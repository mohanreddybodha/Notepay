---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Software Testing & Quality Assurance Standards

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Pytest Smoke Testing Suite**: [backend/tests/test_smoke.py](../backend/tests/test_smoke.py)
*   **Offline Synchronization Client Logic**: [frontend/js/api.js](../frontend/js/api.js) (Function: `syncOfflineQueue()`)

---

## 🐍 Backend Testing (Python & Pytest)

Backend testing uses **Pytest** and the **FastAPI TestClient** to run integration tests against a mock SQLite database.

### 1. Test Environment Setup
The smoke testing suite in [test_smoke.py](../backend/tests/test_smoke.py) overrides the default database connection:
```python
# Force in-memory SQLite for tests to isolate them from development databases
os.environ.setdefault("DATABASE_URL", "sqlite:///./test_notepay.db")
os.environ.setdefault("ENVIRONMENT", "test")
```
*   **Fixture Isolation**: The `setup_db` fixture runs `Base.metadata.create_all` before the test session, and deletes the temporary `test_notepay.db` file after tests complete.
*   **Auth Dependency Override**: To test authenticated routes without calling Firebase servers, tests override the `get_current_user_id` and `get_optional_current_user_id` dependencies:
    ```python
    main.app.dependency_overrides[get_current_user_id] = lambda: 1
    ```
    This returns a mock user ID of `1`, allowing tests to focus on router logic and database operations.

### 2. How to Run Backend Tests
1.  Navigate to the `/backend` folder:
    ```bash
    cd backend
    ```
2.  Install development dependencies:
    ```bash
    pip install pytest pytest-cov
    ```
3.  Execute the testing suite:
    ```bash
    pytest tests/test_smoke.py -v
    ```

---

## 🌐 Frontend Testing (Manual & E2E Validation)

Since the frontend does not use heavy frameworks, tests focus on manual verification and simulating different network environments.

### 1. Local Routing Verification
Ensure that routing maps are functioning correctly:
1.  Launch the local dev server using `python serve_frontend.py`.
2.  Open your browser and navigate to `http://localhost:3000/dashboard` directly (verifying that the server resolves the clean URL).
3.  Click through sidebar navigation links to verify that page transitions occur without throwing 404 errors.

### 2. Offline Sync Verification
To test the offline queuing system:
1.  Open the application in your browser, log in, and navigate to an event details page.
2.  Open your browser's Developer Tools (F12) > Network tab, and toggle the connection to **Offline**.
3.  Attempt to log a contribution transaction.
4.  **Verification Steps**:
    *   Verify that a toast notification displays showing `Offline mode: Action queued locally!`.
    *   Verify that the transaction displays in the list immediately with a negative ID (optimistic rendering).
    *   Inspect Developer Tools > Application > Local Storage to verify the action is saved in `np_offline_queue`.
5.  Toggle the Network tab back to **Online**.
6.  **Verification Steps**:
    *   Verify that the browser triggers the sync process immediately.
    *   Verify that the transaction's negative ID is updated with a valid server ID from the database.

---

## 📋 Pre-Release Regression Checklist

Before merging pull requests or deploying code changes to production, complete the following manual checks:
*   [ ] **Authentication**: Log in, log out, and verify that invalid tokens are blocked with 401/403 errors.
*   [ ] **Custom Columns**: Add a custom column, enter data into it, rename it, and verify that the data migrates correctly. Delete the column and verify the field is cleared from all records.
*   [ ] **AI advisor**: Send a message starting with `@ai` to verify that context aggregation, Groq/Gemini calls, and WebSocket typing indicators work.
*   [ ] **UPI receipt upload**: Upload a mock payment screenshot to verify that image magic bytes validation and AI UPI parsing work correctly.
*   [ ] **Admin actions**: Log in to the admin panel, search for users, ban a test user, and verify that all actions are logged in the audit trail.
