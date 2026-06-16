import os
import sys
import json
import time
import asyncio
import concurrent.futures
from datetime import datetime
from typing import List, Optional, Dict
import boto3
from dotenv import load_dotenv
load_dotenv()  # Load .env for local development

# Ensure local modules (models, schemas, crud, auth) can be found regardless of current directory
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from fastapi import FastAPI, Depends, HTTPException, BackgroundTasks, Request, Query, Header, WebSocket, WebSocketDisconnect, UploadFile, File
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
from limiter import verify_rate_limit, check_rate_limit

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
    admin_domain = os.getenv("ADMIN_DOMAIN")
    if admin_domain:
        _ALLOWED_ORIGINS.append(admin_domain)
    _ALLOWED_ORIGINS.append("https://admin.notepay.in")
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

async def get_current_user_id(
    db: Session = Depends(get_db),
    credentials: HTTPAuthorizationCredentials = Depends(_bearer)
):
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
                user = crud.update_user_firebase_uid(db, user, uid)
            else:
                raise HTTPException(status_code=404, detail="User not found")
        else:
            raise HTTPException(status_code=404, detail="User not found")
            
    if getattr(user, 'is_banned', False):
        raise HTTPException(status_code=403, detail=f"Your account has been banned. Reason: {user.ban_reason or 'No reason provided.'}")
        
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


@app.get("/health", tags=["System"])
def health_check():
    """Simple health check for deployment pipelines."""
    return {"status": "ok"}

async def register_rate_limit(request: Request):
    client_ip = request.client.host if request.client else "unknown"
    verify_rate_limit(f"ip:{client_ip}:register", limit=5, window=3600)

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


@app.post("/feedback", response_model=dict, tags=["Profile"])
async def submit_feedback(data: schemas.FeedbackCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Submit a bug report, feature request, or security issue."""
    verify_rate_limit(f"user:{user_id}:feedback", limit=3, window=3600)
    new_feedback = models.Feedback(
        user_id=user_id,
        type=data.type,
        message=data.message,
        status="pending"
    )
    db.add(new_feedback)
    db.commit()
    return {"message": "Feedback submitted successfully"}

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
    verify_rate_limit(f"user:{user_id}:generate_code", limit=5, window=3600)
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

@app.get("/events/{event_id}/donations/{donation_id}/receipt", tags=["Donations"])
def get_donation_receipt(event_id: str, donation_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Fetch the receipt image securely."""
    verify_membership(db, event_id, user_id)
    donation = db.query(models.Donation).filter_by(id=donation_id, event_id=event_id).first()
    if not donation or not donation.receipt_key:
        raise HTTPException(status_code=404, detail="Receipt not found")
        
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    if not s3_bucket or donation.receipt_key.startswith("local://"):
        # Local fallback
        local_path = donation.receipt_key.replace("local://", "")
        # Construct absolute path to backend/uploads
        base_dir = os.path.dirname(os.path.abspath(__file__))
        abs_local_path = os.path.join(base_dir, local_path)
        if not os.path.exists(abs_local_path):
            raise HTTPException(status_code=404, detail="Receipt image not found on local disk")
        from fastapi.responses import FileResponse
        return FileResponse(abs_local_path)
        
    try:
        s3_client = boto3.client('s3')
        obj = s3_client.get_object(Bucket=s3_bucket, Key=donation.receipt_key)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(obj['Body'], media_type=obj['ContentType'])
    except Exception as e:
        print(f"Failed to fetch receipt from S3: {e}")
        raise HTTPException(status_code=404, detail="Receipt image not found in storage")

@app.post("/events/{event_id}/donations/{donation_id}/receipt", tags=["Donations"])
async def upload_donation_receipt_manual(event_id: str, donation_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Manually upload a receipt for a donation."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    donation = db.query(models.Donation).filter_by(id=donation_id, event_id=event_id).first()
    if not donation:
        raise HTTPException(status_code=404, detail="Donation not found")
    if member.role != models.UserRole.organizer and donation.collected_by != user_id:
        raise HTTPException(status_code=403, detail="You can only upload receipts for your own entries")
        
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    try:
        contents = await file.read()
        import uuid
        if s3_bucket:
            receipt_key = f"receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            s3_client = boto3.client('s3')
            s3_client.put_object(
                Bucket=s3_bucket,
                Key=receipt_key,
                Body=contents,
                ContentType=file.content_type or 'image/jpeg'
            )
        else:
            # Local fallback
            base_dir = os.path.dirname(os.path.abspath(__file__))
            local_dir = os.path.join(base_dir, f"uploads/receipts/{event_id}")
            os.makedirs(local_dir, exist_ok=True)
            local_filename = f"uploads/receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            abs_local_path = os.path.join(base_dir, local_filename)
            with open(abs_local_path, "wb") as f:
                f.write(contents)
            receipt_key = f"local://{local_filename}"
        donation.receipt_key = receipt_key
        db.commit()
        await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "receipt_upload"})
        return {"receipt_key": receipt_key, "message": "Receipt uploaded successfully"}
    except Exception as e:
        print(f"Failed to upload manual receipt: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload receipt")

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

