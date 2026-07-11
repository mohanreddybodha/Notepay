---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Coding Standards & Architecture Guidelines

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Architecture Enforcement**: [docs/architecture-rules.md](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/architecture-rules.md)
*   **PR Contributions**: [CONTRIBUTING.md](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/CONTRIBUTING.md)

---

## 🏷️ Naming Conventions

### 1. Backend (Python Standards)
*   **Functions & Variables**: Enforces PEP 8 style using `snake_case` (e.g., `get_user_by_phone`, `is_banned`).
*   **Classes (Models & Schemas)**: Uses `PascalCase` (e.g., `EventMember`, `ContributionCreate`).
*   **Constants**: Uses uppercase `SNAKE_CASE` (e.g., `RECENT_TXN_LIMIT`, `SQLALCHEMY_DATABASE_URL`).
*   **API Route Paths**: Lowercase `snake_case` or hyphenated segments (e.g., `/events/{event_id}/full-details`).

### 2. Frontend (JavaScript & HTML)
*   **JavaScript Functions & Variables**: Enforces `camelCase` (e.g., `syncOfflineQueue`, `currentTab`).
*   **Custom Web Components**: Custom tags must contain a hyphen and use lowercase `kebab-case` (e.g., `<np-sidebar>`).
*   **CSS Classes & IDs**: Uses lowercase `kebab-case` (e.g., `.live-badge`, `#circle-spinner`).
*   **HTML Attribute bindings**: Lowercase `kebab-case` (e.g., `active-tab`, `active-link`).

---

## 📂 Project Organization & Folders

Maintain a clear separation between backend logic and frontend templates:
*   **`backend/`**: Contains all FastAPI, Database, and Python code.
    *   **`backend/routers/`**: Group API routes logically by resource (e.g., chat operations go in `chat.py`, admin panel routes in `admin.py`).
    *   **`backend/tests/`**: All backend test suites.
*   **`frontend/`**: Contains all static layout files.
    *   **`frontend/js/`**: Client scripts.
    *   **`frontend/js/controllers/`**: Page layout controllers (e.g., `EventFinancialsController.js`).
    *   **`frontend/css/`**: Styling stylesheets.

---

## ⚙️ Backend Architecture Rules

### 1. Data Access Isolation (CRUD Layer)
*   Do not write direct database SQL operations or ORM queries inside router files. 
*   All queries, updates, and deletes must reside in [crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) as the single data access layer, keeping router scripts lightweight.

### 2. No N+1 Query Loops (Performance)
*   Never write database query calls inside Python iteration loops (such as calling a query for each event in a list).
*   **Eager Loading**: Use SQLAlchemy's `joinedload()` option to fetch nested entities (e.g., loading user profiles for event member lists in a single join query).
*   **SQL Aggregations**: Calculate sums, averages, and counts inside the database engine using `SUM`, `COUNT`, and `GROUP BY` SQL statements. Do not fetch records into memory to calculate aggregates in Python.

### 3. Schema Schema Contracts
*   Every route input payload and output response must utilize Pydantic schemas defined in [schemas.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/schemas.py).
*   Ensure that internal database columns (like password hashes or system tokens) are excluded from public responses.

### 4. Input Sanitization (stored XSS check)
*   All user inputs saved to the database (especially custom fields, descriptions, and user names) must be run through `crud.sanitize_json_payload(data)` before committing. This cleans the input using `bleach` to strip out script tags.

---

## ⚡ Frontend Architecture Rules

### 1. Framework Restrictions
*   **No Frameworks**: Do not introduce frameworks like React, Angular, Svelte, or Vue unless explicitly requested. All changes must use Vanilla JS.
*   **Web Components**: Reusable UI elements must be defined as Custom Web Components in [components.js](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/js/components.js).

### 2. Decoupled Route Helpers
*   Never hardcode file names like `dashboard.html` or `/dashboard` directly in navigation bindings. 
*   Always use `buildUrl(page, ...segments)` in [shared-utils.js](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/js/shared-utils.js) to resolve paths, ensuring the URL resolves correctly in both local development environments and production.

### 3. Local Formatting Wrappers
*   To format dates, numbers, and currencies, use the shared helper functions defined in `NPUtils` (e.g., `formatINR(amount)`, `formatDate(date)`). Do not write custom formatting logic inside page controllers.

### 4. Offline Writes Check
*   If performing a write operation (POST, PUT, DELETE), check network connectivity:
    ```javascript
    if (!navigator.onLine) {
        return handleOfflineWrite(method, path, body);
    }
    ```
    This queues the action in `localStorage` and triggers optimistic UI updates immediately, rather than throwing network errors.
