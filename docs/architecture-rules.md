---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Notepay Engineering Handbook & Architecture Constraints

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

This handbook establishes the core engineering constraints and architecture rules for the Notepay project. All future modifications, new features, and contributions must follow these guidelines.

---

## 🛠️ Core Engineering Principles

### 1. Don't Repeat Yourself (DRY)
*   **Business Logic**: Core calculations (like transaction aggregations or permissions checks) must not be duplicated. If logic is needed in multiple locations, extract it to a shared helper function in [crud.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/crud.py) or [dependencies.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/dependencies.py).
*   **Frontend Helpers**: Do not write ad-hoc date or currency formatting code in page controllers. Use the central formatting wrappers (`formatINR`, `formatDate`) in [shared-utils.js](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/js/shared-utils.js).

### 2. Component Decoupling
*   **API Layer**: Route files inside `/routers` are only responsible for handling HTTP parameters, checking rate limits, and enforcing permissions. They must not contain direct database queries or business logic.
*   **Frontend Views**: HTML templates must remain thin. All complex interactive logic and API call dispatches must be handled by JS controllers (such as `EventFinancialsController.js`).

### 3. Database Integrity & Performance
*   **Eager Loading**: Never perform database queries inside loops (the N+1 query problem). Use SQLAlchemy's `joinedload` option or write aggregated SQL queries using `GROUP BY`.
*   **Indexes**: Every foreign key column or column frequently used in `WHERE`, `ORDER BY`, or `JOIN` operations must have a database index configured in [models.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/models.py).
*   **Input Sanitization**: All user-submitted text saved to the database must be sanitized recursively using the bleach-equivalent HTML sanitizer in `crud.py` to prevent stored XSS attacks.

### 4. API Stability & Documentation
*   **Backward Compatibility**: When updating API routes, do not rename or remove existing JSON fields. If a breaking change is unavoidable, increment the API version prefix (e.g. `/api/v2`).
*   **Sync Documentation**: Every new API endpoint, database column, or frontend view must be documented in the corresponding Markdown files in `/docs` before submitting a pull request.

---

## ⚙️ Pull Request Standards

Before submitting a PR for review:
1.  Verify that all database migrations are generated and applied via Alembic:
    ```bash
    alembic revision --autogenerate -m "description"
    alembic upgrade head
    ```
2.  Run the smoke testing suite locally to confirm there are no failures:
    ```bash
    pytest backend/tests/test_smoke.py
    ```
3.  Add the **"Last Verified"** metadata block to the top of any documentation page you modified, updating the `commit_sha` to match the target HEAD commit.
