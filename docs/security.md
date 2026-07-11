---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# System Security Posture & Protection Gates

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **User Authentication System**: [backend/auth.py](../backend/auth.py)
*   **Admin JWT Signatures**: [backend/admin_auth.py](../backend/admin_auth.py)
*   **Role Authorization Dependencies**: [backend/dependencies.py](../backend/dependencies.py)
*   **XSS HTML Sanitizer**: [backend/crud.py](../backend/crud.py) (Function: `sanitize_json_payload()`)
*   **Magic Byte Image Scanner**: [backend/storage.py](../backend/storage.py) (Function: `validate_receipt_content()`)
*   **Brute-Force Rate Limiter**: [backend/limiter.py](../backend/limiter.py)

---

## 🔐 Authentication & Session Authorization

Notepay separates user activities from administrative operations:

```
[User Request]  ---> [Authorization Header Bearer Token] ---> [Firebase JWT Verification]
[Admin Request] ---> [Authorization Header Bearer Token] ---> [Custom HS256 JWT Verification]
```

### 1. User Session Security
*   **Decoupled Verification**: The client authenticates directly with Google Firebase Authentication (using OTP phone number authentication). The client sends the ID token to the backend in the `Authorization: Bearer <token>` header.
*   **JWT Decoding**: The backend verifies the token using the Firebase Admin SDK.
*   **Auth Token Cache**: To prevent network latency on every request, the decoded token is cached in a local memory dictionary (`_local_token_cache`) for 10 minutes. Cache entries are hashed using SHA-1 to prevent memory leak attacks.
*   **Clock Skew Resiliency**: If clock drifts cause Firebase to reject the token as "used too early", the backend sleeps and retries up to 3 times before returning an HTTP 401 error.
*   **Firebase App Check**: In production, Firebase App Check verifies the client's integrity using reCAPTCHA v3, blocking requests from unauthorized apps or scripts.

### 2. Administrative Session Security
*   **Custom Token Verification**: Admin authentication operates independently of Firebase. The admin panel utilizes standard OAuth2 Password Bearer flow.
*   **JWT Token Signatures**: The backend signs administrative tokens using `HS256` signed with the server secret key `ADMIN_JWT_SECRET`. Tokens are configured with a 120-minute expiration.
*   **Role Scope Checking**: The security dependency `require_admin` parses the decoded JWT, validates that the subject matches a registered administrator in the `admin_users` table, and verifies `role == "admin"`.

---

## 🧹 Input Validation & XSS Prevention

To prevent malicious JavaScript injection (Stored XSS) in transaction names, descriptions, or custom fields:

### 1. Pydantic Schemas
FastAPI route parameters utilize Pydantic schemas to validate and clean input types (e.g., converting inputs to floats, strings, or booleans, and rejecting malformed payloads with HTTP 422 errors).

### 2. HTML Sanitization via Bleach
Before saving values to the database, the backend sanitizes text inputs using the `bleach` library. This is handled by `sanitize_json_payload(data)` inside [crud.py](../backend/crud.py):
*   **Recursive Sanitization**: The function recursively traverses lists and dictionaries (such as dynamic custom fields).
*   **HTML Strip**: It applies `bleach.clean(value, tags=[], strip=True)` to strip out all HTML tags, script elements, styles, or inline attributes (e.g., converting `<script>alert('xss')</script>Hello` to `Hello`).
*   **JSON Safety**: Ensures JSON parameters saved in SQLite or PostgreSQL cannot execute script payloads in client browsers.

---

## 📸 File Upload Security (Receipts)

Allowing users to upload files presents a significant security risk. Notepay mitigates this with several checks:

### 1. Magic-Byte Image Signatures
The system validates file types by inspecting the first bytes (magic numbers) of the uploaded file inside `storage_service.upload_receipt`:
*   **Verification**:
    *   JPEG: `\xff\xd8\xff`
    *   PNG: `\x89PNG\r\n\x1a\n`
    *   GIF: `GIF8`
    *   WEBP: `RIFF`
*   **MIME Validation**: If the file bytes do not match these signatures, the file is rejected with an HTTP 400 error, blocking executable scripts masquerading as images (e.g., `backdoor.png.php`).

### 2. Size & Path Security
*   **Strict Size Limit**: Rejects uploads larger than 5MB to prevent storage depletion attacks.
*   **Safe Filenames**: The system discards the client-provided filename. Instead, it generates a random UUID hex name and appends the detected extension (e.g., `receipts/{event_id}/{uuid}.jpg`), preventing directory traversal attacks.

### 3. Flexible UPI Verification
To prevent users from uploading unrelated receipts (e.g., a payment screenshot for another event), the backend validates the receipt against the event's UPI owner:
*   **Flexible Word Match**: Cleans and checks words inside the receipt's extracted `receiver_name` against the registered `upi_owner_name` on the event.
*   **Rejection Gate**: If no matching words are found, the upload is rejected with a message detailing the mismatch, preventing fraud.

---

## 🛡️ Throttling & Brute-Force Protection

To prevent denial of service (DoS) and account cracking attempts, the backend implements rate limiting inside [limiter.py](../backend/limiter.py):

### 1. Endpoint Rate Limiting
Critical paths utilize the `verify_rate_limit(key, limit, window)` function:
*   **Create Event**: Limited to 5 creations per user per minute.
*   **Join Event**: Limited to 5 joins per user per minute.
*   **Code Preview**: Limited to 100 previews per user per minute.
*   **Register User**: Limited to 5 register requests per phone number per hour.
*   **AI Chat Advisor**: Limited to 10 queries per user per event per day.
*   **Transaction Add**: Limited to 30 transaction entries per user per minute.

### 2. Administrative Throttling
The administrative login route (`POST /api/v1/admin/login`) implements brute-force throttling:
*   **IP Tracker**: Tracks login failures by client IP address using the cache.
*   **Lockout Policy**: If an IP records 3 consecutive login failures within 1 hour, the backend blocks the IP for 5 hours (`admin_block:{ip}`). Subsequent login attempts return an HTTP 429 error without checking the database.
