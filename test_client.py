import requests

# 1. Register a test faculty
res = requests.post("http://localhost:8000/api/auth/register", json={
    "username": "tester", "password": "123", "role": "faculty"
})
print("Register:", res.status_code, res.text)

# 2. Login
res = requests.post("http://localhost:8000/api/auth/login", json={
    "username": "tester", "password": "123"
})
print("Login:", res.status_code, res.text)
token = res.json().get("access_token")

# 3. Create classroom
res = requests.post("http://localhost:8000/api/classrooms", 
    json={"name": "My New Room"},
    headers={"Authorization": f"Bearer {token}"}
)
print("Create Classroom:", res.status_code, res.text)
