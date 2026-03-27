import sqlite3
import os
import hashlib
from .config import BASE_DIR

DB_PATH = os.path.join(BASE_DIR, "data", "app_logs.db")

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
    student_activity = [{"user": row[0], "count": row[1]} for row in cursor.fetchall()]
    
    conn.close()
    
    return {
        "total_queries": total_queries,
        "active_students": total_students,
        "heatmap_data": top_confusion_topics,
        "student_activity": student_activity
    }
