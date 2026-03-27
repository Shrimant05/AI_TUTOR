import os
import datetime
import uuid
import jwt
import bcrypt
from passlib.context import CryptContext
from fastapi import Request, HTTPException, Depends
from fastapi.security import OAuth2PasswordBearer
from .mongo_auth import get_auth_user_by_id, is_session_active

SECRET_KEY = os.environ.get("JWT_SECRET", "super-secret-key-that-should-be-in-env")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24 * 7 # 7 days

# Use pbkdf2_sha256 for new hashes to avoid runtime incompatibilities
# between passlib and newer bcrypt backend versions.
pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")

def verify_password(plain_password, hashed_password):
    if not hashed_password:
        return False
    # Backward compatibility for existing bcrypt hashes already in DB.
    if hashed_password.startswith(("$2a$", "$2b$", "$2y$")):
        try:
            return bcrypt.checkpw(plain_password.encode("utf-8"), hashed_password.encode("utf-8"))
        except Exception:
            return False
    try:
        return pwd_context.verify(plain_password, hashed_password)
    except Exception:
        return False

def get_password_hash(password):
    return pwd_context.hash(password)

def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    jti = uuid.uuid4().hex
    to_encode.update({"exp": expire, "jti": jti})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return {
        "token": encoded_jwt,
        "jti": jti,
        "expires_at": expire,
    }

def decode_access_token(token: str):
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token has expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_current_user(token: str = Depends(oauth2_scheme)):
    payload = decode_access_token(token)
    user_id: str = payload.get("sub")
    role: str = payload.get("role")
    jti: str = payload.get("jti")
    if user_id is None or role is None or jti is None:
        raise HTTPException(status_code=401, detail="Could not validate credentials")

    user = get_auth_user_by_id(str(user_id))
    if not user or not user.get("is_active", False):
        raise HTTPException(status_code=401, detail="User inactive or not found")

    if user["role"] != role:
        raise HTTPException(status_code=401, detail="Token role mismatch")

    if not is_session_active(str(user_id), jti):
        raise HTTPException(status_code=401, detail="Session expired or revoked")

    return {
        "user_id": str(user_id),
        "role": user["role"],
        "jti": jti,
        "username": user["username"],
    }

def verify_token_from_header(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid token")
    token = auth_header.split(" ")[1]
    return decode_access_token(token)