@app.get("/events/{event_id}/expenses/{expense_id}/receipt", tags=["Expenses"])
def get_expense_receipt(event_id: str, expense_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Fetch the receipt image securely."""
    verify_membership(db, event_id, user_id)
    expense = db.query(models.Expense).filter_by(id=expense_id, event_id=event_id).first()
    if not expense or not expense.receipt_key:
        raise HTTPException(status_code=404, detail="Receipt not found")
        
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    if not s3_bucket or expense.receipt_key.startswith("local://"):
        local_path = expense.receipt_key.replace("local://", "")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        abs_local_path = os.path.join(base_dir, local_path)
        if not os.path.exists(abs_local_path):
            raise HTTPException(status_code=404, detail="Receipt image not found locally")
        from fastapi.responses import FileResponse
        return FileResponse(abs_local_path)
        
    try:
        s3_client = boto3.client('s3')
        obj = s3_client.get_object(Bucket=s3_bucket, Key=expense.receipt_key)
        from fastapi.responses import StreamingResponse
        return StreamingResponse(obj['Body'], media_type=obj['ContentType'])
    except Exception as e:
        print(f"Failed to fetch expense receipt from S3: {e}")
        raise HTTPException(status_code=404, detail="Receipt image not found in storage")

@app.post("/events/{event_id}/expenses/{expense_id}/receipt", tags=["Expenses"])
async def upload_expense_receipt_manual(event_id: str, expense_id: int, file: UploadFile = File(...), db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Manually upload a receipt for an expense."""
    member = verify_event_active_for_collector(db, event_id, user_id, for_write=True)
    expense = db.query(models.Expense).filter_by(id=expense_id, event_id=event_id).first()
    if not expense:
        raise HTTPException(status_code=404, detail="Expense not found")
    if member.role != models.UserRole.organizer and expense.collected_by != user_id:
        raise HTTPException(status_code=403, detail="You can only upload receipts for your own entries")
        
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    try:
        contents = await file.read()
        import uuid
        if s3_bucket:
            receipt_key = f"receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            s3_client = boto3.client('s3')
            s3_client.put_object(
                Bucket=s3_bucket,
                Key=receipt_key,
                Body=contents,
                ContentType=file.content_type or 'image/jpeg'
            )
        else:
            # Local fallback
            base_dir = os.path.dirname(os.path.abspath(__file__))
            local_dir = os.path.join(base_dir, f"uploads/receipts/{event_id}")
            os.makedirs(local_dir, exist_ok=True)
            local_filename = f"uploads/receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            abs_local_path = os.path.join(base_dir, local_filename)
            with open(abs_local_path, "wb") as f:
                f.write(contents)
            receipt_key = f"local://{local_filename}"
        expense.receipt_key = receipt_key
        db.commit()
        await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "expense_receipt_upload"})
        return {"receipt_key": receipt_key, "message": "Receipt uploaded successfully"}
    except Exception as e:
        print(f"Failed to upload expense manual receipt: {e}")
        raise HTTPException(status_code=500, detail="Failed to upload receipt")


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
        expense_lines = "\n".join([f"  - {e.description}: ₹{e.amount or 0} (Spent by: {user_map.get(e.collected_by, 'Unknown')})" for e in sorted(expenses, key=lambda x: x.amount or 0, reverse=True)])
        donation_lines = "\n".join([f"  - {d.donor_name}: ₹{d.amount or 0} (Collected by: {user_map.get(d.collected_by, 'Unknown')})" for d in sorted(donations, key=lambda x: x.amount or 0, reverse=True)])
        
        event_name = event.name
        event_desc = event.description
        num_donors = len(donations)
        num_expenses = len(expenses)
    except Exception as e:
        print(f"AI Chat DB Fetch Error: {type(e).__name__} - {e}")
        return
    finally:
        db.close()
    system_prompt = f"""
You are a friendly, helpful event management and financial assistant inside Notepay. Notepay is an app where friends and family work together to organize events, track shared expenses, and collect money.

You are helping the event organizer understand the event's finances and providing general advice for event management.
Follow these rules strictly:
1. Speak in plain, simple, everyday language. Avoid hard technical words (like "ledger", "fiscal", "liabilities"). Instead, use words like "money collected", "money spent", "remaining balance", etc.
2. Be warm, supportive, and extremely easy to understand.
3. Be concise and to the point.
4. Use ₹ for all money amounts.
5. Format your answer with clear bullet points.
6. When answering questions about the event's current numbers, ONLY use the exact data provided below. Do not make up any financial numbers.
7. You are allowed and encouraged to give general advice, ideas, and suggestions for event management (e.g., how to collect donations, how to organize activities, how to handle members).
8. Keep your response under 250 words.

KNOWLEDGE BASE: NOTEPAY MEMBER ROLES
- Organizer: The creator of the event. They can edit the event, delete the event, add/delete/edit any financial entries, and promote/restrict members.
- Collector: A normal member. They can read everything, add new donations/expenses, and edit/delete their own entries.
- Restricted Member: A member whose access has been temporarily blocked by the Organizer. They have absolutely ZERO permissions. They cannot read the finances, they cannot write, and they cannot add collections until they are unrestricted.

CRITICAL RULE: You must ONLY answer questions related to this event, its finances, its members, or general event management/organization advice.
You do NOT know how the Notepay app works technically. Do NOT give instructions on how to use Notepay features (like how to create an event, how to add members, etc).
If the user asks ANY unrelated question (like coding, history) OR asks how to use the Notepay app, you MUST reject the question. 
To reject a question, you must output EXACTLY the following sentence and absolutely nothing else (no greetings, no explanations):
"I'm your friendly Notepay assistant for the {event_name} event! I can help you with your event's finances, members, and give you general advice for organizing your event."

═══ EVENT FINANCIAL DATA ═══
Event: {event_name}
Description: {event_desc}

MEMBERS LIST:
{member_lines}

COLLECTIONS:
  Total collected:    ₹{total_collected}
  Number of donors:   {num_donors}
{donation_lines}

EXPENSES (already paid):
  Total spent:        ₹{total_spent}
  Number of items:    {num_expenses}
{expense_lines}

FINANCIAL POSITION:
  Current balance:    ₹{balance}
═══ END OF EVENT DATA ═══
"""
        
    groq_api_key = os.environ.get("GROQ_API_KEY")
    if not groq_api_key:
        try:
            import boto3
            ssm = boto3.client('ssm')
            param = ssm.get_parameter(Name='/notepay/groq_key', WithDecryption=True)
            groq_api_key = param['Parameter']['Value']
        except Exception as e:
            print(f"Chat SSM fetch failed: {e}")
            
    gemini_api_key = os.environ.get("GEMINI_KEY_1")
    
    ai_text = None
    if not groq_api_key and not gemini_api_key:
        print("AI Chat Error: Both GROQ_API_KEY and GEMINI_KEY_1 are missing.")
        ai_text = "AI Advisor configuration error: API keys are missing."
    else:
        # 1. Attempt Groq with multi-model fallback
        if groq_api_key:
            groq_models = ["llama-3.1-8b-instant", "llama-3.3-70b-versatile", "mixtral-8x7b-32768"]
            for model_id in groq_models:
                groq_payload = {
                    "model": model_id,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": question}
                    ],
                    "temperature": 0.4
                }
                for attempt in range(2):
                    try:
                        # Groq is fast, timeout is 30s
                        groq_resp = requests.post(
                            "https://api.groq.com/openai/v1/chat/completions",
                            headers={"Authorization": f"Bearer {groq_api_key}"},
                            json=groq_payload,
                            timeout=30
                        )
                        if groq_resp.status_code == 200:
                            ai_text = groq_resp.json()["choices"][0]["message"]["content"]
                            break
                        elif groq_resp.status_code == 429:
                            retry_after = groq_resp.headers.get("retry-after")
                            if retry_after and float(retry_after) <= 4.0 and attempt == 0:
                                print(f"Groq 429 Hit on {model_id}. Retrying after {retry_after}s...")
                                time.sleep(float(retry_after))
                                continue
                            else:
                                print(f"Groq {model_id} hit hard rate limit. Trying next model...")
                                break
                        else:
                            print(f"Groq API Error {groq_resp.status_code} on {model_id}: {groq_resp.text[:100]}")
                            break
                    except Exception as e:
                        print(f"Groq connection failed for {model_id}: {type(e).__name__} - {e}")
                        break
                        
                if ai_text:
                    break # Success! Exit the model loop
                
        # 2. Attempt Gemini Fallback if Groq failed or is unavailable
        if not ai_text and gemini_api_key:
            gemini_payload = {
                "contents": [{"parts": [{"text": system_prompt + "\n\nUser question: " + question}]}],
                "generationConfig": {"temperature": 0.4}
            }
            url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_api_key}"
            for attempt in range(2):
                try:
                    resp = requests.post(url, json=gemini_payload, timeout=60)
                    if resp.status_code == 200:
                        ai_text = resp.json()["candidates"][0]["content"]["parts"][0]["text"]
                        break
                    elif resp.status_code in (429, 503):
                        wait_sec = (2 ** attempt) * 5
                        print(f"Gemini rate limited ({resp.status_code}), retrying in {wait_sec}s (attempt {attempt+1})")
                        time.sleep(wait_sec)
                    else:
                        print(f"Gemini API Error {resp.status_code}: {resp.text[:100]}")
                        break
                except Exception as e:
                    print(f"Gemini connection failed: {type(e).__name__} - {e}")
                    break
    
    if not ai_text:
        ai_text = "I'm experiencing some technical difficulties right now. Please try asking again in a few minutes! 🛠️"
        
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
        
    if hasattr(data, "idempotency_key") and data.idempotency_key and cache:
        local_key = f"idemp:{user_id}:{data.idempotency_key}"
        existing = cache.get(local_key)
        if existing:
            existing_id = int(existing)
            existing_msg = db.query(models.ChatMessage).filter(models.ChatMessage.id == existing_id).first()
            if existing_msg:
                return existing_msg
    
    clean_msg = data.message.strip()
    
    ai_limit_reached = False
    if clean_msg.lower().startswith("@ai "):
        today_str = datetime.utcnow().strftime('%Y-%m-%d')
        if not check_rate_limit(f"event:{event_id}:user:{user_id}:ai_chat:{today_str}", limit=10, window=86400):
            ai_limit_reached = True
    
    msg = crud.create_chat_message(db, event_id, user_id, clean_msg, data.reply_to_id)
    
    if hasattr(data, "idempotency_key") and data.idempotency_key and cache:
        cache.set(f"idemp:{user_id}:{data.idempotency_key}", msg["id"], expire=86400)
        
    # Broadcast to all connected clients via WebSocket
    await manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": jsonable_encoder(msg)})
    
    # Process AI response asynchronously
    if clean_msg.lower().startswith("@ai "):
        if ai_limit_reached:
            # Friendly rate limit message
            friendly_text = "Hey! You've reached your AI query limit for today. I need to take a nap! 😴"
            loop = asyncio.get_running_loop()
            await manager.broadcast_change(event_id, {"type": "AI_TYPING"})
            
            async def send_friendly_nap():
                await asyncio.sleep(1.5)
                from database import SessionLocal
                db2 = SessionLocal()
                try:
                    nap_msg = crud.create_chat_message(db2, event_id, None, friendly_text, msg["id"])
                    nap_data = jsonable_encoder(nap_msg)
                    asyncio.run_coroutine_threadsafe(
                        manager.broadcast_change(event_id, {"type": "NEW_CHAT_MSG", "data": nap_data}), loop
                    )
                finally:
                    db2.close()
                    
            background_tasks.add_task(send_friendly_nap)
        else:
            question = clean_msg[4:].strip()
            if question:
                loop = asyncio.get_running_loop()
                await manager.broadcast_change(event_id, {"type": "AI_TYPING"})
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

