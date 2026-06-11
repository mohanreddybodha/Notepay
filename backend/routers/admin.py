from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, desc
from datetime import datetime, timedelta
import json

from database import get_db
import models
import schemas
from admin_auth import (
    verify_password,
    create_access_token,
    ACCESS_TOKEN_EXPIRE_MINUTES,
    require_admin
)

router = APIRouter(prefix="/api/v1/admin", tags=["admin"])

def log_admin_action(db: Session, admin_id: int, action: str, target_type: str, target_id: str, details: dict = None):
    log = models.AdminAuditLog(
        admin_id=admin_id,
        action=action,
        target_type=target_type,
        target_id=target_id,
        details=details
    )
    db.add(log)
    db.commit()

@router.post("/login", response_model=schemas.AdminToken)
def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    admin = db.query(models.AdminUser).filter(models.AdminUser.email == form_data.username).first()
    if not admin or not verify_password(form_data.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": admin.email, "role": admin.role}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "role": admin.role}

@router.get("/dashboard/stats", response_model=schemas.AdminDashboardStats)
def get_dashboard_stats(db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    total_users = db.query(models.User).count()
    total_events = db.query(models.Event).count()
    
    # Calculate donations collected total
    total_donations = db.query(func.sum(models.Donation.amount)).scalar() or 0.0
    total_expenses = db.query(func.sum(models.Expense.amount)).scalar() or 0.0
    
    today = datetime.utcnow().date()
    new_users_today = db.query(models.User).filter(func.date(models.User.created_at) == today).count()
    
    active_events = db.query(models.Event).filter(models.Event.is_active == True).count()
    banned_users = db.query(models.User).filter(models.User.is_banned == True).count()
    errors_today = db.query(models.ErrorLog).filter(func.date(models.ErrorLog.created_at) == today).count()
    
    return {
        "total_users": total_users,
        "total_events": total_events,
        "total_donations_collected": total_donations,
        "new_users_today": new_users_today,
        "total_expenses_tracked": total_expenses,
        "active_events": active_events,
        "banned_users": banned_users,
        "errors_today": errors_today
    }

@router.get("/users", response_model=list[schemas.AdminUserResponse])
def get_users(page: int = 1, limit: int = 50, search: str = None, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    query = db.query(models.User)
    if search:
        query = query.filter(
            or_(
                models.User.full_name.ilike(f"%{search}%"),
                models.User.phone_number.ilike(f"%{search}%")
            )
        )
    users = query.order_by(desc(models.User.created_at)).offset((page - 1) * limit).limit(limit).all()
    
    for u in users:
        u.events_count = db.query(models.EventMember).filter(models.EventMember.user_id == u.id).count()
    return users

@router.post("/users/{user_id}/ban")
def ban_user(user_id: int, req: schemas.AdminActionRequest, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_banned = True
    user.ban_reason = req.reason
    db.commit()
    log_admin_action(db, current_admin.id, "ban_user", "user", str(user_id), {"reason": req.reason})
    return {"status": "success", "message": "User banned"}

@router.post("/users/{user_id}/unban")
def unban_user(user_id: int, req: schemas.AdminActionRequest, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
    user.is_banned = False
    user.ban_reason = None
    db.commit()
    log_admin_action(db, current_admin.id, "unban_user", "user", str(user_id), {"reason": req.reason})
    return {"status": "success", "message": "User unbanned"}

@router.delete("/users/{user_id}")
def delete_user(user_id: int, req: schemas.AdminActionRequest, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    user = db.query(models.User).filter(models.User.id == user_id).first()
    if not user:
        raise HTTPException(404, "User not found")
        
    # Delete all events organized by the user completely
    user_events = db.query(models.Event).filter(models.Event.organizer_id == user_id).all()
    for ev in user_events:
        db.query(models.EventMember).filter(models.EventMember.event_id == ev.id).delete()
        db.query(models.Donation).filter(models.Donation.event_id == ev.id).delete()
        db.query(models.Expense).filter(models.Expense.event_id == ev.id).delete()
        db.query(models.WatchedEvent).filter(models.WatchedEvent.event_id == ev.id).delete()
        db.query(models.ChatMessage).filter(models.ChatMessage.event_id == ev.id).delete()
        db.delete(ev)
    
    # Remove their footprints in other events (preserve financial data by setting collected_by to None)
    db.query(models.EventMember).filter(models.EventMember.user_id == user_id).delete()
    db.query(models.Donation).filter(models.Donation.collected_by == user_id).update({"collected_by": None})
    db.query(models.Expense).filter(models.Expense.collected_by == user_id).update({"collected_by": None})
    db.query(models.WatchedEvent).filter(models.WatchedEvent.user_id == user_id).delete()
    db.query(models.ChatMessage).filter(models.ChatMessage.user_id == user_id).delete()
    db.query(models.Feedback).filter(models.Feedback.user_id == user_id).delete()
    
    # Delete the user completely so they can re-register
    db.delete(user)
    db.commit()
    
    log_admin_action(db, current_admin.id, "delete_user", "user", str(user_id), {"reason": req.reason})
    return {"status": "success", "message": "User deleted"}

@router.get("/events")
def get_events(page: int = 1, limit: int = 50, search: str = None, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    query = db.query(models.Event, models.User.full_name).outerjoin(models.User, models.Event.organizer_id == models.User.id)
    if search:
        query = query.filter(
            or_(
                models.Event.name.ilike(f"%{{search}}%"),
                models.Event.id == search
            )
        )
    events = query.order_by(desc(models.Event.created_at)).offset((page - 1) * limit).limit(limit).all()
    
    res = []
    for e, org_name in events:
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["organizer_name"] = org_name or "Unknown"
        res.append(e_dict)
    return res

@router.post("/events/{event_id}/deactivate")
def deactivate_event(event_id: str, req: schemas.AdminActionRequest, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(404, "Event not found")
    
    # Toggle active status
    event.is_active = not event.is_active
    db.commit()
    
    action = "deactivate_event" if not event.is_active else "reactivate_event"
    log_admin_action(db, current_admin.id, action, "event", event_id, {"reason": req.reason})
    return {"status": "success", "is_active": event.is_active}

@router.delete("/events/{event_id}")
def delete_event(event_id: str, req: schemas.AdminActionRequest, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        raise HTTPException(404, "Event not found")
        
    db.query(models.EventMember).filter(models.EventMember.event_id == event_id).delete()
    db.query(models.Donation).filter(models.Donation.event_id == event_id).delete()
    db.query(models.Expense).filter(models.Expense.event_id == event_id).delete()
    db.query(models.WatchedEvent).filter(models.WatchedEvent.event_id == event_id).delete()
    db.query(models.ChatMessage).filter(models.ChatMessage.event_id == event_id).delete()
    
    db.delete(event)
    db.commit()
    
    log_admin_action(db, current_admin.id, "delete_event", "event", event_id, {"reason": req.reason})
    return {"status": "success", "message": "Event deleted"}

@router.get("/errors", response_model=list[schemas.AdminErrorLogResponse])
def get_errors(limit: int = 50, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    errors = db.query(models.ErrorLog).order_by(desc(models.ErrorLog.created_at)).limit(limit).all()
    return errors

@router.get("/audit-logs")
def get_audit_logs(limit: int = 50, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    logs = db.query(models.AdminAuditLog, models.AdminUser.name.label("admin_name")).outerjoin(models.AdminUser, models.AdminAuditLog.admin_id == models.AdminUser.id).order_by(desc(models.AdminAuditLog.created_at)).limit(limit).all()
    
    res = []
    for log, admin_name in logs:
        log_dict = {c.name: getattr(log, c.name) for c in log.__table__.columns}
        log_dict["admin_name"] = admin_name or f"Admin {log.admin_id}"
        res.append(log_dict)
    return res

@router.get("/search")
def global_search(q: str, db: Session = Depends(get_db), current_admin: models.AdminUser = Depends(require_admin)):
    """A global search returning matching users and events."""
    if not q or len(q) < 3:
        return {"users": [], "events": []}
        
    users = db.query(models.User).filter(
        or_(
            models.User.full_name.ilike(f"%{q}%"),
            models.User.phone_number.ilike(f"%{q}%")
        )
    ).limit(10).all()
    
    events = db.query(models.Event, models.User.full_name).outerjoin(models.User, models.Event.organizer_id == models.User.id).filter(
        or_(
            models.Event.name.ilike(f"%{q}%"),
            models.Event.id == q
        )
    ).limit(10).all()
    
    user_results = [{c.name: getattr(u, c.name) for c in u.__table__.columns} for u in users]
    
    event_results = []
    for e, org_name in events:
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["organizer_name"] = org_name or "Unknown"
        event_results.append(e_dict)
        
    return {"users": user_results, "events": event_results}
