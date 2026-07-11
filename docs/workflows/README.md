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

*   [Create Event](create-event.md): Lifecycle of creating a new ledger and assigning organizers.
*   [Join Event by Code](join-event.md): Previews invite details and adds collectors via unique tokens.
*   [Logging Contributions](contribution.md): Inserting credit rows, input sanitization, and broadcasting updates.
*   [Tracking Expenses](expense.md): Adding expense records, updating totals, and real-time syncing.
*   [Financial Summaries](summary.md): Aggregated queries (totals and timelines) and Redis caching layers.
*   [Event Chat & AI Advisor](chat.md): Message limit probablistic cleanups and background Llama/Gemini AI processing.
*   [AI UPI Receipt Verification](receipt.md): Screenshot byte scans, OCR parsing failovers, and collector verification gates.
*   [Member Role Management & Restrictions](members.md): Enforcing bans, role transitions, and restricting collector edit gates.
