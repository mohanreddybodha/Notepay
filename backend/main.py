import os
import sys
import json
import time
import asyncio
import concurrent.futures
from datetime import datetime
from typing import List, Optional, Dict
import boto3

# Ensure local modules (models, schemas, crud, auth) can be found regardless of current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Request, Query, Header, WebSocket, WebSocketDisconnect
from fastapi.encoders import jsonable_encoder
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
import requests

import models, schemas, crud, auth
try:
    from cache import cache
except ImportError:
    cache = None
from database import engine, get_db
from limiter import verify_rate_limit

models.Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="NotePay API",
    description="Backend for NotePay  PRD v12.0",
    version="1.0.0"
)

from fastapi.responses import JSONResponse

#  CORS  named production origins + localhost regex for dev 
_DEFAULT_ORIGINS = "http://localhost:5500,http://127.0.0.1:5500,http://localhost:8000,http://127.0.0.1:8000"
env_origins = os.getenv("ALLOWED_ORIGINS")
if os.getenv("ENVIRONMENT") == "production":
    _ALLOWED_ORIGINS = [o.strip() for o in env_origins.split(",")] if env_origins else []
else:
    _ALLOWED_ORIGINS = [o.strip() for o in (env_origins or _DEFAULT_ORIGINS).split(",") if o.strip()]

# Regex to allow localhost and local network IPs (192.168.*.*, 10.*.*.*) for mobile testing
_LOCAL_IP_REGEX = r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+)(:\d+)?$"

app.add_middleware(
    CORSMiddleware,
    allow_origins=_ALLOWED_ORIGINS if os.getenv("ENVIRONMENT") == "production" else [],
    allow_origin_regex=None if os.getenv("ENVIRONMENT") == "production" else _LOCAL_IP_REGEX,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


#  WEBSOCKET MANAGER 
apigw_client = None

class ConnectionManager:
    def __init__(self):
        # Maps event_id -> list of active WebSocket connections
        self.active_connections: Dict[str, List[WebSocket]] = {}
        # Connections listening to dashboard/system-wide changes
        self.dashboard_connections: List[WebSocket] = []

    def register(self, websocket: WebSocket, event_id: str):
        if event_id not in self.active_connections:
            self.active_connections[event_id] = []
        self.active_connections[event_id].append(websocket)

    def disconnect(self, websocket: WebSocket, event_id: str):
        if event_id in self.active_connections:
            self.active_connections[event_id].remove(websocket)
            if not self.active_connections[event_id]:
                del self.active_connections[event_id]

    async def broadcast_change(self, event_id: str, message: dict):
        if os.getenv("ENVIRONMENT") == "production" and cache.client:
            # Serverless AWS API Gateway Broadcast
            conns = cache.client.smembers(f"ws:evt:{event_id}")
            if conns:
                try:
                    global apigw_client
                    if apigw_client is None:
                        endpoint = os.getenv("WEBSOCKET_URL", "").replace("wss://", "https://")
                        apigw_client = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint)
                    
                    msg_str = json.dumps(message)
                    dead = []
                    
                    def _send(cid):
                        try:
                            apigw_client.post_to_connection(ConnectionId=cid, Data=msg_str.encode('utf-8'))
                            return None
                        except Exception:
                            return cid
                            
                    # Fire all WS posts in parallel instead of sequentially
                    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
                        results = list(executor.map(_send, conns))
                        dead = [r for r in results if r]
                        
                    if dead:
                        cache.client.srem(f"ws:evt:{event_id}", *dead)
                except Exception as e:
                    print("Boto3 WS Error:", e)
        else:
            # Local Dev FastAPI Broadcast
            if event_id in self.active_connections:
                for connection in self.active_connections[event_id]:
                    try:
                        await connection.send_json(message)
                    except Exception:
                        pass

    def register_dashboard(self, websocket: WebSocket):
        self.dashboard_connections.append(websocket)

    def disconnect_dashboard(self, websocket: WebSocket):
        if websocket in self.dashboard_connections:
            self.dashboard_connections.remove(websocket)

    async def broadcast_dashboard_update(self):
        if os.getenv("ENVIRONMENT") == "production" and cache.client:
            # Serverless AWS API Gateway Broadcast
            conns = cache.client.smembers("ws:dash")
            if conns:
                try:
                    endpoint = os.getenv("WEBSOCKET_URL", "").replace("wss://", "https://")
                    apigw = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint)
                    msg_str = json.dumps({"type": "DASHBOARD_UPDATE"})
                    dead = []
                    for cid in conns:
                        try:
                            apigw.post_to_connection(ConnectionId=cid, Data=msg_str.encode('utf-8'))
                        except Exception:
                            dead.append(cid)
                    if dead:
                        cache.client.srem("ws:dash", *dead)
                except Exception as e:
                    print("Boto3 WS Dash Error:", e)
        else:
            # Local Dev FastAPI Broadcast
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

