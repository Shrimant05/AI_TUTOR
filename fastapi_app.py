import os
os.environ["KMP_DUPLICATE_LIB_OK"] = "TRUE"
import shutil
import io
import zipfile
import random
import string
import re
import tempfile
import base64
import mimetypes
import time
import requests
import uuid
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, Form, Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Optional
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests

from src.ingest import IngestionPipeline
from src.retriever import HybridParentRetriever
from src.main import socratic_agent, classify_intent
from src.database import (
    init_db, log_query, log_topic, get_dashboard_stats,
    create_classroom, join_classroom,
    get_classrooms_for_faculty, get_classrooms_for_student,
    get_student_query_insights, get_topic_wise_student_doubts, 
    get_student_doubts_by_topic, get_latency_stats, save_chat_feedback, get_feedback_preferences
)
from src.mongo_auth import (
    init_mongo_auth, create_auth_user, get_auth_user_by_username,
    get_auth_user_by_id, get_auth_user_by_google_sub, create_google_auth_user,
    create_session, revoke_session, update_last_login,
    save_chat_history, get_chat_histories
)
from src.config import DATA_DIR, normalize_classroom_id
from src.config import GOOGLE_CLIENT_ID
from src.config import GEMINI_API_KEY, GEMINI_VISION_MODEL
from src.main import _student_unable_to_answer, _student_attempted_solution
from src.auth import get_password_hash, verify_password, create_access_token, get_current_user
from pypdf import PdfReader
try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from paddleocr import PaddleOCR
except Exception:
    PaddleOCR = None

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(DATA_DIR, exist_ok=True)
_ocr_engine = None


def _get_ocr_engine():
    global _ocr_engine
    if PaddleOCR is None:
        return None
    if _ocr_engine is None:
        try:
            _ocr_engine = PaddleOCR(use_angle_cls=True, lang="en")
        except Exception:
            return None
    return _ocr_engine


def _extract_text_from_ocr_result(result) -> str:
    lines = []
    for block in result or []:
        for item in block or []:
            try:
                text = str(item[1][0]).strip()
            except Exception:
                text = ""
            if text:
                lines.append(text)
    return "\n".join(lines)


def _run_ocr(engine, image_path: str):
    """Run OCR across PaddleOCR versions where `cls` may or may not be supported."""
    try:
        return engine.ocr(image_path, cls=True)
    except TypeError:
        # Newer PaddleOCR versions can reject cls in predict/ocr path.
        try:
            return engine.ocr(image_path)
        except Exception:
            return []
    except Exception:
        # Any Paddle runtime/Ops/OneDNN issue should trigger cloud fallback, not fail the request.
        return []


def _gemini_vision_ocr(image_items: list[tuple[bytes, str]]) -> str:
    """Use Gemini Vision as OCR fallback for images/scanned PDFs."""
    if not GEMINI_API_KEY or not image_items:
        return ""

    configured = (GEMINI_VISION_MODEL or "").strip().replace("models/", "")
    candidate_models = [
        configured,
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
    ]
    candidate_models = [m for i, m in enumerate(candidate_models) if m and m not in candidate_models[:i]]

    parts = [{
        "text": "Transcribe all readable text from these study images. Preserve equations and symbols. Return plain text only."
    }]

    for image_bytes, mime_type in image_items:
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": base64.b64encode(image_bytes).decode("utf-8")
            }
        })

    payload = {
        "contents": [{"parts": parts}],
        "generationConfig": {
            "temperature": 0,
            "maxOutputTokens": 4096,
        },
    }

    for model_name in candidate_models:
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model_name}:generateContent?key={GEMINI_API_KEY}"
        try:
            resp = requests.post(url, json=payload, timeout=45)
            if not resp.ok:
                continue
            data = resp.json()
            text = (
                data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                    .strip()
            )
            if text:
                return text
        except Exception:
            continue

    return ""

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


class GoogleAuthRequest(BaseModel):
    id_token: str
    role: Optional[str] = None
    username: Optional[str] = None


def validate_auth_input(username: str, password: str):
    normalized_username = (username or "").strip()
    if len(normalized_username) < 3 or len(normalized_username) > 64:
        raise HTTPException(status_code=400, detail="Username must be 3-64 characters")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", normalized_username):
        raise HTTPException(status_code=400, detail="Username contains invalid characters")
    if len(password or "") < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    return normalized_username


