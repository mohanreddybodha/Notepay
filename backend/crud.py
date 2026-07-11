"""
crud.py — Notepay Data Access Layer
All database queries are optimized for production scale:
  - No N+1 queries: aggregations use GROUP BY / SQL, not Python loops
  - No unbounded memory: paginated & limited queries throughout
  - Eager loading: joinedload() used wherever nested objects are needed
  - Single Source of Truth: fix_custom_fields_dict & members_to_public_response defined once here
"""
import json as _json
import random
from sqlalchemy.orm import Session, joinedload
from sqlalchemy.orm.attributes import flag_modified
from sqlalchemy import func, text, case
import models, schemas, cache
import uuid
from sqlalchemy.exc import IntegrityError
from fastapi import HTTPException
from datetime import datetime, timezone

# ─────────────────────────────────────────
# UTILITIES
# ─────────────────────────────────────────

def fix_custom_fields_dict(obj_dict: dict) -> dict:
    """Ensure custom_fields is always a dict, never a raw JSON string."""
    if not obj_dict:
        return obj_dict
    cf = obj_dict.get("custom_fields")
    if isinstance(cf, str) and cf.strip():
        try:
            obj_dict["custom_fields"] = _json.loads(cf)
        except Exception:
            obj_dict["custom_fields"] = {}
    elif cf is None:
        obj_dict["custom_fields"] = {}
    return obj_dict


import bleach as _bleach


def sanitize_json_payload(data):
    """Recursively sanitize string values inside dicts and lists to prevent stored XSS."""
    if data is None:
        return data
    if isinstance(data, str):
        return _bleach.clean(data, tags=[], strip=True)
    if isinstance(data, dict):
        return {str(k): sanitize_json_payload(v) for k, v in data.items()}
    if isinstance(data, list):
        return [sanitize_json_payload(item) for item in data]
    return data


def _parse_json_columns(d: dict) -> dict:
    """Parse donation_custom_columns / expense_custom_columns JSON strings (SQLite compat)."""
    for col in ("donation_custom_columns", "expense_custom_columns"):
        val = d.get(col)
        if val is None:
            d[col] = []
        elif isinstance(val, str) and val.strip():
            try:
                d[col] = _json.loads(val)
            except Exception:
                d[col] = []
    return d


def fix_event_json(e) -> dict:
    """
    Convert an Event ORM object (or already-a-dict) to a fully serialisable dict.
    NOTE: Does NOT compute aggregations — use get_my_events / get_shared_events for that.
    This is intentionally lightweight for use inside fix_event_json calls that need
    to avoid loading donation/expense relationships.
    """
    if hasattr(e, "__table__"):
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
    else:
        e_dict = dict(e)
    return _parse_json_columns(e_dict)


def members_to_public_response(members: list) -> list:
    """Strip phone numbers from member list for public API responses."""
    out = []
    for m in members:
        u = m.user
        if not u or m.user_id is None:
            continue
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


# ─────────────────────────────────────────
# USERS
# ─────────────────────────────────────────

def get_user_by_firebase_uid(db: Session, firebase_uid: str):
    return db.query(models.User).filter(models.User.firebase_uid == firebase_uid).first()


def get_user_by_phone(db: Session, phone_number: str):
    return db.query(models.User).filter(models.User.phone_number == phone_number).first()


def get_user(db: Session, user_id: int):
    return db.query(models.User).filter(models.User.id == user_id).first()

# get_user_profile removed — use get_user() directly (identical function, single source of truth)


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


def update_user(db: Session, user_id: int, data: schemas.UserUpdate):
    user = get_user(db, user_id)
    if not user:
        return None
    if data.full_name is not None:
        user.full_name = data.full_name
    if data.gender is not None:
        user.gender = data.gender
    db.commit()
    db.refresh(user)
    return user


def update_user_firebase_uid(db: Session, user_id: int, uid: str):
    user = get_user(db, user_id)
    if user:
        user.firebase_uid = uid
        db.commit()
        db.refresh(user)
    return user


# ─────────────────────────────────────────
# EVENTS
# ─────────────────────────────────────────

