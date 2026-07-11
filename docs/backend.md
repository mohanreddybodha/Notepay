---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Backend Architecture & Service Layer

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

Notepay's backend is a high-performance API built with **FastAPI (Python 3.11)**. It is structured to run serverless inside AWS Lambda in production and as a standard FastAPI server locally.

---

## 🛠️ Main API Configuration & CORS Gates

The API entry point is configured inside [main.py](../backend/main.py):
*   **Startup Migrations**: The application triggers `_run_legacy_migrations()` at launch. This checks for the existence of `feedback` tables and appends legacy columns (`name` and `email`) if missing.
*   **CORS Configuration**:
    *   **Production**: CORS settings restrict requests to named domains (`https://notepay.in`, `https://www.notepay.in`), the administration dashboard domain (`ADMIN_DOMAIN`), and explicitly whitelisted IP ranges.
    *   **Development**: Whitelists common local ports (`http://localhost:5500`, `http://localhost:3000`, `http://localhost:8000`) to prevent local web browser blockers.
*   **CORS-Preserving Exception Handler**: FastAPI's default 500 handlers can strip CORS headers on internal errors, causing browsers to block the response body. Notepay overrides this with a custom global handler:
    ```python
    @app.exception_handler(Exception)
    async def global_exception_handler(request: Request, exc: Exception):
        # Prevents 500 errors from stripping CORS headers
        detail = f"Internal Server Error: {repr(exc)}" if _DEBUG_MODE else "Internal server error"
        return JSONResponse(status_code=500, content={"detail": detail})
    ```

---

## ☁️ Serverless WS Adapter (Mangum)

In production, the backend runs inside AWS Lambda behind an API Gateway V2 connection. Rather than hosting long-running Python threads, the connection uses the **Mangum** ASGI adapter.

### 1. HTTP and WebSocket Route Demarcation
The handler function `handler(event, context)` splits incoming request paths:
*   **Standard REST Calls**: Mangum parses the event proxy data and maps it directly to FastAPI's HTTP route handlers.
*   **AWS API Gateway WebSockets**: If `connectionId` is present in the `requestContext`, the function bypasses Mangum and executes WebSocket routing logic in Python:
    *   `CONNECT`: Returns `200 OK` instantly to register connection endpoints.
    *   `DISCONNECT`: Clears connection state keys from the Redis cache (`ws:conn:{conn_id}`).
    *   `MESSAGE`: Parses incoming text frames. If a client sends an `AUTH` message payload containing a Firebase JWT, the backend verifies the signature and maps the connection state to the event sets (`ws:evt:{event_id}`) in Redis.

### 2. Warmup Ping Handling
API Gateway triggers EventBridge scheduled pings to keep Lambda containers warm, avoiding cold starts. The handler checks:
```python
if event.get("source") in ("notepay-warmup", "aws.events"):
    return {"statusCode": 200, "body": "warm"}
```
This returns immediately, preventing unnecessary database connection lookups.

---

## 🔒 Security Dependencies & Auth Verification

FastAPI endpoint protection is consolidated inside [dependencies.py](../backend/dependencies.py):

### 1. User Authentication Checks
*   `get_current_user_id`: Enforces token verification via Firebase. If the user is registered, it returns their database ID. If the user is not found, but a phone number is encoded in the Firebase token, it checks if a record exists with that phone number and updates the user's `firebase_uid`. It also checks if the user is banned; if so, it raises an HTTP 403 Forbidden error with the ban reason.
*   `get_optional_current_user_id`: Performs the same checks but returns `None` for unauthenticated requests, allowing read-only access to public portals. Banned users are still blocked with an HTTP 403 error.

### 2. Role-Based Access Controls
*   `verify_membership`: Validates that a user is an active member of an event.
*   `verify_event_active_for_collector`: Prevents writes to locked/deactivated events.
    *   If `for_write=True`, the route requires event membership and an unrestricted role status. Banned or restricted members cannot write.
    *   If `for_write=False`, access is permitted for standard members and visitors (if the event is public).

---

## ⚡ Dual-Mode Caching Layer

Caching operations are abstracted inside [cache.py](../backend/cache.py).

### 1. Redis Caching (Production)
*   **Connection Routing**: Uses `redis.from_url` using the SSL protocol (`rediss://`) to communicate securely with Upstash Redis, enforcing a `socket_timeout=3.0` limit to prevent API bottlenecks if Redis is slow.
*   **Cache Heartbeat Versioning**: To avoid complex user cache invalidation, the system uses a global key `dash_v` (Dashboard Version). When an event is updated or joined, `bump_global_version()` increments this key. Full dashboards are cached under `dash:{user_id}:{global_version}`. A version bump invalidates all dashboard caches instantly.

### 2. In-Memory Dictionary Fallback (Development)
If `REDIS_URL` is missing:
*   **Storage Fallback**: Cache values are saved in a local Python dict (`_local_cache`) with manual expiration checks.
*   **OOM Eviction**: To prevent memory leaks during long-running test suites, the fallback engine sweeps and deletes expired keys when size exceeds 5,000 items, and clears the cache entirely if size exceeds 8,000 items.

---

## 📂 Dual-Mode Storage Layer

Receipt image handling is consolidated in [storage.py](../backend/storage.py):

### 1. AWS S3 Uploads (Production)
When `RECEIPTS_BUCKET` is configured, uploads are sent to S3:
*   **Key Pathing**: Receipts are stored at `receipts/{event_id}/{uuid}.{ext}`.
*   **Client Reuse**: The S3 client object `_s3_client` is initialized once per container and reused across requests.

### 2. Local Disk Uploads (Development)
If no bucket is configured, files are saved locally:
*   **Local Directories**: Writes files to `uploads/receipts/{event_id}/` in the backend directory.
*   **Path Mapping**: Returns a path string prefixed with `local://` (e.g., `local://uploads/receipts/{event_id}/{uuid}.png`).

### 3. Unified Retrieval Handler
`fetch_receipt_response(receipt_key)` abstracts the storage layer:
*   If the key starts with `local://`, it parses the path and returns a FastAPI `FileResponse`.
*   Otherwise, it fetches the object from S3 and returns a `StreamingResponse` with the correct MIME type.

---

## 🛠️ Code Linkage & Implementation Reference

*   **API Configuration Routes**: [backend/main.py](../backend/main.py) (Function: `global_exception_handler()`, Router mounting: `app.include_router()`)
*   **Serverless ASGI & WS Adapter**: [backend/main.py](../backend/main.py) (Mangum handler wrapper: `handler()`)
*   **Authorization Security Dependencies**: [backend/dependencies.py](../backend/dependencies.py) (Functions: `get_current_user_id()`, `verify_membership()`, `verify_event_active_for_collector()`)
*   **Redis Caching Client**: [backend/cache.py](../backend/cache.py) (Class: `RedisCache`, Global Version Invalidation: `bump_global_version()`)
*   **Receipt Storage & retrieval**: [backend/storage.py](../backend/storage.py) (Functions: `upload_receipt()`, `fetch_receipt_response()`)

---

## 🔗 Related Documentation
*   👉 **[System Architecture & Request Lifecycle Guide](architecture.md)**
*   👉 **[Database Schema & Models Guide](database.md)**
*   👉 **[DevOps & Deployment Guide](deployment.md)**
*   👉 **[Engineering Handbook & constraints](architecture-rules.md)**
