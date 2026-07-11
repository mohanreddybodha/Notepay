# ADR 001: Serverless Architecture (AWS Lambda vs. EC2)

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

Notepay is an Event Collection and Expense Management platform. It experiences highly variable traffic patterns: heavy usage during active events, community drives, or festivals, followed by long periods of inactivity. 

Hosting this on a traditional, constantly running server like Amazon EC2 would lead to:
1.  **High Costs**: Paying for idle computing capacity when no events are active.
2.  **Operational Overhead**: Managing operating system updates, patching, and setting up manual scaling groups.

---

## Decision Rationale

We chose **AWS Lambda** serverless functions (with FastAPI adapted via Mangum) over virtual machines (EC2):

1.  **Cost Efficiency**: AWS Lambda operates on a pay-per-request pricing model. When the application is idle, server compute costs drop to zero.
2.  **Automatic Scalability**: Lambda automatically scales up horizontally to support burst traffic during large contribution events, without needing manual configuration.
3.  **Low Maintenance**: AWS manages infrastructure provisioning, operating system patching, and scaling, reducing operational overhead.

---

## Consequences & Trade-offs

*   **Cold Starts**: Containers shut down after periods of inactivity. The first request to spin up a new container can introduce a 1–2 second delay.
    *   *Mitigation*: We set up EventBridge warmup pings (`notepay-warmup`) to keep Lambda containers active during peak event hours, reducing cold start latency.
*   **Database Connections**: Horizontal scaling can rapidly exhaust database connection limits.
    *   *Mitigation*: We tuned connection pooling to limit pool sizes to 1 connection per container (see [ADR 002](002-why-neondb.md)).
*   **WebSocket Limitations**: Long-lived WebSocket connections are not natively supported by Lambda.
    *   *Mitigation*: We integrated AWS API Gateway V2 WebSocket API to manage connections, keeping the Lambda execution context short-lived.
