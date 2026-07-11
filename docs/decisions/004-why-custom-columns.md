# ADR 004: Dynamic Table Columns via JSON vs. Relational Schema

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

Different events require different data fields (e.g., a birthday event needs "T-Shirt Size" and "Food Preference", while a sports club needs "Jersey Number" and "Membership Tier"). 

Creating database tables with fixed columns or triggering schema migrations for each event would cause performance issues and database instability at scale.

---

## Decision Rationale

We chose to store dynamic columns in a **JSON field** (`custom_fields` inside `contributions` and `expenses`) rather than modifying the database schema:

1.  **Dynamic Schemas**: Organizers can add, rename, or delete columns dynamically without modifying database schemas.
2.  **Zero Migration Overhead**: Modifying dynamic columns does not require database migrations, preventing database locks.
3.  **Low Storage Overhead**: Empty or unused custom fields do not consume database column storage, saving space.

---

## Consequences & Trade-offs

*   **No Native SQL Indexing**: Dynamic fields inside JSON columns cannot be indexed natively using standard B-Tree indexes.
    *   *Mitigation*: Since dynamic columns are only displayed within the context of a single event, we retrieve records by indexing the `event_id` column first, and then parse the JSON fields in memory.
*   **Rename Side Effects**: Renaming a custom column can leave older records with stale keys.
    *   *Mitigation*: The backend runs a rename routine (`_apply_custom_columns_update`) that migrates keys inside the `custom_fields` JSON column when an event's column settings are modified.
*   **Input Sanitization**: Storing raw JSON opens risks of stored XSS.
    *   *Mitigation*: The backend runs the sanitization helper `sanitize_json_payload` recursively on all JSON elements before saving them to the database.
