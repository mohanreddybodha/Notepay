---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# Systems Scalability & Growth Projections

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **AWS SAM template infrastructure**: [template.yaml](../template.yaml)
*   **Performance Optimization references**: [docs/performance.md](performance.md)

---

## 📈 Current Architectural Limits & Bottlenecks

### 1. Database Layer (SQLite vs. PostgreSQL)
*   **SQLite (Local)**: Limited to single-writer environments. As concurrent writes scale beyond 10–20 per second, SQLite will encounter database lock timeouts. *Limit: ~10,000 total transactions before performance degrades.*
*   **Neon PostgreSQL (Production)**: Scales storage and compute resources automatically. The primary bottleneck is database connection limits under serverless traffic spikes.

### 2. Computing Layer (AWS Lambda)
*   AWS Lambda has a default regional concurrency limit of 1,000 concurrent executions. If a large contribution event triggers thousands of concurrent API requests, Lambda can encounter throttling errors (HTTP 429).

### 3. Caching & WebSocket Registry (Redis)
*   Our current Redis setup caches active WebSocket connection IDs inside simple sets (`ws:evt:{event_id}`). If an event has 10,000+ concurrent members, retrieving and looping through these connection IDs in a single Lambda request will cause performance issues.

---

## 🛠️ The Scaling Plan: Scaling to 100,000+ Transactions

To support large-scale community events and contribution drives, the infrastructure will scale as follows:

```
[Web Traffic Spike] ---> [API Gateway Rate Limit] ---> [SQS Message Queue]
                                                              |
[S3 Glacier Archiving] <--- [Lambda Worker Pool] <--- [Lambda Concurrency Scale]
                                   |
[Neon Read Replicas] <---+---------+----------> [Redis Cluster Set partitions]
```

### 1. Database Scale Path
*   **Read-Replicas**: Configure read-replicas in Neon. Query routes (such as fetching transaction lists or event summaries) will be routed to read-replicas, reserving the primary database node for writes (e.g. logging transactions).
*   **Table Partitioning**: Partition the `contributions` and `expenses` tables by `event_id` or `collected_at` month. This ensures index lookups remain fast as table sizes exceed millions of rows.

### 2. Lambda Concurrency Management
*   **Increase Concurrency limits**: Request an increase in AWS Lambda concurrency limits (to 5,000+ concurrent executions).
*   **Provisioned Concurrency**: Configure provisioned concurrency for critical routes (such as receipt uploads) to pre-warm containers during scheduled contribution drives, eliminating cold start delays.

### 3. Redis WebSocket Set Partitioning
*   **Partition Connection Sets**: Instead of storing all connection IDs in a single set, partition sets into sub-groups (e.g. `ws:evt:{event_id}:{shard_id}`).
*   **Decoupled Broadcasting**: Offload WebSocket broadcasting from Lambda to a background queue. When a transaction is logged, the Lambda function publishes a message to an Amazon SQS queue. Background worker threads consume messages from the queue and send WebSocket pushes, keeping API response times low.

### 4. Storage & Chat Archiving
*   **S3 Lifecycle Policies**: Configure S3 lifecycle rules to automatically migrate receipt images older than 90 days to Amazon S3 Glacier Flexible Retrieval, reducing active storage costs.
*   **Chat History Archiving**: Implement an archiving job that exports chat messages older than 30 days to cold storage (such as S3 CSV exports) and clears them from the active PostgreSQL database.

### 5. High-Volume Notifications (SQS/SNS)
*   Replace direct, synchronous SMS or email notification calls with asynchronous messaging. The backend will publish notification tasks to **Amazon SNS** or **Amazon SQS** queues, allowing worker instances to process notifications in the background.