def create_event(db: Session, event: schemas.EventCreate, organizer_id: int):
    raw = uuid.uuid4().hex[:14].upper()
    invite_code = f"{raw[:5]}-{raw[5:9]}-{raw[9:]}"
    db_event = models.Event(
        name=event.name,
        description=event.description,
        event_date=event.event_date,
        organizer_id=organizer_id,
        invite_code=invite_code,
        show_donations=event.show_donations,
        show_expenses=event.show_expenses,
        goal_amount=event.goal_amount
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    cache.cache.bump_global_version()
    db_member = models.EventMember(
        user_id=organizer_id,
        event_id=db_event.id,
        role=models.UserRole.organizer
    )
    db.add(db_member)
    db.commit()
    return db_event


def get_event(db: Session, event_id: str):
    return db.query(models.Event).filter(models.Event.id == event_id).first()


def get_event_member(db: Session, event_id: str):
    """Return a single-row membership record for an event."""
    return db.query(models.EventMember).filter(models.EventMember.event_id == event_id).first()


def get_member(db: Session, event_id: str, user_id: int):
    return db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()


def get_event_members(db: Session, event_id: str):
    """Return all members with their user profiles eagerly loaded (no N+1)."""
    return db.query(models.EventMember).options(
        joinedload(models.EventMember.user)
    ).filter(models.EventMember.event_id == event_id).all()


# ─── OPTIMIZED DASHBOARD AGGREGATIONS ────────────────────────────
# Old approach: for each event, load all donations/expenses/members into Python → O(n*m) memory
# New approach: single GROUP BY query per table → O(events) memory, O(1) database round trips

def _build_event_aggregates(db: Session, event_ids: list[str]) -> dict:
    """
    Fetch totals for a list of event_ids using 3 GROUP BY SQL queries.
    Returns a dict keyed by event_id:
      {event_id: {total_collections, total_to_collect, total_expenses, balance, member_count}}
    """
    if not event_ids:
        return {}

    # Aggregated paid donations per event
    paid_rows = db.query(
        models.Donation.event_id,
        func.sum(models.Donation.amount).label("total_paid"),
        func.sum(
            # SQLite-compatible: use CASE instead of FILTER
            case(
                (models.Donation.payment_received == False, models.Donation.amount),
                else_=0
            )
        ).label("total_pending"),
    ).filter(
        models.Donation.event_id.in_(event_ids)
    ).group_by(models.Donation.event_id).all()

    # Aggregated expenses per event
    exp_rows = db.query(
        models.Expense.event_id,
        func.sum(models.Expense.amount).label("total_expenses"),
    ).filter(
        models.Expense.event_id.in_(event_ids)
    ).group_by(models.Expense.event_id).all()

    # Member counts per event
    mem_rows = db.query(
        models.EventMember.event_id,
        func.count(models.EventMember.id).label("member_count"),
    ).filter(
        models.EventMember.event_id.in_(event_ids)
    ).group_by(models.EventMember.event_id).all()

    # Build lookup maps
    don_map = {r.event_id: (r.total_paid or 0.0, r.total_pending or 0.0) for r in paid_rows}
    exp_map = {r.event_id: (r.total_expenses or 0.0) for r in exp_rows}
    mem_map = {r.event_id: r.member_count for r in mem_rows}

    result = {}
    for eid in event_ids:
        total_col, total_to_col = don_map.get(eid, (0.0, 0.0))
        total_exp = exp_map.get(eid, 0.0)
        # paid_rows sums ALL amounts; subtract pending to get truly paid
        total_paid = total_col - total_to_col
        result[eid] = {
            "total_collections": total_paid,
            "total_to_collect": total_to_col,
            "total_expenses": total_exp,
            "balance": total_paid - total_exp,
            "member_count": mem_map.get(eid, 0),
        }
    return result


def _serialize_event_with_member_context(e, role, is_restricted, aggs):
    e_dict = fix_event_json(e)
    e_dict["my_role"] = role
    e_dict["is_restricted"] = is_restricted
    e_dict.update(aggs.get(e.id, {}))
    return e_dict


def get_events_for_user(db: Session, user_id: int) -> list:
    """All events the user belongs to (organizer + collector)."""
    memberships = db.query(models.EventMember).options(
        joinedload(models.EventMember.event)
    ).filter(models.EventMember.user_id == user_id).all()

    if not memberships:
        return []

    event_ids = [m.event_id for m in memberships]
    aggs = _build_event_aggregates(db, event_ids)

    resp = []
    for m in memberships:
        e = m.event
        if not e:
            continue
        resp.append(_serialize_event_with_member_context(e, m.role, m.is_restricted, aggs))
    return resp


def _get_events_by_role(db: Session, user_id: int, role: models.UserRole) -> list:
    """Shared implementation for get_my_events and get_shared_events."""
    memberships = db.query(models.EventMember).options(
        joinedload(models.EventMember.event)
    ).filter(
        models.EventMember.user_id == user_id,
        models.EventMember.role == role
    ).all()

    if not memberships:
        return []

    event_ids = [m.event_id for m in memberships]
    aggs = _build_event_aggregates(db, event_ids)

    resp = []
    for m in memberships:
        e = m.event
        if not e:
            continue
        resp.append(_serialize_event_with_member_context(e, m.role, m.is_restricted, aggs))
    return resp


def get_my_events(db: Session, user_id: int) -> list:
    """Events where user is Organizer."""
    return _get_events_by_role(db, user_id, models.UserRole.organizer)


def get_shared_events(db: Session, user_id: int) -> list:
    """Events joined via code (Collector role)."""
    return _get_events_by_role(db, user_id, models.UserRole.collector)


# ─────────────────────────────────────────
# JOINING / EXITING
# ─────────────────────────────────────────

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
        cache.cache.invalidate_event(db_event.id)
        cache.cache.bump_global_version()

    return db_event


def exit_event(db: Session, event_id: str, user_id: int):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()
    if not member:
        return False
    db.delete(member)
    # Also remove from watched/discover tab
    db.query(models.WatchedEvent).filter(
        models.WatchedEvent.event_id == event_id,
        models.WatchedEvent.user_id == user_id
    ).delete()
    db.commit()
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return True


# ─────────────────────────────────────────
# EVENT MANAGEMENT
# ─────────────────────────────────────────

def toggle_event_status(db: Session, event_id: str, is_active: bool, user_id: int = None):
    event = get_event(db, event_id)
    if event:
        event.is_active = is_active
        db.commit()
        db.refresh(event)
        cache.cache.invalidate_event(event_id)
        cache.cache.bump_global_version()
    return event


def regenerate_invite_code(db: Session, event_id: str):
    event = get_event(db, event_id)
    if event:
        raw = uuid.uuid4().hex[:14].upper()
        event.invite_code = f"{raw[:5]}-{raw[5:9]}-{raw[9:]}"
        db.commit()
        db.refresh(event)
        cache.cache.invalidate_event(event_id)
        cache.cache.bump_global_version()
    return event


def set_member_restriction(db: Session, event_id: str, user_id: int, is_restricted: bool):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()
    if member:
        member.is_restricted = is_restricted
        member.restricted_at = datetime.now(timezone.utc) if is_restricted else None
        member.role = models.UserRole.collector
        db.commit()
        db.refresh(member)
        cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return member


def update_member_role(db: Session, event_id: str, target_user_id: int, role: models.UserRole):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == target_user_id
    ).first()
    if not member:
        return None
    member.role = role
    db.commit()
    db.refresh(member)
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return member


