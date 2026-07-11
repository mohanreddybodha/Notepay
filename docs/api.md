---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# API Endpoint Reference

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Implementation Routers**: [backend/routers/](../backend/routers) (`profile.py`, `events.py`, `contributions_expenses.py`, `chat.py`, `public.py`, `admin.py`)
*   **Validation Schemas**: [backend/schemas.py](../backend/schemas.py)
*   **Auth & Roles Guards**: [backend/dependencies.py](../backend/dependencies.py)

---

## 🔑 Global API Protocol

All endpoints expect and return payloads according to these rules:
*   **Base URL**: `http://localhost:8000` (Local Dev) or AWS API Gateway URI (Production).
*   **Headers**:
    *   `Content-Type: application/json` (Required for request bodies).
    *   `Authorization: Bearer <JWT_TOKEN>` (Required for all protected endpoints).
*   **Authentication Gates**:
    *   **User Auth**: Cryptographically verified Firebase ID token.
    *   **Admin Auth**: Custom administrative JWT (issued via login).
*   **Common Error Responses**:
    *   `401 Unauthorized`: Token missing, expired, or invalid.
    *   `403 Forbidden`: Insufficient permissions (e.g., restricted member or collector attempting organizer actions).
    *   `404 Not Found`: Resource (user, event, transaction) does not exist.
    *   `422 Unprocessable Entity`: Input validation failure (failed Pydantic rules).
    *   `429 Too Many Requests`: Rate limit ceiling hit.

---

## 1. Authentication & Profile Endpoints

### Register User
*   **Path**: `POST /users`
*   **Auth Scope**: Verified Firebase session token (Bearer).
*   **Rate Limit**: 5 attempts per phone number per hour.
*   **Request Schema (`UserRegisterInput`)**:
    ```json
    {
      "phone_number": "+919876543210",
      "full_name": "John Doe",
      "gender": "Male" // "Male", "Female", or "Prefer not to say"
    }
    ```
*   **Responses**:
    *   `200 OK`: Returns created/existing `UserResponse`.
    *   `400 Bad Request`: Phone number registered to another account.

### Logout User
*   **Path**: `POST /auth/logout`
*   **Auth Scope**: Active Bearer Token.
*   **Description**: Invalidates the current JWT token hash in the Redis cache immediately to prevent session reuse.

### Fetch Own Profile
*   **Path**: `GET /users/me`
*   **Auth Scope**: Active User.
*   **Response Schema (`UserResponse`)**:
    ```json
    {
      "id": 12,
      "phone_number": "+919876543210",
      "full_name": "John Doe",
      "gender": "Male",
      "created_at": "2026-07-10T12:00:00Z"
    }
    ```

### Update Own Profile
*   **Path**: `PUT /users/me`
*   **Auth Scope**: Active User.
*   **Rate Limit**: 5 updates per 60 seconds.
*   **Request Schema (`UserUpdate`)**: All fields are optional.
    ```json
    {
      "full_name": "Johnathan Doe",
      "gender": "Prefer not to say"
    }
    ```

### Submit Feedback
*   **Path**: `POST /feedback`
*   **Auth Scope**: Open (Optional Auth).
*   **Rate Limit**: 3 submissions per hour.
*   **Request Schema (`FeedbackCreate`)**:
    ```json
    {
      "type": "bug", // "bug", "feature", "security", "general"
      "message": "Encountered a problem during receipt upload.",
      "name": "Jane Doe", // Required if unauthenticated guest
      "email": "jane@example.com" // Required if unauthenticated guest
    }
    ```

---

## 2. Event Lifecycle Endpoints

### Create Event
*   **Path**: `POST /events`
*   **Auth Scope**: Active User.
*   **Rate Limit**: 5 creations per 60 seconds.
*   **Request Schema (`EventCreate`)**:
    ```json
    {
      "name": "Annual Picnic",
      "description": "Shared costs for food and transport",
      "event_date": "2026-08-15T10:00:00Z",
      "is_public": false,
      "show_contributions": true,
      "show_expenses": true,
      "goal_amount": 15000
    }
    ```
*   **Response**: `EventResponse` including generated hex `invite_code` (e.g. `ABCDE-FGHI-JKLMN`).

### Fetch Full Dashboard
*   **Path**: `GET /users/me/full-dashboard`
*   **Auth Scope**: Active User.
*   **Response Schema (`UserFullDashboardResponse`)**: Returns user profile, organizer events list, shared collector events list, and watched discovery events list in a single cached query.

### Preview Invite Code
*   **Path**: `GET /events/preview-code?invite_code={code}`
*   **Auth Scope**: Active User.
*   **Rate Limit**: 100 previews per 60 seconds.
*   **Responses**:
    *   `200 OK`: `{ "id": "event_id", "name": "Event Name", "organizer_name": "Alice", "is_active": true }`
    *   `404 Not Found`: Invalid invite code.

### Join Event by Code
*   **Path**: `POST /events/join?invite_code={code}`
*   **Auth Scope**: Active User.
*   **Rate Limit**: 5 joins per 60 seconds.
*   **Responses**:
    *   `200 OK`: Successful join confirmation.
    *   `403 Forbidden`: Joining is blocked because the event is deactivated.

