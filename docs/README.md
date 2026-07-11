---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Notepay Technical Documentation Hub

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

Welcome to the Notepay developer documentation. Use the links below to navigate through guides, workflows, and architectural decisions.

---

## 📂 Documentation Directory

### 🗺️ System & Core Architecture
*   [Architecture Overview](architecture.md): High-level system blocks, request lifecycles, and parallel WebSocket configurations.
*   [Frontend Architecture](frontend.md): SPA view routers, Web Components, Firebase token caches, and offline queues.
*   [Backend Services](backend.md): FastAPI configurations, CORS, serverless adapters, and caching.
*   [Engineering Handbook](architecture-rules.md): Architectural constraints, DRY principles, and PR checklists.

### 📚 Developer & Operations Guides
*   [Project Directory Structure](project-structure.md): Folder structures, module boundaries, and naming conventions.
*   [API Endpoint Reference](api.md): Endpoint list, parameters, response models, and rate limits.
*   [Database & Schema Models](database.md): Database tuning, schema fields, indexes, and Alembic migrations.
*   [Artificial Intelligence Pipeline](ai.md): Vision AI models, prompt guidelines, and chat contextual processing.
*   [System Design System](design-system.md): Light/dark CSS tokens, spacings, custom components, and responsive grid layouts.
*   [Developer Extension Guide](development.md): How to add new endpoints, pages, models, and permission guards.
*   [Troubleshooting & Debugging](troubleshooting.md): Fixing database locks, CORS errors, auth redirects, and Lambda issues.
*   [Testing & Quality Assurance](testing.md): Running backend Pytest smoke suites, E2E checks, and offline sync QA.
*   [Performance Optimization](performance.md): SQL eager loading, version caching, and WebSocket connection pruning.
*   [Scalability Projections](scalability.md): Scale path to 100k+ transactions, partitioning, SQS queues, and S3 Glacier rules.
*   [Operations & Disaster Recovery](operations.md): CloudWatch logs, error logging, Neon backups, PITR, and SSM secrets rotation.

### 🔄 Feature Workflows (docs/workflows/)
Detailed step-by-step process flows mapped from user interaction through to the database, including Mermaid diagrams:
*   [Create Event](workflows/create-event.md)
*   [Join Event](workflows/join-event.md)
*   [Logging Contributions](workflows/contribution.md)
*   [Tracking Expenses](workflows/expense.md)
*   [Financial Summaries](workflows/summary.md)
*   [Chat & AI Advisor](workflows/chat.md)
*   [UPI Receipt Verification](workflows/receipt.md)
*   [Member Management](workflows/members.md)

### ⚖️ Architecture Decision Records (docs/decisions/)
Technical design decisions, trade-offs, and rationale:
*   [ADR 001: Serverless Compute](decisions/001-why-serverless.md)
*   [ADR 002: Neon Database](decisions/002-why-neondb.md)
*   [ADR 003: Vanilla Frontend](decisions/003-why-html-css-js.md)
*   [ADR 004: Dynamic Columns](decisions/004-why-custom-columns.md)
*   [ADR 005: Roles Hierarchy](decisions/005-why-role-based.md)
*   [ADR 006: Event Invite Code](decisions/006-why-event-code.md)
*   [ADR 007: Real-Time Broadcasts](decisions/007-why-websocket.md)