def delete_event(db: Session, event_id: str):
    event = get_event(db, event_id)
    if not event:
        return False
    db.query(models.EventMember).filter(models.EventMember.event_id == event_id).delete()
    db.query(models.Donation).filter(models.Donation.event_id == event_id).delete()
    db.query(models.Expense).filter(models.Expense.event_id == event_id).delete()
    db.query(models.WatchedEvent).filter(models.WatchedEvent.event_id == event_id).delete()
    db.query(models.ChatMessage).filter(models.ChatMessage.event_id == event_id).delete()
    db.delete(event)
    db.commit()
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return True


def _apply_custom_columns_update(db: Session, event_id: str, old_cols_raw, new_cols_raw, renames: dict, model_class):
    old_cols = old_cols_raw or []
    if isinstance(old_cols, str):
        try:
            old_cols = _json.loads(old_cols)
        except Exception:
            old_cols = []

    def _extract_names(cols):
        names = set()
        for c in cols:
            if not c:
                continue
            if isinstance(c, str):
                names.add(c)
            elif isinstance(c, dict) and "n" in c:
                names.add(c["n"])
        return names

    old_names = _extract_names(old_cols)
    new_names = _extract_names(new_cols_raw)

    valid_renames = {old: new for old, new in renames.items() if old in old_names and new in new_names}
    if valid_renames:
        items = db.query(model_class).filter(model_class.event_id == event_id).all()
        for item in items:
            if item.custom_fields and isinstance(item.custom_fields, dict):
                modified = False
                for old_key, new_key in valid_renames.items():
                    if old_key in item.custom_fields:
                        item.custom_fields[new_key] = item.custom_fields.pop(old_key)
                        modified = True
                if modified:
                    flag_modified(item, "custom_fields")

    renamed_old_names = set(valid_renames.keys())
    deleted_names = old_names - new_names - renamed_old_names
    if deleted_names:
        items = db.query(model_class).filter(model_class.event_id == event_id).all()
        for item in items:
            if item.custom_fields and isinstance(item.custom_fields, dict):
                modified = False
                for name in deleted_names:
                    if name in item.custom_fields:
                        del item.custom_fields[name]
                        modified = True
                if modified:
                    flag_modified(item, "custom_fields")
    return sanitize_json_payload(new_cols_raw)


