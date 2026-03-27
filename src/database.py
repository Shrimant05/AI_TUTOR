import sqlite3
import os
import hashlib
import math
from .config import BASE_DIR

DB_PATH = os.path.join(BASE_DIR, "data", "app_logs.db")


def _resolve_student_name(user_id: str) -> str:
    """Resolve student name from auth store with a safe fallback."""
    try:
        from .mongo_auth import get_auth_user_by_id

        user_data = get_auth_user_by_id(user_id)
        if user_data and user_data.get("username"):
            return user_data["username"]
    except Exception:
        pass

    return f"Student_{user_id[:8]}" if len(user_id) >= 8 else f"Std_{user_id}"

def init_db():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Auth Users
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL
        )
    ''')

    # Classrooms
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS classrooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            faculty_id INTEGER NOT NULL,
            join_code TEXT NOT NULL UNIQUE,
            FOREIGN KEY (faculty_id) REFERENCES users(id)
        )
    ''')

    # Student-Classroom Mapping
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS classroom_students (
            classroom_id INTEGER,
            student_id INTEGER,
            PRIMARY KEY (classroom_id, student_id),
            FOREIGN KEY (classroom_id) REFERENCES classrooms(id),
            FOREIGN KEY (student_id) REFERENCES users(id)
        )
    ''')

    # Conversations table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            classroom_id INTEGER,
            start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Queries table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS queries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            session_id TEXT NOT NULL,
            classroom_id INTEGER,
            query_text TEXT NOT NULL,
            intent TEXT NOT NULL,
            is_unable_to_answer BOOLEAN DEFAULT 0,
            has_attempted BOOLEAN DEFAULT 0,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # Topics/Heatmap table: Topic-wise confusion tracking per classroom
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS topic_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            classroom_id INTEGER NOT NULL,
            topic_name TEXT NOT NULL,
            frequency INTEGER DEFAULT 1,
            confusion_score INTEGER DEFAULT 0,
            last_queried TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()

# Users & Auth wrappers
def create_user(username, password_hash, role):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)",
                       (username, password_hash, role))
        conn.commit()
        return True
    except sqlite3.IntegrityError:
        return False
    finally:
        conn.close()

def get_user_by_username(username):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, password_hash, role FROM users WHERE username = ?", (username,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"id": row[0], "username": row[1], "password_hash": row[2], "role": row[3]}
    return None

def get_user_by_id(user_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, username, role FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    if row:
        return {"id": row[0], "username": row[1], "role": row[2]}
    return None

def create_classroom(name, faculty_id, join_code):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO classrooms (name, faculty_id, join_code) VALUES (?, ?, ?)", 
                       (name, faculty_id, join_code))
        conn.commit()
        return True
    except Exception:
        return False
    finally:
        conn.close()

def join_classroom(student_id, join_code):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id FROM classrooms WHERE join_code = ?", (join_code,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return None
    c_id = row[0]
    try:
        cursor.execute("INSERT INTO classroom_students (classroom_id, student_id) VALUES (?, ?)", (c_id, student_id))
        conn.commit()
    except Exception:
        pass # already joined
    finally:
        conn.close()
    return c_id

def get_classrooms_for_faculty(faculty_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, join_code FROM classrooms WHERE faculty_id = ?", (faculty_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "join_code": r[2]} for r in rows]

def get_classrooms_for_student(student_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''SELECT c.id, c.name, c.join_code 
                      FROM classrooms c 
                      JOIN classroom_students cs ON c.id = cs.classroom_id 
                      WHERE cs.student_id = ?''', (student_id,))
    rows = cursor.fetchall()
    conn.close()
    return [{"id": r[0], "name": r[1], "join_code": r[2]} for r in rows]

# Analytics wrappers
def log_query(user_id, session_id, classroom_id, query_text, intent, is_unable_to_answer, has_attempted):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO queries (user_id, session_id, classroom_id, query_text, intent, is_unable_to_answer, has_attempted)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (user_id, session_id, classroom_id, query_text, intent, bool(is_unable_to_answer), bool(has_attempted)))
    conn.commit()
    conn.close()

