# ADR 005: Role-Based Authorization Hierarchy

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

Notepay events are managed by groups of people. We need an authorization system that:
1.  Allows organizers to delegate contribution logging tasks to other members.
2.  Prevents unauthorized users from editing or deleting transactions.
3.  Allows organizers to suspend or restrict members if needed.
4.  Remains simple to manage on mobile screens.

---

## Decision Rationale

We chose a **Two-Role Hierarchy (Organizer and Collector)** with a restriction toggle, rather than a complex multi-tier permission matrix:

1.  **Low Complexity**: Having only two roles reduces authorization logic complexity in the backend, making it easier to maintain and audit.
2.  **Explicit Ownership**: Only the Organizer can edit event settings, delete the event, or modify other members' roles, ensuring clear ownership.
3.  **Collector Delegation**: Collectors can log new transactions and edit or delete *their own* entries, allowing them to help manage the event without full administrative access.
4.  **Restriction Toggle**: If a collector behaves maliciously, the organizer can toggle their restriction status (`is_restricted = True`), instantly blocking their access without removing them from the event.

---

## Consequences & Trade-offs

*   **Limited Customization**: Organizers cannot define custom roles (e.g., a "read-only collector").
    *   *Mitigation*: This simple model covers 95% of real-world use cases. Public portals allow read-only access for visitors, while the Collector role handles data entry.
*   **Restriction Checks**: Every database operation must check the user's membership and restriction status.
    *   *Mitigation*: The backend uses a unified `verify_event_active_for_collector` dependency check to enforce role permissions globally.
