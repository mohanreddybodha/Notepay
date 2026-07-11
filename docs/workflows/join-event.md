---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Workflow: Join Event by Code

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Frontend Action**: [frontend/join-event.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/join-event.html) (Script: `js/join-event.js`)
*   **FastAPI Router Endpoints**: [backend/routers/events.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/events.py) (Functions: `preview_invite_code()`, `join_event()`)
*   **Database CRUD Layer**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `join_event()`)
*   **WebSocket Broadcast Trigger**: [backend/ws_manager.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/ws_manager.py) (Functions: `broadcast_change()`, `broadcast_dashboard_update()`)

---

## 🔄 Execution Sequence Diagram

```mermaid
sequenceDiagram
    autonumber
    actor Collector as Event Collector
    participant FE as Frontend Dashboard
    participant API as FastAPI Backend
    participant DB as SQLite / Neon DB
    participant WS as WebSocket Manager

    Collector->>FE: Enters Code & Clicks "Verify"
    FE->>API: GET /events/preview-code?invite_code=ABCDE-FGHI-JKLMN
    Note over API: Dependency: get_current_user_id (verified via Firebase)
    API->>DB: SELECT event name, organizer_name by code
    DB-->>API: Returns details
    API-->>FE: Return details JSON (200 OK)
    FE->>FE: Renders Event Preview (Name, Organizer)
    Collector->>FE: Clicks "Confirm Join"
    FE->>API: POST /events/join?invite_code=ABCDE-FGHI-JKLMN
    API->>DB: SELECT event (checks is_active)
    API->>DB: INSERT INTO event_members (user_id, event_id, role='Collector')
    DB-->>API: Commits transactions & returns model
    API->>WS: Trigger broadcast_change(event_id, {"type": "DATA_CHANGED"})
    API->>WS: Trigger broadcast_dashboard_update()
    WS-->>FE: Push live WebSocket updates
    API-->>FE: Return HTTP 200 (Success)
    FE->>FE: Redirects to /event/{event_id}
```

---

## 🛠️ Detailed Component Actions

### 1. User Interaction (Frontend)
*   The collector clicks **Join by Code** in the sidebar (or navigates to `/join`).
*   The collector enters the invite code (e.g. `ABCDE-FGHI-JKLMN`) and clicks verify.
*   The page controller [join-event.js](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/join-event.html) calls `previewEventCode()`.
*   Once validated, the user clicks **Confirm Join**, triggering `joinEvent()`.

### 2. API Routing (Backend)
*   **Preview Code**: Resolves at `GET /events/preview-code`. Enforces a rate limit of 100 previews per minute to prevent brute-force attacks.
*   **Join Route**: Resolves at `POST /events/join`. Enforces a rate limit of 5 joins per minute.

### 3. Database Mutations (CRUD)
*   The method `join_event()` inside [crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py):
    1.  Queries the `events` table to find the record matching the `invite_code`.
    2.  Verifies the event is active. If deactivated, it returns an HTTP 403 error.
    3.  Checks the `event_members` table to see if the user is already joined.
    4.  If not joined, it inserts a new membership row with `role = UserRole.collector`.
    5.  Commits the database transaction.

### 4. Cache & WebSocket Sync
*   **Cache Invalidation**: The backend calls `cache.cache.invalidate_event(event_id)` and bumps the global dashboard version in Redis.
*   **Live Notifications**:
    *   Broadcasts `DATA_CHANGED` to the event channel, notifying the organizer and other active collectors that a new member has joined.
    *   Broadcasts `DASHBOARD_UPDATE` to update the event counts in members' sidebars.
*   The browser redirects the collector to the event's detailed page `/event/{event_id}`.
