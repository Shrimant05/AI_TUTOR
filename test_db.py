import os
from src.database import init_db, create_user, create_classroom

init_db()
print("DB Initialized")
create_user("test_faculty", "hash", "faculty")
print("User created")
import sqlite3
from src.database import DB_PATH
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("SELECT id FROM users WHERE username = 'test_faculty'")
uid = cursor.fetchone()[0]
conn.close()

res = create_classroom("Test Room", uid, "XYZ123")
print("Create Classroom Result:", res)
