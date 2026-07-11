# ADR 006: Human-Readable Invite Codes vs. Raw UUIDs

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

To join an event ledger, users need to link their account to the event. Using raw database UUIDs (e.g., `f81d4fae-7dec-11d0-a765-00a0c91e6bf6`) as invitation links introduces several issues:
1.  **Poor Ergonomics**: Raw UUIDs are difficult to type, share, or read on mobile screens.
2.  **Security Risks**: Exposing database keys can make the system vulnerable to enumeration attacks.

---

## Decision Rationale

We chose **Human-Readable Invite Codes** (structured as `XXXXX-XXXX-XXXX`) over raw UUIDs:

1.  **Typing Ergonomics**: The structured format is easier to type on mobile devices and read aloud.
2.  **Security**: The invite code is decoupled from the internal event database ID (which uses a separate 32-character UUID). This hides internal database IDs, preventing enumeration attacks.
3.  **Regenerable Codes**: If an invite code is leaked, the organizer can regenerate it (`regenerate_invite_code`), invalidating the old code without modifying the event's database ID or breaking existing memberships.

---

## Consequences & Trade-offs

*   **Extra DB Lookup**: Joining an event requires looking up the event record by invite code before inserting the membership row.
    *   *Mitigation*: We set a unique index on the `invite_code` column to ensure quick query lookups.
*   **Brute-Force Attacks**: Since invite codes are shorter than UUIDs, they are more vulnerable to brute-force guessing attacks.
    *   *Mitigation*: We implement a rate limit on preview and join routes (`verify_rate_limit`) to block brute-force attempts.
