from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from models import GenderEnum, UserRole

#  What the client sends when registering (firebase_uid comes from the JWT token)
class UserRegisterInput(BaseModel):
    phone_number: str
    full_name: str
    gender: GenderEnum

#  Internal-only schema used by CRUD (never exposed in API routes directly)
class UserCreate(BaseModel):
    firebase_uid: str
    phone_number: str
    full_name: str
    gender: GenderEnum

#  Public response  firebase_uid deliberately excluded
class UserResponse(BaseModel):
    id: int
    phone_number: Optional[str] = None
    full_name: Optional[str] = None
    gender: Optional[str] = None
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class UserPublicResponse(BaseModel):
    """User fields safe to expose to other event members (no phone)."""
    id: int
    full_name: Optional[str] = None
    gender: Optional[str] = None
    created_at: Optional[datetime] = None
    class Config:
        from_attributes = True

class MemberContactResponse(BaseModel):
    user_id: int
    full_name: str
    phone_number: str

class EventCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    event_date: datetime
    is_public: bool = False
    show_donations: bool = True
    show_expenses: bool = True
    goal_amount: Optional[int] = 0

class EventResponse(EventCreate):
    id: str
    invite_code: str
    is_active: bool
    organizer_id: int
    created_at: datetime
    my_role: Optional[str] = None
    is_restricted: bool = False
    member_count: Optional[int] = 0
    show_donations: bool = True
    show_expenses: bool = True
    donation_custom_columns: Any = []
    expense_custom_columns: Any = []
    upi_id: Optional[str] = None
    upi_owner_name: Optional[str] = None
    upi_verified_at: Optional[datetime] = None
    total_collections: Optional[float] = 0.0
    total_expenses: Optional[float] = 0.0
    balance: Optional[float] = 0.0
    total_to_collect: Optional[float] = 0.0
    class Config:
        from_attributes = True

class PublicEventResponse(BaseModel):
    id: str
    name: str
    description: str
    event_date: datetime
    organizer_name: Optional[str] = None
    upi_id: Optional[str] = None
    upi_owner_name: Optional[str] = None
    class Config:
        from_attributes = True

class DonationCreate(BaseModel):
    donor_name: str
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None
    entry_source: Optional[str] = None  # "ai", "manual", "collector"
    transaction_date: Optional[datetime] = None  # Date from screenshot
    collector_name: Optional[str] = None  # Who collected (organizer name)
    receipt_key: Optional[str] = None
    payment_received: Optional[bool] = True

class DonationResponse(DonationCreate):
    id: int
    event_id: str
    collected_by: int
    collected_by_name: str
    collected_at: datetime
    version: int
    is_public_entry: bool
    payment_received: bool = True
    class Config:
        from_attributes = True

class ManualDonationEntry(BaseModel):
    """Schema for manual donation entry when AI extraction fails."""
    donor_name: str
    amount: float
    receipt_session_id: Optional[str] = None
    receipt_key: Optional[str] = None
    custom_fields: Optional[Dict[str, Any]] = None
    class Config:
        json_schema_extra = {
            "example": {
                "donor_name": "BODA MOHAN REDDY",
                "amount": 110.00
            }
        }

class ExpenseCreate(BaseModel):
    description: str
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None

class ExpenseResponse(ExpenseCreate):
    id: int
    event_id: str
    collected_by: int
    collected_by_name: str
    collected_at: datetime
    version: int
    receipt_key: Optional[str] = None
    class Config:
        from_attributes = True

class EventMemberResponse(BaseModel):
    id: int
    user_id: int
    role: UserRole
    joined_at: datetime
    is_restricted: bool
    restricted_at: Optional[datetime] = None
    user: UserResponse
    class Config:
        from_attributes = True

class EventMemberPublicResponse(BaseModel):
    id: int
    user_id: int
    role: UserRole
    joined_at: datetime
    is_restricted: bool
    restricted_at: Optional[datetime] = None
    user: UserPublicResponse
    class Config:
        from_attributes = True

class RecentTransaction(BaseModel):
    id: int
    type: str  # 'donation' or 'expense'
    title: str # donor_name or expense description
    amount: float
    receipt_session_id: Optional[str] = None
    receipt_key: Optional[str] = None
    date: datetime
    collected_by_name: str