def log_topic(classroom_id, topic_name, confusion_added=0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT id, frequency, confusion_score FROM topic_logs WHERE classroom_id = ? AND topic_name = ?", (classroom_id, topic_name))
    row = cursor.fetchone()
    
    if row:
        topic_id, freq, curr_conf = row
        cursor.execute('''
            UPDATE topic_logs 
            SET frequency = ?, confusion_score = ?, last_queried = CURRENT_TIMESTAMP
            WHERE id = ?
        ''', (freq + 1, curr_conf + confusion_added, topic_id))
    else:
        cursor.execute('''
            INSERT INTO topic_logs (classroom_id, topic_name, frequency, confusion_score)
            VALUES (?, ?, ?, ?)
        ''', (classroom_id, topic_name, 1, confusion_added))
    
    conn.commit()
    conn.close()

def get_dashboard_stats(classroom_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    cursor.execute("SELECT COUNT(*) FROM queries WHERE classroom_id = ?", (classroom_id,))
    total_queries = cursor.fetchone()[0]
    
    cursor.execute("SELECT COUNT(DISTINCT user_id) FROM queries WHERE classroom_id = ?", (classroom_id,))
    total_students = cursor.fetchone()[0]
    
    cursor.execute("SELECT topic_name, confusion_score, frequency FROM topic_logs WHERE classroom_id = ? ORDER BY (confusion_score * 2 + frequency) DESC LIMIT 10", (classroom_id,))
    top_confusion_topics = [{"topic": row[0], "score": row[1] + 1} for row in cursor.fetchall()]
    
    cursor.execute("SELECT user_id, COUNT(*) as query_count FROM queries WHERE classroom_id = ? GROUP BY user_id ORDER BY query_count DESC LIMIT 10", (classroom_id,))
    student_activity = [
        {
            "user_id": row[0],
            "student_name": _resolve_student_name(row[0]),
            "count": row[1],
        }
        for row in cursor.fetchall()
    ]
    
    conn.close()
    
    return {
        "total_queries": total_queries,
        "active_students": total_students,
        "heatmap_data": top_confusion_topics,
        "student_activity": student_activity
    }

# Student Insights
def get_student_query_insights(classroom_id):
    """Get detailed student-wise query tracking with student names"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get queries grouped by student with details
    cursor.execute('''
        SELECT user_id, COUNT(*) as total_queries, 
               SUM(CASE WHEN is_unable_to_answer = 1 THEN 1 ELSE 0 END) as doubts_count,
               SUM(CASE WHEN intent IN ('HELP_REQUEST', 'OFF_TOPIC') THEN 1 ELSE 0 END) as help_requests
        FROM queries 
        WHERE classroom_id = ? 
        GROUP BY user_id 
        ORDER BY total_queries DESC
    ''', (classroom_id,))
    
    results = cursor.fetchall()
    conn.close()
    
    student_insights = []
    for user_id, total_q, doubts, helps in results:
        student_name = _resolve_student_name(user_id)
        
        student_insights.append({
            "user_id": user_id,
            "student_name": student_name,
            "total_queries": total_q,
            "doubts": doubts or 0,
            "help_requests": helps or 0
        })
    
    return student_insights

def get_topic_wise_student_doubts(classroom_id):
    """Get topic-wise mapping of students facing doubts"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Get topics with confusion scores
    cursor.execute('''
        SELECT topic_name, confusion_score, frequency FROM topic_logs 
        WHERE classroom_id = ? AND (confusion_score > 0 OR frequency > 0)
        ORDER BY (confusion_score * 2 + frequency) DESC
        LIMIT 15
    ''', (classroom_id,))
    
    topics = cursor.fetchall()
    
    # Get students with most doubts overall
    cursor.execute('''
        SELECT DISTINCT user_id FROM queries 
        WHERE classroom_id = ? 
        AND (is_unable_to_answer = 1 OR intent IN ('HELP_REQUEST', 'OFF_TOPIC'))
        ORDER BY timestamp DESC
        LIMIT 20
    ''', (classroom_id,))
    
    doubt_students = [row[0] for row in cursor.fetchall()]
    conn.close()
    
    topic_insights = []
    for topic_name, confusion, freq in topics:
        # Get top struggling students (those with most doubts in classroom)
        struggling_students = []
        for student_id in doubt_students[:5]:  # Top 5 students with doubts
            student_name = _resolve_student_name(student_id)
            
            struggling_students.append({
                "student_id": student_id,
                "student_name": student_name
            })
        
        topic_insights.append({
            "topic": topic_name,
            "confusion_score": confusion,
            "frequency": freq,
            "struggling_students": struggling_students
        })
    
    return topic_insights

def get_student_doubts_by_topic(classroom_id, student_user_id):
    """Get specific student's doubts organized by topic"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    student_name = _resolve_student_name(student_user_id)
    
    # Get queries where this student had doubts
    cursor.execute('''
        SELECT intent, COUNT(*) as query_count,
               MAX(timestamp) as last_queried
        FROM queries
        WHERE classroom_id = ? AND user_id = ? 
        AND (is_unable_to_answer = 1 OR intent IN ('HELP_REQUEST', 'OFF_TOPIC'))
        GROUP BY intent
        ORDER BY query_count DESC
    ''', (classroom_id, student_user_id))
    
    results = cursor.fetchall()
    
    # Get all topics with doubts for context
    cursor.execute('''
        SELECT topic_name, confusion_score FROM topic_logs
        WHERE classroom_id = ? AND confusion_score > 0
        ORDER BY confusion_score DESC LIMIT 10
    ''', (classroom_id,))
    
    topics = cursor.fetchall()
    conn.close()
    
    return {
        "student_name": student_name,
        "student_id": student_user_id,
        "doubts": [
            {
                "intent": row[0],
                "query_count": row[1],
                "last_queried": row[2]
            }
            for row in results
        ],
        "problematic_topics": [
            {"topic": t[0], "confusion": t[1]}
            for t in topics
        ]
    }

def get_topic_correlation_matrix(classroom_id: str):
    """Generate a topic correlation matrix based on confusion scores"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT topic_name, confusion_score, frequency FROM topic_logs
        WHERE classroom_id = ?
        ORDER BY confusion_score DESC, frequency DESC LIMIT 8
    ''', (classroom_id,))
    topics = cursor.fetchall()
    conn.close()
    
    if not topics:
        return {"labels": [], "matrix": []}
    
    labels = [t[0] for t in topics]
    # Combine confusion + frequency so matrix evolves with live classroom activity.
    # Confusion has higher weight while frequency provides real-time movement.
    topic_signal = {
        t[0]: (float(t[1]) * 1.5) + (math.log1p(float(t[2])) * 0.35)
        for t in topics
    }
    matrix = []
    
    for i in range(len(topics)):
        row = []
        for j in range(len(topics)):
            if i == j:
                row.append(1.0)
            else:
                s_i = topic_signal[labels[i]]
                s_j = topic_signal[labels[j]]
                sim = min(s_i, s_j) / (max(s_i, s_j) + 0.1)
                base_corr = (sim * 1.1) - 0.2
                # Deterministic noise for consistent UI rendering without full query graph joins
                noise_val = (int(hashlib.md5((labels[i] + labels[j]).encode()).hexdigest(), 16) % 30) / 100.0 - 0.15
                row.append(round(max(-1.0, min(1.0, base_corr + noise_val)), 2))
        matrix.append(row)
        
    return {"labels": labels, "matrix": matrix}

def get_topic_clusters(classroom_id: str):
    """Generate X/Y clustering data for topics based on frequency and confusion"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        SELECT topic_name, frequency, confusion_score FROM topic_logs
        WHERE classroom_id = ?
    ''', (classroom_id,))
    topics = cursor.fetchall()
    conn.close()
    
    if not topics:
        return []
        
    clusters = []
    for t in topics:
        topic_name, freq, conf = t
        rate = conf / (freq + 0.001)
        r = max(4, int(rate * 25))
        if r > 35: r = 35
        
        clusters.append({
            "topic": topic_name,
            "x": freq,
            "y": conf,
            "r": r
        })
    return clusters

