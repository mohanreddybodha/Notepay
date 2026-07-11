---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Deployment Architecture & Environment Configuration

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **AWS SAM Deployment Template**: [template.yaml](../template.yaml)
*   **Local Frontend Dev Server**: [serve_frontend.py](../serve_frontend.py)
*   **CI/CD Workflow Settings**: [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)

---

## 💻 Local Development Setup

To run Notepay locally, run the decoupled backend API and the frontend clean URL server concurrently.

### 1. Run Backend API
1.  Navigate to the `/backend` folder:
    ```bash
    cd backend
    ```
2.  Install dependencies:
    ```bash
    pip install -r requirements.txt
    ```
3.  Set up local environment variables in a `.env` file inside `/backend` (see [Environment Variables](#-environment-variables) below).
4.  Launch the API server using Uvicorn:
    ```bash
    uvicorn main:app --reload --port 8000
    ```
    The API docs will be available at `http://localhost:8000/docs`.

### 2. Run Frontend Web Server
Since the frontend uses clean URL mapping (e.g. `/dashboard` instead of `dashboard.html`), standard static web servers will fail on direct page navigation or refreshes. Use the built-in clean URL server:
1.  From the project root directory, run:
    ```bash
    python serve_frontend.py
    ```
2.  Open your browser and navigate to `http://localhost:3000`.

### 💡 Clean URL Emulator (`serve_frontend.py`)
The script [serve_frontend.py](../serve_frontend.py) runs a customized HTTP server:
*   **Static Routes**: Maps exact paths directly to HTML files (e.g., `/dashboard` resolves to `/frontend/dashboard.html`).
*   **Prefix Segment Routing**: Maps dynamic prefix segments to the appropriate HTML controllers:
    *   `/event/*` resolves to `/frontend/event.html`
    *   `/edit-event/*` resolves to `/frontend/create-event.html`
    *   `/contribute/*` resolves to `/frontend/contribute.html`
    *   `/join/*` resolves to `/frontend/join-event.html`
*   **MIME-Type Overrides**: Overrides registry settings for `.css`, `.js`, and `.svg` files to prevent MIME type errors on Windows development machines.

---

## ☁️ AWS Production Serverless Architecture

In production, Notepay is deployed to AWS using the **AWS Serverless Application Model (SAM)** defined in [template.yaml](../template.yaml).

```mermaid
graph TD
    User["Client Browser"]
    CloudFront["Amazon CloudFront CDN"]
    S3Static["S3 Web Hosting Bucket"]
    
    APIGW["API Gateway V2"]
    APIGW_WS["API Gateway V2 (WebSockets)"]
    Lambda["AWS Lambda (FastAPI App)"]
    S3Receipts["S3 Receipts Bucket"]
    
    Redis["Upstash Redis Cache"]
    Neon["Neon PostgreSQL Database"]

    User -->|Static Assets| CloudFront
    CloudFront -->|Serve| S3Static
    
    User -->|HTTP API| APIGW
    User -->|WS WSS| APIGW_WS
    
    APIGW -->|Proxy Trigger| Lambda
    APIGW_WS -->|Proxy Trigger| Lambda
    
    Lambda -->|Store Image| S3Receipts
    Lambda -->|Cache State| Redis
    Lambda -->|SQL Ledger| Neon
```

### 1. Key AWS Infrastructure Components
*   **AWS::Serverless::Function (`NotePayFunction`)**: The primary execution container running the Python 3.11 FastAPI application. Configured with a 30-second timeout, 512MB RAM, and policies for Amazon S3 bucket access, Amazon SSM read permissions, and API Gateway connection management.
*   **AWS::ApiGatewayV2::Api (`WebSocketApi`)**: WebSocket API Gateway. Manages connections, disconnections, and routes messages using route keys `$connect`, `$disconnect`, and `$default`.
*   **AWS::S3::Bucket (`ReceiptsBucket`)**: Bucket for storing receipt uploads.
*   **CloudFront Distributions**: Separates static content hosting (Frontend S3 bucket) from dynamic backend APIs.

---

## 🔑 Environment Variables

The backend requires the following environment variables:

| Variable Name | Environment | Description | Example |
| :--- | :--- | :--- | :--- |
| `ENVIRONMENT` | All | Deployment runtime mode | `development` or `production` |
| `DATABASE_URL` | All | DB Connection URI | `sqlite:///./notepay_dev_v2.db` or `postgresql://user:pass@host/db` |
| `REDIS_URL` | Production | Redis connection string with TLS support | `rediss://default:token@host.upstash.io:6379` |
| `RECEIPTS_BUCKET` | Production | Name of S3 bucket for uploads | `notepay-production-receipts` |
| `WEBSOCKET_URL` | Production | HTTPS URL of WebSocket API Gateway | `https://api-id.execute-api.region.amazonaws.com/prod` |
| `ALLOWED_ORIGINS` | All | Whitelisted CORS host origins | `http://localhost:3000,https://notepay.in` |
| `ADMIN_DOMAIN` | Production | URL of administrative panel | `https://admin.notepay.in` |
| `FIREBASE_PROJECT_ID`| All | Google Firebase target project ID | `notepay-de2b0` |
| `GROQ_API_KEY` | All | API Key for Groq AI parsing | `gsk_...` |
| `GEMINI_KEY_1` | All | API Key for Gemini fallback parsing | `AIzaSy...` |
| `ADMIN_JWT_SECRET`| Production | Key used to sign administrative JWT tokens | `your-secret-key` |

---

## 🔒 AWS System Manager (SSM) Configuration

To avoid embedding secrets inside codebase repositories or deployment templates, production secrets are resolved dynamically at deploy time from **AWS Systems Manager (SSM) Parameter Store**:

*   **Database Credentials**: Resolved from SSM parameter path `{{resolve:ssm:/notepay/database_url}}`.
*   **Redis Credentials**: Resolved from SSM parameter path `{{resolve:ssm:/notepay/redis_url}}`.
*   **CORS Whitelist**: Resolved from SSM parameter path `{{resolve:ssm:/notepay/allowed_origins}}`.
*   **Admin JWT Secret**: Resolved from SSM parameter path `{{resolve:ssm:/notepay/admin_jwt_secret}}`.
*   **AI API Credentials**:
    *   Gemini API Key: `{{resolve:ssm:/notepay/gemini_key_1}}`
    *   Groq API Key: `{{resolve:ssm:/notepay/groq_key}}`

---

## ⚙️ CI/CD Deployment Flow

```
[Git Commit / PR] ---> [GitHub Actions Build] ---> [Run Backend Pytest Suite]
                                                              |
[CloudFront Purge] <-- [AWS SAM Deploy] <-- [Alembic Migrations] <-- [Passed]
```

1.  **Code Checkin**: Developers merge pull requests into the `main` production branch.
2.  **Lint & Test (GitHub Actions)**:
    *   Initializes Python 3.11 environment.
    *   Installs dependencies listed in `backend/requirements.txt`.
    *   Launches smoke testing suite by executing `pytest backend/tests/test_smoke.py`.
3.  **Database Migration**:
    *   Once tests pass, the pipeline executes database migrations via Alembic: `alembic upgrade head`.
4.  **AWS SAM Packaging**:
    *   Packages the backend code: `sam build --use-container`.
    *   Deploys cloud resources to AWS: `sam deploy --non-interactive --stack-name notepay-production --resolve-s3`.
5.  **Frontend Deployment**:
    *   Uploads files inside the `/frontend` directory to the CloudFront-backed S3 static bucket.
    *   Triggers an invalidation request in CloudFront to clear cached index pages.
6.  **Rollback Strategy**:
    *   If deployment smoke checks fail (e.g., Lambda health endpoint fails), AWS SAM automatically rolls back the stack configuration to the previously stable version.
