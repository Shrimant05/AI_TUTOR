import os
from datetime import datetime, timezone
from typing import Optional

from pymongo import MongoClient, ASCENDING
from pymongo.errors import ConnectionFailure
from pymongo.errors import DuplicateKeyError
from bson.objectid import ObjectId
from .config import MONGODB_URI, MONGODB_DB

_client = None
_db = None


def _get_db():
    global _client, _db
    if _db is None:
        if not MONGODB_URI:
            raise RuntimeError("MONGODB_URI is not set. Please configure a MongoDB Atlas connection string.")
        if not MONGODB_URI.startswith("mongodb+srv://"):
            raise RuntimeError("MONGODB_URI must be a MongoDB Atlas SRV URI (mongodb+srv://...).")

        _client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=7000)
        _db = _client[MONGODB_DB]
    return _db


def init_mongo_auth():
    db = _get_db()
    try:
        db.command("ping")
    except ConnectionFailure as exc:
        raise RuntimeError(f"Unable to connect to MongoDB Atlas: {exc}") from exc

    db.users.create_index([("username_lower", ASCENDING)], unique=True)
    db.sessions.create_index([("jti", ASCENDING)], unique=True)
    db.sessions.create_index([("expires_at", ASCENDING)])
    db.chat_histories.create_index([("user_id", ASCENDING), ("created_at", ASCENDING)])
    db.chat_histories.create_index([("session_id", ASCENDING), ("created_at", ASCENDING)])
    db.chat_histories.create_index([("classroom_id", ASCENDING), ("created_at", ASCENDING)])


def create_auth_user(username: str, password_hash: str, role: str) -> bool:
    db = _get_db()
    doc = {
        "username": username,
        "username_lower": username.lower(),
        "password_hash": password_hash,
        "role": role,
        "is_active": True,
        "created_at": datetime.now(timezone.utc),
        "last_login_at": None,
    }
    try:
        db.users.insert_one(doc)
        return True
    except DuplicateKeyError:
        return False


def get_auth_user_by_username(username: str) -> Optional[dict]:
    db = _get_db()
    return db.users.find_one({"username_lower": (username or "").strip().lower()})


def get_auth_user_by_id(user_id: str) -> Optional[dict]:
    db = _get_db()
    try:
        oid = ObjectId(user_id)
    except Exception:
        return None
    return db.users.find_one({"_id": oid})


def update_last_login(user_id: str):
    db = _get_db()
    db.users.update_one({"_id": ObjectId(user_id)}, {"$set": {"last_login_at": datetime.now(timezone.utc)}})


def create_session(user_id: str, jti: str, expires_at, created_ip=None, user_agent=None):
    db = _get_db()
    if hasattr(expires_at, "tzinfo") and expires_at.tzinfo is not None:
        expires_at = expires_at.astimezone(timezone.utc).replace(tzinfo=None)
    db.sessions.insert_one({
        "user_id": str(user_id),
        "jti": jti,
        "issued_at": datetime.utcnow(),
        "expires_at": expires_at,
        "revoked": False,
        "revoked_at": None,
        "created_ip": created_ip,
        "user_agent": (user_agent or "")[:255],
    })


def is_session_active(user_id: str, jti: str) -> bool:
    db = _get_db()
    now = datetime.utcnow()
    doc = db.sessions.find_one({
        "user_id": str(user_id),
        "jti": jti,
        "revoked": False,
        "expires_at": {"$gt": now},
    })
    return doc is not None


def revoke_session(user_id: str, jti: str):
    db = _get_db()
    db.sessions.update_one(
        {"user_id": str(user_id), "jti": jti, "revoked": False},
        {"$set": {"revoked": True, "revoked_at": datetime.utcnow()}},
    )


def save_chat_history(user_id: str, classroom_id: str, session_id: str, query: str, reply: str, intent: str, citations: list):
    db = _get_db()
    db.chat_histories.insert_one({
        "user_id": str(user_id),
        "classroom_id": str(classroom_id),
        "session_id": str(session_id),
        "query": query,
        "reply": reply,
        "intent": intent,
        "citations": citations or [],
        "created_at": datetime.utcnow(),
    })


def get_chat_histories(user_id: str, classroom_id: Optional[str] = None, session_id: Optional[str] = None, limit: int = 50):
    db = _get_db()
    query = {"user_id": str(user_id)}
    if classroom_id:
        query["classroom_id"] = str(classroom_id)
    if session_id:
        query["session_id"] = str(session_id)

    docs = list(
        db.chat_histories.find(query)
        .sort("created_at", -1)
        .limit(max(1, min(int(limit), 200)))
    )

    items = []
    for d in docs:
        items.append({
            "id": str(d.get("_id")),
            "classroom_id": d.get("classroom_id"),
            "session_id": d.get("session_id"),
            "query": d.get("query"),
            "reply": d.get("reply"),
            "intent": d.get("intent"),
            "citations": d.get("citations", []),
            "created_at": d.get("created_at").isoformat() + "Z" if d.get("created_at") else None,
        })
    return items
