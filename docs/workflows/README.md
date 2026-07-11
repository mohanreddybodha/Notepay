---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Notepay Feature Workflows Directory

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

This directory contains step-by-step process workflows mapping client-side UI actions, API calls, database writes, and WebSocket broadcasts.

---

## 📂 Workflow Indexes

*   [Create Event](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/create-event.md): Lifecycle of creating a new ledger and assigning organizers.
*   [Join Event by Code](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/join-event.md): Previews invite details and adds collectors via unique tokens.
*   [Logging Contributions](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/contribution.md): Inserting credit rows, input sanitization, and broadcasting updates.
*   [Tracking Expenses](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/expense.md): Adding expense records, updating totals, and real-time syncing.
*   [Financial Summaries](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/summary.md): Aggregated queries (totals and timelines) and Redis caching layers.
*   [Event Chat & AI Advisor](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/chat.md): Message limit probablistic cleanups and background Llama/Gemini AI processing.
*   [AI UPI Receipt Verification](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/receipt.md): Screenshot byte scans, OCR parsing failovers, and collector verification gates.
*   [Member Role Management & Restrictions](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/docs/workflows/members.md): Enforcing bans, role transitions, and restricting collector edit gates.