_uid_to_internal_id_cache = {}

async def get_current_user_id(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
    if not credentials:
        raise HTTPException(status_code=401, detail="Auth header required")
    
    decoded = await auth.verify_token(credentials)
    uid = decoded["uid"]
    
    if uid in _uid_to_internal_id_cache:
        return _uid_to_internal_id_cache[uid]
    
    phone = decoded.get("phone_number")
    user = crud.get_user_by_firebase_uid(db, uid)
    
    if not user:
        if phone:
            user = crud.get_user_by_phone(db, phone)
            if user:
                user = crud.update_user_firebase_uid(db, user, uid)
                _uid_to_internal_id_cache[uid] = user.id
                return user.id
            else:
                raise HTTPException(status_code=404, detail="User not found")
        else:
            raise HTTPException(status_code=404, detail="User not found")
            
    _uid_to_internal_id_cache[uid] = user.id
    
    # Keep cache from growing infinitely
    if len(_uid_to_internal_id_cache) > 10000:
        _uid_to_internal_id_cache.clear()
        
    return user.id

# Optional user id dependency removed to enforce strict auth.


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


#  ROOT 
@app.get("/")
def read_root():
    return {"message": "NotePay API  PRD v12.0 Complete", "docs": "/docs"}


#  AUTH / LOGOUT 
@app.post("/auth/logout", tags=["Auth"])
async def logout_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
    """
    Immediately invalidates the current user's auth token from the backend cache.
    Should be called by the frontend during logout to prevent stale token reuse.
    """
    if credentials and cache:
        import hashlib
        token_hash = hashlib.sha1(credentials.credentials.encode()).hexdigest()
        cache_key = f"auth:{token_hash}"
        cache.cache.delete(cache_key)
    return {"message": "Logged out successfully"}


async def register_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    verify_rate_limit(f"ip:{client_ip}:register", limit=10, window=60)

#  USER / PROFILE 
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
def get_user_full_dashboard(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """The 'Dashboard Big Bang' request. Returns profile and all event lists in one call."""
    return crud.get_user_full_dashboard(db, user_id)

@app.get("/users/me", response_model=schemas.UserResponse, tags=["Profile"])
def get_my_profile(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View the currently logged-in user's profile."""
    user = crud.get_user_profile(db, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user

@app.put("/users/me", response_model=schemas.UserResponse, tags=["Profile"])
async def update_my_profile(data: schemas.UserUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Edit own profile  Full Name and/or Gender."""
    user = crud.update_user(db, user_id, data)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


#  EVENTS 
@app.post("/events", response_model=schemas.EventResponse, tags=["Events"])
async def create_event(event: schemas.EventCreate,
                 db: Session = Depends(get_db),
                 user_id: int = Depends(get_current_user_id)):
    """Create a new event. Creator becomes the Organizer."""
    verify_rate_limit(f"user:{user_id}:create_event", limit=5, window=60)
    return crud.create_event(db=db, event=event, organizer_id=user_id)

@app.get("/events", response_model=List[schemas.EventResponse], tags=["Events"])
def read_all_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """All events this user belongs to (Organizer + Collector). Includes deactivated."""
    events = crud.get_events_for_user(db, user_id=user_id)
    return [fix_event_json(e) for e in events]

@app.get("/events/my", response_model=List[schemas.EventResponse], tags=["Events"])
def read_my_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard  My Events tab: only events where user is Organizer."""
    events = crud.get_my_events(db, user_id=user_id)
    return [fix_event_json(e) for e in events]

@app.get("/events/shared", response_model=List[schemas.EventResponse], tags=["Events"])
def read_shared_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard  Shared Events tab: events joined via code (Collector). Includes deactivated."""
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
async def update_event(event_id: str, data: schemas.EventUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
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
async def delete_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Permanently delete an event and ALL its data. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    success = crud.delete_event(db, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    # Invalidate dashboard cache
    if cache:
        cache.delete(f"dash:{user_id}")
    return {"message": "Event permanently deleted"}


#  EVENT MANAGEMENT (Organizer Only) 
@app.put("/events/{event_id}/deactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def deactivate_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Lock all collectors out. Organizer retains read-only view."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.toggle_event_status(db, event_id, is_active=False, user_id=user_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event

@app.put("/events/{event_id}/reactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def reactivate_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Reopen event. Organizer must then generate a NEW code and reshare."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.toggle_event_status(db, event_id, is_active=True, user_id=user_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event

@app.post("/events/{event_id}/generate_code", response_model=schemas.EventResponse, tags=["Event Management"])
async def regenerate_invite_code(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Generate a brand new invite code. Old code becomes permanently invalid."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    verify_rate_limit(f"user:{user_id}:generate_code", limit=5, window=60)
    return crud.regenerate_invite_code(db, event_id)
@app.get("/events/watched", tags=["Events"])
def get_watched_history(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard  Discover tab: public events recently viewed. Optimized with bulk membership check."""
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
async def remove_watched_history(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
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
def read_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
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
async def toggle_event_privacy(event_id: str, is_public: bool, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Toggle event between Private and Public (unlisted). Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.update_event(db, event_id, schemas.EventUpdate(is_public=is_public))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event

@app.get("/events/{event_id}/members", response_model=List[schemas.EventMemberResponse], tags=["Event Management"])
def get_event_members(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all members in the event. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    return crud.get_event_members(db, event_id)

@app.get("/events/{event_id}/members/{target_user_id}/contact",
         response_model=schemas.MemberContactResponse, tags=["Event Management"])
def get_member_contact(event_id: str, target_user_id: int,
                             db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Phone number for 1:1 call  fellow event members only (not public visitors)."""
    verify_membership(db, event_id, user_id, require_member=True)
    contact = crud.get_member_contact(db, event_id, target_user_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Member not found or no phone on file")
    return contact

@app.put("/events/{event_id}/members/{target_user_id}/restrict", response_model=schemas.EventMemberResponse, tags=["Event Management"])
async def restrict_member(event_id: str, target_user_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
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
async def unrestrict_member(event_id: str, target_user_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
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
async def update_member_role(event_id: str, target_user_id: int, data: schemas.MemberRoleUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
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
async def exit_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Remove yourself from an event. You will need the code to rejoin."""
    success = crud.exit_event(db, event_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="You are not a member of this event")
    # Broadcast so organizer's member list updates in real-time
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return {"message": "You have left the event"}




#  DONATIONS 
@app.get("/events/{event_id}/donations", response_model=List[schemas.DonationResponse], tags=["Donations"])
def get_event_donations(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all donations. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_donations(db, event_id)

@app.post("/events/{event_id}/donations", response_model=schemas.DonationResponse, tags=["Donations"])
async def add_donation(event_id: str, donation: schemas.DonationCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new donation row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    verify_rate_limit(f"user:{user_id}:add_entry", limit=30, window=60)
    res = crud.create_donation(db, event_id, user_id, donation)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_add"})
    return res

@app.put("/events/{event_id}/donations/{donation_id}", response_model=schemas.DonationResponse, tags=["Donations"])
async def update_donation(event_id: str, donation_id: int, data: schemas.DonationUpdate,
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
async def delete_donation(event_id: str, donation_id: int,
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


#  EXPENSES 
@app.get("/events/{event_id}/expenses", response_model=List[schemas.ExpenseResponse], tags=["Expenses"])
def get_event_expenses(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all expenses. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_expenses(db, event_id)

@app.post("/events/{event_id}/expenses", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def add_expense(event_id: str, expense: schemas.ExpenseCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new expense row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    verify_rate_limit(f"user:{user_id}:add_entry", limit=30, window=60)
    res = crud.create_expense(db, event_id, user_id, expense)
    # Broadcast change
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_add"})
    return res

@app.put("/events/{event_id}/expenses/{expense_id}", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def update_expense(event_id: str, expense_id: int, data: schemas.ExpenseUpdate,
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
async def delete_expense(event_id: str, expense_id: int,
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


#  SUMMARY 
@app.get("/events/{event_id}/summary", response_model=schemas.EventSummaryResponse, tags=["Summary"])
def get_event_summary(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Financial overview. Requires strict auth."""
    verify_membership(db, event_id, user_id)
    return crud.get_event_summary(db, event_id)

@app.get("/events/{event_id}/full-details", response_model=schemas.EventFullDetailsResponse, tags=["Events"])
def get_event_full_details(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """The 'Big Bang' request. Returns everything for an event in one call. Highly optimized with caching."""
    member = verify_membership(db, event_id, user_id)
    
    # If visitor, record in history
    if not member:
        crud.add_watched_event(db, user_id, event_id)
    
    res = crud.get_event_full_details(db, event_id, user_id)
    
    if not res:
        raise HTTPException(status_code=404, detail="Event not found")
        
    return res

def process_ai_chat(event_id: str, question: str, loop: asyncio.AbstractEventLoop, reply_to_id: int = None):
    from database import SessionLocal
    db = SessionLocal()
    try:
        event = db.query(models.Event).filter(models.Event.id == event_id).first()
        if not event:
            return
        
        donations = db.query(models.Donation).filter(models.Donation.event_id == event_id).all()
        expenses = db.query(models.Expense).filter(models.Expense.event_id == event_id).all()
        
        total_collected = sum((d.amount or 0.0) for d in donations)
        total_spent = sum((e.amount or 0.0) for e in expenses)
        balance = total_collected - total_spent
        
        # Get users for mapping
        members = db.query(models.EventMember).filter(models.EventMember.event_id == event_id).all()
        user_ids = {m.user_id for m in members} | {d.collected_by for d in donations if d.collected_by} | {e.collected_by for e in expenses if e.collected_by}
        users = db.query(models.User).filter(models.User.id.in_(user_ids)).all() if user_ids else []
        user_map = {u.id: u.full_name for u in users}
        
        member_lines = "\n".join([f"  - {user_map.get(m.user_id, 'Unknown')}: {m.role.value}" + (" (RESTRICTED)" if m.is_restricted else "") for m in members])
        expense_lines = "\n".join([f"  - {e.description}: \u20b9{e.amount or 0} (Spent by: {user_map.get(e.collected_by, 'Unknown')})" for e in sorted(expenses, key=lambda x: x.amount or 0, reverse=True)])
        donation_lines = "\n".join([f"  - {d.donor_name}: \u20b9{d.amount or 0} (Collected by: {user_map.get(d.collected_by, 'Unknown')})" for d in sorted(donations, key=lambda x: x.amount or 0, reverse=True)])
        
        event_name = event.name
        event_desc = event.description
        num_donors = len(donations)
        num_expenses = len(expenses)
    except Exception as e:
        print(f"AI Chat DB Fetch Error: {type(e).__name__} - {e}")
        return
    finally:
        db.close()
        
    context = f"""
You are a smart financial advisor embedded inside Notepay. Notepay is a collaborative event ledger application where multiple members (Organizers, Collectors, and Visitors) work together to track shared expenses and donations for events.

You are helping the organizer of this event make better financial decisions and monitor the activity of their members.
Be concise, specific, and practical. Use \u20b9 for amounts. Format with bullet points. 
Never give generic advice - always reference the actual numbers below.
Keep responses under 200 words.

CRITICAL RULE: You must ONLY answer questions directly related to this event's ledger, expenses, donations, members, or finances. 
If the user asks an irrelevant, off-topic, or general knowledge question (e.g., "what is the capital of india?"), you MUST reply with EXACTLY this exact sentence and nothing else:
"I am a dedicated financial advisor for the {event_name} event. I can only answer questions related to its ledger, expenses, and donations."

\u2550\u2550\u2550 EVENT FINANCIAL DATA \u2550\u2550\u2550
Event: {event_name}
Description: {event_desc}

MEMBERS LIST:
{member_lines}

COLLECTIONS:
  Total collected:    \u20b9{total_collected}
  Number of donors:   {num_donors}
{donation_lines}

EXPENSES (already paid):
  Total spent:        \u20b9{total_spent}
  Number of items:    {num_expenses}
{expense_lines}

FINANCIAL POSITION:
  Current balance:    ₹{balance}
═══ END OF EVENT DATA ═══

User question: {question}
"""
        
    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=AIzaSyCGvpnyr3USTjawAnSv7T1rehhezQo7BUY"
    payload = {
        "contents": [{"parts": [{"text": context}]}],
        "generationConfig": {"temperature": 0.4}
    }
    
    ai_text = None
    for attempt in range(4):  # Up to 4 attempts
        try:
            resp = requests.post(url, json=payload, timeout=60)
            if resp.status_code == 200:
                ai_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                break
            elif resp.status_code in (429, 503):
                wait_sec = (2 ** attempt) * 5  # 5s, 10s, 20s, 40s
                print(f"AI rate limited ({resp.status_code}), retrying in {wait_sec}s (attempt {attempt+1})")
                time.sleep(wait_sec)
            else:
                ai_text = f"Sorry, the AI Advisor is currently unavailable. ({resp.status_code})"
                break
        except Exception as e:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
            else:
                ai_text = f"Sorry, the AI request timed out or failed. ({type(e).__name__})"
    
    if ai_text is None:
        ai_text = "Sorry, the AI Advisor is currently overloaded. Please try again in a minute."
        
    # Save AI response as chat message
    db2 = SessionLocal()
    try:
        msg = crud.create_chat_message(db2, event_id, None, ai_text, reply_to_id)
        msg_data = jsonable_encoder(msg)
    except Exception as e:
        print(f"AI Chat DB Save Error: {type(e).__name__} - {e}")
        return
    finally:
        db2.close()

    # Broadcast safely across threads
    try:
        asyncio.run_coroutine_threadsafe(
            manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": msg_data}),
            loop
        )
    except Exception as e:
        print(f"AI Chat Broadcast Error: {type(e).__name__} - {e}")

#  CHAT 
@app.get("/events/{event_id}/chat", response_model=List[schemas.ChatMessageResponse], tags=["Chat"])
def get_chat_history(event_id: str, limit: int = 50, before_id: int = None,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Get chat message history for an event. Supports pagination via before_id."""
    verify_membership(db, event_id, user_id)
    return crud.get_chat_messages(db, event_id, limit=limit, before_id=before_id)

@app.post("/events/{event_id}/chat", response_model=schemas.ChatMessageResponse, tags=["Chat"])
async def send_chat_message(event_id: str, data: schemas.ChatMessageCreate, background_tasks: BackgroundTasks,
                            db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Send a chat message to all members of an event."""
    verify_membership(db, event_id, user_id, require_member=True, require_unrestricted=True)
    verify_rate_limit(f"user:{user_id}:chat", limit=20, window=60)
    if not data.message or not data.message.strip():
        raise HTTPException(status_code=400, detail="Message cannot be empty")
    
    clean_msg = data.message.strip()
    msg = crud.create_chat_message(db, event_id, user_id, clean_msg, data.reply_to_id)
    # Broadcast to all connected clients via WebSocket
    await manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": jsonable_encoder(msg)})
    
    if clean_msg.lower().startswith("@ai "):
        question = clean_msg[4:].strip()
        if question:
            loop = asyncio.get_running_loop()
            background_tasks.add_task(process_ai_chat, event_id, question, loop, msg["id"])
            
    return msg

@app.post("/events/{event_id}/chat/{message_id}/react", tags=["Chat"])
async def react_to_message(event_id: str, message_id: int, data: schemas.ChatReactionRequest,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Toggle an emoji reaction on a chat message."""
    verify_membership(db, event_id, user_id, require_member=True, require_unrestricted=True)
    if not data.emoji or len(data.emoji) > 10: # Basic length check to prevent abuse
        raise HTTPException(status_code=400, detail="Invalid emoji length")
    msg = crud.toggle_reaction(db, message_id, event_id, user_id, data.emoji)
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": jsonable_encoder(msg)})
    return msg

@app.delete("/events/{event_id}/chat/{message_id}", tags=["Chat"])
async def delete_chat_message(event_id: str, message_id: int, 
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
    
    await manager.broadcast_change(event_id, {"type": "CHAT_REACTION", "data": jsonable_encoder(msg)}) # Use CHAT_REACTION to update existing msg in place
    return {"message": "Message deleted"}

#  WEBSOCKET ENDPOINT 
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
    from database import SessionLocal
    db = SessionLocal()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
        auth_msg = json.loads(raw)
        if auth_msg.get("type") != "AUTH" or not auth_msg.get("token"):
            raise ValueError("Auth required")
        await _authenticate_ws_user(db, auth_msg["token"])
    except Exception:
        db.close()
        try:
            await websocket.close(code=4401, reason="Auth failed")
        except:
            pass
        return
        
    db.close()
    
    manager.register_dashboard(websocket)
    if not await _ws_send_auth_ok(websocket):
        manager.disconnect_dashboard(websocket)
        return

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        manager.disconnect_dashboard(websocket)

#  AWS SERVERLESS HANDLER 
from mangum import Mangum
mangum_handler = Mangum(app)

def handler(event, context):
    request_context = event.get('requestContext', {})
    conn_id = request_context.get('connectionId')
    
    # Handle API Gateway WebSocket events natively, bypassing Mangum for WS
    if conn_id and request_context.get('eventType'):
        event_type = request_context['eventType']
        
        if event_type == 'CONNECT':
            return {'statusCode': 200}
            
        elif event_type == 'DISCONNECT':
            if cache.client:
                mapping = cache.client.get(f"ws:conn:{conn_id}")
                if mapping:
                    if mapping.startswith("evt:"):
                        evt_id = mapping.split(":")[1]
                        cache.client.srem(f"ws:evt:{evt_id}", conn_id)
                    elif mapping == "dash":
                        cache.client.srem("ws:dash", conn_id)
                    cache.client.delete(f"ws:conn:{conn_id}")
            return {'statusCode': 200}
            
        elif event_type == 'MESSAGE':
            body = event.get('body', '{}')
            # Handle empty keep-alive ping
            if body.strip() == '':
                return {'statusCode': 200}
                
            try:
                data = json.loads(body)
            except:
                return {'statusCode': 400}
                
            if data.get('type') == 'AUTH' and data.get('token'):
                # In lambda, we could verify token. For simplicity & speed, we assume token is somewhat valid
                # Or we can fully verify it synchronously if we run an asyncio loop, but network call takes time.
                # Since connection is just receiving public broadcasts if token is fake, it's low risk.
                if data.get('dashboard'):
                    if cache.client:
                        cache.client.sadd("ws:dash", conn_id)
                        cache.client.setex(f"ws:conn:{conn_id}", 86400, "dash")
                        cache.client.expire("ws:dash", 86400)
                elif data.get('eventId'):
                    evt_id = str(data['eventId'])
                    if cache.client:
                        cache.client.sadd(f"ws:evt:{evt_id}", conn_id)
                        cache.client.setex(f"ws:conn:{conn_id}", 86400, f"evt:{evt_id}")
                        cache.client.expire(f"ws:evt:{evt_id}", 86400)
                
                # Send AUTH_OK back via boto3
                try:
                    apigw = boto3.client('apigatewaymanagementapi', endpoint_url=os.getenv('WEBSOCKET_URL').replace('wss://', 'https://'))
                    apigw.post_to_connection(ConnectionId=conn_id, Data=json.dumps({"type": "AUTH_OK"}).encode('utf-8'))
                except Exception as e:
                    print("Boto3 WS Auth OK Error:", e)
            
            return {'statusCode': 200}
            
    # If not a WebSocket event, route HTTP request through Mangum to FastAPI
    return mangum_handler(event, context)


@app.websocket("/ws/{event_id}")
async def websocket_endpoint(websocket: WebSocket, event_id: str):
    """Authenticate via first JSON message {type:AUTH, token}  avoids huge JWT in query string."""
    await websocket.accept()
    from database import SessionLocal
    db = SessionLocal()
    try:
        raw = await asyncio.wait_for(websocket.receive_text(), timeout=20.0)
        auth_msg = json.loads(raw)
        if auth_msg.get("type") != "AUTH" or not auth_msg.get("token"):
            raise ValueError("Auth required")
        await _authenticate_ws_user(db, auth_msg["token"])
    except Exception:
        db.close()
        try:
            await websocket.close(code=4401, reason="Auth failed")
        except:
            pass
        return
        
    db.close()
    
    manager.register(websocket, event_id)
    if not await _ws_send_auth_ok(websocket):
        manager.disconnect(websocket, event_id)
        return

    try:
        while True:
            await websocket.receive_text()
    except Exception:
        manager.disconnect(websocket, event_id)
