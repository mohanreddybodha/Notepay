---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Notepay Architecture Decision Records (ADRs)

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

This directory tracks the architectural decisions, design motivations, alternatives, and trade-offs made during the development of Notepay.

---

## 📂 Architecture Decision Records

*   [ADR 001: Serverless Compute](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/001-why-serverless.md): Rationale behind using AWS Lambda & Mangum instead of dedicated EC2 virtual machines.
*   [ADR 002: Neon Database](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/002-why-neondb.md): Rationale for adopting Neon Serverless PostgreSQL over RDS.
*   [ADR 003: Vanilla Frontend](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/003-why-html-css-js.md): Decoupling client from web frameworks in favor of light pure HTML/CSS/JS files.
*   [ADR 004: Dynamic Columns](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/004-why-custom-columns.md): Adopting Postgres custom columns using JSON metadata instead of altering tables.
*   [ADR 005: Roles Hierarchy](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/005-why-role-based.md): Using Organizer/Collector boundaries and restricted bans instead of granular privileges.
*   [ADR 006: Event Invite Code](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/006-why-event-code.md): Using structured invite codes instead of direct user lookup invitations.
*   [ADR 007: Real-Time Broadcasts](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/decisions/007-why-websocket.md): Using API Gateway WebSocket proxying and Redis connection stores for serverless updates.
