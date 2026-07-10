"""
routers/profile.py — User authentication, registration, profile management, and feedback endpoints
"""
import hashlib
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
import auth
import crud
import models
import schemas
from dependencies import _bearer, get_current_user_id, get_optional_current_user_id
from limiter import verify_rate_limit

try:
    from cache import cache
except ImportError:
    cache = None

router = APIRouter()


@router.post("/auth/logout", tags=["Auth"])
async def logout_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
    """
    Immediately invalidates the current user's auth token from the backend cache.
    Should be called by the frontend during logout to prevent stale token reuse.
    """
    if credentials and cache:
        token_hash = hashlib.sha1(credentials.credentials.encode()).hexdigest()
        cache_key = f"auth:{token_hash}"
        cache.delete(cache_key)
    return {"message": "Logged out successfully"}


@router.post("/users", response_model=schemas.UserResponse, tags=["Profile"])
async def create_user(
    user_data: schemas.UserRegisterInput,
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
    """
    Register a new user after Firebase OTP/phone verification.
    Send the Firebase ID token as:  Authorization: Bearer <id_token>
    The firebase_uid and phone are extracted directly from the verified token.
    """
    if not credentials:
        raise HTTPException(status_code=401, detail="Firebase ID token required in Authorization header")

    decoded = await auth.verify_token(credentials)
    firebase_uid = decoded["uid"]

    # Phone number from Firebase token is the authoritative source
    phone_from_token = decoded.get("phone_number") or user_data.phone_number
    
    verify_rate_limit(f"phone:{phone_from_token}:register", limit=5, window=3600, detail="Too many attempts. Try again later.")

    existing = crud.get_user_by_firebase_uid(db, firebase_uid=firebase_uid)
    if existing:
        # User exists
        return existing

    try:
        return crud.create_user(db=db, user=schemas.UserCreate(
            firebase_uid=firebase_uid,
            phone_number=phone_from_token,
            full_name=user_data.full_name,
            gender=user_data.gender
        ))
    except HTTPException:
        # HTTP Exception during registration
        raise
    except Exception as e:
        # Unexpected Exception during registration
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/users/me/full-dashboard", response_model=schemas.UserFullDashboardResponse, tags=["Profile"])
def get_user_full_dashboard(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """The 'Dashboard Big Bang' request. Returns profile and all event lists in one call."""
    return crud.get_user_full_dashboard(db, user_id)


@router.get("/users/me", response_model=schemas.UserResponse, tags=["Profile"])
def get_my_profile(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View the currently logged-in user's profile."""
    user = crud.get_user(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.put("/users/me", response_model=schemas.UserResponse, tags=["Profile"])
async def update_my_profile(data: schemas.UserUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit own profile  Full Name and/or Gender."""
    verify_rate_limit(f"user:{user_id}:update_profile", limit=5, window=60, detail="Updating too fast. Wait a moment.")
    user = crud.update_user(db, user_id, data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/feedback", response_model=dict, tags=["Profile"])
async def submit_feedback(data: schemas.FeedbackCreate, db: Session = Depends(get_db), user_id: Optional[int] = Depends(get_optional_current_user_id)):
    """Submit a bug report, feature request, or security issue."""
    if user_id is None:
        if not data.name or not data.email:
            raise HTTPException(status_code=401, detail="Authentication required or guest details (name/email) must be provided")
        verify_rate_limit(f"guest:{data.email}:feedback", limit=3, window=3600, detail="Feedback limit reached. Try later.")
    else:
        verify_rate_limit(f"user:{user_id}:feedback", limit=3, window=3600, detail="Feedback limit reached. Try later.")

    new_feedback = models.Feedback(
        user_id=user_id,
        name=data.name,
        email=data.email,
        type=data.type,
        message=data.message,
        status="pending"
    )
    db.add(new_feedback)
    db.commit()
    return {"message": "Feedback submitted successfully"}
