# NotePay API — Security Features Documentation

## New Security Features (v1.0.0)

### 1. OTP Rate Limiting (Client-Side & Server-Side)

#### Frontend Implementation
**File**: `frontend/login.html`

Tracks failed OTP verification attempts with localStorage:
```javascript
const MAX_OTP_ATTEMPTS = 5; // Maximum allowed attempts

// Tracks failed attempts
let otpAttempts = 0;

// Stored in localStorage for persistence
localStorage.setItem("np_otp_attempts", otpAttempts.toString());
```

**User Experience**:
1. User enters OTP
2. If wrong: counter increments, warning shown
3. At 5 failed attempts: "Too many failed attempts" message
4. User must request new OTP via resend
5. Resend resets counter to 0

**Error Messages**:
```
Attempt 1-3: "Invalid OTP. Please check and try again."
Attempt 4: "Invalid OTP. (1 attempt remaining)"
Attempt 5: "Too many failed attempts. Please request a new OTP."
```

---

### 2. Event Join Rate Limiting (Backend)

#### Endpoint
```
POST /events/join?invite_code=ABC12345
```

#### Rate Limiting Rules
- **Max 50 joins per user per hour**
- **Time window: 3600 seconds**
- **Returns 429 Too Many Requests if exceeded**

#### Implementation
```python
# Backend: main.py
if cache and cache.is_join_rate_limited(user_id, max_attempts=50):
    raise HTTPException(
        status_code=429, 
        detail="Too many join attempts. Please try again later."
    )

# Cache: cache.py
def increment_join_attempts(user_id: int, window_seconds: int = 3600) -> int
def is_join_rate_limited(user_id: int, max_attempts: int = 50) -> bool
```

#### Security Purpose
- **IDOR Prevention**: Prevents attackers from brute-forcing event codes
- **DoS Protection**: Prevents abuse of join endpoint
- **Fair Usage**: Ensures fair access for all users

---

### 3. Restricted Member Authorization

#### Problem
Previously, if an organizer was restricted, they could still access event data via their role.

#### Solution
Implemented a **priority-based authorization system**:

```
Authorization Check Order:
1. Is user a member? → if not, deny access
2. Is user restricted? → if yes, deny ALL access (priority)
3. What is user's role? → allow based on organizer/collector role
```

#### API: Restrict Member

**Endpoint**:
```
PUT /events/{event_id}/members/{target_user_id}/restrict
```

**Request**: (empty body)

**Response**:
```json
{
  "id": 123,
  "user_id": 456,
  "event_id": 789,
  "role": "Collector",  // Automatically demoted
  "joined_at": "2024-05-16T10:30:00",
  "is_restricted": true,
  "restricted_at": "2024-05-16T14:45:00"
}
```

**Behavior**:
1. If target is organizer → automatically demoted to collector
2. is_restricted set to true
3. restricted_at timestamp recorded
4. Cannot be undone by unrestricting and promoting again
5. All access blocked immediately

#### API: Unrestrict Member

**Endpoint**:
```
PUT /events/{event_id}/members/{target_user_id}/unrestrict
```

**Response**: EventMemberResponse with `is_restricted: false`

**Behavior**:
1. is_restricted set to false
2. restricted_at cleared
3. User regains access (based on their role)
4. Must have been organizer before restriction to be promoted again

---

### 4. Role Update with Restriction Check

#### Endpoint
```
PUT /events/{event_id}/members/{target_user_id}/role
```

#### Request Body
```json
{
  "role": "Organizer"  // or "Collector"
}
```

#### New Security Check
```python
# SECURITY: Prevent promoting restricted members
if target_member.is_restricted and data.role == models.UserRole.organizer:
    raise HTTPException(
        status_code=403,
        detail="Cannot promote a restricted member to organizer. "
               "The member must be unrestricted first."
    )
```

**Validation Logic**:
- ✓ Can promote unrestricted collectors to organizer
- ✓ Can demote organizers to collectors (even if restricted)
- ✗ Cannot promote restricted members to organizer
- ✗ Cannot promote/demote original event creator

#### Error Responses
```
403: "Cannot promote a restricted member to organizer. 
       The member must be unrestricted first."

403: "The original creator's role cannot be changed."

404: "Member not found"
```

---

### 5. Input Validation & Sanitization

### Event Creation

**Endpoint**: `POST /events`

**Request Validation**:
```json
{
  "name": "string (1-200 chars, required)",
  "description": "string (0-2000 chars)",
  "event_date": "datetime (must be future)",
  "is_public": "boolean",
  "show_donations": "boolean",
  "show_expenses": "boolean"
}
```

**Validation Rules**:
```python
if not event.name or len(event.name.strip()) == 0:
    raise HTTPException(400, "Event name cannot be empty")

if len(event.name) > 200:
    raise HTTPException(400, "Event name is too long (max 200 chars)")

if event.description and len(event.description) > 2000:
    raise HTTPException(400, "Description is too long (max 2000 chars)")

if event.event_date < datetime.utcnow():
    raise HTTPException(400, "Event date must be in the future")
```

### Donation Creation

**Endpoint**: `POST /events/{event_id}/donations`

**Request Validation**:
```json
{
  "donor_name": "string (1-200 chars, required)",
  "amount": "number (0-10000000, optional)",
  "custom_fields": "object (optional)"
}
```

**Validation Rules**:
```python
if not donation.donor_name or len(donation.donor_name.strip()) == 0:
    raise HTTPException(400, "Donor name cannot be empty")

if len(donation.donor_name) > 200:
    raise HTTPException(400, "Donor name is too long (max 200 chars)")

if donation.amount < 0:
    raise HTTPException(400, "Amount cannot be negative")

if donation.amount > 10000000:
    raise HTTPException(400, "Amount exceeds maximum limit (10M)")
```

