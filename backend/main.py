import os
import sys
import json
import time
import asyncio
from datetime import datetime
from typing import List, Optional, Dict

# Ensure local modules (models, schemas, crud, auth) can be found regardless of current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Depends, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session

import models, schemas, crud, auth
try:
    from cache import cache
except ImportError:
    cache = None
from database import engine, get_db
from limiter import verify_rate_limit

models.Base.metadata.create_all(bind=engine)

# Lightweight migration: add new columns to existing tables if missing
import sqlite3
def _migrate_db():
    db_url = str(engine.url)
    if "sqlite" not in db_url:
        return
    db_path = db_url.replace("sqlite:///", "").replace("sqlite://", "")
    if not db_path or db_path == ":memory:":
        return
    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()
    cursor.execute("PRAGMA table_info(events)")
    existing_cols = {row[1] for row in cursor.fetchall()}
    for col_name, col_default in [("show_donations", 1), ("show_expenses", 1)]:
        if col_name not in existing_cols:
            cursor.execute(f"ALTER TABLE events ADD COLUMN {col_name} BOOLEAN DEFAULT {col_default}")
            print(f"🔧 Migration: Added '{col_name}' column to events table")
    # Chat messages table migration
    try:
        cursor.execute("PRAGMA table_info(chat_messages)")
        chat_cols = {row[1] for row in cursor.fetchall()}
        if chat_cols:  # table exists
            if "reply_to_id" not in chat_cols:
                cursor.execute("ALTER TABLE chat_messages ADD COLUMN reply_to_id INTEGER")
                print("🔧 Migration: Added 'reply_to_id' column to chat_messages table")
            if "reactions" not in chat_cols:
                cursor.execute("ALTER TABLE chat_messages ADD COLUMN reactions TEXT DEFAULT '{}'")
                print("🔧 Migration: Added 'reactions' column to chat_messages table")
    except Exception:
        pass  # Table doesn't exist yet, create_all will handle it
    conn.commit()
    conn.close()
_migrate_db()

app = FastAPI(
    title="NotePay API",
    description="Backend for NotePay — PRD v12.0",
    version="1.0.0"
)

from fastapi.responses import JSONResponse

# ─── CORS — named production origins + localhost regex for dev ───────────────
_DEFAULT_ORIGINS = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000,http://127.0.0.1:8000"
_ALLOWED_ORIGINS = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", _DEFAULT_ORIGINS).split(",") if o.strip()]
# Local dev servers use many ports (Live Server, Vite, etc.) — regex avoids OPTIONS 400
_LOCAL_ORIGIN_REGEX = r"https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?"
app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS,
    allow_origin_regex=_LOCAL_ORIGIN_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── WEBSOCKET MANAGER ─────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # event_id -> list of websockets
        self.active_connections: Dict[int, List[WebSocket]] = {}
        self.dashboard_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket, event_id: int):
        await websocket.accept()
        self.register(websocket, event_id)

    def register(self, websocket: WebSocket, event_id: int):
        """Track an already-accepted WebSocket connection."""
        if event_id not in self.active_connections:
            self.active_connections[event_id] = []
        self.active_connections[event_id].append(websocket)

    def disconnect(self, websocket: WebSocket, event_id: int):
        if event_id in self.active_connections:
            self.active_connections[event_id].remove(websocket)
            if not self.active_connections[event_id]:
                del self.active_connections[event_id]

    async def broadcast_change(self, event_id: int, message: dict):
        if event_id in self.active_connections:
            for connection in self.active_connections[event_id]:
                try:
                    await connection.send_json(message)
                except Exception:
                    # Handle dead connections silently
                    pass

    def register_dashboard(self, websocket: WebSocket):
        self.dashboard_connections.append(websocket)

    def disconnect_dashboard(self, websocket: WebSocket):
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)

    async def broadcast_dashboard_update(self):
        for connection in list(self.dashboard_connections):
            try:
                await connection.send_json({"type": "DASHBOARD_UPDATE"})
            except Exception:
                if connection in self.dashboard_connections:
                    self.dashboard_connections.remove(connection)

manager = ConnectionManager()

_DEBUG_MODE = os.getenv("DEBUG", "false").lower() in ("1", "true", "yes")

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # This prevents 500 errors from stripping CORS headers!
    if _DEBUG_MODE:
        detail = f"Internal Server Error: {repr(exc)}"
    else:
        print(f"Unhandled error on {request.url.path}: {exc!r}")
        detail = "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail})