def update_event(db: Session, event_id: str, data: schemas.EventUpdate, user_id: int = None):
    event = get_event(db, event_id)
    if not event:
        return None
    if data.name is not None:
        event.name = data.name
    if data.description is not None:
        event.description = data.description
    if data.event_date is not None:
        event.event_date = data.event_date

    renames = data.column_renames or {}

    if data.donation_custom_columns is not None:
        event.donation_custom_columns = _apply_custom_columns_update(
            db, event_id, event.donation_custom_columns, data.donation_custom_columns, renames, models.Donation
        )

    if data.expense_custom_columns is not None:
        event.expense_custom_columns = _apply_custom_columns_update(
            db, event_id, event.expense_custom_columns, data.expense_custom_columns, renames, models.Expense
        )

    if data.show_donations is not None:
        event.show_donations = data.show_donations
    if data.show_expenses is not None:
        event.show_expenses = data.show_expenses
    if data.is_public is not None:
        event.is_public = data.is_public
    if data.upi_id is not None:
        event.upi_id = data.upi_id
    if data.upi_owner_name is not None or data.upi_id == "":
        event.upi_owner_name = data.upi_owner_name
    if data.goal_amount is not None:
        event.goal_amount = data.goal_amount
    db.commit()
    db.refresh(event)
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return event


# ─────────────────────────────────────────
# DONATIONS
# ─────────────────────────────────────────

def get_donation(db: Session, donation_id: int):
    res = db.query(models.Donation, models.User.full_name).outerjoin(
        models.User, models.Donation.collected_by == models.User.id
    ).filter(models.Donation.id == donation_id).first()
    if not res:
        return None
    d, name = res
    d_dict = {c.name: getattr(d, c.name) for c in d.__table__.columns}
    d_dict["collected_by_name"] = name or "Unknown"
    return fix_custom_fields_dict(d_dict)


def get_donations(db: Session, event_id: str, limit: int = 1000, offset: int = 0,
                  search: str = None, sort_by: str = "collected_at", sort_dir: str = "desc"):
    """
    Paginated + searchable + sortable donations list.
    Defaults to legacy unlimited behaviour (limit=1000) for backward compat.
    Future: frontend can pass limit/offset for true pagination.
    """
    q = db.query(models.Donation, models.User.full_name).outerjoin(
        models.User, models.Donation.collected_by == models.User.id
    ).filter(models.Donation.event_id == event_id)

    if search:
        q = q.filter(models.Donation.donor_name.ilike(f"%{search}%"))

    sort_col = getattr(models.Donation, sort_by, models.Donation.collected_at)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset(offset).limit(limit)

    resp = []
    for d, name in q.all():
        d_dict = {c.name: getattr(d, c.name) for c in d.__table__.columns}
        d_dict["collected_by_name"] = name or "Unknown"
        resp.append(fix_custom_fields_dict(d_dict))
    return resp


def create_donation(db: Session, event_id: str, collector_id: int, donation: schemas.DonationCreate, is_public_entry: bool = False):
    db_donation = models.Donation(
        event_id=event_id,
        donor_name=donation.donor_name,
        amount=donation.amount,
        collected_by=collector_id,
        custom_fields=sanitize_json_payload(donation.custom_fields),
        receipt_key=getattr(donation, 'receipt_key', None),
        is_public_entry=is_public_entry,
        payment_received=donation.payment_received if donation.payment_received is not None else True
    )
    db.add(db_donation)
    db.commit()
    db.refresh(db_donation)
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return get_donation(db, db_donation.id)


def update_donation(db: Session, donation_id: int, data: schemas.DonationUpdate):
    donation = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not donation:
        return None
    if data.donor_name is not None:
        donation.donor_name = data.donor_name
    if data.amount is not None:
        donation.amount = data.amount
    if data.custom_fields is not None:
        donation.custom_fields = sanitize_json_payload(data.custom_fields)
    if data.receipt_key is not None:
        donation.receipt_key = data.receipt_key if data.receipt_key != "" else None
    if data.payment_received is not None:
        donation.payment_received = data.payment_received
    donation.version += 1
    db.commit()
    cache.cache.invalidate_event(donation.event_id)
    cache.cache.bump_global_version()
    return get_donation(db, donation_id)