### Expense Creation

**Endpoint**: `POST /events/{event_id}/expenses`

**Request Validation**:
```json
{
  "description": "string (1-500 chars, required)",
  "amount": "number (0-10000000, optional)",
  "custom_fields": "object (optional)"
}
```

**Validation Rules**: Similar to donations

### Event Join

**Endpoint**: `POST /events/join`

**Query Parameter**: `invite_code=string`

**Validation**:
```python
if not invite_code or len(invite_code) > 20:
    raise HTTPException(400, "Invalid invite code format")

# Only alphanumeric characters allowed
import string
valid_chars = set(string.ascii_letters + string.digits + '-_')
if not all(c in valid_chars for c in invite_code):
    raise HTTPException(400, "Invalid invite code format")
```

---

### 6. API Error Codes (Enhanced)

| Code | Meaning | Cause |
|------|---------|-------|
| 400 | Bad Request | Invalid input format/validation failed |
| 401 | Unauthorized | Missing/invalid authentication token |
| 403 | Forbidden | Insufficient permissions or access denied |
| 404 | Not Found | Resource doesn't exist |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Server Error | Unexpected server error |

---

### 7. Security Headers

All responses include:
```
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: max-age=31536000
Referrer-Policy: strict-origin-when-cross-origin
Content-Security-Policy: default-src 'self'; ...
```

---

### 8. Event Access Control

#### Membership Rules

**Not a member**:
- Cannot access event data
- Cannot join unless code is shared
- Cannot see member list
- Can only view if event is public

**Member (Collector)**:
- Can read event data
- Can add donations/expenses
- Can edit own donations/expenses
- Cannot manage members
- Cannot edit event settings

**Organizer**:
- Full access
- Can manage members
- Can edit event settings
- Can deactivate/reactivate event
- Can view all member details

**Restricted Member** (regardless of role):
- ✗ Cannot access event data
- ✗ Cannot add/edit donations/expenses
- ✗ Cannot send chat messages
- ✗ Cannot view members
- ✓ Can see event in "Shared Events"
- ✓ Can see restriction message

---

### 9. Event Visibility

#### "My Events" Tab
- Shows all events where user is organizer
- Excludes restricted events (even if organizer)
- Includes active and inactive events

#### "Shared Events" Tab
- Shows all events where user is collector
- Includes restricted events with locked icon
- Includes both active and inactive events

#### "Discover" Tab
- Shows public events user has viewed
- Excludes events user is member of
- Click to add to watched history

---

### 10. WebSocket Security

**Connection Authentication**:
```json
First message must be:
{
  "type": "AUTH",
  "token": "firebase_id_token"
}
```

**Security Checks**:
- Token verified against Firebase
- User membership verified
- Restricted members disconnected after auth
- Invalid tokens result in connection close

**Broadcast Rules**:
- Only members receive DATA_CHANGED updates
- Restricted members see updates but cannot act
- Organizers see all member changes

---

### 11. Caching Strategy

#### Cached Data
- **User profiles**: 1 hour
- **Event details**: 30 minutes
- **Donations/Expenses**: 5 minutes
- **Verified tokens**: 10 minutes

#### Cache Invalidation
```
When modified:
- Event member list
- Event settings
- Donation/Expense created/updated/deleted
- Member restricted/unrestricted
- Member role changed

Action:
- Clear event-specific cache
- Bump global dashboard version
- WebSocket broadcasts DATA_CHANGED
```

#### Cache Miss
- Falls back to database query
- Result cached for next request
- No data loss, just slower first request

---

### 12. Monitoring & Logging

#### Logged Events
```
[INFO] User 123 joined event 456
[INFO] User 123 restricted in event 456
[INFO] User 123 promoted to organizer in event 456
[WARN] Rate limit exceeded: 50 joins from user 123
[ERROR] Authorization failed: User 123 cannot access event 456
```

#### Access Log Format
```
2024-05-16 14:32:00 | 192.168.1.100 | POST /events/join | 200
2024-05-16 14:32:45 | 192.168.1.100 | GET /events/456/donations | 200
2024-05-16 14:33:12 | 192.168.1.100 | PUT /events/456/members/789/restrict | 200
2024-05-16 14:33:15 | 192.168.1.100 | GET /events/456 | 403
```

---

### 13. Testing Endpoints

#### Health Check
```
GET /health

Response:
{
  "status": "healthy",
  "version": "1.0.0",
  "timestamp": "2024-05-16T14:30:00"
}
```

#### API Version
```
GET /api/version

Response:
{
  "version": "1.0.0",
  "name": "NotePay API",
  "environment": "production",
  "build_date": "2024-05-16T14:30:00"
}
```

---

### 14. Migration from Old System

If upgrading from older version:

```sql
-- Ensure is_restricted column exists
ALTER TABLE event_members ADD COLUMN is_restricted BOOLEAN DEFAULT FALSE;
ALTER TABLE event_members ADD COLUMN restricted_at TIMESTAMP;

-- No data migration needed (all users start as unrestricted)
```

---

### 15. Future Enhancements

- [ ] Two-factor authentication
- [ ] Biometric login support
- [ ] IP whitelisting per event
- [ ] Audit log export
- [ ] Role templates
- [ ] Time-based member access
- [ ] Integration with identity providers
- [ ] Advanced rate limiting (per endpoint)

---

**Last Updated**: May 16, 2024
**Version**: 1.0.0
**Status**: Production Ready