# Firebase Bearer token scheme
_bearer = HTTPBearer(auto_error=False)

async def get_current_user_id(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
    # Start profiling
    import time
    start_t = time.time()
    
    if not credentials:
        raise HTTPException(status_code=401, detail="Auth header required")
    
    decoded = await auth.verify_token(credentials)
    auth_dur = (time.time() - start_t) * 1000
    print(f"🔑 Auth Verification took {auth_dur:.2f}ms")
    
    uid = decoded["uid"]
    phone = decoded.get("phone_number")
    
    # Log for diagnosis (masking UID)
    # Debug logging removed
    
    user = crud.get_user_by_firebase_uid(db, uid)
    if not user and phone:
        # Debug logging removed
        # Check if user exists by phone (UID might have changed)
        user = crud.get_user_by_phone(db, phone)
        if user:
            # User found by phone, updating UID
            # Update UID to the new one
            user.firebase_uid = uid
            db.commit()
            db.refresh(user)
            
    if not user:
        # User not found in DB
        raise HTTPException(status_code=404, detail="User not registered")
    return user.id

# Optional user id dependency removed to enforce strict auth.


# ─── HELPER: Membership Gatekeeper ─────────────────────────────────────────────
def verify_membership(db: Session, event_id: int, user_id: int,
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

def verify_event_active_for_collector(db: Session, event_id: int, user_id: int, *, for_write: bool = False):
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


# ─── ROOT ──────────────────────────────────────────────────────────────────────
@app.get("/")
def read_root():
    return {"message": "NotePay API — PRD v12.0 Complete", "docs": "/docs"}


async def register_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    verify_rate_limit(f"ip:{client_ip}:register", limit=10, window=60)

# ─── USER / PROFILE ────────────────────────────────────────────────────────────
@app.post("/users", response_model=schemas.UserResponse, tags=["Profile"])
async def create_user(
    user_data: schemas.UserRegisterInput,
    db: Session = Depends(get_db),
    _rl = Depends(register_rate_limit),
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
    except HTTPException as e:
        # HTTP Exception during registration
        raise
    except Exception as e:
        # Unexpected Exception during registration
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/users/me/full-dashboard", response_model=schemas.UserFullDashboardResponse, tags=["Profile"])
async def get_user_full_dashboard(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """The 'Dashboard Big Bang' request. Returns profile and all event lists in one call."""
    return crud.get_user_full_dashboard(db, user_id)

@app.get("/users/me", response_model=schemas.UserResponse, tags=["Profile"])
async def get_my_profile(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View the currently logged-in user's profile."""
    user = crud.get_user_profile(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.put("/users/me", response_model=schemas.UserResponse, tags=["Profile"])
async def update_my_profile(data: schemas.UserUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit own profile — Full Name and/or Gender."""
    user = crud.update_user(db, user_id, data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


# ─── EVENTS ────────────────────────────────────────────────────────────────────
@app.post("/events", response_model=schemas.EventResponse, tags=["Events"])
async def create_event(event: schemas.EventCreate,
                 db: Session = Depends(get_db),
                 user_id: int = Depends(get_current_user_id)):
    """Create a new event. Creator becomes the Organizer."""
    verify_rate_limit(f"user:{user_id}:create_event", limit=5, window=60)
    return crud.create_event(db=db, event=event, organizer_id=user_id)

@app.get("/events", response_model=List[schemas.EventResponse], tags=["Events"])
async def read_all_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """All events this user belongs to (Organizer + Collector). Includes deactivated."""
    events = crud.get_events_for_user(db, user_id=user_id)
    return [fix_event_json(e) for e in events]

@app.get("/events/my", response_model=List[schemas.EventResponse], tags=["Events"])
async def read_my_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard — My Events tab: only events where user is Organizer."""
    events = crud.get_my_events(db, user_id=user_id)
    return [fix_event_json(e) for e in events]

@app.get("/events/shared", response_model=List[schemas.EventResponse], tags=["Events"])
async def read_shared_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard — Shared Events tab: events joined via code (Collector). Includes deactivated."""
    events = crud.get_shared_events(db, user_id=user_id)
    return [fix_event_json(e) for e in events]

@app.post("/events/join", tags=["Events"])
async def join_event_by_code(invite_code: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Join an event using an invite code (becomes Collector)."""
    verify_rate_limit(f"user:{user_id}:join", limit=5, window=60)
    event = crud.join_event(db, user_id, invite_code)
    if event is None:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if event is False:
        raise HTTPException(status_code=403, detail="This event is currently deactivated. Contact your organizer.")
    # Broadcast so organizer sees new member in real-time
    await manager.broadcast_change(event.id, {"type": "DATA_CHANGED"})
    return {"message": "Joined event successfully", "event_id": event.id, "event_name": event.name}

@app.put("/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def update_event(event_id: int, data: schemas.EventUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Rename/edit event details. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.update_event(db, event_id, data, user_id=user_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Explicitly map and parse JSON for SQLite compatibility
    event_dict = {c.name: getattr(event, c.name) for c in event.__table__.columns}
    # Broadcast layout/column changes to all clients
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    return fix_event_json(event_dict)

@app.delete("/events/{event_id}", tags=["Events"])
async def delete_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Permanently delete an event and ALL its data. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    success = crud.delete_event(db, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    # Invalidate dashboard cache
    if cache:
        cache.delete(f"dash:{user_id}")
    return {"message": "Event permanently deleted"}


# ─── EVENT MANAGEMENT (Organizer Only) ─────────────────────────────────────────
@app.put("/events/{event_id}/deactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def deactivate_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Lock all collectors out. Organizer retains read-only view."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.toggle_event_status(db, event_id, is_active=False, user_id=user_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event

@app.put("/events/{event_id}/reactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def reactivate_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Reopen event. Organizer must then generate a NEW code and reshare."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.toggle_event_status(db, event_id, is_active=True, user_id=user_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event

@app.post("/events/{event_id}/generate_code", response_model=schemas.EventResponse, tags=["Event Management"])
async def regenerate_invite_code(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Generate a brand new invite code. Old code becomes permanently invalid."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    verify_rate_limit(f"user:{user_id}:generate_code", limit=5, window=60)
    return crud.regenerate_invite_code(db, event_id)
@app.get("/events/watched", tags=["Events"])
async def get_watched_history(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard — Discover tab: public events recently viewed. Optimized with bulk membership check."""
    watched = crud.get_watched_events(db, user_id)
    if not watched: return []
    
    # Pre-fetch all memberships for these events to avoid N+1 queries
    event_ids = [w.event_id for w in watched if w.event_id]
    memberships = {}
    if event_ids:
        memberships = {m.event_id: m for m in db.query(models.EventMember).filter(
            models.EventMember.user_id == user_id,
            models.EventMember.event_id.in_(event_ids)
        ).all()}
    
    resp = []
    for w in watched:
        e = w.event
        if not e: continue
        
        member = memberships.get(e.id)
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["my_role"] = member.role if member else None
        e_dict["is_restricted"] = member.is_restricted if member else False
        
        resp.append({
            "id": w.id,
            "user_id": w.user_id,
            "event_id": w.event_id,
            "last_viewed_at": w.last_viewed_at,
            "event": fix_event_json(e_dict)
        })
    return resp

@app.delete("/events/{event_id}/watched", tags=["Events"])
async def remove_watched_history(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Remove event from watched history (Discover tab)."""
    success = crud.remove_watched_event(db, user_id, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Watched event not found")
    return {"message": "Removed from discovery tab"}

def fix_event_json(e_dict):
    """Robust JSON parsing for SQLite string fields."""
    for col_name in ["donation_custom_columns", "expense_custom_columns"]:
        val = e_dict.get(col_name)
        if isinstance(val, str) and val.strip():
            try:
                e_dict[col_name] = json.loads(val)
            except json.JSONDecodeError:
                e_dict[col_name] = []
        elif val is None:
            e_dict[col_name] = []
    return e_dict

@app.get("/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def read_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Fetch details for a single event. Requires strict auth."""
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Verify membership or public access
    member = verify_membership(db, event_id, user_id)
    
    # If visitor, add to watched history
    if not member:
        crud.add_watched_event(db, user_id, event_id)
    
    # Explicitly map to avoid Pydantic serialization issues with SQLAlchemy objects
    event_dict = {c.name: getattr(event, c.name) for c in event.__table__.columns}
    event_dict["my_role"] = member.role if member else None
    event_dict["is_restricted"] = member.is_restricted if member else False
    
    return fix_event_json(event_dict)




@app.patch("/events/{event_id}/privacy", response_model=schemas.EventResponse, tags=["Event Management"])
async def toggle_event_privacy(event_id: int, is_public: bool, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Toggle event between Private and Public (unlisted). Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.update_event(db, event_id, schemas.EventUpdate(is_public=is_public))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event

@app.get("/events/{event_id}/members", response_model=List[schemas.EventMemberResponse], tags=["Event Management"])
async def get_event_members(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all members in the event. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    return crud.get_event_members(db, event_id)

@app.get("/events/{event_id}/members/{target_user_id}/contact",
         response_model=schemas.MemberContactResponse, tags=["Event Management"])
async def get_member_contact(event_id: int, target_user_id: int,
                             db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Phone number for 1:1 call — fellow event members only (not public visitors)."""
    verify_membership(db, event_id, user_id, require_member=True)
    contact = crud.get_member_contact(db, event_id, target_user_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Member not found or no phone on file")
    return contact

@app.put("/events/{event_id}/members/{target_user_id}/restrict", response_model=schemas.EventMemberResponse, tags=["Event Management"])
async def restrict_member(event_id: int, target_user_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Block a collector from reading or writing anything in this event."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    
    event = crud.get_event(db, event_id)
    if target_user_id == event.organizer_id:
        raise HTTPException(status_code=403, detail="The original creator cannot be restricted.")

    member = crud.set_member_restriction(db, event_id, target_user_id, is_restricted=True)
    if not member:
        raise HTTPException(status_code=404, detail="Target member not found in this event")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return member

@app.put("/events/{event_id}/members/{target_user_id}/unrestrict", response_model=schemas.EventMemberResponse, tags=["Event Management"])
async def unrestrict_member(event_id: int, target_user_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Restore a restricted collector's full access."""
    verify_membership(db, event_id, user_id, require_organizer=True)

    event = crud.get_event(db, event_id)
    if target_user_id == event.organizer_id:
        raise HTTPException(status_code=403, detail="The original creator cannot be restricted/unrestricted.")

    member = crud.set_member_restriction(db, event_id, target_user_id, is_restricted=False)
    if not member:
        raise HTTPException(status_code=404, detail="Target member not found in this event")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return member

@app.put("/events/{event_id}/members/{target_user_id}/role", response_model=schemas.EventMemberResponse, tags=["Event Management"])
async def update_member_role(event_id: int, target_user_id: int, data: schemas.MemberRoleUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Change a member's role (e.g., Promote to Organizer). Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)

    event = crud.get_event(db, event_id)
    if target_user_id == event.organizer_id:
        raise HTTPException(status_code=403, detail="The original creator's role cannot be changed.")

    # Security: Prevent promoting restricted members to organizer
    target_member = crud.get_member(db, event_id, target_user_id)
    if target_member and target_member.is_restricted and data.role == models.UserRole.organizer:
        target_user = crud.get_user(db, target_user_id)
        target_name = target_user.full_name if target_user else "Member"
        raise HTTPException(status_code=403, detail=f"Restricted member can't be promoted to organizer. Unrestrict {target_name} before promotion.")

    member = crud.update_member_role(db, event_id, target_user_id, data.role)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return member

@app.post("/events/{event_id}/exit", tags=["Events"])
async def exit_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Remove yourself from an event. You will need the code to rejoin."""
    success = crud.exit_event(db, event_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="You are not a member of this event")
    # Broadcast so organizer's member list updates in real-time
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return {"message": "You have left the event"}




# ─── DONATIONS ─────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/donations", response_model=List[schemas.DonationResponse], tags=["Donations"])
async def get_event_donations(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all donations. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_donations(db, event_id)

@app.post("/events/{event_id}/donations", response_model=schemas.DonationResponse, tags=["Donations"])
async def add_donation(event_id: int, donation: schemas.DonationCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new donation row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    verify_rate_limit(f"user:{user_id}:add_entry", limit=30, window=60)
    res = crud.create_donation(db, event_id, user_id, donation)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_add"})
    return res

@app.put("/events/{event_id}/donations/{donation_id}", response_model=schemas.DonationResponse, tags=["Donations"])
async def update_donation(event_id: int, donation_id: int, data: schemas.DonationUpdate,
                    db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit a donation row. Organizer can edit any row. Collector can only edit their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    donation = crud.get_donation(db, donation_id)
    if not donation or donation["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Donation not found in this event")
    if member.role != models.UserRole.organizer and donation["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own entries")
    result = crud.update_donation(db, donation_id, data)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_update"})
    return result

@app.delete("/events/{event_id}/donations/{donation_id}", tags=["Donations"])
async def delete_donation(event_id: int, donation_id: int,
                    db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Delete a donation row. Organizer can delete any. Collector can only delete their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    donation = crud.get_donation(db, donation_id)
    if not donation or donation["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Donation not found in this event")
    if member.role != models.UserRole.organizer and donation["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own entries")
    crud.delete_donation(db, donation_id)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_delete"})
    return {"message": "Donation deleted"}


# ─── EXPENSES ──────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/expenses", response_model=List[schemas.ExpenseResponse], tags=["Expenses"])
async def get_event_expenses(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all expenses. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_expenses(db, event_id)

@app.post("/events/{event_id}/expenses", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def add_expense(event_id: int, expense: schemas.ExpenseCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new expense row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    verify_rate_limit(f"user:{user_id}:add_entry", limit=30, window=60)
    res = crud.create_expense(db, event_id, user_id, expense)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_add"})
    return res

@app.put("/events/{event_id}/expenses/{expense_id}", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def update_expense(event_id: int, expense_id: int, data: schemas.ExpenseUpdate,
                   db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit an expense row. Organizer can edit any. Collector can only edit their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    expense = crud.get_expense(db, expense_id)
    if not expense or expense["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Expense not found in this event")
    if member.role != models.UserRole.organizer and expense["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only edit your own entries")
    res = crud.update_expense(db, expense_id, data)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_update"})
    return res

@app.delete("/events/{event_id}/expenses/{expense_id}", tags=["Expenses"])
async def delete_expense(event_id: int, expense_id: int,
                   db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Delete an expense row. Organizer can delete any. Collector can only delete their own."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    expense = crud.get_expense(db, expense_id)
    if not expense or expense["event_id"] != event_id:
        raise HTTPException(status_code=404, detail="Expense not found in this event")
    if member.role != models.UserRole.organizer and expense["collected_by"] != user_id:
        raise HTTPException(status_code=403, detail="You can only delete your own entries")
    crud.delete_expense(db, expense_id)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_delete"})
    return {"message": "Expense deleted"}


# ─── SUMMARY ───────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/summary", response_model=schemas.EventSummaryResponse, tags=["Summary"])
async def get_event_summary(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Financial overview. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_event_summary(db, event_id)

@app.get("/events/{event_id}/full-details", response_model=schemas.EventFullDetailsResponse, tags=["Events"])
async def get_event_full_details(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """The 'Big Bang' request. Returns everything for an event in one call. Highly optimized with caching."""
    member = verify_membership(db, event_id, user_id)
    
    # If visitor, record in history
    if not member:
        crud.add_watched_event(db, user_id, event_id)
    
    start_fetch = time.time()
    res = crud.get_event_full_details(db, event_id, user_id)
    fetch_dur = (time.time() - start_fetch) * 1000
    print(f"📦 Data Fetch took {fetch_dur:.2f}ms")
        
        
    return res

# ─── CHAT ──────────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/chat", response_model=List[schemas.ChatMessageResponse], tags=["Chat"])
async def get_chat_history(event_id: int, limit: int = 50, before_id: int = None,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Get chat message history for an event. Supports pagination via before_id."""
    verify_membership(db, event_id, user_id)
    return crud.get_chat_messages(db, event_id, limit=limit, before_id=before_id)

@app.post("/events/{event_id}/chat", response_model=schemas.ChatMessageResponse, tags=["Chat"])
async def send_chat_message(event_id: int, data: schemas.ChatMessageCreate,
                            db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Send a chat message to all members of an event."""
    verify_membership(db, event_id, user_id, require_member=True, require_unrestricted=True)
    verify_rate_limit(f"user:{user_id}:chat", limit=20, window=60)
    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    msg = crud.create_chat_message(db, event_id, user_id, data.message.strip(), data.reply_to_id)
    # Broadcast to all connected clients via WebSocket
    await manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": msg})
    return msg

@app.post("/events/{event_id}/chat/{message_id}/react", tags=["Chat"])
async def react_to_message(event_id: int, message_id: int, data: schemas.ChatReactionRequest,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Toggle an emoji reaction on a chat message."""
    verify_membership(db, event_id, user_id, require_member=True, require_unrestricted=True)
    if not data.emoji or len(data.emoji) > 10: # Basic length check to prevent abuse
        raise HTTPException(status_code=400, detail="Invalid emoji length")
    msg = crud.toggle_reaction(db, message_id, event_id, user_id, data.emoji)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": msg})
    return {"message": "Reaction toggled"}

@app.delete("/events/{event_id}/chat/{message_id}", tags=["Chat"])
async def delete_chat_message(event_id: int, message_id: int, 
                              db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Wipe a chat message (replaces content with 'deleted'). Only sender or organizer can delete."""
    verify_membership(db, event_id, user_id, require_member=True)
    mem = crud.get_member(db, event_id, user_id)
    ev = crud.get_event(db, event_id)
    is_org = bool(
        mem and mem.role == models.UserRole.organizer
    ) or bool(ev and ev.organizer_id == user_id)

    msg = crud.delete_chat_message(db, message_id, event_id, user_id, is_org)
    if not msg:
        raise HTTPException(status_code=403, detail="Not authorized to delete this message or message not found")
    
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": msg}) # Use CHAT_REACTION to update existing msg in place
    return {"message": "Message deleted"}

# ─── WEBSOCKET ENDPOINT ────────────────────────────────────────────────────────
async def _authenticate_ws_user(db: Session, token: str) -> int:
    """Verify Firebase token and return internal user id."""
    if not token:
        raise HTTPException(status_code=401, detail="Token required")
    creds = HTTPAuthorizationCredentials(scheme="Bearer", credentials=token)
    decoded = await auth.verify_token(creds)
    user = crud.get_user_by_firebase_uid(db, decoded["uid"])
    if not user:
        raise HTTPException(status_code=404, detail="User not registered")
    return user.id


async def _ws_send_auth_ok(websocket: WebSocket) -> bool:
    """Send AUTH_OK; return False if the client already disconnected."""
    try:
        await websocket.send_json({"type": "AUTH_OK"})
        return True
    except WebSocketDisconnect:
        return False

@app.websocket("/ws/dashboard")
async def websocket_dashboard(websocket: WebSocket):
    """Authenticated dashboard channel for DASHBOARD_UPDATE broadcasts (no event membership)."""
    await websocket.accept()
    db = next(get_db())
    try:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
            auth_msg = json.loads(raw)
        except (asyncio.TimeoutError, json.JSONDecodeError):
            await websocket.close(code=4401, reason="Auth required")
            return

        if auth_msg.get("type") != "AUTH" or not auth_msg.get("token"):
            await websocket.close(code=4401, reason="Auth required")
            return

        await _authenticate_ws_user(db, auth_msg["token"])
        manager.register_dashboard(websocket)
        if not await _ws_send_auth_ok(websocket):
            manager.disconnect_dashboard(websocket)
            return

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect_dashboard(websocket)
    except HTTPException:
        try:
            await websocket.close(code=4401, reason="Invalid token")
        except WebSocketDisconnect:
            pass
    except WebSocketDisconnect:
        manager.disconnect_dashboard(websocket)
    finally:
        db.close()


@app.websocket("/ws/{event_id}")
async def websocket_endpoint(websocket: WebSocket, event_id: int):
    """Authenticate via first JSON message {type:AUTH, token} — avoids huge JWT in query string."""
    if event_id <= 0:
        await websocket.accept()
        await websocket.close(code=4400, reason="Invalid event")
        return

    await websocket.accept()
    db = next(get_db())
    try:
        try:
            raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
            auth_msg = json.loads(raw)
        except asyncio.TimeoutError:
            await websocket.close(code=4401, reason="Auth timeout")
            return
        except json.JSONDecodeError:
            await websocket.close(code=4401, reason="Invalid auth payload")
            return

        if auth_msg.get("type") != "AUTH":
            await websocket.close(code=4401, reason="Auth message required")
            return

        token = auth_msg.get("token")
        if not token:
            await websocket.close(code=4401, reason="Token required")
            return

        ws_user_id = await _authenticate_ws_user(db, token)
        # We allow visitors and restricted users to stay connected 
        # so they can receive DATA_CHANGED signals in real-time.
        # Security is still enforced during actual data fetching.
        
        manager.register(websocket, event_id)
        if not await _ws_send_auth_ok(websocket):
            manager.disconnect(websocket, event_id)
            return

        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            manager.disconnect(websocket, event_id)
    except HTTPException:
        try:
            await websocket.close(code=4401, reason="Invalid token")
        except WebSocketDisconnect:
            pass
    except WebSocketDisconnect:
        manager.disconnect(websocket, event_id)
    except Exception as exc:
        print(f"WebSocket error event={event_id}: {exc!r}")
        try:
            await websocket.close(code=1011, reason="Server error")
        except WebSocketDisconnect:
            pass
    finally:
        db.close()
