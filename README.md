---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Notepay — Shared Events Contribution & Expense Manager

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

Notepay is an Event Collection and Expense Management platform built to handle shared funds, contributions, and expense ledgers for real-world organizations, events, and community groups. This document serves as the main entry point to the codebase, system architecture, and development guidelines.

---

## 📖 Table of Contents
1. [Beginner Explanation](#-beginner-explanation)
2. [Technical Explanation](#%EF%B8%8F-technical-explanation)
3. [Repository Layout](#-repository-layout)
4. [Centralized Documentation Index](#-centralized-documentation-index)
5. [Quick Start (Local Development)](#-quick-start-local-development)

---

## 🐣 Beginner Explanation
### What is Notepay?
Imagine you are organizing a community festival, a family gathering, or a contribution drive. You need a way to collect money from many people (contributions), record who paid (ledger), track where the money is going (expenses), and see how much money is left over (balance). 

Normally, people do this using chaotic spreadsheets or notebook listings that get outdated quickly. Notepay solves this by providing a single, shared web application.

### Why does it exist?
- **Shared Responsibility**: Instead of one person manually entering every contribution or expense, organizers can add trusted "Collectors" to help manage transactions.
- **Real-Time Sync**: When a collector records a contribution, everyone else sees it instantly without having to refresh their screen.
- **UPI Receipt Auto-Verification**: Instead of manually matching payments, donors can scan the event QR code, pay via UPI (such as PhonePe or Google Pay), and upload a screenshot of their payment receipt. Notepay uses built-in AI to read the receipt, verify the payment was sent to the correct person for the correct amount, and add it to the list automatically.
- **Community Trust**: Transparency is key. Normal members can view the transaction history in real-time, building trust across the organization.

---

## 🛠️ Technical Explanation
Notepay is designed as a hybrid application, using a lightweight **Serverless microservice architecture** in production, paired with a fully-functional **decoupled local development environment**.

### Frontend
- **Stack**: Pure HTML5, Vanilla CSS, and Modern JavaScript. No framework overhead (no React, Angular, or Vue).
- **Architecture**: Single Page Application (SPA) dashboard layout.
- **Web Components**: Custom UI structures (like the sidebar) are built using standard web components (`customElements`).
- **State & Sync**: Managed via client-side memory, synchronizing through secure WebSockets.
- **Offline Mode**: Includes a local storage queuing system (`np_offline_queue`) that caches actions when offline and synchronizes them transparently when connection is restored.
- **Session Auth**: Firebase Authentication with client-side token caching.

### Backend
- **Framework**: FastAPI (Python 3.11) with Pydantic for input validation.
- **Database Engine**: SQLAlchemy ORM connecting to **Neon PostgreSQL** in production (QueuePool optimized for serverless connection longevity) and **SQLite** (configured with WAL mode) for local development.
- **Caching Layer**: Redis in production (Upstash TLS) for fast rate-limiting, transaction heartbeat versioning, and shared WebSocket connection maps. Local caching falls back to memory caches.
- **AI Processing Pipeline**: Dual-mode vision pipeline. Uses Groq (`meta-llama/llama-4-scout-17b-16e-instruct`) as the primary image-to-text extractor, falling back to Gemini 2.0 Flash for maximum reliability.
- **Production Serverless Adapter**: Mangum acts as the ASGI handler, translating API Gateway HTTP/REST calls and WebSocket connection states natively into FastAPI commands inside an AWS Lambda runtime.

---

## 📂 Repository Layout

```
Notepay_App/
├── .aws-sam/              # AWS Serverless Application Model build artifacts
├── docs/                  # Centralized system documentation
│   ├── README.md          # Centralized Documentation Home Index
│   ├── decisions/         # Architecture Decision Records (ADRs)
│   └── workflows/         # Visual feature process sequences (with Mermaid)
├── backend/               # FastAPI backend codebase
│   ├── alembic/           # Database migration files
│   ├── routers/           # Endpoint controllers (admin, chat, events, transactions)
│   ├── tests/             # Pytest testing suites (smoke tests, etc.)
│   ├── app.db             # Local SQLite database
│   ├── auth.py            # Firebase & local memory auth caching
│   ├── crud.py            # Data access layer (pure SQL aggregations, zero N+1)
│   ├── main.py            # FastAPI setup, AWS Lambda Mangum entry point
│   ├── models.py          # SQLAlchemy models
│   ├── requirements.txt   # Python dependencies
│   ├── storage.py         # Dual-mode storage (AWS S3 vs local uploads)
│   └── ws_manager.py      # Dual-mode WS broadcast (Redis + Boto3 vs local WS)
├── frontend/              # HTML, CSS, JS assets
│   ├── assets/            # Fonts, media, brand icons
│   ├── css/               # Modular CSS sheets & global variables stylesheet
│   ├── js/                # Client logic
│   │   ├── controllers/   # Event layout managers (Financials, Members, Chat)
│   │   ├── api.js         # API wrapper & offline sync queue
│   │   ├── firebase-config.js # Auth config & token caching
│   │   └── shared-utils.js# Pure formatters & clean URL translation
│   ├── index.html         # Portal home page
│   ├── dashboard.html     # SPA Dashboard layout
│   └── event.html         # SPA Event detailed layout
├── serve_frontend.py      # Local python development server (clean URL emulator)
└── template.yaml          # AWS SAM deployment template (API Gateway, Lambdas, S3)
```

---

## 📚 Centralized Documentation Index

For detailed guides and deep dives into specific layers of the system, reference the main index:
👉 **[Notepay Technical Documentation Hub (docs/README.md)](docs/README.md)**

Alternatively, access individual documents directly:

| Document | Purpose | Key Topics covered |
| :--- | :--- | :--- |
| **[System Architecture](docs/architecture.md)** | Overall technical design | System map, request lifecycles, WebSocket synchronizers, AI receipt validation flow |
| **[Frontend Guide](docs/frontend.md)** | Client-side mechanics | SPA navigation, Web Components, Firebase token cache, Offline sync queue |
| **[Backend Guide](docs/backend.md)** | API and runtime logic | FastAPI architecture, dependency security guards, dual-mode caching and storage |
| **[Engineering Handbook](docs/architecture-rules.md)** | System constraints | Structural rules, DRY principles, PR checklists |
| **[Features Reference](docs/features.md)** | Application workflows | Dashboards, Event creation, Invite code generation, Chat constraints, Receipt uploads |
| **[API Endpoint Index](docs/api.md)** | Endpoint specification | Paths, query arguments, Pydantic schemas, role-gates, rate-limits |
| **[Database Schema](docs/database.md)** | Data layer and models | ER diagram, tables, composite indices, GROUP BY aggregations, Alembic |
| **[Deployment Guide](docs/deployment.md)** | DevOps and Infrastructure | Local setup, AWS SAM deployment, SSM parameters, CloudFront CDN |
| **[Security Posture](docs/security.md)** | Access controls & protection | Firebase App Check, administrative JWT, bleach XSS sanitizers, magic-bytes |
| **[Design System](docs/design-system.md)** | UI standards & Spacings | CSS colors, buttons, spacing variables, sheet metrics, breakpoints |
| **[Coding Standards](docs/coding_standards.md)** | Developer styling guide | Naming rules, Web Component designs, preventing N+1 queries, PR reviews |

---

## 🚀 Quick Start (Local Development)

To run Notepay locally, run the backend API and the frontend clean URL server concurrently:

1.  **Start the Backend**:
    ```bash
    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload --port 8000
    ```
2.  **Start the Frontend**:
    ```bash
    python serve_frontend.py
    ```
3.  Navigate to `http://localhost:3000` in your web browser.
