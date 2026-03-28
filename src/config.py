import os
import re
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:
    load_dotenv = None

if load_dotenv:
    env_path = Path(__file__).resolve().parents[1] / ".env"
    load_dotenv(dotenv_path=env_path)

# Gemini Text Model Settings
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_TEXT_MODEL = os.environ.get("GEMINI_TEXT_MODEL", "gemini-1.5-flash")
EMBED_MODEL = os.environ.get("EMBED_MODEL", "all-MiniLM-L6-v2")

# RAG Settings
CHUNCK_SIZE = 1000
CHUNK_OVERLAP = 200
SIMILARITY_THRESHOLD = 0.35  

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "pdf_files")
DB_DIR = os.path.join(BASE_DIR, "data", "vector_store")

# MongoDB Atlas Settings (auth + chat history)
MONGODB_URI = os.environ.get("MONGODB_URI", "")
MONGODB_DB = os.environ.get("MONGODB_DB", "ai_tutor_auth")
GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
GEMINI_VISION_MODEL = os.environ.get("GEMINI_VISION_MODEL", "gemini-1.5-flash")


def get_classroom_vector_db_path(classroom_id: str) -> str:
    """Return the dedicated vector DB directory for a classroom."""
    normalized = normalize_classroom_id(classroom_id)
    return os.path.join(DB_DIR, f"classroom_{normalized}")


def normalize_classroom_id(classroom_id: str) -> str:
    value = str(classroom_id or "").strip()
    # Keep IDs filesystem-safe and deterministic across ingestion/retrieval.
    value = re.sub(r"[^A-Za-z0-9_-]", "_", value)
    return value or "unknown"

# FastAPI Settings
CORS_ORIGINS = [
    "http://localhost:3000", # Next.js frontend
    "http://127.0.0.1:3000"
]