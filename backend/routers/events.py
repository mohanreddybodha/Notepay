"""
routers/events.py — Event lifecycle, creation, invitation, membership, and watched history endpoints
"""
from typing import List
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
import crud
import models
import schemas
from dependencies import get_current_user_id, verify_membership
from limiter import verify_rate_limit
from ws_manager import manager

try:
    from cache import cache
except ImportError:
    cache = None

router = APIRouter()


@router.post("/events", response_model=schemas.EventResponse, tags=["Events"])
async def create_event(event: schemas.EventCreate,
                 db: Session = Depends(get_db),
                 user_id: int = Depends(get_current_user_id)):
    """Create a new event. Creator becomes the Organizer."""
    verify_rate_limit(f"user:{user_id}:create_event", limit=5, window=60, detail="Creating events too fast. Wait a minute.")
    return crud.create_event(db=db, event=event, organizer_id=user_id)


@router.get("/events", response_model=List[schemas.EventResponse], tags=["Events"])
def read_all_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """All events this user belongs to (Organizer + Collector). Includes deactivated."""
    return crud.get_events_for_user(db, user_id=user_id)


@router.get("/events/my", response_model=List[schemas.EventResponse], tags=["Events"])
def read_my_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard  My Events tab: only events where user is Organizer."""
    return crud.get_my_events(db, user_id=user_id)


@router.get("/events/shared", response_model=List[schemas.EventResponse], tags=["Events"])
def read_shared_events(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard  Shared Events tab: events joined via code (Collector). Includes deactivated."""
    return crud.get_shared_events(db, user_id=user_id)


