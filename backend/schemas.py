from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
from models import GenderEnum, UserRole

# ── What the client sends when registering (firebase_uid comes from the JWT token)
class UserRegisterInput(BaseModel):
    phone_number: str
    full_name: str
    gender: GenderEnum

# ── Internal-only schema used by CRUD (never exposed in API routes directly)
class UserCreate(BaseModel):
    firebase_uid: str
    phone_number: str
    full_name: str
    gender: GenderEnum

# ── Public response — firebase_uid deliberately excluded
class UserResponse(BaseModel):
    id: int
    phone_number: str
    full_name: str
    gender: GenderEnum
    created_at: datetime
    class Config:
        from_attributes = True

class EventCreate(BaseModel):
    name: str
    description: str
    event_date: datetime

class EventResponse(EventCreate):
    id: int
    invite_code: str
    is_active: bool
    organizer_id: int
    created_at: datetime
    my_role: Optional[UserRole] = None
    is_restricted: bool = False
    donation_custom_columns: List[Any] = []
    expense_custom_columns: List[Any] = []
    class Config:
        from_attributes = True

class DonationCreate(BaseModel):
    donor_name: str
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None

class DonationResponse(DonationCreate):
    id: int
    event_id: int
    collected_by: int
    collected_by_name: str
    collected_at: datetime
    class Config:
        from_attributes = True

class ExpenseCreate(BaseModel):
    description: str
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None

class ExpenseResponse(ExpenseCreate):
    id: int
    event_id: int
    collected_by: int
    collected_by_name: str
    collected_at: datetime
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

class RecentTransaction(BaseModel):
    id: int
    type: str  # 'donation' or 'expense'
    title: str # donor_name or expense description
    amount: float
    date: datetime
    collected_by_name: str

class EventSummaryResponse(BaseModel):
    total_donations: float
    total_expenses: float
    balance: float
    donations_count: int
    expenses_count: int
    recent_transactions: List[RecentTransaction] = []

# ── UPDATE (PUT) SCHEMAS ──
class UserUpdate(BaseModel):
    full_name: Optional[str] = None
    gender: Optional[GenderEnum] = None

class EventUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    event_date: Optional[datetime] = None
    donation_custom_columns: Optional[List[Any]] = None
    expense_custom_columns: Optional[List[Any]] = None

class DonationUpdate(BaseModel):
    donor_name: Optional[str] = None
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None

class ExpenseUpdate(BaseModel):
    description: Optional[str] = None
    amount: Optional[float] = None
    custom_fields: Optional[Dict[str, Any]] = None


class MemberRoleUpdate(BaseModel):
    role: UserRole
    custom_fields: Optional[Dict[str, Any]] = None