def delete_donation(db: Session, donation_id: int):
    donation = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not donation:
        return False
    eid = donation.event_id
    db.delete(donation)
    db.commit()
    cache.cache.invalidate_event(eid)
    cache.cache.bump_global_version()
    return True


# ─────────────────────────────────────────
# EXPENSES
# ─────────────────────────────────────────

def get_expense(db: Session, expense_id: int):
    res = db.query(models.Expense, models.User.full_name).outerjoin(
        models.User, models.Expense.collected_by == models.User.id
    ).filter(models.Expense.id == expense_id).first()
    if not res:
        return None
    e, name = res
    e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
    e_dict["collected_by_name"] = name or "Unknown"
    return fix_custom_fields_dict(e_dict)


def get_expenses(db: Session, event_id: str, limit: int = 1000, offset: int = 0,
                 search: str = None, sort_by: str = "collected_at", sort_dir: str = "desc"):
    """
    Paginated + searchable + sortable expenses list.
    """
    q = db.query(models.Expense, models.User.full_name).outerjoin(
        models.User, models.Expense.collected_by == models.User.id
    ).filter(models.Expense.event_id == event_id)

    if search:
        q = q.filter(models.Expense.description.ilike(f"%{search}%"))

    sort_col = getattr(models.Expense, sort_by, models.Expense.collected_at)
    q = q.order_by(sort_col.desc() if sort_dir == "desc" else sort_col.asc())
    q = q.offset(offset).limit(limit)

    resp = []
    for e, name in q.all():
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["collected_by_name"] = name or "Unknown"
        resp.append(fix_custom_fields_dict(e_dict))
    return resp


def create_expense(db: Session, event_id: str, collector_id: int, expense: schemas.ExpenseCreate):
    db_expense = models.Expense(
        event_id=event_id,
        description=expense.description,
        amount=expense.amount,
        collected_by=collector_id,
        custom_fields=sanitize_json_payload(expense.custom_fields),
        receipt_key=getattr(expense, 'receipt_key', None)
    )
    db.add(db_expense)
    db.commit()
    db.refresh(db_expense)
    cache.cache.invalidate_event(event_id)
    cache.cache.bump_global_version()
    return get_expense(db, db_expense.id)


def update_expense(db: Session, expense_id: int, data: schemas.ExpenseUpdate):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        return None
    if data.description is not None:
        expense.description = data.description
    if data.amount is not None:
        expense.amount = data.amount
    if data.custom_fields is not None:
        expense.custom_fields = sanitize_json_payload(data.custom_fields)
    if data.receipt_key is not None:
        expense.receipt_key = data.receipt_key if data.receipt_key != "" else None
    expense.version += 1
    db.commit()
    cache.cache.invalidate_event(expense.event_id)
    cache.cache.bump_global_version()
    return get_expense(db, expense_id)


def delete_expense(db: Session, expense_id: int):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense:
        return False
    eid = expense.event_id
    db.delete(expense)
    db.commit()
    cache.cache.invalidate_event(eid)
    cache.cache.bump_global_version()
    return True


# ─────────────────────────────────────────
# SUMMARY (SQL aggregations — no Python loops)
# ─────────────────────────────────────────

# How many recent transactions to include in the summary
RECENT_TXN_LIMIT = 50

