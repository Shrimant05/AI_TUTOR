import os

# Ollama Settings
OLLAMA_HOST = "http://localhost:11434"
LLM_MODEL = "llama3.1:8b"
EMBED_MODEL = "all-MiniLM-L6-v2"

# RAG Settings
CHUNCK_SIZE = 1000
CHUNK_OVERLAP = 200
SIMILARITY_THRESHOLD = 0.35  

# Paths
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "data", "pdf_files")
DB_DIR = os.path.join(BASE_DIR, "data", "vector_store")

# FastAPI Settings
CORS_ORIGINS = [
    "http://localhost:3000", # Next.js frontend
    "http://127.0.0.1:3000"
]