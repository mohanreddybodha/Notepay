# ADR 007: Real-Time Sync via API Gateway WebSockets & Redis

*   **Status**: Approved
*   **Date**: 2026-07-11

---

## Context & Problem Statement

Notepay is an Event Collection and Expense Management platform where multiple collectors log transactions simultaneously. If developers used traditional HTTP polling to update the UI:
1.  **High Database Load**: Repeatedly polling endpoints (e.g. every 5 seconds) would cause high query load and exhaust connection pools.
2.  **Delayed Updates**: Changes would not display in real-time, leading to data entry conflicts or duplicate logs.

---

## Decision Rationale

We chose **AWS API Gateway V2 WebSockets** backed by **Upstash Redis** for real-time synchronization, rather than HTTP polling or Server-Sent Events (SSE):

1.  **Low Latency**: WebSockets provide a persistent, bi-directional communication channel. Updates are pushed to clients within milliseconds of a write.
2.  **Reduced Database Load**: Clients only query database endpoints when they receive a change notification, eliminating constant polling queries.
3.  **Serverless Compatibility**: AWS API Gateway manages the persistent TCP connections. The backend Lambda function is only invoked when a message is sent or received, keeping compute costs low.
4.  **Shared State**: We use Redis sets (`ws:evt:{event_id}`) to store connection IDs across isolated Lambda containers, allowing any container to broadcast updates to all connected clients.

---

## Consequences & Trade-offs

*   **Redis Costs**: Production requires a hosted Redis instance (Upstash) to store connection sets.
    *   *Mitigation*: The connection data is small (Connection IDs are strings), keeping Redis storage requirements and costs minimal.
*   **Local Overhead**: Developing with API Gateway WebSockets locally requires emulation.
    *   *Mitigation*: We implement a dual-mode connection manager (`ws_manager.py`). Locally, it runs standard FastAPI WebSockets in memory. In production, it routes broadcasts through Redis and `boto3`.
