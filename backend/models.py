from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Float, JSON, Enum as SQLEnum
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
from database import Base

class GenderEnum(str, enum.Enum):
    male = "Male"
    female = "Female"
    prefer_not = "Prefer not to say"

class UserRole(str, enum.Enum):
    organizer = "Organizer"
    collector = "Collector"

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    firebase_uid = Column(String, unique=True, index=True)
    phone_number = Column(String, unique=True)
    full_name = Column(String)
    gender = Column(SQLEnum(GenderEnum))
    created_at = Column(DateTime, default=datetime.utcnow)

    memberships = relationship("EventMember", back_populates="user")
    donations_collected = relationship("Donation", back_populates="collector_user")
    expenses_collected = relationship("Expense", back_populates="collector_user")

class Event(Base):
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, index=True)
    description = Column(String)
    event_date = Column(DateTime)
    created_at = Column(DateTime, default=datetime.utcnow)
    invite_code = Column(String, unique=True, index=True)
    is_active = Column(Boolean, default=True)
    is_public = Column(Boolean, default=False)
    
    # Who created it
    organizer_id = Column(Integer, ForeignKey("users.id"))
    
    # Custom column definitions (Array of names)
    donation_custom_columns = Column(JSON, default=list)
    expense_custom_columns = Column(JSON, default=list)
    
    members = relationship("EventMember", back_populates="event")
    donations = relationship("Donation", back_populates="event")
    expenses = relationship("Expense", back_populates="event")

class EventMember(Base):
    __tablename__ = "event_members"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    event_id = Column(Integer, ForeignKey("events.id"))
    role = Column(SQLEnum(UserRole))
    joined_at = Column(DateTime, default=datetime.utcnow)
    is_restricted = Column(Boolean, default=False)
    restricted_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="memberships")
    event = relationship("Event", back_populates="members")

class Donation(Base):
    __tablename__ = "donations"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"))
    donor_name = Column(String, index=True)
    amount = Column(Float, nullable=True)
    collected_by = Column(Integer, ForeignKey("users.id"))
    collected_at = Column(DateTime, default=datetime.utcnow)
    custom_fields = Column(JSON, nullable=True)

    event = relationship("Event", back_populates="donations")
    collector_user = relationship("User", back_populates="donations_collected")

class Expense(Base):
    __tablename__ = "expenses"

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(Integer, ForeignKey("events.id"))
    description = Column(String, index=True)
    amount = Column(Float, nullable=True)
    collected_by = Column(Integer, ForeignKey("users.id"))
    collected_at = Column(DateTime, default=datetime.utcnow)
    custom_fields = Column(JSON, nullable=True)

    event = relationship("Event", back_populates="expenses")
    collector_user = relationship("User", back_populates="expenses_collected")

class WatchedEvent(Base):
    __tablename__ = "watched_events"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"))
    event_id = Column(Integer, ForeignKey("events.id"))
    last_viewed_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    event = relationship("Event")
