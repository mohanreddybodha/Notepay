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
*   [Architecture Overview](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/architecture.md): High-level system blocks, request lifecycles, and parallel WebSocket configurations.
*   [Frontend Architecture](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/frontend.md): SPA view routers, Web Components, Firebase token caches, and offline queues.
*   [Backend Services](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/backend.md): FastAPI configurations, CORS, serverless adapters, and caching.
*   [Engineering Handbook](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/architecture-rules.md): Architectural constraints, DRY principles, and PR checklists.

### 📚 Developer & Operations Guides
*   [Project Directory Structure](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/project-structure.md): Folder structures, module boundaries, and naming conventions.
*   [API Endpoint Reference](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/api.md): Endpoint list, parameters, response models, and rate limits.
*   [Database & Schema Models](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/database.md): Database tuning, schema fields, indexes, and Alembic migrations.
*   [Artificial Intelligence Pipeline](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/ai.md): Vision AI models, prompt guidelines, and chat contextual processing.
*   [System Design System](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/design-system.md): Light/dark CSS tokens, spacings, custom components, and responsive grid layouts.
*   [Developer Extension Guide](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/development.md): How to add new endpoints, pages, models, and permission guards.
*   [Troubleshooting & Debugging](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/troubleshooting.md): Fixing database locks, CORS errors, auth redirects, and Lambda issues.
*   [Testing & Quality Assurance](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/testing.md): Running backend Pytest smoke suites, E2E checks, and offline sync QA.
*   [Performance Optimization](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/performance.md): SQL eager loading, version caching, and WebSocket connection pruning.
*   [Scalability Projections](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/scalability.md): Scale path to 100k+ transactions, partitioning, SQS queues, and S3 Glacier rules.
*   [Operations & Disaster Recovery](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/operations.md): CloudWatch logs, error logging, Neon backups, PITR, and SSM secrets rotation.

### 🔄 Feature Workflows (docs/workflows/)
Detailed step-by-step process flows mapped from user interaction through to the database, including Mermaid diagrams:
*   [Create Event](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/create-event.md)
*   [Join Event](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/join-event.md)
*   [Logging Contributions](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/contribution.md)
*   [Tracking Expenses](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/expense.md)
*   [Financial Summaries](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/summary.md)
*   [Chat & AI Advisor](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/chat.md)
*   [UPI Receipt Verification](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/receipt.md)
*   [Member Management](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/members.md)

### ⚖️ Architecture Decision Records (docs/decisions/)
Technical design decisions, trade-offs, and rationale:
*   [ADR 001: Serverless Compute](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/001-why-serverless.md)
*   [ADR 002: Neon Database](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/002-why-neondb.md)
*   [ADR 003: Vanilla Frontend](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/003-why-html-css-js.md)
*   [ADR 004: Dynamic Columns](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/004-why-custom-columns.md)
*   [ADR 005: Roles Hierarchy](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/005-why-role-based.md)
*   [ADR 006: Event Invite Code](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/006-why-event-code.md)
*   [ADR 007: Real-Time Broadcasts](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/007-why-websocket.md)
