import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import shutil
import random
import string
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from src.ingest import IngestionPipeline
from src.retriever import HybridParentRetriever
from src.main import socratic_agent, classify_intent
from src.database import (
    init_db, log_query, log_topic, get_dashboard_stats,
    create_user, get_user_by_username, create_classroom,
    join_classroom, get_classrooms_for_faculty, get_classrooms_for_student
)
from src.config import DATA_DIR
from src.main import _student_unable_to_answer, _student_attempted_solution
from src.auth import get_password_hash, verify_password, create_access_token, get_current_user

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(DATA_DIR, exist_ok=True)

@app.on_event("startup")
def startup_event():
    init_db()

# --- Auth Schemas ---
class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str # "faculty" or "student"

class LoginRequest(BaseModel):
    username: str
    password: str

# --- Auth Endpoints ---

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    username = req.username.strip()
    role = req.role.strip().lower()

    if not username:
        raise HTTPException(status_code=400, detail="Username is required")
    if role not in ["faculty", "student"]:
        raise HTTPException(status_code=400, detail="Invalid role")
    p_hash = get_password_hash(req.password)
    success = create_user(username, p_hash, role)
    if not success:
        raise HTTPException(status_code=400, detail="Username already exists")
    return {"message": "User created successfully"}

@app.post("/api/auth/login")
def login(req: LoginRequest):
    username = req.username.strip()
    if not username:
        raise HTTPException(status_code=400, detail="Username is required")

    user = get_user_by_username(username)
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")
    
    token = create_access_token(data={"sub": str(user["id"]), "role": user["role"]})
    return {"access_token": token, "token_type": "bearer", "role": user["role"], "username": user["username"]}


# --- Classroom Schemas ---
class CreateClassroomRequest(BaseModel):
    name: str

class JoinClassroomRequest(BaseModel):
    join_code: str

# --- Classroom Endpoints ---
def generate_join_code(length=6):
    return ''.join(random.choices(string.ascii_uppercase + string.digits, k=length))

@app.post("/api/classrooms")
def create_new_classroom(req: CreateClassroomRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Only faculty can create classrooms")
    code = generate_join_code()
    success = create_classroom(req.name, int(current_user["user_id"]), code)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to create classroom")
    return {"message": "Classroom created", "join_code": code}

@app.post("/api/classrooms/join")
def join_existing_classroom(req: JoinClassroomRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "student":
        raise HTTPException(status_code=403, detail="Only students can join classrooms via code")
    c_id = join_classroom(int(current_user["user_id"]), req.join_code.strip().upper())
    if not c_id:
        raise HTTPException(status_code=404, detail="Invalid join code")
    return {"message": "Successfully joined classroom"}

@app.get("/api/classrooms")
def retrieve_classrooms(current_user: dict = Depends(get_current_user)):
    uid = int(current_user["user_id"])
    if current_user["role"] == "faculty":
        return {"classrooms": get_classrooms_for_faculty(uid)}
    else:
        return {"classrooms": get_classrooms_for_student(uid)}


# --- Chat & Analytics ---

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    classroom_id: str
    session_id: str
    query: str
    history: List[ChatMessage] = []

class ChatResponse(BaseModel):
    reply: str
    intent: str
    citations: list = []

@app.post("/api/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest, current_user: dict = Depends(get_current_user)):
    retriever = HybridParentRetriever(classroom_id=str(req.classroom_id))
    
    intent = classify_intent(req.query, history=[h.dict() for h in req.history])
    unable = _student_unable_to_answer(req.query, history=[h.dict() for h in req.history])
    attempted = _student_attempted_solution(req.query, history=[h.dict() for h in req.history])
    
    log_query(current_user["user_id"], req.session_id, req.classroom_id, req.query, intent, unable, attempted)
    
    result_data = socratic_agent(req.query, retriever, history=[h.dict() for h in req.history], user_id=current_user["user_id"])
    
    reply_text = result_data.get("reply", "I am having trouble processing that right now.")
    citations = result_data.get("citations", [])
    
    if citations and len(citations) > 0:
        topic_name = citations[0].get("file", "unknown_topic")
        confusion_val = 1 if (unable or intent == "HELP_REQUEST" or intent == "OFF_TOPIC") else 0
        log_topic(req.classroom_id, topic_name, confusion_added=confusion_val)
    
    return ChatResponse(
        reply=reply_text, 
        intent=intent,
        citations=citations
    )

@app.get("/api/dashboard/stats")
async def dashboard_stats(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return get_dashboard_stats(classroom_id)

@app.post("/api/upload_notes")
async def upload_notes(
    file: UploadFile = File(...), 
    classroom_id: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    class_dir = os.path.join(DATA_DIR, classroom_id)
    os.makedirs(class_dir, exist_ok=True)
    file_path = os.path.join(class_dir, file.filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    pipeline = IngestionPipeline(classroom_id=classroom_id)
    pipeline.process_pdf(file_path, file.filename, force_reindex=True)
    
    return {"filename": file.filename, "status": "indexed"}

@app.get("/api/notes")
async def list_notes(classroom_id: str, current_user: dict = Depends(get_current_user)):
    # Fallback to general data dir checking to prevent crash if not uploaded yet
    class_dir = os.path.join(DATA_DIR, classroom_id)
    files = []
    if os.path.exists(class_dir):
        files = [f for f in os.listdir(class_dir) if f.endswith('.pdf') or f.endswith('.txt')]
    return {"notes": files}

@app.delete("/api/notes/{filename}")
async def delete_note(filename: str, classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    class_dir = os.path.join(DATA_DIR, classroom_id)
    file_path = os.path.join(class_dir, filename)
    
    if os.path.exists(file_path):
        os.remove(file_path)
        
    pipeline = IngestionPipeline(classroom_id=classroom_id)
    try:
        col = pipeline.client.get_collection(name=pipeline.collection_name)
        col.delete(where={"source_file": filename})
    except Exception as e:
        print("Purge error:", e)
    
    return {"message": "Success"}