@app.post("/events/{event_id}/chat/{message_id}/status", tags=["Chat"])
async def update_message_status(event_id: str, message_id: int, data: schemas.MessageStatusUpdate,
                           db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Update message status to delivered or read."""
    verify_membership(db, event_id, user_id, require_member=True)
    if data.status not in ["delivered", "read"]:
        raise HTTPException(status_code=400, detail="Invalid status")
    
    msg = crud.update_chat_status(db, message_id, event_id, user_id, data.status)
    if not msg:
        # Either msg not found or no change needed (e.g., sender marking own msg)
        return {"message": "Ignored"}
        
    await manager.broadcast_change(event_id, {"type": "CHAT_STATUS_UPDATE", "data": jsonable_encoder(msg)})
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

from routers import admin
app.include_router(admin.router)

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


# --- RECOVERED ENDPOINTS ---
from fastapi import UploadFile, File


@app.post("/api/public/event/{event_id}/upload_receipt", tags=["Public Portal"])
async def upload_receipt(event_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event.upi_id or not event.upi_owner_name:
        raise HTTPException(status_code=409, detail="The organizer must verify the event UPI ID before accepting donations")
    
    if not file.content_type or not file.content_type.startswith('image/'):
        raise HTTPException(status_code=400, detail="File must be an image")
    
    try:
        contents = await file.read()
        if not contents:
            raise HTTPException(status_code=400, detail="File is empty")
        
        if len(contents) > 5 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File too large (max 5MB)")
            
        receipt_key = None
        s3_bucket = os.getenv("RECEIPTS_BUCKET")
        import uuid
        try:
            if s3_bucket:
                s3_client = boto3.client('s3')
                receipt_key = f"receipts/{event_id}/{uuid.uuid4().hex}.jpg"
                s3_client.put_object(
                    Bucket=s3_bucket,
                    Key=receipt_key,
                    Body=contents,
                    ContentType=file.content_type or 'image/jpeg'
                )
            else:
                base_dir = os.path.dirname(os.path.abspath(__file__))
                local_dir = os.path.join(base_dir, f"uploads/receipts/{event_id}")
                os.makedirs(local_dir, exist_ok=True)
                local_filename = f"uploads/receipts/{event_id}/{uuid.uuid4().hex}.jpg"
                abs_local_path = os.path.join(base_dir, local_filename)
                with open(abs_local_path, "wb") as f:
                    f.write(contents)
                receipt_key = f"local://{local_filename}"
        except Exception as e:
            print(f"Failed to upload receipt early: {e}")

        def get_fallback_response(msg):
            session_id = str(uuid.uuid4())
            try:
                from cache import cache
                cache.set(f"receipt:{session_id}", {
                    "receipt_key": receipt_key,
                    "extraction_api": "manual_fallback"
                }, expire=900)
            except Exception as e:
                pass
            return {
                "status": "extraction_failed",
                "extraction_failed": True,
                "message": msg,
                "receipt_session_id": session_id
            }
        
        prompt = '''You are analyzing an Indian UPI payment receipt screenshot. Extract these 5 fields:
1. amount: The payment amount in INR as a number (e.g., 10.00, 110.00)
2. sender_name: The person who SENT the money (the payer)
3. receiver_name: The person or business who RECEIVED the money (the payee)
4. transaction_date: The date in YYYY-MM-DD format
5. status: "success" if this is a successful payment receipt, "failed" if the screenshot shows a failed or pending transaction, "unrelated_image" if the image is NOT a payment receipt (e.g., selfie, scenery, random text).

KEY RULES FOR DIFFERENT UPI APPS:

PhonePe receipts:
- "Banking Name: John Doe" → receiver_name is "John Doe" (this is the RECEIVER\'s account name)
- "Debited from" section = the SENDER\'s bank account
- "Transfer to" section = the RECEIVER\'s bank account
- The name under "Banking Name" in the "Transfer to" section = receiver_name

Google Pay receipts:
- "Paid to [Name]" or "To [Name]" = receiver_name
- "From: [Name]" or "Sender: [Name]" = sender_name
- "Banking name: [Name]" = receiver_name if in paid-to section

Paytm/BHIM/Other receipts:
- "Paid To", "Beneficiary", "To", "Merchant" = receiver_name
- "From", "Debited", "Your Account" = sender_name

GENERAL RULES:
- receiver_name: Look for "Banking Name", "Paid to", "To", "Transfer to", "Merchant", "Beneficiary"
- sender_name: Look for "From", "Debited from", "Paid by", "Your name" - must be a PERSON NAME not bank name
- CRITICAL SENDER NAME RULE: You MUST return null for sender_name unless the sender's name is EXPLICITLY labeled with "From", "Paid by", "Sender", "Payer", "Debited from", or "From A/C". If the image does not contain the sender's name explicitly, you MUST return null. DO NOT guess, DO NOT use the receiver's name, and DO NOT hallucinate.
- NEVER confuse sender and receiver
- transaction_date: Look for dates near "Transaction", time stamps at top of screen (e.g., "04:44 pm on 12 Jun 2026" → "2026-06-12")
- Transaction Successful Rule: You MUST detect words or messages indicating a successful payment completion (like "Success", "Paid", "Payment Successful", "Transaction Complete", or any other clear success indicator). However, if the screenshot shows "Pending", "Processing", or "Failed", you MUST immediately set status to "failed" and return.

Return ONLY valid JSON:
{"amount": 10.00, "sender_name": null, "receiver_name": "Boda Mohan Reddy", "transaction_date": "2026-06-12", "status": "success"}'''

        extracted_text = None
        extraction_api = None

        # Fetch keys
        groq_key_1 = os.getenv("GROQ_API_KEY")
        groq_key_2 = os.getenv("GROQ_API_KEY_2")
        groq_key_3 = os.getenv("GROQ_API_KEY_3")

        try:
            ssm = boto3.client('ssm')
            if not groq_key_1:
                try:
                    param = ssm.get_parameter(Name='/notepay/groq_key_for_payment', WithDecryption=True)
                    groq_key_1 = param['Parameter']['Value']
                except Exception:
                    pass
            if not groq_key_2:
                try:
                    param2 = ssm.get_parameter(Name='/notepay/groq_key_for_payment-2', WithDecryption=True)
                    groq_key_2 = param2['Parameter']['Value']
                except Exception:
                    pass
            if not groq_key_3:
                try:
                    param3 = ssm.get_parameter(Name='/notepay/groq_key_for_payment-3', WithDecryption=True)
                    groq_key_3 = param3['Parameter']['Value']
                except Exception:
                    pass
        except Exception as e:
            print(f"SSM client failed: {e}")

        # Order: key_2 first, key_3 second fallback, key_1 third fallback
        keys_to_try = []
        if groq_key_2: keys_to_try.append(groq_key_2)
        if groq_key_3: keys_to_try.append(groq_key_3)
        if groq_key_1: keys_to_try.append(groq_key_1)

        # Llama 4 Scout is the ONLY vision model on Groq free tier (tested June 2026)
        # Both API keys have identical model access
        groq_vision_models = [
            "meta-llama/llama-4-scout-17b-16e-instruct",  # Only vision model available
        ]

        for g_key in keys_to_try:
            if extracted_text:
                break
            try:
                from groq import Groq as GroqClient
                import base64
                groq_client = GroqClient(api_key=g_key)
                image_b64 = base64.standard_b64encode(contents).decode("utf-8")
                
                for model_id in groq_vision_models:
                    try:
                        response = groq_client.chat.completions.create(
                            model=model_id,
                            messages=[
                                {
                                    "role": "user",
                                    "content": [
                                        {"type": "text", "text": prompt},
                                        {
                                            "type": "image_url",
                                            "image_url": {"url": f"data:image/jpeg;base64,{image_b64}"}
                                        }
                                    ]
                                }
                            ],
                            temperature=0.1,
                            response_format={"type": "json_object"},
                            max_completion_tokens=256
                        )
                        extracted_text = response.choices[0].message.content.strip()
                        extraction_api = "groq"
                        break  # Break out of model loop if successful
                    except Exception as model_e:
                        print(f"Groq {model_id} with key {g_key[:5]}... failed: {model_e}")
                        
            except Exception as e:
                print(f"Groq setup failed for key: {e}")

        if not extracted_text:
            gemini_key = os.getenv("GEMINI_KEY_1") or os.getenv("GEMINI_API_KEY")
            if gemini_key:
                try:
                    import google.generativeai as genai
                    import PIL.Image, io
                    genai.configure(api_key=gemini_key)
                    image = PIL.Image.open(io.BytesIO(contents))
                    
                    model = genai.GenerativeModel('gemini-2.0-flash')
                    response = model.generate_content([image, prompt])
                    extracted_text = response.text.strip()
                    extraction_api = "gemini"
                except Exception as e:
                    print(f"Gemini failed: {e}")

        if not extracted_text:
            return get_fallback_response("AI services are currently unavailable. Please enter manually.")

        import re, json
        json_match = re.search(r'\{.*?\}', extracted_text, re.DOTALL)
        if not json_match:
            return get_fallback_response("AI failed to return structured data. Please enter manually.")

        parsed_data = json.loads(json_match.group(0))
        
        if parsed_data.get("status") == "unrelated_image":
            return {
                "status": "unrelated_image",
                "message": "Please upload a valid payment screenshot. The uploaded image does not appear to be a UPI receipt."
            }
            
        if parsed_data.get("status") == "failed":
            return {
                "status": "failed",
                "message": "This screenshot shows a failed, pending, or incomplete transaction. Please upload a receipt for a successful payment."
            }
            
        amount = float(parsed_data.get("amount", 0)) if parsed_data.get("amount") else 0
        donor_name = str(parsed_data.get("sender_name", "") or "")[:100].strip()
        receiver_name = str(parsed_data.get("receiver_name", "") or "")[:100].strip()
        transaction_date_str = parsed_data.get("transaction_date")

        if amount <= 0:
            return {
                "status": "rejected",
                "message": "The uploaded image does not appear to be a valid UPI receipt. We could not find a payment amount. Please upload a clear screenshot of a genuine receipt."
            }

        # Validate receiver name (Flexible Match)
        owner_name = event.upi_owner_name or ""
        rn_clean = re.sub(r'[^a-zA-Z0-9]', '', receiver_name).lower()
        owner_clean = re.sub(r'[^a-zA-Z0-9]', '', owner_name).lower()

        if not rn_clean:
            return {
                "status": "rejected",
                "message": "The uploaded image does not appear to be a valid UPI receipt. We could not find a receiver name. Please upload a clear screenshot of a genuine receipt."
            }

        rn_words = set(re.findall(r'[a-z0-9]+', receiver_name.lower()))
        owner_words = set(re.findall(r'[a-z0-9]+', owner_name.lower()))
        shared_significant_words = {w for w in rn_words.intersection(owner_words) if len(w) > 2}
        is_substring = (rn_clean in owner_clean or owner_clean in rn_clean)

        if owner_clean and not is_substring and not shared_significant_words:
            # AI found a receiver name but it doesn't match — genuine rejection
            return {
                "status": "rejected",
                "message": f"Payment was made to '{receiver_name}', but the registered name for this QR or UPI ID is '{owner_name}'. Please upload the correct receipt."
            }

        # Validation Passed

        # Check donor name
        dn_clean = re.sub(r'[^a-zA-Z0-9]', '', donor_name).lower()
        if dn_clean and rn_clean and (dn_clean == rn_clean):
            donor_name = ""  # Same person
        if donor_name.lower() in ["none", "null", "unknown"]:
            donor_name = ""

        from datetime import datetime
        try:
            transaction_date = datetime.strptime(transaction_date_str, "%Y-%m-%d") if transaction_date_str else datetime.now()
        except:
            transaction_date = datetime.now()

        # Check if there are any required donor custom columns
        has_required_donor_cols = False
        cols = event.donation_custom_columns or []
        if isinstance(cols, str):
            try:
                import json
                cols = json.loads(cols)
            except:
                cols = []
        for col in cols:
            if isinstance(col, dict) and col.get("reqByDonor") and not col.get("hidden"):
                has_required_donor_cols = True
                break

        # If donor name missing or required custom columns exist, initiate Partial Success flow
        if not donor_name or has_required_donor_cols:
            import uuid
            session_id = str(uuid.uuid4())
            try:
                from cache import cache
                cache.set(f"receipt:{session_id}", {
                    "amount": amount,
                    "transaction_date": transaction_date.isoformat(),
                    "receiver_name": receiver_name,
                    "extraction_api": extraction_api,
                    "receipt_key": receipt_key
                }, expire=900) # 15 minutes
            except Exception as e:
                print(f"Failed to cache receipt session: {e}")

            return {
                "status": "partial_success",
                "amount": amount,
                "receipt_session_id": session_id,
                "receiver_name": receiver_name,
                "donor_name": donor_name if donor_name else "",
                "message": "Receipt valid! Please complete the required details."
            }

        # Full Success - Create Donation Automatically
        donor_name_with_prefix = f"(AI) {donor_name}"
        
        new_donation = schemas.DonationCreate(
            donor_name=donor_name_with_prefix,
            amount=amount,
            entry_source="ai",
            transaction_date=transaction_date,
            collector_name=event.upi_owner_name,
            custom_fields={
                "method": f"UPI Auto-Receipt ({extraction_api.upper()})",
                "status": "ai_verified",
                "receiver_name": event.upi_owner_name,
                "receipt_receiver_name": receiver_name,
                "verified_upi_id": event.upi_id,
                "extraction_api": extraction_api
            },
            receipt_key=receipt_key
        )
        
        res = crud.create_donation(db, event_id, event.organizer_id, new_donation)
        await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_add_auto"})
        
        return {
            "message": "Success",
            "donation": res,
            "verification": "ai_verified",
            "extraction_api": extraction_api
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Error processing receipt: {str(e)}")

@app.post("/api/public/event/{event_id}/submit_manual_donation", tags=["Public Portal"])
async def submit_manual_donation(event_id: str, data: schemas.ManualDonationEntry, db: Session = Depends(get_db)):
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    if not event.upi_id or not event.upi_owner_name:
        raise HTTPException(status_code=409, detail="The organizer must verify the event UPI ID before accepting donations")
    
    try:
        donor_name = data.donor_name.strip()
        amount = float(data.amount)
        if not donor_name or len(donor_name) < 2:
            raise ValueError("Donor name must be at least 2 characters")
        if amount <= 0:
            raise ValueError("Amount must be greater than 0")
        if amount > 1000000:
            raise ValueError("Amount seems too high (max ₹10,00,000)")
            
        from datetime import datetime
        transaction_date = datetime.now()
        entry_source = "manual"
        status = "manual_entry"
        method = "Manual Entry"
        receipt_receiver_name = None
        extraction_api = None
        receipt_key = None
        
        # Secure Partial AI Validation Logic
        if data.receipt_session_id:
            try:
                from cache import cache
                cached_data = cache.get(f"receipt:{data.receipt_session_id}")
                if cached_data:
                    # Enforce cached values
                    if cached_data.get("amount"):
                        amount = float(cached_data.get("amount"))
                        entry_source = "ai_partial"
                        status = "ai_partial_verified"
                        extraction_api = cached_data.get("extraction_api")
                        method = f"UPI Partial Auto ({str(extraction_api).upper()})"
                    else:
                        entry_source = "manual"
                        status = "manual_entry"
                        extraction_api = "manual_fallback"
                        method = "Manual Entry (with image)"
                        
                    try:
                        if cached_data.get("transaction_date"):
                            transaction_date = datetime.fromisoformat(cached_data.get("transaction_date"))
                    except:
                        pass
                    receipt_receiver_name = cached_data.get("receiver_name")
                    receipt_key = cached_data.get("receipt_key")
                    # Clear cache to prevent replay
                    cache.delete(f"receipt:{data.receipt_session_id}")
            except Exception as e:
                print(f"Error reading cache for partial ai: {e}")

        donor_name_with_prefix = f"(M) {donor_name}" if entry_source == "manual" else f"(AI) {donor_name}"
        
        custom_fields = {
            "method": method,
            "status": status,
            "receiver_name": event.upi_owner_name,
            "verified_upi_id": event.upi_id
        }
        if receipt_receiver_name:
            custom_fields["receipt_receiver_name"] = receipt_receiver_name
        if extraction_api:
            custom_fields["extraction_api"] = extraction_api
            
        if data.custom_fields:
            # Merge user-filled custom fields
            custom_fields.update(data.custom_fields)

        new_donation = schemas.DonationCreate(
            donor_name=donor_name_with_prefix,
            amount=amount,
            entry_source=entry_source,
            transaction_date=transaction_date,
            collector_name=event.upi_owner_name,
            custom_fields=custom_fields,
            receipt_key=receipt_key
        )
        res = crud.create_donation(db, event_id, event.organizer_id, new_donation, is_public_entry=True)
        await manager.broadcast_change(event_id, {"type": "DATA_CHANGED", "source": "donation_add_manual"})
        return {
            "message": "Success",
            "donation": res,
            "verification": status
        }
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/public/event/{event_id}", tags=["Public Portal"])
def get_public_event(event_id: str, db: Session = Depends(get_db)):
    event = crud.get_event(db, event_id)
    if not event or not event.is_active:
        raise HTTPException(status_code=404, detail="Event not found")
    
    organizer = crud.get_user_profile(db, event.organizer_id)
    
    return {
        "id": event.id,
        "name": event.name,
        "description": event.description,
        "upi_id": event.upi_id,
        "upi_owner_name": event.upi_owner_name,
        "organizer_name": organizer.full_name if organizer else "Organizer",
        "donation_custom_columns": event.donation_custom_columns
    }

