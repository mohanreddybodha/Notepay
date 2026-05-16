from sqlalchemy.orm import Session
import models, schemas, cache
import uuid, json
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from datetime import datetime
from sqlalchemy import func

def get_user_by_firebase_uid(db: Session, firebase_uid: str):
    return db.query(models.User).filter(models.User.firebase_uid == firebase_uid).first()

def get_user(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

def create_user(db: Session, user: schemas.UserCreate):
    db_user = models.User(
        firebase_uid=user.firebase_uid,
        phone_number=user.phone_number,
        full_name=user.full_name,
        gender=user.gender
    )
    db.add(db_user)
    try:
        db.commit()
        db.refresh(db_user)
        return db_user
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="This phone number is already registered to another account. Please contact support.")

def create_event(db: Session, event: schemas.EventCreate, organizer_id: int):
    invite_code = str(uuid.uuid4())[:8].upper()
    db_event = models.Event(
        name=event.name,
        description=event.description,
        event_date=event.event_date,
        organizer_id=organizer_id,
        invite_code=invite_code,
        show_donations=event.show_donations,
        show_expenses=event.show_expenses
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    
    # Bump global dashboard version so it shows up for everyone
    cache.cache.bump_global_version()
    
    db_member = models.EventMember(
        user_id=organizer_id,
        event_id=db_event.id,
        role=models.UserRole.organizer
    )
    db.add(db_member)
    db.commit()
    return db_event

def get_events_for_user(db: Session, user_id: int):
    memberships = db.query(models.EventMember).filter(
        models.EventMember.user_id == user_id
    ).all()
    
    resp = []
    for m in memberships:
        e = m.event
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["my_role"] = m.role
        e_dict["is_restricted"] = m.is_restricted
        resp.append(e_dict)
    return resp

def get_my_events(db: Session, user_id: int):
    memberships = db.query(models.EventMember).filter(
        models.EventMember.user_id == user_id,
        models.EventMember.role == models.UserRole.organizer
    ).all()
    
    resp = []
    for m in memberships:
        e = m.event
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["my_role"] = m.role
        e_dict["is_restricted"] = m.is_restricted
        resp.append(e_dict)
    return resp

def get_shared_events(db: Session, user_id: int):
    memberships = db.query(models.EventMember).filter(
        models.EventMember.user_id == user_id,
        models.EventMember.role == models.UserRole.collector
    ).all()
    
    resp = []
    for m in memberships:
        e = m.event
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["my_role"] = m.role
        e_dict["is_restricted"] = m.is_restricted
        resp.append(e_dict)
    return resp

def join_event(db: Session, user_id: int, invite_code: str):
    db_event = db.query(models.Event).filter(models.Event.invite_code == invite_code).first()
    if not db_event:
        return None
    if not db_event.is_active:
        return False
    
    existing = db.query(models.EventMember).filter(
        models.EventMember.user_id == user_id, 
        models.EventMember.event_id == db_event.id
    ).first()
    
    if not existing:
        db_member = models.EventMember(
            user_id=user_id,
            event_id=db_event.id,
            role=models.UserRole.collector
        )
        db.add(db_member)
        db.commit()
        # Invalidate event cache so organizer sees new member
        cache.cache.invalidate_event(db_event.id)
        # Bump global version so joining user's dashboard refreshes
        cache.cache.bump_global_version()
    
    return db_event

def create_donation(db: Session, event_id: int, collector_id: int, donation: schemas.DonationCreate):
    db_donation = models.Donation(
        event_id=event_id,
        donor_name=donation.donor_name,
        amount=donation.amount,
        collected_by=collector_id,
        custom_fields=donation.custom_fields
    )
    db.add(db_donation)
    db.commit()
    db.refresh(db_donation)
    # Invalidate cache for this event
    cache.cache.invalidate_event(event_id)
    return get_donation(db, db_donation.id)

def get_donations(db: Session, event_id: int):
    results = db.query(models.Donation, models.User.full_name).join(
        models.User, models.Donation.collected_by == models.User.id
    ).filter(models.Donation.event_id == event_id).all()
    resp = []
    for d, name in results:
        d_dict = {c.name: getattr(d, c.name) for c in d.__table__.columns}
        d_dict["collected_by_name"] = name
        resp.append(d_dict)
    return resp

def create_expense(db: Session, event_id: int, collector_id: int, expense: schemas.ExpenseCreate):
    db_expense = models.Expense(
        event_id=event_id,
        description=expense.description,
        amount=expense.amount,
        collected_by=collector_id,
        custom_fields=expense.custom_fields
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    # Invalidate cache for this event
    cache.cache.invalidate_event(event_id)
    return get_expense(db, db_expense.id)

def get_expenses(db: Session, event_id: int):
    results = db.query(models.Expense, models.User.full_name).join(
        models.User, models.Expense.collected_by == models.User.id
    ).filter(models.Expense.event_id == event_id).all()
    resp = []
    for e, name in results:
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["collected_by_name"] = name
        resp.append(e_dict)
    return resp

def get_event(db: Session, event_id: int):
    return db.query(models.Event).filter(models.Event.id == event_id).first()

def get_event_members(db: Session, event_id: int):
    return db.query(models.EventMember).filter(models.EventMember.event_id == event_id).all()

def get_member(db: Session, event_id: int, user_id: int):
    return db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()

def toggle_event_status(db: Session, event_id: int, is_active: bool, user_id: int = None):
    event = get_event(db, event_id)
    if event:
        event.is_active = is_active
        db.commit()
        db.refresh(event)
        cache.cache.invalidate_event(event_id)
        # Bump global version to sync all users (including visitors)
        cache.cache.bump_global_version()
    return event

def regenerate_invite_code(db: Session, event_id: int):
    event = get_event(db, event_id)
    if event:
        event.invite_code = str(uuid.uuid4())[:8].upper()
        db.commit()
        db.refresh(event)
        cache.cache.invalidate_event(event_id)
    return event


def set_member_restriction(db: Session, event_id: int, user_id: int, is_restricted: bool):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()
    if member:
        member.is_restricted = is_restricted
        member.restricted_at = datetime.utcnow() if is_restricted else None
        
        # Requirement: Organizers are demoted to collectors upon restriction (strict security)
        # Also ensure they stay/become collector when unrestricted.
        member.role = models.UserRole.collector
            
        db.commit()
        db.refresh(member)
        cache.cache.invalidate_event(event_id)
        cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return member

def get_event_summary(db: Session, event_id: int):
    # Try to get from cache first
    cached_sum = cache.cache.get(f"sum:{event_id}")
    if cached_sum:
        return schemas.EventSummaryResponse(**cached_sum)

    total_donations = db.query(func.sum(models.Donation.amount)).filter(models.Donation.event_id == event_id).scalar() or 0.0
    total_expenses = db.query(func.sum(models.Expense.amount)).filter(models.Expense.event_id == event_id).scalar() or 0.0
    donations_count = db.query(func.count(models.Donation.id)).filter(models.Donation.event_id == event_id).scalar() or 0
    expenses_count = db.query(func.count(models.Expense.id)).filter(models.Expense.event_id == event_id).scalar() or 0
    
    recent_don = db.query(models.Donation, models.User.full_name).join(models.User, models.Donation.collected_by == models.User.id).filter(models.Donation.event_id == event_id).order_by(models.Donation.collected_at.desc()).all()
    recent_exp = db.query(models.Expense, models.User.full_name).join(models.User, models.Expense.collected_by == models.User.id).filter(models.Expense.event_id == event_id).order_by(models.Expense.collected_at.desc()).all()
    
    txns = []
    for d, creator_name in recent_don:
        txns.append(schemas.RecentTransaction(
            id=d.id,
            type='donation',
            title=d.donor_name,
            amount=d.amount or 0,
            date=d.collected_at,
            collected_by_name=creator_name
        ))
    for e, creator_name in recent_exp:
        txns.append(schemas.RecentTransaction(
            id=e.id,
            type='expense',
            title=e.description,
            amount=e.amount or 0,
            date=e.collected_at,
            collected_by_name=creator_name
        ))
    
    txns.sort(key=lambda x: x.date, reverse=True)
    
    resp = schemas.EventSummaryResponse(
        total_donations=total_donations,
        total_expenses=total_expenses,
        balance=total_donations - total_expenses,
        donations_count=donations_count,
        expenses_count=expenses_count,
        recent_transactions=txns
    )

    # Save to cache for next time
    # Convert to dict for JSON serialization
    cache.cache.set(f"sum:{event_id}", resp.dict())

    return resp

def get_user_profile(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

def update_user(db: Session, user_id: int, data: schemas.UserUpdate):
    user = get_user_profile(db, user_id)
    if not user: return None
    if data.full_name is not None: user.full_name = data.full_name
    if data.gender is not None: user.gender = data.gender
    db.commit()
    db.refresh(user)
    return user

def update_event(db: Session, event_id: int, data: schemas.EventUpdate, user_id: int = None):
    event = get_event(db, event_id)
    if not event: return None
    if data.name is not None: event.name = data.name
    if data.description is not None: event.description = data.description
    if data.event_date is not None: event.event_date = data.event_date
    if data.donation_custom_columns is not None: event.donation_custom_columns = data.donation_custom_columns
    if data.expense_custom_columns is not None: event.expense_custom_columns = data.expense_custom_columns
    if data.show_donations is not None: event.show_donations = data.show_donations
    if data.show_expenses is not None: event.show_expenses = data.show_expenses
    if data.is_public is not None: event.is_public = data.is_public
    db.commit()
    db.refresh(event)
    # Invalidate full cache
    cache.cache.invalidate_event(event_id)
    # Bump global version for dashboard sync
    cache.cache.bump_global_version()
    return event


def delete_event(db: Session, event_id: int):
    event = get_event(db, event_id)
    if not event: return False
    db.query(models.EventMember).filter(models.EventMember.event_id == event_id).delete()
    db.query(models.Donation).filter(models.Donation.event_id == event_id).delete()
    db.query(models.Expense).filter(models.Expense.event_id == event_id).delete()
    db.delete(event)
    db.commit()
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return True

def get_donation(db: Session, donation_id: int):
    res = db.query(models.Donation, models.User.full_name).join(
        models.User, models.Donation.collected_by == models.User.id
    ).filter(models.Donation.id == donation_id).first()
    if not res: return None
    d, name = res
    d_dict = {c.name: getattr(d, c.name) for c in d.__table__.columns}
    d_dict["collected_by_name"] = name
    return d_dict

def update_donation(db: Session, donation_id: int, data: schemas.DonationUpdate):
    donation = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not donation: return None
    if data.donor_name is not None: donation.donor_name = data.donor_name
    if data.amount is not None: donation.amount = data.amount
    if data.custom_fields is not None: donation.custom_fields = data.custom_fields
    db.commit()
    # Invalidate cache for this event
    cache.cache.invalidate_event(donation.event_id)
    return get_donation(db, donation_id)

def delete_donation(db: Session, donation_id: int):
    donation = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not donation: return False
    eid = donation.event_id
    db.delete(donation)
    db.commit()
    # Invalidate cache for this event
    cache.cache.invalidate_event(eid)
    return True

def get_expense(db: Session, expense_id: int):
    res = db.query(models.Expense, models.User.full_name).join(
        models.User, models.Expense.collected_by == models.User.id
    ).filter(models.Expense.id == expense_id).first()
    if not res: return None
    e, name = res
    e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
    e_dict["collected_by_name"] = name
    return e_dict

def update_expense(db: Session, expense_id: int, data: schemas.ExpenseUpdate):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense: return None
    if data.description is not None: expense.description = data.description
    if data.amount is not None: expense.amount = data.amount
    if data.custom_fields is not None: expense.custom_fields = data.custom_fields
    db.commit()
    # Invalidate cache for this event
    cache.cache.invalidate_event(expense.event_id)
    return get_expense(db, expense_id)

def delete_expense(db: Session, expense_id: int):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense: return False
    eid = expense.event_id
    db.delete(expense)
    db.commit()
    # Invalidate cache for this event
    cache.cache.invalidate_event(eid)
    return True

def exit_event(db: Session, event_id: int, user_id: int):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()
    if not member: return False
    db.delete(member)
    db.commit()
    # Also remove from watched/discover tab
    watched = db.query(models.WatchedEvent).filter(
        models.WatchedEvent.event_id == event_id,
        models.WatchedEvent.user_id == user_id
    ).first()
    if watched:
        db.delete(watched)
        db.commit()
    # Invalidate caches so organizer sees updated member list
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return True



def update_member_role(db: Session, event_id: int, target_user_id: int, role: models.UserRole):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == target_user_id
    ).first()
    if not member: return None
    member.role = role
    db.commit()
    db.refresh(member)
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return member

# ── Watched Events (Discover Tab) ──────────────────────────────────────────

def get_watched_events(db: Session, user_id: int):
    """Return watched events for a user, excluding events they are already a member of."""
    subquery = db.query(models.EventMember.event_id).filter(
        models.EventMember.user_id == user_id
    ).scalar_subquery()
    return db.query(models.WatchedEvent).filter(
        models.WatchedEvent.user_id == user_id,
        ~models.WatchedEvent.event_id.in_(subquery)
    ).order_by(models.WatchedEvent.last_viewed_at.desc()).all()


def add_watched_event(db: Session, user_id: int, event_id: int):
    """Add or update a watched event entry (upsert by last_viewed)."""
    existing = db.query(models.WatchedEvent).filter(
        models.WatchedEvent.user_id == user_id,
        models.WatchedEvent.event_id == event_id
    ).first()
    if existing:
        existing.last_viewed_at = datetime.utcnow()
        db.commit()
        db.refresh(existing)
        cache.cache.bump_global_version()
        return existing
    entry = models.WatchedEvent(user_id=user_id, event_id=event_id)
    db.add(entry)
    db.commit()
    db.refresh(entry)
    cache.cache.bump_global_version()
    return entry


def remove_watched_event(db: Session, user_id: int, event_id: int):
    """Remove a watched event entry. Returns True if deleted, False if not found."""
    entry = db.query(models.WatchedEvent).filter(
        models.WatchedEvent.user_id == user_id,
        models.WatchedEvent.event_id == event_id
    ).first()
    if not entry:
        return False
    db.delete(entry)
    db.commit()
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return True


def members_to_public_response(members) -> list:
    """Strip phone numbers from member list for API responses."""
    out = []
    for m in members:
        u = m.user
        out.append(schemas.EventMemberPublicResponse(
            id=m.id,
            user_id=m.user_id,
            role=m.role,
            joined_at=m.joined_at,
            is_restricted=m.is_restricted,
            restricted_at=m.restricted_at,
            user=schemas.UserPublicResponse(
                id=u.id,
                full_name=u.full_name,
                gender=u.gender,
                created_at=u.created_at,
            ),
        ))
    return out


def get_member_contact(db: Session, event_id: int, target_user_id: int):
    """Return phone for a fellow event member (for 1:1 call)."""
    target = get_member(db, event_id, target_user_id)
    if not target:
        return None
    user = db.query(models.User).filter(models.User.id == target_user_id).first()
    if not user or not user.phone_number:
        return None
    return schemas.MemberContactResponse(
        user_id=user.id,
        full_name=user.full_name,
        phone_number=user.phone_number,
    )


def get_event_full_details(db: Session, event_id: int, user_id: int):
    # PHASE 2: Try cache first (Place 1)
    cache_key = f"full:{event_id}:{user_id}"
    cached_data = cache.cache.get(cache_key)
    if cached_data:
        print(f"🚀 Cache Hit for Event {event_id} (User {user_id})")
        # Return as the Pydantic model it expects
        return schemas.EventFullDetailsResponse(**cached_data)

    # Fetch everything (DB)
    event = get_event(db, event_id)
    if not event: return None
    
    member = get_member(db, event_id, user_id)
    
    # Determine role (Hard-check for creator)
    actual_role = "visitor"
    if user_id == event.organizer_id:
        actual_role = "Organizer"
    elif member:
        actual_role = member.role

    is_restricted = member.is_restricted if member else False

    # Map event details
    event_dict = {c.name: getattr(event, c.name) for c in event.__table__.columns}
    event_dict["my_role"] = actual_role
    event_dict["is_restricted"] = is_restricted
    
    # Manual JSON fix to avoid circular import
    import json
    for col_name in ["donation_custom_columns", "expense_custom_columns"]:
        val = event_dict.get(col_name)
        if isinstance(val, str) and val.strip():
            try:
                event_dict[col_name] = json.loads(val)
            except:
                event_dict[col_name] = []
        elif val is None:
            event_dict[col_name] = []

    donations = get_donations(db, event_id)
    expenses = get_expenses(db, event_id)
    summary = get_event_summary(db, event_id)
    members_raw = get_event_members(db, event_id)
    members_public = members_to_public_response(members_raw)

    resp = schemas.EventFullDetailsResponse(
        event=schemas.EventResponse(**event_dict),
        donations=donations,
        expenses=expenses,
        summary=summary,
        members=members_public,
        my_role=actual_role,
        is_restricted=is_restricted
    )

    # Save to cache (Place 1) - Convert to dict for JSON storage
    cache.cache.set(cache_key, resp.model_dump(), expire=1800) # 30 min cache
    return resp

def fix_event_json(e):
    # If it's a SQL Alchemy object, convert to dict first
    if hasattr(e, "__table__"):
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
    else:
        e_dict = e
        
    import json
    for col in ["donation_custom_columns", "expense_custom_columns"]:
        val = e_dict.get(col)
        if val is None or isinstance(val, (list, dict)):
            if val is None: e_dict[col] = []
            continue
        if isinstance(val, str):
            try: e_dict[col] = json.loads(val)
            except: e_dict[col] = []
    return e_dict

# ── Chat ──────────────────────────────────────────────────────────────────────

def _chat_msg_to_dict(db, msg, sender_name):
    """Convert a ChatMessage ORM object to a response dict with reply snippet."""
    d = {
        "id": msg.id,
        "event_id": msg.event_id,
        "user_id": msg.user_id,
        "sender_name": sender_name or "Unknown",
        "message": msg.message,
        "reply_to_id": msg.reply_to_id,
        "reply_snippet": None,
        "reactions": msg.reactions or {},
        "sent_at": msg.sent_at.isoformat() + "Z" if msg.sent_at else None
    }
    if msg.reply_to_id and msg.reply_to:
        reply_user = db.query(models.User).filter(models.User.id == msg.reply_to.user_id).first()
        d["reply_snippet"] = {
            "id": msg.reply_to.id,
            "sender_name": reply_user.full_name if reply_user else "Unknown",
            "message": msg.reply_to.message[:100]  # snippet
        }
    return d

def create_chat_message(db: Session, event_id: int, user_id: int, message: str, reply_to_id: int = None):
    msg = models.ChatMessage(
        event_id=event_id,
        user_id=user_id,
        message=message[:500],
        reply_to_id=reply_to_id
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)
    user = db.query(models.User).filter(models.User.id == user_id).first()
    return _chat_msg_to_dict(db, msg, user.full_name if user else "Unknown")

def get_chat_messages(db: Session, event_id: int, limit: int = 50, before_id: int = None):
    q = db.query(models.ChatMessage, models.User.full_name).join(
        models.User, models.ChatMessage.user_id == models.User.id
    ).filter(models.ChatMessage.event_id == event_id)
    if before_id:
        q = q.filter(models.ChatMessage.id < before_id)
    results = q.order_by(models.ChatMessage.id.desc()).limit(limit).all()
    msgs = []
    for msg, sender_name in results:
        msgs.append(_chat_msg_to_dict(db, msg, sender_name))
    return msgs[::-1]  # Return in chronological order

def toggle_reaction(db: Session, message_id: int, event_id: int, user_id: int, emoji: str):
    msg = db.query(models.ChatMessage).filter(
        models.ChatMessage.id == message_id,
        models.ChatMessage.event_id == event_id,
    ).first()
    if not msg:
        return None
    reactions = dict(msg.reactions or {})
    # Remove user from all other reactions first
    for e, users in list(reactions.items()):
        if user_id in users:
            users.remove(user_id)
            if not users:
                del reactions[e]
            else:
                reactions[e] = users
            
            # If the user clicked the SAME emoji they already had, we just removed it. We're done (toggle off).
            if e == emoji:
                msg.reactions = reactions
                from sqlalchemy.orm.attributes import flag_modified
                flag_modified(msg, "reactions")
                db.commit()
                sender_name = db.query(models.User.full_name).filter(models.User.id == msg.user_id).scalar()
                return _chat_msg_to_dict(db, msg, sender_name)

    # Otherwise, add the new reaction
    if emoji not in reactions:
        reactions[emoji] = []
    reactions[emoji].append(user_id)
    msg.reactions = reactions
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(msg, "reactions")
    db.commit()
    sender_name = db.query(models.User.full_name).filter(models.User.id == msg.user_id).scalar()
    return _chat_msg_to_dict(db, msg, sender_name)

def delete_chat_message(db: Session, message_id: int, event_id: int, user_id: int, is_organizer: bool):
    msg = db.query(models.ChatMessage).filter(
        models.ChatMessage.id == message_id,
        models.ChatMessage.event_id == event_id,
    ).first()
    if not msg:
        return None
    if msg.user_id != user_id and not is_organizer:
        return None
    msg.message = "🚫 This message was deleted."
    msg.reactions = {}
    from sqlalchemy.orm.attributes import flag_modified
    flag_modified(msg, "reactions")
    db.commit()
    sender_name = db.query(models.User.full_name).filter(models.User.id == msg.user_id).scalar()
    return _chat_msg_to_dict(db, msg, sender_name)


def get_user_full_dashboard(db: Session, user_id: int):
    # Use global version to ensure real-time sync across all users
    v = cache.cache.get_global_version()
    cache_key = f"dash:{user_id}:{v}"
    cached_dash = cache.cache.get(cache_key)
    if cached_dash:
        return cached_dash

    profile = get_user(db, user_id)
    my_events = [fix_event_json(e) for e in get_my_events(db, user_id)]
    shared_events = [fix_event_json(e) for e in get_shared_events(db, user_id)]
    watched_raw = get_watched_events(db, user_id)
    
    watched_fixed = []
    for w in watched_raw:
        # Skip orphaned records where the event was deleted
        if not w.event:
            continue
        # Convert to dict manually to avoid SQLAlchemy relationship errors
        w_dict = {
            "id": w.id,
            "user_id": w.user_id,
            "event_id": w.event_id,
            "last_viewed_at": w.last_viewed_at,
            "event": fix_event_json(w.event)
        }
        watched_fixed.append(w_dict)
    
    res = schemas.UserFullDashboardResponse(
        profile=schemas.UserResponse.model_validate(profile),
        my_events=my_events,
        shared_events=shared_events,
        watched_events=watched_fixed
    )
    # Cache for 5 minutes
    v = cache.cache.get_global_version()
    cache.cache.set(f"dash:{user_id}:{v}", res, expire=300)
    return res