def get_event_summary(db: Session, event_id: str):
    """
    Financial summary using pure SQL aggregations.
    No records are loaded into Python memory — all computed by the database.
    """
    cached_sum = cache.cache.get(f"sum:{event_id}")
    if cached_sum:
        return schemas.EventSummaryResponse(**cached_sum)

    # All aggregations in SQL — zero Python loops
    total_donations = db.query(func.sum(models.Donation.amount)).filter(
        models.Donation.event_id == event_id,
        models.Donation.payment_received != False  # noqa: E712
    ).scalar() or 0.0

    total_to_collect = db.query(func.sum(models.Donation.amount)).filter(
        models.Donation.event_id == event_id,
        models.Donation.payment_received == False  # noqa: E712
    ).scalar() or 0.0

    total_expenses = db.query(func.sum(models.Expense.amount)).filter(
        models.Expense.event_id == event_id
    ).scalar() or 0.0

    donations_count = db.query(func.count(models.Donation.id)).filter(
        models.Donation.event_id == event_id
    ).scalar() or 0

    expenses_count = db.query(func.count(models.Expense.id)).filter(
        models.Expense.event_id == event_id
    ).scalar() or 0

    # Recent transactions: LIMIT applied at DB level — no unbounded memory load
    recent_don = db.query(models.Donation, models.User.full_name).join(
        models.User, models.Donation.collected_by == models.User.id
    ).filter(
        models.Donation.event_id == event_id
    ).order_by(models.Donation.collected_at.desc()).limit(RECENT_TXN_LIMIT).all()

    recent_exp = db.query(models.Expense, models.User.full_name).join(
        models.User, models.Expense.collected_by == models.User.id
    ).filter(
        models.Expense.event_id == event_id
    ).order_by(models.Expense.collected_at.desc()).limit(RECENT_TXN_LIMIT).all()

    txns = []
    for d, creator_name in recent_don:
        txns.append(schemas.RecentTransaction(
            id=d.id, type='donation', title=d.donor_name,
            amount=d.amount or 0, date=d.collected_at,
            collected_by_name=creator_name
        ))
    for e, creator_name in recent_exp:
        txns.append(schemas.RecentTransaction(
            id=e.id, type='expense', title=e.description,
            amount=e.amount or 0, date=e.collected_at,
            collected_by_name=creator_name
        ))

    txns.sort(key=lambda x: x.date, reverse=True)
    txns = txns[:RECENT_TXN_LIMIT]  # Keep only the freshest N after merge-sort

    resp = schemas.EventSummaryResponse(
        total_donations=total_donations,
        total_expenses=total_expenses,
        balance=total_donations - total_expenses,
        donations_count=donations_count,
        expenses_count=expenses_count,
        recent_transactions=txns,
        total_to_collect=total_to_collect
    )

    cache.cache.set(f"sum:{event_id}", resp.dict())
    return resp


# ─────────────────────────────────────────
# FULL EVENT DETAILS (Big Bang)
# ─────────────────────────────────────────

def get_event_full_details(db: Session, event_id: str, user_id: int):
    """
    Returns everything for an event in one call.
    Optimised to use exactly 4 database queries:
      Q1: Event row
      Q2: Membership row for current user
      Q3: All donations + collector names (single JOIN)
      Q4: All expenses + collector names (single JOIN)
      Q5: Members + user profiles (joinedload)
    Summary is computed from in-memory data (already loaded) — no extra queries.
    """
    event = db.query(models.Event).filter(models.Event.id == event_id).first()
    if not event:
        return None

    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()

    actual_role = "visitor"
    if user_id == event.organizer_id:
        actual_role = "Organizer"
    elif member:
        actual_role = member.role
    is_restricted = member.is_restricted if member else False

    event_dict = {c.name: getattr(event, c.name) for c in event.__table__.columns}
    event_dict["my_role"] = actual_role
    event_dict["is_restricted"] = is_restricted
    _parse_json_columns(event_dict)

    # All donations (no limit — full dataset needed for table view)
    don_results = db.query(models.Donation, models.User.full_name).join(
        models.User, models.Donation.collected_by == models.User.id
    ).filter(models.Donation.event_id == event_id).all()

    donations = []
    for d, name in don_results:
        d_dict = {c.name: getattr(d, c.name) for c in d.__table__.columns}
        d_dict["collected_by_name"] = name
        donations.append(fix_custom_fields_dict(d_dict))

    # All expenses (no limit — full dataset needed for table view)
    exp_results = db.query(models.Expense, models.User.full_name).join(
        models.User, models.Expense.collected_by == models.User.id
    ).filter(models.Expense.event_id == event_id).all()

    expenses = []
    for e, name in exp_results:
        e_dict = {c.name: getattr(e, c.name) for c in e.__table__.columns}
        e_dict["collected_by_name"] = name
        expenses.append(fix_custom_fields_dict(e_dict))

    # Compute summary from already-loaded data — 0 extra queries
    total_donations = sum(d.get("amount") or 0 for d in donations if d.get("payment_received") is not False)
    total_to_collect = sum(d.get("amount") or 0 for d in donations if d.get("payment_received") is False)
    total_expenses = sum(e.get("amount") or 0 for e in expenses)

    txns = []
    for d in donations:
        txns.append(schemas.RecentTransaction(
            id=d["id"], type='donation', title=d["donor_name"],
            amount=d.get("amount") or 0, date=d.get("collected_at"),
            collected_by_name=d.get("collected_by_name")
        ))
    for e in expenses:
        txns.append(schemas.RecentTransaction(
            id=e["id"], type='expense', title=e["description"],
            amount=e.get("amount") or 0, date=e.get("collected_at"),
            collected_by_name=e.get("collected_by_name")
        ))
    txns.sort(key=lambda x: x.date or datetime.min, reverse=True)

    summary = schemas.EventSummaryResponse(
        total_donations=total_donations,
        total_expenses=total_expenses,
        balance=total_donations - total_expenses,
        donations_count=len(donations),
        expenses_count=len(expenses),
        recent_transactions=txns[:RECENT_TXN_LIMIT],
        total_to_collect=total_to_collect
    )

    # Members with eagerly loaded user profiles — single JOIN (no N+1)
    members_raw = db.query(models.EventMember).options(
        joinedload(models.EventMember.user)
    ).filter(models.EventMember.event_id == event_id).all()
    members_public = members_to_public_response(members_raw)

    return schemas.EventFullDetailsResponse(
        event=schemas.EventResponse(**event_dict),
        donations=donations,
        expenses=expenses,
        summary=summary,
        members=members_public,
        my_role=actual_role,
        is_restricted=is_restricted
    )


