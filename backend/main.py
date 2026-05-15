import os
import sys
import json
import time
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

# ─── CORS — allow browser frontend to call the API ──────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── WEBSOCKET MANAGER ─────────────────────────────────────────────────────────
class ConnectionManager:
    def __init__(self):
        # event_id -> list of websockets
        self.active_connections: Dict[int, List[WebSocket]] = {}

    async def connect(self, websocket: WebSocket, event_id: int):
        await websocket.accept()
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

    async def broadcast_dashboard_update(self):
        # Notify all connected clients to refresh their dashboard data
        for event_id in self.active_connections:
            for connection in self.active_connections[event_id]:
                try:
                    await connection.send_json({"type": "DASHBOARD_UPDATE"})
                except Exception: pass

manager = ConnectionManager()

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    # This prevents 500 errors from stripping CORS headers!
    return JSONResponse(status_code=500, content={"detail": f"Internal Server Error: {repr(exc)}"})

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
                      require_unrestricted: bool = False):
    member = crud.get_member(db, event_id, user_id)
    if not member:
        event = crud.get_event(db, event_id)
        if event and event.is_public and not require_organizer and not require_unrestricted:
            return None # Visitor mode
        raise HTTPException(status_code=403, detail="You are not a member of this event")
    if require_organizer and member.role != models.UserRole.organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can perform this action")
    if require_unrestricted and member.is_restricted:
        raise HTTPException(status_code=403, detail="Your access has been restricted by the organizer")
    return member

def verify_event_active_for_collector(db: Session, event_id: int, user_id: int):
    """Collectors/Visitors are blocked from data access when event is deactivated. Organizers always pass."""
    member = verify_membership(db, event_id, user_id, require_unrestricted=False)
    event = crud.get_event(db, event_id)
    if not event.is_active and (not member or member.role != models.UserRole.organizer):
        raise HTTPException(status_code=403, detail="This event is deactivated. Contact your organizer.")
    return member


# ─── ROOT ──────────────────────────────────────────────────────────────────────
@app.get("/")
def read_root():
    return {"message": "NotePay API — PRD v12.0 Complete", "docs": "/docs"}


# ─── USER / PROFILE ────────────────────────────────────────────────────────────
@app.post("/users", response_model=schemas.UserResponse, tags=["Profile"])
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
    return member

@app.put("/events/{event_id}/members/{target_user_id}/role", response_model=schemas.EventMemberResponse, tags=["Event Management"])
async def update_member_role(event_id: int, target_user_id: int, data: schemas.MemberRoleUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Change a member's role (e.g., Promote to Organizer). Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)

    event = crud.get_event(db, event_id)
    if target_user_id == event.organizer_id:
        raise HTTPException(status_code=403, detail="The original creator's role cannot be changed.")

    member = crud.update_member_role(db, event_id, target_user_id, data.role)
    if not member:
        raise HTTPException(status_code=404, detail="Member not found")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
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
    verify_event_active_for_collector(db, event_id, user_id)
    res = crud.create_donation(db, event_id, user_id, donation)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_add"})
    return res

@app.put("/events/{event_id}/donations/{donation_id}", response_model=schemas.DonationResponse, tags=["Donations"])
async def update_donation(event_id: int, donation_id: int, data: schemas.DonationUpdate,
                    db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit a donation row. Organizer can edit any row. Collector can only edit their own."""
    member = verify_event_active_for_collector(db, event_id, user_id)
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
    member = verify_event_active_for_collector(db, event_id, user_id)
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
    verify_event_active_for_collector(db, event_id, user_id)
    res = crud.create_expense(db, event_id, user_id, expense)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_add"})
    return res

@app.put("/events/{event_id}/expenses/{expense_id}", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def update_expense(event_id: int, expense_id: int, data: schemas.ExpenseUpdate,
                   db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit an expense row. Organizer can edit any. Collector can only edit their own."""
    member = verify_event_active_for_collector(db, event_id, user_id)
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
    member = verify_event_active_for_collector(db, event_id, user_id)
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
    verify_membership(db, event_id, user_id)
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
    verify_membership(db, event_id, user_id)
    if not data.emoji or len(data.emoji) > 10: # Basic length check to prevent abuse
        raise HTTPException(status_code=400, detail="Invalid emoji length")
    msg = crud.toggle_reaction(db, message_id, user_id, data.emoji)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": msg})
    return {"message": "Reaction toggled"}

@app.delete("/events/{event_id}/chat/{message_id}", tags=["Chat"])
async def delete_chat_message(event_id: int, message_id: int, 
                              db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Wipe a chat message (replaces content with 'deleted'). Only sender or organizer can delete."""
    is_org = False
    mem = db.query(models.EventMember).filter(models.EventMember.event_id == event_id, models.EventMember.user_id == user_id).first()
    if mem and mem.role == "organizer":
        is_org = True
    ev = db.query(models.Event).filter(models.Event.id == event_id).first()
    if ev and ev.organizer_id == user_id:
        is_org = True
        
    msg = crud.delete_chat_message(db, message_id, user_id, is_org)
    if not msg:
        raise HTTPException(status_code=403, detail="Not authorized to delete this message or message not found")
    
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": msg}) # Use CHAT_REACTION to update existing msg in place
    return {"message": "Message deleted"}

# ─── WEBSOCKET ENDPOINT ────────────────────────────────────────────────────────
@app.websocket("/ws/{event_id}")
async def websocket_endpoint(websocket: WebSocket, event_id: int, user_id: int = None):
    await manager.connect(websocket, event_id)
    try:
        while True:
            raw = await websocket.receive_text()
            # Try to handle chat messages sent via WebSocket
            try:
                import json as _json
                msg = _json.loads(raw)
                if msg.get("type") == "CHAT_MSG" and user_id and msg.get("message", "").strip():
                    db = next(get_db())
                    try:
                        reply_id = msg.get("reply_to_id")
                        saved = crud.create_chat_message(db, event_id, user_id, msg["message"].strip(), reply_id)
                        await manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": saved})
                    finally:
                        db.close()
            except Exception:
                pass  # Keepalive pings or invalid JSON — ignore
    except WebSocketDisconnect:
        manager.disconnect(websocket, event_id)
