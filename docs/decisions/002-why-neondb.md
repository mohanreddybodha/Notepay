# ADR 002: Neon Serverless Database vs. Self-Hosted PostgreSQL

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

Notepay requires a relational database to handle transaction ledgers, event memberships, and audit trails. A serverless application backend requires a database that can handle:
1.  **Scaling and Idle State**: The database should scale down to zero or go into standby when inactive, reducing costs.
2.  **Connection Management**: The database must handle rapid, short-lived connections from AWS Lambda containers without exhausting connection limits.

---

## Decision Rationale

We chose **Neon Serverless PostgreSQL** over self-hosted databases:

1.  **Scale-to-Zero**: Neon automatically suspends the database compute layer after 10 minutes of inactivity, bringing compute costs to zero. When a request arrives, the compute layer is restored automatically (taking 2–3 seconds).
2.  **Serverless Connection Compatibility**: Neon uses a built-in connection pooler (PgBouncer) that handles thousands of concurrent serverless requests.
3.  **Managed Backups & Branching**: Neon supports instant database branching, allowing developers to create copy databases for testing.

---

## Consequences & Trade-offs

*   **Standby Recovery Delay**: If a user accesses an inactive event, the first query can take 3 seconds while Neon wakes up.
    *   *Mitigation*: The frontend handles this delay gracefully by using loading overlays, and the backend utilizes Redis caches to serve static pages without querying the database.
*   **Connection Pool Limits**: To prevent Neon connection exhaustion, we tuned the backend's SQLAlchemy engine to use a single persistent connection per Lambda container:
    ```python
    pool_size=1, max_overflow=2
    ```
