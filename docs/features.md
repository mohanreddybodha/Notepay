---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Product Features & Application Workflows

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

This document describes the user flows, backend operations, and database states for each primary feature of Notepay.

---

## 📊 Event Dashboard

The central hub for users to view and navigate their events.

### 1. User Interface Flow
*   The dashboard is a Single Page Application (SPA) layout containing four tabs: **All Events**, **My Events** (where the user is the Organizer), **Shared Events** (where the user is a Collector), and **Visited Events** (Discovery history).
*   **Zero-Latency Initial Render**: On page load, `dashboard.js` loads the cached payload `np_dash_cache` from `localStorage` and renders the list immediately. 
*   **Background Refresh**: Once the Firebase auth session completes, the client requests `/users/me/full-dashboard` from the API, updates the UI, and overwrites the local cache.
*   **Live Status Indicator**: When the dashboard WebSocket connects successfully, the `#live-badge` element turns green, indicating the client is listening for real-time updates.

### 2. Backend & Database Operations
*   The endpoint `/users/me/full-dashboard` queries `crud.get_user_full_dashboard()`.
*   It aggregates:
    *   **Profile**: User's full name, phone number, and gender.
    *   **My Events**: Events where `organizer_id == user_id`.
    *   **Shared Events**: Events where the user is joined via `event_members` with `role == "Collector"`.
    *   **Watched Events**: Viewed public events.
*   **Performance Optimization**: To prevent N+1 query loops, the system fetches all membership records in a single query and aggregates data (contributions, expenses, and member counts) using SQL `GROUP BY` operations rather than Python loops.

#### 🛠️ Code Linkage & Implementation Reference
*   **Frontend Controller**: [frontend/dashboard.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/dashboard.html) (Client Script: `js/dashboard.js`)
*   **Router Endpoint**: [backend/routers/profile.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/profile.py) (Function: `get_user_full_dashboard()`)
*   **Database Query**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `get_user_full_dashboard()`, SQL Aggregations helper: `_build_event_aggregates()`)

---

## 🔑 Event Creation & Invite Codes

Allows organizers to create new events and invite collectors.

### 1. User Interface Flow
*   Clicking **Create Event** in the sidebar opens the creation form.
*   Users enter the event name, description, date, goal amount, and configure toggles (public portal toggle, show collections/expenses toggles).
*   On submission, the client calls `POST /events` and redirects to the new event detail page.

### 2. Backend & Database Operations
*   **Code Generation**: The API generates a unique, human-readable 14-character invite code:
    *   Generates a UUID hex: `4F8E9C2A1B7D3E...`
    *   Takes the first 14 characters, capitalizes them, and structures them: `4F8E9-C2A1-B7D3E`.
*   **Membership Setup**: The backend inserts the event row into the `events` table, sets `organizer_id`, and immediately adds a membership row in `event_members` with `role = UserRole.organizer`.
*   **Cache Management**: Bumps the global version in Redis, invalidating cached dashboards for the user.

#### 🛠️ Code Linkage & Implementation Reference
*   **Frontend View**: [frontend/create-event.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/create-event.html)
*   **Router Endpoint**: [backend/routers/events.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/events.py) (Function: `create_event()`)
*   **Database Query**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `create_event()`)

---

## 🤝 Join Event by Code

Allows collectors to join an existing event ledger.

### 1. User Interface Flow
*   Collectors go to the **Join by Code** page, enter a code, and submit.
*   **Preview Gateway**: Before joining, the client calls `/events/preview-code` to show the event name and organizer's name, allowing users to verify before joining.
*   On confirmation, the client joins the event and navigates to the event page.

### 2. Backend & Database Operations
*   The API checks if the invite code exists and if the event is active.
*   If valid, it inserts a row into `event_members` with `role = UserRole.collector`.
*   Bumps the global version in Redis. If the organizer is online, their dashboard updates in real-time, showing the new member.

#### 🛠️ Code Linkage & Implementation Reference
*   **Frontend View**: [frontend/join-event.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/join-event.html)
*   **Router Endpoints**: [backend/routers/events.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/events.py) (Functions: `preview_invite_code()`, `join_event()`)
*   **Database Query**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `join_event()`)

---

## 💸 Collections & Expenses

The core ledger tracking payments and spending.

### 1. User Interface Flow
*   Ledgers are presented in tables with support for custom columns.
*   **Optimistic Offline Writes**: If a collector logs a payment while offline, the client renders the transaction immediately with a negative ID. The actual API write is queued.
*   **Custom Fields**: Standard columns (Name, Amount, Date, Collector) are augmented with dynamic custom columns (e.g., "T-Shirt Size" or "Department").

### 2. Backend & Database Operations
*   **Contributions**: Written to the `contributions` table. Direct dashboard entries are set with `payment_received=True`. UPI receipt uploads are set with `payment_received=False` until verified.
*   **Expenses**: Written to the `expenses` table.
*   **Column Renaming (No Data Loss)**: When organizers rename custom columns, the backend migrates keys inside the `custom_fields` JSON column:
    ```python
    for item in items:
        if old_key in item.custom_fields:
            item.custom_fields[new_key] = item.custom_fields.pop(old_key)
    ```
    If columns are deleted, the keys are purged from all records.

#### 🛠️ Code Linkage & Implementation Reference
*   **Frontend View**: [frontend/event.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/event.html) (Script: `js/controllers/EventFinancialsController.js`)
*   **Router Endpoints**: [backend/routers/contributions_expenses.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/contributions_expenses.py) (Functions: `add_contribution()`, `add_expense()`, `update_event_columns()`)
*   **Database Queries**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Functions: `create_contribution()`, `create_expense()`, `_apply_custom_columns_update()`)