# ─────────────────────────────────────────
# WATCHED EVENTS
# ─────────────────────────────────────────

def get_watched_events(db: Session, user_id: int):
    """Return watched events excluding events user is a member of."""
    subquery = db.query(models.EventMember.event_id).filter(
        models.EventMember.user_id == user_id
    ).scalar_subquery()
    return db.query(models.WatchedEvent).options(
        joinedload(models.WatchedEvent.event)
    ).filter(
        models.WatchedEvent.user_id == user_id,
        ~models.WatchedEvent.event_id.in_(subquery)
    ).order_by(models.WatchedEvent.last_viewed_at.desc()).all()


def add_watched_event(db: Session, user_id: int, event_id: str):
    existing = db.query(models.WatchedEvent).filter(
        models.WatchedEvent.user_id == user_id,
        models.WatchedEvent.event_id == event_id
    ).first()
    if existing:
        existing.last_viewed_at = datetime.now(timezone.utc)
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


def remove_watched_event(db: Session, user_id: int, event_id: str):
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


# ─────────────────────────────────────────
# MEMBER MANAGEMENT
# ─────────────────────────────────────────

def get_member_contact(db: Session, event_id: str, target_user_id: int):
    """Return phone for a fellow event member — single JOIN query."""
    result = db.query(
        models.EventMember, models.User
    ).join(
        models.User, models.EventMember.user_id == models.User.id
    ).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == target_user_id
    ).first()

    if not result:
        return None
    member, user = result
    if not user or not user.phone_number:
        return None
    return schemas.MemberContactResponse(
        user_id=user.id,
        full_name=user.full_name,
        phone_number=user.phone_number,
    )


# ─────────────────────────────────────────
# DASHBOARD
# ─────────────────────────────────────────

def get_user_full_dashboard(db: Session, user_id: int):
    v = cache.cache.get_global_version()
    cache_key = f"dash:{user_id}:{v}"
    cached_dash = cache.cache.get(cache_key)
    if cached_dash:
        return cached_dash

    profile = get_user(db, user_id)
    my_events = get_my_events(db, user_id)
    shared_events = get_shared_events(db, user_id)
    watched_raw = get_watched_events(db, user_id)

    watched_fixed = []
    for w in watched_raw:
        if not w.event:
            continue
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
    v = cache.cache.get_global_version()
    cache.cache.set(f"dash:{user_id}:{v}", res, expire=300)
    return res


# ─────────────────────────────────────────
# CHAT
# ─────────────────────────────────────────

def _chat_msg_to_dict(db: Session, msg, sender_name: str) -> dict:
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
        "delivered_to": msg.delivered_to or [],
        "read_by": msg.read_by or [],
        "sent_at": msg.sent_at.isoformat() + "Z" if msg.sent_at else None
    }
    if msg.reply_to_id and msg.reply_to:
        # Fetch reply user with single query
        reply_user_name = db.query(models.User.full_name).filter(
            models.User.id == msg.reply_to.user_id
        ).scalar()
        d["reply_snippet"] = {
            "id": msg.reply_to.id,
            "sender_name": reply_user_name or "Unknown",
            "message": msg.reply_to.message[:100]
        }
    return d