class EventSummaryResponse(BaseModel):
    total_donations: float
    total_expenses: float
    balance: float
    donations_count: int
    expenses_count: int
    recent_transactions: List[RecentTransaction] = []
    total_to_collect: float = 0.0

#  UPDATE (PUT) SCHEMAS 
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[GenderEnum] = None

class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[datetime] = None
    show_donations: Optional[bool] = None
    show_expenses: Optional[bool] = None
    donation_custom_columns: Optional[List[Any]] = None
    expense_custom_columns: Optional[List[Any]] = None
    is_public: Optional[bool] = None
    upi_id: Optional[str] = None
    upi_owner_name: Optional[str] = None
    upi_verified_at: Optional[datetime] = None
    goal_amount: Optional[int] = None
    # Rename mapping: {"old_name": "new_name"} — used when renaming custom columns
    # so that existing data is migrated instead of deleted
    column_renames: Optional[Dict[str, str]] = None

class DonationUpdate(BaseModel):
    donor_name: Optional[str] = None
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None
    receipt_key: Optional[str] = None
    payment_received: Optional[bool] = None

class ExpenseUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None
    receipt_key: Optional[str] = None


class MemberRoleUpdate(BaseModel):
    role: UserRole
    custom_fields: Optional[Dict[str, Any]] = None

class WatchedEventResponse(BaseModel):
    id: int
    user_id: int
    event_id: str
    last_viewed_at: datetime
    event: EventResponse
    class Config:
        from_attributes = True

class EventFullDetailsResponse(BaseModel):
    event: EventResponse
    donations: List[DonationResponse]
    expenses: List[ExpenseResponse]
    summary: EventSummaryResponse
    members: List[EventMemberPublicResponse]
    my_role: Optional[str] = None
    is_restricted: bool = False

class UserFullDashboardResponse(BaseModel):
    profile: UserResponse
    my_events: List[EventResponse]
    shared_events: List[EventResponse]
    watched_events: List[WatchedEventResponse]

#  CHAT 
class ChatMessageCreate(BaseModel):
    message: str
    reply_to_id: Optional[int] = None
    idempotency_key: Optional[str] = None

class ChatReplySnippet(BaseModel):
    id: int
    sender_name: str
    message: str

class ChatMessageResponse(BaseModel):
    id: int
    event_id: str
    user_id: Optional[int] = None
    sender_name: str
    message: str
    reply_to_id: Optional[int] = None
    reply_snippet: Optional[ChatReplySnippet] = None
    reactions: Optional[dict] = {}
    delivered_to: Optional[List[int]] = []
    read_by: Optional[List[int]] = []
    sent_at: datetime

class ChatReactionRequest(BaseModel):
    emoji: str

class MessageStatusUpdate(BaseModel):
    status: str  # 'delivered' or 'read'


#  ADMIN SCHEMAS 
class AdminLogin(BaseModel):
    email: str
    password: str

class AdminToken(BaseModel):
    access_token: str
    token_type: str
    role: str

class AdminActionRequest(BaseModel):
    reason: str

class AdminDashboardStats(BaseModel):
    total_users: int
    total_events: int
    total_donations_collected: float
    new_users_today: int
    total_expenses_tracked: float
    active_events: int
    banned_users: int
    errors_today: int
    pending_feedback: int = 0
    admin_name: Optional[str] = None

class AdminErrorLogResponse(BaseModel):
    id: int
    endpoint: str
    error_message: str
    traceback: str
    created_at: datetime
    class Config:
        from_attributes = True

class AdminAuditLogResponse(BaseModel):
    id: int
    admin_id: int
    admin_name: Optional[str] = None
    action: str
    target_type: str
    target_id: str
    details: Optional[Dict[str, Any]] = None
    created_at: datetime
    class Config:
        from_attributes = True

class AdminUserResponse(UserResponse):
    is_banned: Optional[bool] = False
    ban_reason: Optional[str] = None
    events_count: Optional[int] = 0
    class Config:
        from_attributes = True

class FeedbackCreate(BaseModel):
    type: str
    message: str
    name: Optional[str] = None
    email: Optional[str] = None

class AdminFeedbackResponse(BaseModel):
    id: int
    user_id: Optional[int] = None
    user_name: Optional[str] = None
    name: Optional[str] = None
    email: Optional[str] = None
    type: str
    message: str
    status: str
    created_at: datetime
    class Config:
        from_attributes = True