### Update Event Settings
*   **Path**: `PUT /events/{event_id}`
*   **Auth Scope**: Organizer.
*   **Request Schema (`EventUpdate`)**: All fields optional. Includes `column_renames` map to migrate dynamic fields.
    ```json
    {
      "name": "Updated Picnic",
      "contribution_custom_columns": [{"n": "T-Shirt", "t": "text", "reqByDonor": true}],
      "column_renames": {"Old Size": "T-Shirt"}
    }
    ```

### Delete Event
*   **Path**: `DELETE /events/{event_id}`
*   **Auth Scope**: Organizer.
*   **Description**: Permanently wipes the event and all associated contributions, expenses, chat logs, and memberships from the database.

### Toggle Event Status (Deactivate / Reactivate)
*   **Path**: `PUT /events/{event_id}/deactivate` (or `/reactivate`)
*   **Auth Scope**: Organizer.
*   **Description**: Locking event prevents collectors from writing, while preserving organizer read/write operations.

---

## 3. Financial Transaction Endpoints

### Fetch Ledgers
*   **Paths**: `GET /events/{event_id}/contributions` and `GET /events/{event_id}/expenses`
*   **Auth Scope**: Organizer / Collector / Public Visitor (Read-only if event is public).

### Add Contribution Entry
*   **Path**: `POST /events/{event_id}/contributions`
*   **Auth Scope**: Organizer / Collector.
*   **Request Schema (`ContributionCreate`)**:
    ```json
    {
      "donor_name": "Jane Smith",
      "amount": 2500.00,
      "payment_received": true,
      "custom_fields": {
        "T-Shirt": "Medium"
      }
    }
    ```

### Update Transaction Row
*   **Path**: `PUT /events/{event_id}/contributions/{contribution_id}` (same for `/expenses/{expense_id}`)
*   **Auth Scope**: Organizer (any entry) / Collector (only their own entries).
*   **Rule**: Blocked if the event is deactivated or the collector is restricted.

---

## 4. Real-Time Chat Endpoints

### Fetch Chat History
*   **Path**: `GET /events/{event_id}/chat`
*   **Query Params**: `limit` (default 50), `before_id` (used for scroll-up cursor pagination).
*   **Auth Scope**: Organizer / Collector.

### Send Chat Message
*   **Path**: `POST /events/{event_id}/chat`
*   **Auth Scope**: Organizer / Unrestricted Collector.
*   **Request Schema (`ChatMessageCreate`)**:
    ```json
    {
      "message": "@ai What is the remaining budget?",
      "reply_to_id": 142, // optional
      "idempotency_key": "unique-uuid-client-generated" // prevents double sending
    }
    ```

### React to Message
*   **Path**: `POST /events/{event_id}/chat/{message_id}/react`
*   **Request Schema**: `{"emoji": "👍"}`
*   **Description**: Toggles user emoji reaction. Length restricted to prevent spam.

---

## 5. Public Portal Endpoints

### Retrieve Public Event Profile
*   **Path**: `GET /api/public/event/{event_id}`
*   **Auth Scope**: Unauthenticated (Guest portal view).
*   **Description**: Fetches basic profile, UPI ID, and receiver name. Required for guest contribution page rendering.

### Upload Receipt Screenshot
*   **Path**: `POST /api/public/event/{event_id}/upload_receipt`
*   **Content-Type**: `multipart/form-data`
*   **Payload**: File parameter `file` (image).
*   **AI Validation Logic**: Analyzes UPI receipt. If receiver name matches registered event UPI owner, logs the entry.
*   **Responses**:
    *   `200 OK (Success)`: Contribution logged (`payment_received=False`).
    *   `200 OK (Partial Success)`: Receipt valid, returns a `receipt_session_id` and prompts user for missing donor name or custom fields.
    *   `200 OK (Extraction Failed)`: Image valid but parsing failed, returns fallback `receipt_session_id`.

### Submit Manual Contribution (with fallback session)
*   **Path**: `POST /api/public/event/{event_id}/submit_manual_contribution`
*   **Request Schema (`ManualContributionEntry`)**:
    ```json
    {
      "donor_name": "Boda Mohan Reddy",
      "amount": 100.00,
      "receipt_session_id": "cached-session-uuid", // optional, matches image
      "custom_fields": {}
    }
    ```

---

## 6. Administration Endpoints (Admin JWT Protected)

### Admin Login
*   **Path**: `POST /api/v1/admin/login`
*   **Rate Limit**: 3 failures blocks IP for 5 hours.
*   **Request Form**: URL encoded fields `username` (email) and `password`.
*   **Response**: `{"access_token": "...", "token_type": "bearer", "role": "admin"}`

### Ban User
*   **Path**: `POST /api/v1/admin/users/{user_id}/ban`
*   **Request Schema**: `{"reason": "Violated terms of service."}`
*   **Effect**: Instantly revokes profile access. Banned users hit a 403 error on all calls.
