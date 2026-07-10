"""
dependencies.py — Shared FastAPI dependencies and authentication checks for NotePay API
"""
from typing import Optional
from fastapi import Depends, HTTPException
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from database import get_db
import auth
import crud
import models

_bearer = HTTPBearer(auto_error=False)

async def get_current_user_id(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
) -> int:
    if not credentials:
        raise HTTPException(status_code=401, detail="Auth header required")
    
    decoded = await auth.verify_token(credentials)
    uid = decoded["uid"]
    phone = decoded.get("phone_number")
    
    user = crud.get_user_by_firebase_uid(db, uid)
    if not user:
        if phone:
            user = crud.get_user_by_phone(db, phone)
            if user:
                user = crud.update_user_firebase_uid(db, user.id, uid)
            else:
                raise HTTPException(status_code=404, detail="User not registered")
        else:
            raise HTTPException(status_code=404, detail="User not registered")
            
    if getattr(user, 'is_banned', False):
        raise HTTPException(status_code=403, detail=f"Your account has been banned. Reason: {user.ban_reason or 'No reason provided.'}")
        
    return user.id


async def get_optional_current_user_id(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
) -> Optional[int]:
    if not credentials:
        return None
    try:
        decoded = await auth.verify_token(credentials)
        uid = decoded["uid"]
        phone = decoded.get("phone_number")
        
        user = crud.get_user_by_firebase_uid(db, uid)
        if not user:
            if phone:
                user = crud.get_user_by_phone(db, phone)
                if user:
                    user = crud.update_user_firebase_uid(db, user.id, uid)
                else:
                    return None
            else:
                return None
                
        if getattr(user, 'is_banned', False):
            raise HTTPException(status_code=403, detail=f"Your account has been banned. Reason: {user.ban_reason or 'No reason provided.'}")
            
        return user.id
    except HTTPException as he:
        if he.status_code == 403:
            raise he
        return None
    except Exception:
        return None


def verify_membership(db: Session, event_id: str, user_id: int,
                      require_organizer: bool = False,
                      require_unrestricted: bool = False,
                      require_member: bool = False):
    member = crud.get_member(db, event_id, user_id)
        
    if not member:
        event = crud.get_event(db, event_id)
        if require_member or require_organizer or require_unrestricted:
            raise HTTPException(status_code=403, detail="You are not a member of this event")
        if event and event.is_public:
            return None  # Visitor read-only on public events
        raise HTTPException(status_code=403, detail="You are not a member of this event")
    if require_organizer and member.role != models.UserRole.organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can perform this action")
    if require_unrestricted and member.is_restricted:
        raise HTTPException(status_code=403, detail="Your access has been restricted by the organizer")
    return member


def verify_event_active_for_collector(db: Session, event_id: str, user_id: int, *, for_write: bool = False):
    """Gate event access. Writes require membership + unrestricted; reads allow public visitors."""
    if for_write:
        member = verify_membership(
            db, event_id, user_id, require_member=True, require_unrestricted=True
        )
    else:
        member = verify_membership(db, event_id, user_id)
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event.is_active and (not member or member.role != models.UserRole.organizer):
        raise HTTPException(status_code=403, detail="This event is deactivated. Contact your organizer.")
    return member