def validate_username_only(username: str):
    normalized_username = (username or "").strip()
    if len(normalized_username) < 3 or len(normalized_username) > 64:
        raise HTTPException(status_code=400, detail="Username must be 3-64 characters")
    if not re.fullmatch(r"[A-Za-z0-9_.-]+", normalized_username):
        raise HTTPException(status_code=400, detail="Username contains invalid characters")
    return normalized_username

# --- Auth Endpoints ---


def _issue_session_token(auth_user: dict, request: Request):
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

    return _issue_session_token(auth_user, request)


@app.post("/api/auth/token")
def oauth_token(form_data: OAuth2PasswordRequestForm = Depends(), request: Request = None):
    username = validate_auth_input(form_data.username, form_data.password)
    auth_user = get_auth_user_by_username(username)

    if not auth_user or not auth_user.get("is_active", False) or not verify_password(form_data.password, auth_user["password_hash"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # Keep response fields used by current frontend while remaining OAuth2-compatible.
    if request is None:
        raise HTTPException(status_code=500, detail="Request context unavailable")
    return _issue_session_token(auth_user, request)


@app.post("/api/auth/google")
def google_auth(req: GoogleAuthRequest, request: Request):
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(status_code=500, detail="GOOGLE_CLIENT_ID is not configured")

    try:
        id_info = id_token.verify_oauth2_token(req.id_token, google_requests.Request(), GOOGLE_CLIENT_ID)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid Google token")

    if id_info.get("iss") not in ["accounts.google.com", "https://accounts.google.com"]:
        raise HTTPException(status_code=401, detail="Invalid token issuer")

    google_sub = str(id_info.get("sub") or "").strip()
    email = str(id_info.get("email") or "").strip()
    if not google_sub:
        raise HTTPException(status_code=400, detail="Google profile is missing required fields")

    auth_user = get_auth_user_by_google_sub(google_sub)
    if not auth_user:
        requested_username = (req.username or "").strip()
        requested_role = (req.role or "").strip().lower()

        if requested_role not in ["faculty", "student"]:
            raise HTTPException(status_code=400, detail="Role is required for first-time Google registration")
        if not requested_username:
            raise HTTPException(status_code=400, detail="Name is required for first-time Google registration")

        display_name = validate_username_only(requested_username)
        created = create_google_auth_user(
            username=display_name,
            role=requested_role,
            google_sub=google_sub,
            email=email,
        )
        if not created:
            # Fallback when username is already taken; use deterministic suffix from Google subject.
            unique_username = f"{display_name}_{google_sub[-6:]}"
            if not create_google_auth_user(
                username=unique_username,
                role=requested_role,
                google_sub=google_sub,
                email=email,
            ):
                raise HTTPException(status_code=500, detail="Unable to create Google account")

        auth_user = get_auth_user_by_google_sub(google_sub)

    if not auth_user or not auth_user.get("is_active", False):
        raise HTTPException(status_code=401, detail="User inactive or not found")

    return _issue_session_token(auth_user, request)

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


def _allowed_classroom_ids(current_user: dict):
    if current_user["role"] == "faculty":
        return {str(c["id"]) for c in get_classrooms_for_faculty(current_user["user_id"])}
    return {str(c["id"]) for c in get_classrooms_for_student(current_user["user_id"])}


def _assert_classroom_access(classroom_id: str, current_user: dict):
    normalized = normalize_classroom_id(classroom_id)
    if normalized not in _allowed_classroom_ids(current_user):
        raise HTTPException(status_code=403, detail="Not authorized for this classroom")
    return normalized

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
    response_id: Optional[str] = None


class ChatFeedbackRequest(BaseModel):
    classroom_id: str
    session_id: Optional[str] = None
    response_id: Optional[str] = None
    feedback: str  # "up" | "down"
    reply_text: Optional[str] = ""
    had_citations: bool = False


def _extract_attachment_text(filename: str, raw_bytes: bytes, content_type: str = "") -> tuple[str, str]:
    ext = Path(filename or "").suffix.lower()
    mime = (content_type or "").lower().strip()

    if ext in {".txt", ".md", ".csv", ".json", ".py"}:
        return (raw_bytes.decode("utf-8", errors="ignore"), "TEXT")

    if ext == ".pdf":
        chunks = []

        # 1) Normal PDF text extraction
        try:
            reader = PdfReader(io.BytesIO(raw_bytes))
            for page in reader.pages:
                txt = (page.extract_text() or "").strip()
                if txt:
                    chunks.append(txt)
        except Exception:
            chunks = []

        if chunks:
            return ("\n".join(chunks), "PDF")

        # 2) OCR fallback for scanned/image-only PDFs
        if fitz is None:
            return ("", "PDF")
        engine = _get_ocr_engine()

        try:
            doc = fitz.open(stream=raw_bytes, filetype="pdf")
        except Exception:
            return ("", "PDF")

        ocr_chunks = []
        page_pngs = []
        try:
            for page in doc:
                pix = page.get_pixmap(matrix=fitz.Matrix(2, 2))
                try:
                    page_png = pix.tobytes("png")
                except Exception:
                    page_png = b""
                if page_png and len(page_pngs) < 6:
                    page_pngs.append((page_png, "image/png"))
                temp_path = None
                try:
                    with tempfile.NamedTemporaryFile(delete=False, suffix=".png") as temp_file:
                        temp_file.write(page_png if page_png else pix.tobytes("png"))
                        temp_path = temp_file.name
                    if engine is not None:
                        result = _run_ocr(engine, temp_path)
                        text = _extract_text_from_ocr_result(result)
                        if text.strip():
                            ocr_chunks.append(text)
                finally:
                    if temp_path and os.path.exists(temp_path):
                        os.remove(temp_path)
        finally:
            doc.close()

        local_text = "\n".join(ocr_chunks).strip()
        if local_text:
            return (local_text, "PDF")

        # Cloud fallback for scanned PDFs
        cloud_text = _gemini_vision_ocr(page_pngs)
        return (cloud_text, "PDF")

    image_exts = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".gif", ".tif", ".tiff", ".heic", ".heif"}
    if ext in image_exts or mime.startswith("image/"):
        engine = _get_ocr_engine()
        mime_map = {
            ".png": "image/png",
            ".jpg": "image/jpeg",
            ".jpeg": "image/jpeg",
            ".bmp": "image/bmp",
            ".webp": "image/webp",
            ".gif": "image/gif",
            ".tif": "image/tiff",
            ".tiff": "image/tiff",
            ".heic": "image/heic",
            ".heif": "image/heif",
        }

        local_text = ""
        if engine is not None:
            temp_path = None
            try:
                with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as temp_file:
                    temp_file.write(raw_bytes)
                    temp_path = temp_file.name

                result = _run_ocr(engine, temp_path)
                local_text = _extract_text_from_ocr_result(result)
            finally:
                if temp_path and os.path.exists(temp_path):
                    os.remove(temp_path)

        if local_text.strip():
            return (local_text, "IMAGE")

        cloud_text = _gemini_vision_ocr([(raw_bytes, mime_map.get(ext, mime if mime.startswith("image/") else "image/png"))])
        return (cloud_text, "IMAGE")

    raise HTTPException(status_code=400, detail=f"Unsupported file type: {ext or 'unknown'}")

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
    preference_hint = get_feedback_preferences(current_user["user_id"], classroom_id)
    
    intent = classify_intent(req.query, history=[h.dict() for h in req.history])
    unable = _student_unable_to_answer(req.query, history=[h.dict() for h in req.history])
    attempted = _student_attempted_solution(req.query, history=[h.dict() for h in req.history])

    start_t = time.perf_counter()
    result_data = socratic_agent(
        req.query,
        retriever,
        history=[h.dict() for h in req.history],
        user_id=current_user["user_id"],
        allowed_sources=allowed_sources,
        response_preferences=preference_hint,
    )
    elapsed_ms = (time.perf_counter() - start_t) * 1000.0
    
    reply_text = result_data.get("reply", "I am having trouble processing that right now.")
    citations = result_data.get("citations", [])
    
    if citations and len(citations) > 0:
        topic_name = citations[0].get("file", "unknown_topic")
        confusion_val = 1 if (unable or intent == "HELP_REQUEST" or intent == "OFF_TOPIC") else 0
        log_topic(req.classroom_id, topic_name, confusion_added=confusion_val)

    log_query(
        current_user["user_id"],
        req.session_id,
        req.classroom_id,
        req.query,
        intent,
        unable,
        attempted,
        response_time_ms=elapsed_ms,
    )

    save_chat_history(
        user_id=current_user["user_id"],
        classroom_id=str(req.classroom_id),
        session_id=req.session_id,
        query=req.query,
        reply=reply_text,
        intent=intent,
        citations=citations,
    )
    response_id = str(uuid.uuid4())
    
    return ChatResponse(
        reply=reply_text, 
        intent=intent,
        citations=citations,
        response_id=response_id,
    )


@app.post("/api/chat/feedback")
async def chat_feedback(req: ChatFeedbackRequest, current_user: dict = Depends(get_current_user)):
    classroom_id = _assert_classroom_access(req.classroom_id, current_user)
    fb = (req.feedback or "").strip().lower()
    if fb not in {"up", "down"}:
        raise HTTPException(status_code=400, detail="feedback must be 'up' or 'down'")

    save_chat_feedback(
        user_id=current_user["user_id"],
        classroom_id=classroom_id,
        session_id=req.session_id or "",
        response_id=(req.response_id or "").strip() or None,
        feedback_value=1 if fb == "up" else -1,
        response_length=len((req.reply_text or "").strip()),
        had_citations=bool(req.had_citations),
    )

    return {"status": "ok", "feedback": fb, "classroom_id": classroom_id}


@app.post("/api/chat/parse-attachment")
async def parse_chat_attachment(
    file: UploadFile = File(...),
    classroom_id: str = Form(...),
    current_user: dict = Depends(get_current_user)
):
    classroom_id = _assert_classroom_access(classroom_id, current_user)

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File is too large. Max size is 10MB")

    try:
        extracted_text, file_type = _extract_attachment_text(file.filename or "attachment", raw, file.content_type or "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse attachment: {str(e)}")
    extracted_text = (extracted_text or "").strip()
    notice = None
    if not extracted_text:
        if file_type == "IMAGE":
            extracted_text = "[Image uploaded. OCR is not available in the current backend environment. Please type key points from the image in your message.]"
            notice = "OCR unavailable"
        elif file_type == "PDF":
            extracted_text = "[PDF uploaded but no selectable text was found. If this is a scanned PDF, OCR is currently unavailable. Please type key points manually.]"
            notice = "No extractable PDF text"
        else:
            raise HTTPException(status_code=400, detail="No readable text found in file")

    max_chars = 12000
    truncated = len(extracted_text) > max_chars
    if truncated:
        extracted_text = extracted_text[:max_chars]

    return {
        "filename": file.filename,
        "classroom_id": classroom_id,
        "file_type": file_type,
        "extracted_text": extracted_text,
        "truncated": truncated,
        "notice": notice,
    }


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

@app.get("/api/dashboard/topic-matrix")
async def topic_matrix(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    from src.database import get_topic_correlation_matrix
    return get_topic_correlation_matrix(classroom_id)

@app.get("/api/dashboard/topic-clusters")
async def topic_clusters(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    from src.database import get_topic_clusters
    return {"clusters": get_topic_clusters(classroom_id)}

@app.get("/api/dashboard/student-insights")
async def student_insights(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return {"student_insights": get_student_query_insights(classroom_id)}

@app.get("/api/dashboard/latency")
async def dashboard_latency(classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")
    return get_latency_stats(classroom_id)

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
    
    classroom_id = _assert_classroom_access(classroom_id, current_user)
    class_dir = os.path.join(DATA_DIR, classroom_id)
    os.makedirs(class_dir, exist_ok=True)
    file_path = os.path.join(class_dir, file.filename)
    ext = Path(file.filename or "").suffix.lower()
    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")
    
    with open(file_path, "wb") as buffer:
        buffer.write(raw)
        
    pipeline = IngestionPipeline(classroom_id=classroom_id)

    if ext == ".txt":
        text_data = raw.decode("utf-8", errors="ignore")
        if not text_data.strip():
            raise HTTPException(status_code=400, detail="Text file is empty")
        chunks = pipeline.process_text(text_data, file.filename, force_reindex=True)
        return {"filename": file.filename, "status": "indexed", "mode": "text", "chunks": chunks}

    if ext != ".pdf":
        raise HTTPException(status_code=400, detail="Unsupported file type. Faculty uploads support .pdf and .txt")

    # First try native PDF extraction for speed and citations fidelity.
    chunks = pipeline.process_pdf(file_path, file.filename, force_reindex=True)
    if chunks > 0:
        return {"filename": file.filename, "status": "indexed", "mode": "pdf-native", "chunks": chunks}

    # Handwritten/scanned fallback: OCR + Gemini Vision extraction.
    extracted_text, _ = _extract_attachment_text(file.filename or "attachment.pdf", raw, file.content_type or "application/pdf")
    extracted_text = (extracted_text or "").strip()
    if not extracted_text:
        raise HTTPException(status_code=400, detail="Could not extract text from this PDF. Please ensure Gemini API key is configured or upload a clearer scan.")

    chunks = pipeline.process_text(extracted_text, file.filename, force_reindex=True)
    return {"filename": file.filename, "status": "indexed", "mode": "pdf-ocr", "chunks": chunks}

@app.get("/api/notes")
async def list_notes(classroom_id: str, current_user: dict = Depends(get_current_user)):
    classroom_id = _assert_classroom_access(classroom_id, current_user)
    # Fallback to general data dir checking to prevent crash if not uploaded yet
    class_dir = os.path.join(DATA_DIR, classroom_id)
    files = []
    notes_meta = []
    if os.path.exists(class_dir):
        files = [f for f in os.listdir(class_dir) if f.lower().endswith('.pdf') or f.lower().endswith('.txt')]
        for file_name in files:
            file_path = os.path.join(class_dir, file_name)
            ext = Path(file_name).suffix.lower()
            notes_meta.append({
                "name": file_name,
                "size_bytes": os.path.getsize(file_path) if os.path.exists(file_path) else 0,
                "file_type": "PDF" if ext == ".pdf" else "TXT" if ext == ".txt" else ext.replace(".", "").upper(),
            })
    return {"notes": files, "notes_meta": notes_meta}


def _note_media_type(filename: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext == ".pdf":
        return "application/pdf"
    if ext == ".txt":
        return "text/plain; charset=utf-8"
    guessed, _ = mimetypes.guess_type(filename)
    return guessed or "application/octet-stream"


@app.get("/api/notes/{filename}/view")
async def view_note(filename: str, classroom_id: str, current_user: dict = Depends(get_current_user)):
    classroom_id = _assert_classroom_access(classroom_id, current_user)
    safe_filename = Path(filename).name
    class_dir = os.path.join(DATA_DIR, classroom_id)
    file_path = os.path.join(class_dir, safe_filename)

    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(
        path=file_path,
        filename=safe_filename,
        media_type=_note_media_type(safe_filename),
        headers={"Content-Disposition": f'inline; filename="{safe_filename}"'},
    )


@app.get("/api/notes/{filename}/download")
async def download_note(filename: str, classroom_id: str, current_user: dict = Depends(get_current_user)):
    classroom_id = _assert_classroom_access(classroom_id, current_user)
    safe_filename = Path(filename).name
    class_dir = os.path.join(DATA_DIR, classroom_id)
    file_path = os.path.join(class_dir, safe_filename)

    if not os.path.exists(file_path) or not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    return FileResponse(path=file_path, filename=safe_filename, media_type="application/octet-stream")


@app.get("/api/notes/download-all")
async def download_all_notes(classroom_id: str, current_user: dict = Depends(get_current_user)):
    classroom_id = _assert_classroom_access(classroom_id, current_user)
    class_dir = os.path.join(DATA_DIR, classroom_id)

    if not os.path.exists(class_dir):
        raise HTTPException(status_code=404, detail="No classroom materials found")

    files = [f for f in os.listdir(class_dir) if f.lower().endswith('.pdf') or f.lower().endswith('.txt')]
    if not files:
        raise HTTPException(status_code=404, detail="No classroom materials found")

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as zip_file:
        for file_name in files:
            file_path = os.path.join(class_dir, file_name)
            if os.path.isfile(file_path):
                zip_file.write(file_path, arcname=file_name)

    zip_buffer.seek(0)
    headers = {
        "Content-Disposition": f'attachment; filename="classroom_{classroom_id}_materials.zip"'
    }
    return StreamingResponse(zip_buffer, media_type="application/zip", headers=headers)

@app.delete("/api/notes/{filename}")
async def delete_note(filename: str, classroom_id: str, current_user: dict = Depends(get_current_user)):
    if current_user["role"] != "faculty":
        raise HTTPException(status_code=403, detail="Not authorized")

    # Prevent path traversal and keep source_file key consistent with ingestion.
    safe_filename = Path(filename).name
    classroom_id = _assert_classroom_access(classroom_id, current_user)
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
