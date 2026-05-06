from sqlalchemy.orm import Session
import models, schemas
import uuid
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
        invite_code=invite_code
    )
    db.add(db_event)
    db.commit()
    db.refresh(db_event)
    
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

def toggle_event_status(db: Session, event_id: int, is_active: bool):
    event = get_event(db, event_id)
    if event:
        event.is_active = is_active
        db.commit()
        db.refresh(event)
    return event

def regenerate_invite_code(db: Session, event_id: int):
    event = get_event(db, event_id)
    if event:
        event.invite_code = str(uuid.uuid4())[:8].upper()
        db.commit()
        db.refresh(event)
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
    return member

def get_event_summary(db: Session, event_id: int):
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
    
    return schemas.EventSummaryResponse(
        total_donations=total_donations,
        total_expenses=total_expenses,
        balance=total_donations - total_expenses,
        donations_count=donations_count,
        expenses_count=expenses_count,
        recent_transactions=txns
    )

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

def update_event(db: Session, event_id: int, data: schemas.EventUpdate):
    event = get_event(db, event_id)
    if not event: return None
    if data.name is not None: event.name = data.name
    if data.description is not None: event.description = data.description
    if data.event_date is not None: event.event_date = data.event_date
    if data.donation_custom_columns is not None: event.donation_custom_columns = data.donation_custom_columns
    if data.expense_custom_columns is not None: event.expense_custom_columns = data.expense_custom_columns
    db.commit()
    db.refresh(event)
    return event

def delete_event(db: Session, event_id: int):
    event = get_event(db, event_id)
    if not event: return False
    db.query(models.EventMember).filter(models.EventMember.event_id == event_id).delete()
    db.query(models.Donation).filter(models.Donation.event_id == event_id).delete()
    db.query(models.Expense).filter(models.Expense.event_id == event_id).delete()
    db.delete(event)
    db.commit()
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
    return get_donation(db, donation_id)

def delete_donation(db: Session, donation_id: int):
    donation = db.query(models.Donation).filter(models.Donation.id == donation_id).first()
    if not donation: return False
    db.delete(donation)
    db.commit()
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
    return get_expense(db, expense_id)

def delete_expense(db: Session, expense_id: int):
    expense = db.query(models.Expense).filter(models.Expense.id == expense_id).first()
    if not expense: return False
    db.delete(expense)
    db.commit()
    return True

def exit_event(db: Session, event_id: int, user_id: int):
    member = db.query(models.EventMember).filter(
        models.EventMember.event_id == event_id,
        models.EventMember.user_id == user_id
    ).first()
    if not member: return False
    db.delete(member)
    db.commit()
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
    return member
