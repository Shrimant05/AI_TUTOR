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
            response_time_ms REAL,
            timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # Backward-compatible migration for existing DB files created before latency tracking.
    cursor.execute("PRAGMA table_info(queries)")
    query_columns = [row[1] for row in cursor.fetchall()]
    if "response_time_ms" not in query_columns:
        cursor.execute("ALTER TABLE queries ADD COLUMN response_time_ms REAL")
    
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

    # Chat feedback table to capture thumbs up/down on AI responses.
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_feedback (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id TEXT NOT NULL,
            classroom_id INTEGER NOT NULL,
            session_id TEXT,
            response_id TEXT,
            feedback_value INTEGER NOT NULL,
            response_length INTEGER DEFAULT 0,
            had_citations BOOLEAN DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
def log_query(user_id, session_id, classroom_id, query_text, intent, is_unable_to_answer, has_attempted, response_time_ms=None):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute('''
        INSERT INTO queries (user_id, session_id, classroom_id, query_text, intent, is_unable_to_answer, has_attempted, response_time_ms)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ''', (
        user_id,
        session_id,
        classroom_id,
        query_text,
        intent,
        bool(is_unable_to_answer),
        bool(has_attempted),
        float(response_time_ms) if response_time_ms is not None else None,
    ))
    conn.commit()
    conn.close()


def get_latency_stats(classroom_id):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            COUNT(response_time_ms) as measured_count,
            AVG(response_time_ms) as avg_ms,
            MAX(response_time_ms) as max_ms
        FROM queries
        WHERE classroom_id = ? AND response_time_ms IS NOT NULL
    ''', (classroom_id,))
    overall = cursor.fetchone() or (0, None, None)

    cursor.execute('''
        SELECT
            user_id,
            COUNT(response_time_ms) as response_count,
            AVG(response_time_ms) as avg_ms,
            MAX(response_time_ms) as max_ms
        FROM queries
        WHERE classroom_id = ? AND response_time_ms IS NOT NULL
        GROUP BY user_id
        ORDER BY avg_ms DESC
    ''', (classroom_id,))
    rows = cursor.fetchall()
    conn.close()

    user_rows = []
    for user_id, response_count, avg_ms, max_ms in rows:
        user_rows.append({
            "user_id": user_id,
            "student_name": _resolve_student_name(user_id),
            "response_count": int(response_count or 0),
            "avg_response_time_ms": round(float(avg_ms or 0.0), 2),
            "max_response_time_ms": round(float(max_ms or 0.0), 2),
        })

    measured_count, overall_avg, overall_max = overall
    return {
        "classroom_id": str(classroom_id),
        "measured_responses": int(measured_count or 0),
        "overall_avg_response_time_ms": round(float(overall_avg or 0.0), 2),
        "overall_max_response_time_ms": round(float(overall_max or 0.0), 2),
        "users": user_rows,
    }

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


def save_chat_feedback(
    user_id,
    classroom_id,
    session_id,
    response_id,
    feedback_value,
    response_length,
    had_citations,
):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    if response_id:
        cursor.execute('''
            SELECT id FROM chat_feedback
            WHERE user_id = ? AND classroom_id = ? AND response_id = ?
            ORDER BY id DESC LIMIT 1
        ''', (user_id, classroom_id, response_id))
        existing = cursor.fetchone()
        if existing:
            cursor.execute('''
                UPDATE chat_feedback
                SET feedback_value = ?, response_length = ?, had_citations = ?,
                    session_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
            ''', (
                int(feedback_value),
                int(response_length or 0),
                1 if had_citations else 0,
                session_id,
                existing[0],
            ))
            conn.commit()
            conn.close()
            return

    cursor.execute('''
        INSERT INTO chat_feedback
        (user_id, classroom_id, session_id, response_id, feedback_value, response_length, had_citations)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    ''', (
        user_id,
        classroom_id,
        session_id,
        response_id,
        int(feedback_value),
        int(response_length or 0),
        1 if had_citations else 0,
    ))
    conn.commit()
    conn.close()


def get_feedback_preferences(user_id, classroom_id):
    """Infer lightweight response-style preferences from thumbs feedback."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute('''
        SELECT
            feedback_value,
            COUNT(*) as cnt,
            AVG(response_length) as avg_len,
            AVG(CASE WHEN had_citations = 1 THEN 1.0 ELSE 0.0 END) as citation_rate
        FROM chat_feedback
        WHERE user_id = ? AND classroom_id = ?
        GROUP BY feedback_value
    ''', (user_id, classroom_id))
    rows = cursor.fetchall()
    conn.close()

    by_value = {int(v): {"count": c, "avg_len": l or 0.0, "citation_rate": r or 0.0} for v, c, l, r in rows}
    up = by_value.get(1, {"count": 0, "avg_len": 0.0, "citation_rate": 0.0})
    down = by_value.get(-1, {"count": 0, "avg_len": 0.0, "citation_rate": 0.0})
    total = int(up["count"] + down["count"])

    if total < 3:
        return ""

    preferences = []

    if up["avg_len"] > 0 and down["avg_len"] > 0:
        if up["avg_len"] < (down["avg_len"] * 0.8):
            preferences.append("Prefer concise responses (about 3-6 sentences) unless the student asks for detail.")
        elif up["avg_len"] > (down["avg_len"] * 1.2):
            preferences.append("Prefer more detailed, step-by-step responses before asking the next question.")

    citation_delta = float(up["citation_rate"] - down["citation_rate"])
    if citation_delta > 0.2:
        preferences.append("Include source citations whenever relevant; the student responds better to cited answers.")
    elif citation_delta < -0.2:
        preferences.append("Keep citations brief and only include the most relevant source to avoid clutter.")

    if down["count"] > up["count"] and total >= 5:
        preferences.append("Ask one short clarifying question before giving guidance when the prompt is ambiguous.")

    return " ".join(preferences).strip()

