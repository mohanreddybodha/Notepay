---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Troubleshooting & Debugging Guide

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Error Logs Schema**: [backend/models.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/models.py) (Class: `ErrorLog`)
*   **System Operations Logs**: [docs/operations.md](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/operations.md)

---

## 💻 Local Development Issues

### 1. CORS Policy Blocks (API Request Rejected)
*   **Symptom**: Console outputs `Access-Control-Allow-Origin header is missing` or `CORS preflight request failed`.
*   **Causes**:
    *   The frontend is accessed via `http://localhost:3000`, but port `3000` is missing from `_ALLOWED_ORIGINS` in [main.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/main.py).
    *   The API crashed during execution, returning a 500 error that bypassed standard CORS middlewares.
*   **Resolution**:
    *   Verify that your local URL is whitelisted in `main.py` CORS origins.
    *   Check backend logs to verify if an unhandled 500 error bypassed CORS middlewares.

### 2. Local Database Locks (SQLite Database Locked)
*   **Symptom**: Backend logs show `sqlite3.OperationalError: database is locked` or queries hang indefinitely.
*   **Cause**: The local database file `notepay_dev_v2.db` is located inside a directory managed by a cloud sync service (e.g., OneDrive or Dropbox), which locks the file during sync operations.
*   **Resolution**:
    *   Verify that SQLite WAL mode is enabled:
        ```python
        cursor.execute("PRAGMA journal_mode=WAL")
        ```
    *   If locks persist, disable OneDrive file syncing temporarily or move the project folder to a directory that is not synced.

---

## 🔒 Authentication & Authorization Failures

### 1. Clock Skew Auth Rejections
*   **Symptom**: User login logs output `Firebase ID Token used too early. iat: 1719870005, now: 1719870001`.
*   **Cause**: The backend container's system clock is slightly out of sync (behind) compared to Firebase's authorization servers.
*   **Resolution**:
    *   The backend includes a retry loop in `auth.py` to sleep and retry when clock skew is detected.
    *   If running locally or on an EC2 instance, synchronize your system clock:
        ```bash
        # On Windows (PowerShell)
        w32tm /resync
        ```

### 2. Redirect Loops (Sent to login.html repeatedly)
*   **Symptom**: Accessing `dashboard.html` redirects to `login.html` even after entering valid credentials.
*   **Cause**: Firebase's `onAuthStateChanged` fires a brief `null` event on page load before loading the user session from IndexedDB, causing the auth guard to redirect the user.
*   **Resolution**:
    *   Verify that `waitForAuthReady()` is active in [firebase-config.js](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/frontend/js/firebase-config.js). This ensures the guard waits up to 3.5 seconds to see if a valid session is restored before redirecting.

---

## ☁️ Neon Database & Cloud Failures

### 1. Neon DB Wake Latency
*   **Symptom**: The first API query to a public event portal takes 3–5 seconds to load.
*   **Cause**: Neon serverless database compute nodes automatically scale down to zero after 10 minutes of inactivity to reduce costs. The delay occurs while Neon wakes up the compute nodes.
*   **Resolution**:
    *   This delay is normal for serverless databases. The frontend displays a loading overlay to manage the delay.
    *   To keep database compute nodes active during peak event hours, set up a cron job or monitoring check to ping the `/health` endpoint periodically.

### 2. Neon Connection Exhaustion
*   **Symptom**: Logs show `sqlalchemy.exc.TimeoutError: QueuePool limit of size reached`.
*   **Cause**: AWS Lambda containers are creating too many concurrent connections, exhausting the database's connection limit.
*   **Resolution**:
    *   Verify that `pool_size` is limited to `1` in `database.py` to ensure each Lambda container only creates one connection.
    *   Ensure that database sessions are closed correctly using context managers or `db.close()` inside route handlers.

---

## 🚀 AWS SAM Deployment Failures

### 1. Parameter Store Resolution Failures
*   **Symptom**: Deploying via `sam deploy` fails with `Parameter /notepay/database_url not found` or `AccessDenied`.
*   **Cause**: The SSM parameters referenced in `template.yaml` (such as database credentials or API keys) do not exist in the target AWS region, or the CloudFormation role lacks permissions to read them.
*   **Resolution**:
    *   Verify that the required parameters are configured in the AWS Console under Systems Manager > Parameter Store for the correct region.
    *   Verify that parameter names match the references in `template.yaml` exactly.
