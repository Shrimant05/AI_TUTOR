import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import shutil
import random
import string
import re
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, status, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional

from src.ingest import IngestionPipeline
from src.retriever import HybridParentRetriever
from src.main import socratic_agent, classify_intent
from src.database import (
    init_db, log_query, log_topic, get_dashboard_stats,
    create_classroom, join_classroom,
    get_classrooms_for_faculty, get_classrooms_for_student,
    get_student_query_insights, get_topic_wise_student_doubts, 
    get_student_doubts_by_topic
)
from src.mongo_auth import (
    init_mongo_auth, create_auth_user, get_auth_user_by_username,
    get_auth_user_by_id, create_session, revoke_session, update_last_login,
    save_chat_history, get_chat_histories
)
from src.config import DATA_DIR, normalize_classroom_id
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
    init_mongo_auth()

# --- Auth Schemas ---
class RegisterRequest(BaseModel):
    username: str
    password: str
    role: str # "faculty" or "student"

class LoginRequest(BaseModel):
    username: str
    password: str


def validate_auth_input(username: str, password: str):
    normalized_username = (username or "").strip()
    if len(normalized_username) < 3 or len(normalized_username) > 64:
        raise HTTPException(status_code=400, detail="Username must be 3-64 characters")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", normalized_username):
        raise HTTPException(status_code=400, detail="Username contains invalid characters")
    if len(password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    return normalized_username

# --- Auth Endpoints ---

@app.post("/api/auth/register")
def register(req: RegisterRequest):
    username = validate_auth_input(req.username, req.password)
    role = req.role.strip().lower()

    if role not in ["faculty", "student"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    if get_auth_user_by_username(username):
        raise HTTPException(status_code=400, detail="Username already exists")

    p_hash = get_password_hash(req.password)
    if not create_auth_user(username, p_hash, role):
        raise HTTPException(status_code=500, detail="Failed to initialize auth profile")

    return {"message": "User created successfully"}

@app.post("/api/auth/login")
def login(req: LoginRequest, request: Request):
    username = validate_auth_input(req.username, req.password)

    auth_user = get_auth_user_by_username(username)

    if not auth_user or not auth_user.get("is_active", False) or not verify_password(req.password, auth_user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token_data = create_access_token(data={
        "sub": str(auth_user["_id"]),
        "role": auth_user["role"],
    })
    create_session(
        user_id=str(auth_user["_id"]),
        jti=token_data["jti"],
        expires_at=token_data["expires_at"],
        created_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent", "")[:255],
    )
    update_last_login(str(auth_user["_id"]))

    return {
        "access_token": token_data["token"],
        "token_type": "bearer",
        "role": auth_user["role"],
        "username": auth_user["username"],
    }

@app.get("/api/auth/me")
def get_me(current_user: dict = Depends(get_current_user)):
    user = get_auth_user_by_id(current_user["user_id"])
    if not user or not user.get("is_active", False):
        raise HTTPException(status_code=404, detail="User not found")
    return {"id": str(user["_id"]), "username": user["username"], "role": user["role"]}


@app.post("/api/auth/logout")
def logout(current_user: dict = Depends(get_current_user)):
    revoke_session(current_user["user_id"], current_user["jti"])
    return {"message": "Logged out successfully"}


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
    success = create_classroom(req.name, current_user["user_id"], code)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to create classroom")

    # Provision an isolated vector DB directory + collection at classroom creation time.
    classrooms = get_classrooms_for_faculty(current_user["user_id"])
    created = [c for c in classrooms if c["name"] == req.name and c["join_code"] == code]
    if created:
        IngestionPipeline(classroom_id=str(created[0]["id"])).client.get_or_create_collection(name="materials")

    return {"message": "Classroom created", "join_code": code}

@app.post("/api/classrooms/join")
def join_existing_classroom(req: JoinClassroomRequest, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "student":
        raise HTTPException(status_code=403, detail="Only students can join classrooms via code")
    c_id = join_classroom(current_user["user_id"], req.join_code.strip().upper())
    if not c_id:
        raise HTTPException(status_code=404, detail="Invalid join code")
    return {"message": "Successfully joined classroom"}

@app.get("/api/classrooms")
def retrieve_classrooms(current_user: dict = Depends(get_current_user)):
    uid = current_user["user_id"]
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
    classroom_id = normalize_classroom_id(req.classroom_id)

    if current_user["role"] == "faculty":
        allowed_classrooms = {str(c["id"]) for c in get_classrooms_for_faculty(current_user["user_id"])}
    else:
        allowed_classrooms = {str(c["id"]) for c in get_classrooms_for_student(current_user["user_id"])}

    if classroom_id not in allowed_classrooms:
        raise HTTPException(status_code=403, detail="Not authorized for this classroom")

    class_dir = os.path.join(DATA_DIR, classroom_id)
    allowed_sources = set()
    if os.path.exists(class_dir):
        allowed_sources = {
            f for f in os.listdir(class_dir)
            if f.lower().endswith('.pdf') or f.lower().endswith('.txt')
        }

    retriever = HybridParentRetriever(classroom_id=classroom_id)
    
    intent = classify_intent(req.query, history=[h.dict() for h in req.history])
    unable = _student_unable_to_answer(req.query, history=[h.dict() for h in req.history])
    attempted = _student_attempted_solution(req.query, history=[h.dict() for h in req.history])
    
    log_query(current_user["user_id"], req.session_id, req.classroom_id, req.query, intent, unable, attempted)
    
    result_data = socratic_agent(
        req.query,
        retriever,
        history=[h.dict() for h in req.history],
        user_id=current_user["user_id"],
        allowed_sources=allowed_sources,
    )
    
    reply_text = result_data.get("reply", "I am having trouble processing that right now.")
    citations = result_data.get("citations", [])
    
    if citations and len(citations) > 0:
        topic_name = citations[0].get("file", "unknown_topic")
        confusion_val = 1 if (unable or intent == "HELP_REQUEST" or intent == "OFF_TOPIC") else 0
        log_topic(req.classroom_id, topic_name, confusion_added=confusion_val)

    save_chat_history(
        user_id=current_user["user_id"],
        classroom_id=str(req.classroom_id),
        session_id=req.session_id,
        query=req.query,
        reply=reply_text,
        intent=intent,
        citations=citations,
    )
    
    return ChatResponse(
        reply=reply_text, 
        intent=intent,
        citations=citations
    )


@app.get("/api/chat/history")
def chat_history(
    classroom_id: Optional[str] = None,
    session_id: Optional[str] = None,
    limit: int = 50,
    current_user: dict = Depends(get_current_user)
):
    items = get_chat_histories(
        user_id=current_user["user_id"],
        classroom_id=classroom_id,
        session_id=session_id,
        limit=limit,
    )
    return {"items": items}

@app.get("/api/dashboard/stats")
async def dashboard_stats(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return get_dashboard_stats(classroom_id)

@app.get("/api/dashboard/student-insights")
async def student_insights(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return {"student_insights": get_student_query_insights(classroom_id)}

@app.get("/api/dashboard/topic-students")
async def topic_students(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return {"topic_insights": get_topic_wise_student_doubts(classroom_id)}

@app.get("/api/dashboard/student/{student_id}/doubts")
async def student_doubts(student_id: str, classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return get_student_doubts_by_topic(classroom_id, student_id)

@app.post("/api/upload_notes")
async def upload_notes(
    file: UploadFile = File(...), 
    classroom_id: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    
    classroom_id = normalize_classroom_id(classroom_id)
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
    classroom_id = normalize_classroom_id(classroom_id)
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

    # Prevent path traversal and keep source_file key consistent with ingestion.
    safe_filename = Path(filename).name
    classroom_id = normalize_classroom_id(classroom_id)
    class_dir = os.path.join(DATA_DIR, classroom_id)
    file_path = os.path.join(class_dir, safe_filename)
    
    removed_file = False
    if os.path.exists(file_path):
        os.remove(file_path)
        removed_file = True
        
    deleted_chunks = 0
    pipeline = IngestionPipeline(classroom_id=classroom_id)
    try:
        col = pipeline.client.get_collection(name=pipeline.collection_name)
        # Purge only this classroom's vectors for the deleted file.
        where_filter = {"$and": [{"source_file": safe_filename}, {"classroom_id": classroom_id}]}
        existing = col.get(where=where_filter, include=[])
        ids = existing.get("ids", []) if existing else []
        if ids:
            col.delete(ids=ids)
            deleted_chunks = len(ids)
    except Exception as e:
        print("Purge error:", e)
    
    return {
        "message": "Success",
        "filename": safe_filename,
        "file_deleted": removed_file,
        "vector_chunks_deleted": deleted_chunks,
        "classroom_id": classroom_id,
    }
