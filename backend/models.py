from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, DateTime, Float, JSON, Enum as SQLEnum, Index
from sqlalchemy.orm import relationship
import enum
from datetime import datetime
import uuid
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
    phone_number = Column(String, unique=True, index=True)
    full_name = Column(String, index=True)
    gender = Column(SQLEnum(GenderEnum))
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    is_banned = Column(Boolean, default=False, index=True)
    ban_reason = Column(String, nullable=True)

    memberships = relationship("EventMember", back_populates="user")
    donations_collected = relationship("Donation", back_populates="collector_user", foreign_keys="Donation.collected_by")
    expenses_collected = relationship("Expense", back_populates="collector_user", foreign_keys="Expense.collected_by")

class Event(Base):
    __tablename__ = "events"

    id = Column(String(32), primary_key=True, index=True, default=lambda: uuid.uuid4().hex)
    name = Column(String, index=True)
    description = Column(String)
    event_date = Column(DateTime, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    invite_code = Column(String, unique=True, index=True)
    is_active = Column(Boolean, default=True, index=True)
    is_public = Column(Boolean, default=False, index=True)

    # Who created it
    organizer_id = Column(Integer, ForeignKey("users.id"), index=True)

    # Public Donation Portal
    upi_id = Column(String, nullable=True)
    upi_owner_name = Column(String, nullable=True)
    upi_verified_at = Column(DateTime, nullable=True)

    # Table visibility  organizer can hide Donations or Expenses
    show_donations = Column(Boolean, default=True)
    show_expenses = Column(Boolean, default=True)
    goal_amount = Column(Integer, default=0, nullable=True)

    # Custom column definitions (Array of names)
    donation_custom_columns = Column(JSON, default=list)
    expense_custom_columns = Column(JSON, default=list)

    members = relationship("EventMember", back_populates="event")
    donations = relationship("Donation", back_populates="event")
    expenses = relationship("Expense", back_populates="event")

class EventMember(Base):
    __tablename__ = "event_members"

    __table_args__ = (
        # Composite unique index: a user can only be in an event once
        Index('idx_event_members_user_event', 'user_id', 'event_id', unique=True),
        # Index for filtering by role (get_my_events uses user_id + role=organizer)
        Index('idx_event_members_user_role', 'user_id', 'role'),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    event_id = Column(String(32), ForeignKey("events.id"), index=True)
    role = Column(SQLEnum(UserRole), index=True)
    joined_at = Column(DateTime, default=datetime.utcnow)
    is_restricted = Column(Boolean, default=False)
    restricted_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="memberships")
    event = relationship("Event", back_populates="members")

class Donation(Base):
    __tablename__ = "donations"

    __table_args__ = (
        # Composite index for sorted listing and recent transactions per event
        Index('idx_donations_event_collected_at', 'event_id', 'collected_at'),
        # Composite index for aggregating paid vs pending donations
        Index('idx_donations_event_payment', 'event_id', 'payment_received'),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String(32), ForeignKey("events.id"), index=True)
    donor_name = Column(String, index=True)
    amount = Column(Float, nullable=True)
    collected_by = Column(Integer, ForeignKey("users.id"), index=True)
    collected_at = Column(DateTime, default=datetime.utcnow, index=True)
    custom_fields = Column(JSON, nullable=True)
    receipt_key = Column(String, nullable=True)
    version = Column(Integer, default=1)
    is_public_entry = Column(Boolean, default=False)
    payment_received = Column(Boolean, default=True, server_default='1', nullable=False)

    event = relationship("Event", back_populates="donations")
    collector_user = relationship("User", back_populates="donations_collected", foreign_keys=[collected_by])

class Expense(Base):
    __tablename__ = "expenses"

    __table_args__ = (
        # Composite index for sorted listing per event
        Index('idx_expenses_event_collected_at', 'event_id', 'collected_at'),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String(32), ForeignKey("events.id"), index=True)
    description = Column(String, index=True)
    amount = Column(Float, nullable=True)
    collected_by = Column(Integer, ForeignKey("users.id"), index=True)
    collected_at = Column(DateTime, default=datetime.utcnow, index=True)
    custom_fields = Column(JSON, nullable=True)
    receipt_key = Column(String, nullable=True)
    version = Column(Integer, default=1)

    event = relationship("Event", back_populates="expenses")
    collector_user = relationship("User", back_populates="expenses_collected", foreign_keys=[collected_by])

class WatchedEvent(Base):
    __tablename__ = "watched_events"

    __table_args__ = (
        # Composite unique index: a user can only watch an event once
        Index('idx_watched_events_user_event', 'user_id', 'event_id', unique=True),
    )

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    event_id = Column(String(32), ForeignKey("events.id"), index=True)
    last_viewed_at = Column(DateTime, default=datetime.utcnow, index=True)

    user = relationship("User")
    event = relationship("Event")

class ChatMessage(Base):
    __tablename__ = "chat_messages"

    __table_args__ = (
        # Compound index for cursor-based pagination: event_id + id DESC
        Index('idx_chat_messages_event_id_id', 'event_id', 'id'),
    )

    id = Column(Integer, primary_key=True, index=True)
    event_id = Column(String(32), ForeignKey("events.id"), index=True)
    user_id = Column(Integer, ForeignKey("users.id"), index=True)
    message = Column(String, nullable=False)
    reply_to_id = Column(Integer, ForeignKey("chat_messages.id"), nullable=True)
    reactions = Column(JSON, default=dict)  # {"❤️": [1,3], "👍": [2]}
    delivered_to = Column(JSON, default=list)  # [1, 2, 3]
    read_by = Column(JSON, default=list)  # [1, 2]
    sent_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    event = relationship("Event")
    reply_to = relationship("ChatMessage", remote_side=[id], uselist=False)


class AdminUser(Base):
    __tablename__ = "admin_users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=True)
    password_hash = Column(String, nullable=False)
    role = Column(String, default="admin")
    created_at = Column(DateTime, default=datetime.utcnow)

class AdminAuditLog(Base):
    __tablename__ = "admin_audit_log"

    id = Column(Integer, primary_key=True, index=True)
    admin_id = Column(Integer, ForeignKey("admin_users.id"), index=True)
    action = Column(String, nullable=False)
    target_type = Column(String)
    target_id = Column(String)
    details = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

class Feedback(Base):
    __tablename__ = "feedback"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=True, index=True)
    name = Column(String, nullable=True)
    email = Column(String, nullable=True)
    type = Column(String)
    message = Column(String)
    status = Column(String, default="pending", index=True)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)

class ErrorLog(Base):
    __tablename__ = "error_logs"

    id = Column(Integer, primary_key=True, index=True)
    endpoint = Column(String)
    error_message = Column(String)
    traceback = Column(String)
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