@router.get("/events/preview-code", tags=["Events"])
def preview_event_by_code(invite_code: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Retrieve basic event details using an invite code (before joining)."""
    verify_rate_limit(f"user:{user_id}:preview-code", limit=100, window=60, detail="Previewing codes too fast. Slow down.")
    event = db.query(models.Event).filter(models.Event.invite_code == invite_code).first()
    if not event:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    
    # Get creator/organizer name
    creator = db.query(models.User).filter(models.User.id == event.organizer_id).first()
    organizer_name = creator.full_name if creator else "Unknown"
    
    return {
        "id": event.id,
        "name": event.name,
        "organizer_name": organizer_name,
        "is_active": event.is_active
    }


@router.post("/events/join", tags=["Events"])
async def join_event_by_code(invite_code: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Join an event using an invite code (becomes Collector)."""
    verify_rate_limit(f"user:{user_id}:join", limit=5, window=60, detail="Joining events too fast. Wait a minute.")
    event = crud.join_event(db, user_id, invite_code)
    if event is None:
        raise HTTPException(status_code=404, detail="Invalid invite code")
    if event is False:
        raise HTTPException(status_code=403, detail="This event is currently deactivated. Contact your organizer.")
    # Broadcast so organizer sees new member in real-time
    await manager.broadcast_change(event.id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return {"message": "Joined event successfully", "event_id": event.id, "event_name": event.name}


@router.put("/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
async def update_event(event_id: str, data: schemas.EventUpdate, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Rename/edit event details. Organizer only."""
    verify_rate_limit(f"user:{user_id}:update_event", limit=10, window=60, detail="Updating event too fast. Wait a moment.")
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.update_event(db, event_id, data, user_id=user_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    # Broadcast to all clients in this event channel (collectors see live changes)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    # Broadcast to all dashboard connections (event name/details update in dashboard)
    await manager.broadcast_dashboard_update()
    return crud.fix_event_json(event)


@router.delete("/events/{event_id}", tags=["Events"])
async def delete_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Permanently delete an event and ALL its data. Organizer only."""
    verify_rate_limit(f"user:{user_id}:delete_event", limit=5, window=60, detail="Deleting events too fast. Wait a moment.")
    verify_membership(db, event_id, user_id, require_organizer=True)
    success = crud.delete_event(db, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Event not found")
    # Invalidate dashboard cache
    if cache:
        cache.delete(f"dash:{user_id}")
    return {"message": "Event permanently deleted"}


@router.put("/events/{event_id}/deactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def deactivate_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Lock all collectors out. Organizer retains read-only view."""
    verify_rate_limit(f"user:{user_id}:deactivate_event", limit=5, window=60, detail="Deactivating events too fast. Wait a moment.")
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.toggle_event_status(db, event_id, is_active=False, user_id=user_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event


@router.put("/events/{event_id}/reactivate", response_model=schemas.EventResponse, tags=["Event Management"])
async def reactivate_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Reopen event. Organizer must then generate a NEW code and reshare."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.toggle_event_status(db, event_id, is_active=True, user_id=user_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event


@router.post("/events/{event_id}/generate_code", response_model=schemas.EventResponse, tags=["Event Management"])
async def regenerate_invite_code(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Generate a brand new invite code. Old code becomes permanently invalid."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    verify_rate_limit(f"user:{user_id}:generate_code", limit=5, window=3600, detail="Code refresh limit reached. Try again in an hour.")
    event = crud.regenerate_invite_code(db, event_id)
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event


@router.get("/events/watched", tags=["Events"])
def get_watched_history(db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Dashboard  Discover tab: public events recently viewed. crud handles eager loading + membership filter."""
    watched = crud.get_watched_events(db, user_id)
    if not watched:
        return []
    resp = []
    for w in watched:
        e = w.event
        if not e:
            continue
        e_dict = crud.fix_event_json(e)
        e_dict["my_role"] = None
        e_dict["is_restricted"] = False
        resp.append({
            "id": w.id,
            "user_id": w.user_id,
            "event_id": w.event_id,
            "last_viewed_at": w.last_viewed_at,
            "event": e_dict
        })
    return resp


@router.delete("/events/{event_id}/watched", tags=["Events"])
async def remove_watched_history(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Remove event from watched history (Discover tab)."""
    success = crud.remove_watched_event(db, user_id, event_id)
    if not success:
        raise HTTPException(status_code=404, detail="Watched event not found")
    return {"message": "Removed from discovery tab"}


@router.get("/events/{event_id}", response_model=schemas.EventResponse, tags=["Events"])
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
    
    return crud.fix_event_json(event_dict)


@router.patch("/events/{event_id}/privacy", response_model=schemas.EventResponse, tags=["Event Management"])
async def toggle_event_privacy(event_id: str, is_public: bool, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Toggle event between Private and Public (unlisted). Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    event = crud.update_event(db, event_id, schemas.EventUpdate(is_public=is_public))
    if not event:
        raise HTTPException(status_code=404, detail="Event not found")
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return event


@router.get("/events/{event_id}/members", response_model=List[schemas.EventMemberResponse], tags=["Event Management"])
def get_event_members(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """View all members in the event. Organizer only."""
    verify_membership(db, event_id, user_id, require_organizer=True)
    return crud.get_event_members(db, event_id)


@router.get("/events/{event_id}/members/{target_user_id}/contact",
         response_model=schemas.MemberContactResponse, tags=["Event Management"])
def get_member_contact(event_id: str, target_user_id: int,
                             db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Phone number for 1:1 call  fellow event members only (not public visitors)."""
    verify_membership(db, event_id, user_id, require_member=True)
    contact = crud.get_member_contact(db, event_id, target_user_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Member not found or no phone on file")
    return contact


@router.put("/events/{event_id}/members/{target_user_id}/restrict", response_model=schemas.EventMemberResponse, tags=["Event Management"])
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


@router.put("/events/{event_id}/members/{target_user_id}/unrestrict", response_model=schemas.EventMemberResponse, tags=["Event Management"])
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


@router.put("/events/{event_id}/members/{target_user_id}/role", response_model=schemas.EventMemberResponse, tags=["Event Management"])
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


@router.post("/events/{event_id}/exit", tags=["Events"])
async def exit_event(event_id: str, db: Session = Depends(get_db), user_id: int = Depends(get_current_user_id)):
    """Remove yourself from an event. You will need the code to rejoin."""
    success = crud.exit_event(db, event_id, user_id)
    if not success:
        raise HTTPException(status_code=404, detail="You are not a member of this event")
    # Broadcast so organizer's member list updates in real-time
    await manager.broadcast_change(event_id, {"type": "DATA_CHANGED"})
    await manager.broadcast_dashboard_update()
    return {"message": "You have left the event"}