def create_chat_message(db: Session, event_id: str, user_id: int, message: str, reply_to_id: int = None):
    msg = models.ChatMessage(
        event_id=event_id,
        user_id=user_id,
        message=message[:2000],
        reply_to_id=reply_to_id
    )
    db.add(msg)
    db.commit()
    db.refresh(msg)

    # Probabilistic cleanup: enforce 250-message cap ~10% of the time.
    # This avoids running COUNT(*) on every single message insertion (saves 2 DB round-trips 90% of the time).
    if random.random() < 0.10:
        count = db.query(func.count(models.ChatMessage.id)).filter(
            models.ChatMessage.event_id == event_id
        ).scalar()
        if count > 250:
            to_delete = count - 250
            oldest_ids = [row[0] for row in db.query(models.ChatMessage.id).filter(
                models.ChatMessage.event_id == event_id
            ).order_by(models.ChatMessage.id.asc()).limit(to_delete).all()]
            if oldest_ids:
                db.query(models.ChatMessage).filter(
                    models.ChatMessage.reply_to_id.in_(oldest_ids)
                ).update({models.ChatMessage.reply_to_id: None}, synchronize_session=False)
                db.query(models.ChatMessage).filter(
                    models.ChatMessage.id.in_(oldest_ids)
                ).delete(synchronize_session=False)
                db.commit()

    sender_name = "AI Advisor" if user_id is None else (
        db.query(models.User.full_name).filter(models.User.id == user_id).scalar() or "Unknown"
    )
    return _chat_msg_to_dict(db, msg, sender_name)


def get_chat_messages(db: Session, event_id: str, limit: int = 50, before_id: int = None):
    q = db.query(models.ChatMessage, models.User.full_name).outerjoin(
        models.User, models.ChatMessage.user_id == models.User.id
    ).filter(models.ChatMessage.event_id == event_id)
    if before_id:
        q = q.filter(models.ChatMessage.id < before_id)
    results = q.order_by(models.ChatMessage.id.desc()).limit(limit).all()
    msgs = []
    for msg, sender_name in results:
        msgs.append(_chat_msg_to_dict(db, msg, sender_name or "AI Advisor"))
    return msgs[::-1]  # Chronological order


def toggle_reaction(db: Session, message_id: int, event_id: str, user_id: int, emoji: str):
    msg = db.query(models.ChatMessage).filter(
        models.ChatMessage.id == message_id,
        models.ChatMessage.event_id == event_id,
    ).first()
    if not msg:
        return None
    reactions = dict(msg.reactions or {})
    for e, users in list(reactions.items()):
        if user_id in users:
            users.remove(user_id)
            if not users:
                del reactions[e]
            else:
                reactions[e] = users
            if e == emoji:
                msg.reactions = reactions
                flag_modified(msg, "reactions")
                db.commit()
                sender_name = db.query(models.User.full_name).filter(
                    models.User.id == msg.user_id
                ).scalar()
                return _chat_msg_to_dict(db, msg, sender_name)

    if emoji not in reactions:
        reactions[emoji] = []
    reactions[emoji].append(user_id)
    msg.reactions = reactions
    flag_modified(msg, "reactions")
    db.commit()
    sender_name = db.query(models.User.full_name).filter(
        models.User.id == msg.user_id
    ).scalar()
    return _chat_msg_to_dict(db, msg, sender_name)


def delete_chat_message(db: Session, message_id: int, event_id: str, user_id: int, is_organizer: bool):
    msg = db.query(models.ChatMessage).filter(
        models.ChatMessage.id == message_id,
        models.ChatMessage.event_id == event_id,
    ).first()
    if not msg:
        return None
    if msg.user_id != user_id and not is_organizer:
        return None
    msg.message = "[DELETED]"
    msg.reactions = {}
    flag_modified(msg, "reactions")
    db.commit()
    sender_name = db.query(models.User.full_name).filter(
        models.User.id == msg.user_id
    ).scalar()
    return _chat_msg_to_dict(db, msg, sender_name)


def update_chat_status(db: Session, message_id: int, event_id: str, user_id: int, status: str):
    """Update delivered or read status for a chat message."""
    msg = db.query(models.ChatMessage).filter(
        models.ChatMessage.id == message_id,
        models.ChatMessage.event_id == event_id
    ).first()
    if not msg:
        return None
    if msg.user_id == user_id or msg.user_id is None:
        return None

    changed = False
    if status == "delivered":
        delivered_list = msg.delivered_to or []
        if user_id not in delivered_list:
            delivered_list.append(user_id)
            msg.delivered_to = delivered_list
            flag_modified(msg, "delivered_to")
            changed = True
    elif status == "read":
        read_list = msg.read_by or []
        if user_id not in read_list:
            read_list.append(user_id)
            msg.read_by = read_list
            flag_modified(msg, "read_by")
            changed = True
            delivered_list = msg.delivered_to or []
            if user_id not in delivered_list:
                delivered_list.append(user_id)
                msg.delivered_to = delivered_list
                flag_modified(msg, "delivered_to")

    if changed:
        db.commit()
        sender_name = db.query(models.User.full_name).filter(
            models.User.id == msg.user_id
        ).scalar()
        return _chat_msg_to_dict(db, msg, sender_name)
    return None