---

## 📊 Financial Summary

Real-time totals and transaction logs.

### 1. User Interface Flow
*   The **Summary** tab displays total collected, total expenses, remaining balance, and a progress bar showing progress toward the event goal.
*   It displays a combined timeline of the 50 most recent transactions.

### 2. Backend & Database Operations
*   Summary data is calculated in a single database query.
*   **SQL Aggregations**:
    *   `total_contributions`: `SUM(amount)` where `payment_received != False`.
    *   `total_to_collect`: `SUM(amount)` where `payment_received == False`.
    *   `total_expenses`: `SUM(amount)`.
*   **Chronological Merge**: Fetches the 50 most recent contributions and 50 most recent expenses, merges them, sorts them by date descending, and returns the top 50.
*   **Caching**: Results are cached in Redis under `sum:{event_id}`.

#### 🛠️ Code Linkage & Implementation Reference
*   **Router Endpoint**: [backend/routers/contributions_expenses.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/contributions_expenses.py) (Function: `get_event_summary()`)
*   **Database Query**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `get_event_summary()`)

---

## 💬 Real-Time Chat & AI Advisor

Communication channel with built-in AI assistance.

### 1. Chat Flow & Constraints
*   **Message Limit**: To prevent database bloat, events are capped at 250 chat messages.
*   **Probabilistic Cleanup**: To avoid running expensive `COUNT` queries on every message insertion, the backend runs a cleanup routine 10% of the time. If messages exceed 250, it bulk-deletes the oldest messages and updates their reply references to `None`.
*   **Soft Deletion**: Deleted messages are updated to `[DELETED]` and their reactions are cleared, preserving message layout stability.
*   **Read & Delivery Status**: Keeps track of message status:
    *   `delivered_to`: Array of user IDs who received the message.
    *   `read_by`: Array of user IDs who read the message.

### 2. AI Advisor Contextual Processing
*   Users can invoke the AI by typing `@ai` at the start of a message.
*   **Asynchronous Tasks**: FastAPI handles the AI request inside a `BackgroundTasks` thread, allowing the user's message to compile and display instantly.
*   **Context Assembly**: The background thread builds a context prompt:
    *   Injects event name, description, and goal.
    *   Aggregates the members list and roles.
    *   Injects lists of collections and expenses.
*   **AI Models**: Passes the prompt to Groq (Llama-3 models), falling back to Google Gemini 2.5 Flash if needed.
*   **Typing State**: Broadcasts `AI_TYPING` to display a typing indicator, and broadcasts `NEW_CHAT_MSG` once the response is ready.

#### 🛠️ Code Linkage & Implementation Reference
*   **Frontend Controller**: [frontend/event.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/event.html) (Script: `js/controllers/EventChatController.js`)
*   **Router Endpoint**: [backend/routers/chat.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/chat.py) (Function: `send_chat_message()`)
*   **AI Processing Background Task**: [backend/routers/chat.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/chat.py) (Function: `process_ai_chat()`)
*   **Probabilistic Cleanup & Insert**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `create_chat_message()`)

---

## 📸 UPI Receipts & AI Extraction

Automated UPI payment receipt verification.

### 1. User Upload Flow
*   Donors pay via UPI using the event QR code and upload a screenshot of the successful payment page.
*   **Pre-Check**: Validates that the file type is an image before reading the body.
*   **Parsing State**:
    *   **Success**: The AI extracts the payer name, payment amount, UPI receiver name, and transaction date. It validates that the receiver name matches the organizer's UPI name, creating a contribution with `payment_received=False` and broadcasting the event.
    *   **Partial Success**: If the payer's name is missing or the event requires custom columns, the AI cache-stores extraction data in Redis for 15 minutes, issuing a `receipt_session_id`. The user is prompted to enter their name or missing fields to complete the contribution.
    *   **Manual Fallback**: If the AI extraction fails, the image is saved to storage and the user is redirected to input all transaction details manually.

#### 🛠️ Code Linkage & Implementation Reference
*   **Frontend View**: [frontend/contribute.html](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/contribute.html)
*   **Router Endpoints**: [backend/routers/public.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/public.py) (Functions: `upload_receipt()`, `submit_manual_contribution()`)
*   **Receipt Parsing Methods**: [backend/routers/public.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/public.py) (Function: `extract_receipt_data_with_fallback()`)

---

## 👁️ Discovery History (Watched Events)

Tracks public events viewed by visitors.

### 1. Visual Flow
*   When a user clicks on an active public event link (e.g., a shared invitation portal) without joining as a collector, the system registers them as a Visitor.
*   The event is added to the user's **Discovery** history tab.
*   Users can delete items from this list to remove them from their view.

### 2. Backend Operations
*   If a user views `/events/{event_id}` and is not an organizer or collector, the API calls `crud.add_watched_event()`.
*   It adds a record to the `watched_events` table and updates `last_viewed_at` if the record already exists.
*   The database filters out events that the user has subsequently joined as an active collector or organizer, keeping lists clean.

#### 🛠️ Code Linkage & Implementation Reference
*   **Router Endpoint**: [backend/routers/events.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/routers/events.py) (Function: `get_event()`)
*   **Database Queries**: [backend/crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) (Function: `add_watched_event()`, `remove_watched_event()`)

---

## 🔗 Related Documentation
*   👉 **[System Architecture Guide](architecture.md)**
*   👉 **[API Endpoint Reference Guide](api.md)**
*   👉 **[Visual Feature Workflows Index](README.md#📂-documentation-directory)**
