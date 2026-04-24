from fastapi import FastAPI, Depends, HTTPException, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from typing import List

import models, schemas, crud, auth
from database import engine, get_db

models.Base.metadata.create_all(bind=engine)

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
    """
    Verify the Firebase ID token sent as:  Authorization: Bearer <id_token>
    Returns the internal DB user ID.
    """
    if not credentials:
        raise HTTPException(
            status_code=401,
            detail="Authorization header required. Format: Bearer <firebase_id_token>"
        )

    # Verify token with Firebase Admin SDK (raises 401 on failure)
    decoded = await auth.verify_token(credentials)
    firebase_uid = decoded["uid"]

    # Look up user in our database
    user = crud.get_user_by_firebase_uid(db, firebase_uid)
    if not user:
        print(f"DEBUG: get_current_user_id failed for UID: {firebase_uid}")
        raise HTTPException(
            status_code=404,
            detail="User not registered. Call POST /users first."
        )
    return user.id


# ─── HELPER: Membership Gatekeeper ─────────────────────────────────────────────
def verify_membership(db: Session, event_id: int, user_id: int,
                      require_organizer: bool = False,
                      require_unrestricted: bool = False):
    member = crud.get_member(db, event_id, user_id)
    if not member:
        raise HTTPException(status_code=403, detail="You are not a member of this event")
    if require_organizer and member.role != models.UserRole.organizer:
        raise HTTPException(status_code=403, detail="Only the organizer can perform this action")
    if require_unrestricted and member.is_restricted:
        raise HTTPException(status_code=403, detail="Your access has been restricted by the organizer")
    return member

def verify_event_active_for_collector(db: Session, event_id: int, user_id: int):
    """Collectors are blocked from data access when event is deactivated. Organizers always pass."""
    member = verify_membership(db, event_id, user_id, require_unrestricted=True)
    event = crud.get_event(db, event_id)
    if not event.is_active and member.role != models.UserRole.organizer:
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
        print(f"DEBUG: User already exists for UID: {firebase_uid}. Returning existing profile.")
        return existing

    try:
        return crud.create_user(db=db, user=schemas.UserCreate(
            firebase_uid=firebase_uid,
            phone_number=phone_from_token,
            full_name=user_data.full_name,
            gender=user_data.gender
        ))
    except HTTPException as e:
        print(f"DEBUG: HTTP Error during registration: {e.detail}")
        raise
    except Exception as e:
        print(f"DEBUG: Unexpected error during registration: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))

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
    return crud.get_events_for_user(db, user_id=user_id)

@app.get("/events/my", response_model=List[schemas.EventResponse], tags=["Events"])
async def read_my_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard — My Events tab: only events where user is Organizer."""
    return crud.get_my_events(db, user_id=user_id)

@app.get("/events/shared", response_model=List[schemas.EventResponse], tags=["Events"])
async def read_shared_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard — Shared Events tab: events joined via code (Collector). Includes deactivated."""
    return crud.get_shared_events(db, user_id=user_id)

@app.post("/events/join", tags=["Events"])
async def join_event_by_code(invite_code: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Join an event using an invite code (becomes Collector)."""
    event = crud.join_event(db, user_id, invite_code)
    if event is None:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if event is False:
        raise HTTPException(status_code=403, detail="This event is currently deactivated. Contact your organizer.")
    return {"message": "Joined event successfully", "event_id": event.id, "event_name": event.name}

@app.put("/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def update_event(event_id: int, data: schemas.EventUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Rename/edit event details. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.update_event(db, event_id, data)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    return event

@app.delete("/events/{event_id}", tags=["Events"])
async def delete_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Permanently delete an event and ALL its data. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    success = crud.delete_event(db, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"message": "Event permanently deleted"}


# ─── EVENT MANAGEMENT (Organizer Only) ─────────────────────────────────────────
@app.put("/events/{event_id}/deactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def deactivate_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Lock all collectors out. Organizer retains read-only view."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    return crud.toggle_event_status(db, event_id, is_active=False)

@app.put("/events/{event_id}/reactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def reactivate_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Reopen event. Organizer must then generate a NEW code and reshare."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    return crud.toggle_event_status(db, event_id, is_active=True)

@app.post("/events/{event_id}/generate_code", response_model=schemas.EventResponse, tags=["Event Management"])
async def regenerate_invite_code(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Generate a brand new invite code. Old code becomes permanently invalid."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    return crud.regenerate_invite_code(db, event_id)
@app.get("/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def read_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Fetch details for a single event, including user's current role and restriction status."""
    verify_membership(db, event_id, user_id)
    event = crud.get_event(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    
    # Add membership context
    member = crud.get_member(db, event_id, user_id)
    event_dict = {c.name: getattr(event, c.name) for c in event.__table__.columns}
    event_dict["my_role"] = member.role
    event_dict["is_restricted"] = member.is_restricted
    return event_dict

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
    return member

@app.post("/events/{event_id}/exit", tags=["Events"])
async def exit_event(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Remove yourself from an event. You will need the code to rejoin."""
    success = crud.exit_event(db, event_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="You are not a member of this event")
    return {"message": "You have left the event"}




# ─── DONATIONS ─────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/donations", response_model=List[schemas.DonationResponse], tags=["Donations"])
async def get_event_donations(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all donations. Blocked when event is deactivated (Collector only blocked)."""
    verify_event_active_for_collector(db, event_id, user_id)
    return crud.get_donations(db, event_id)

@app.post("/events/{event_id}/donations", response_model=schemas.DonationResponse, tags=["Donations"])
async def add_donation(event_id: int, donation: schemas.DonationCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new donation row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id)
    return crud.create_donation(db, event_id, user_id, donation)

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
    return {"message": "Donation deleted"}


# ─── EXPENSES ──────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/expenses", response_model=List[schemas.ExpenseResponse], tags=["Expenses"])
async def get_event_expenses(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all expenses. Blocked when event is deactivated (Collector only blocked)."""
    verify_event_active_for_collector(db, event_id, user_id)
    return crud.get_expenses(db, event_id)

@app.post("/events/{event_id}/expenses", response_model=schemas.ExpenseResponse, tags=["Expenses"])
async def add_expense(event_id: int, expense: schemas.ExpenseCreate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Add a new expense row. Blocked if restricted or event deactivated."""
    verify_event_active_for_collector(db, event_id, user_id)
    return crud.create_expense(db, event_id, user_id, expense)

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
    return crud.update_expense(db, expense_id, data)

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
    return {"message": "Expense deleted"}


# ─── SUMMARY ───────────────────────────────────────────────────────────────────
@app.get("/events/{event_id}/summary", response_model=schemas.EventSummaryResponse, tags=["Summary"])
async def get_event_summary(event_id: int, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Summary tab: Total donations, expenses, balance. All members have access."""
    verify_event_active_for_collector(db, event_id, user_id)
    return crud.get_event_summary(db, event_id)
