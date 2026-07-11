---
last_verified: "2026-07-11"
commit_sha: "19bb9d0"
verified_by: "Antigravity AI Auditor"
status: "Verified ✓"
---

# System Operations, Logging & Disaster Recovery

> [!IMPORTANT]
> **Code is the Source of Truth**: If this documentation differs from the implementation in the codebase, the implementation always wins.

*   **Error Logs Database Model**: [backend/models.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/models.py) (Class: `ErrorLog`)
*   **API Middleware Log handler**: [backend/main.py](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/backend/main.py)
*   **AWS Systems Manager resolving template**: [template.yaml](file:///c:/Users/bodha/OneDrive/Documents/NOTEPAY/Notepay_App/template.yaml)

---

## 📊 System Monitoring & Logging

### 1. Unified Logging (AWS CloudWatch)
*   **Log Streams**: In production, all stdout/stderr logs from backend Lambdas are forwarded to **Amazon CloudWatch** Log Groups.
*   **JSON Format**: Application logs utilize structured formats containing:
    *   `timestamp`: UTC ISO format.
    *   `level`: INFO, WARNING, ERROR, or CRITICAL.
    *   `requestId`: The unique AWS Lambda request ID, allowing developers to trace requests across log lines.
    *   `message`: Text description.

### 2. Error Aggregation (`ErrorLog`)
The backend catches unhandled exceptions and saves them to the `error_logs` table:
```python
class ErrorLog(Base):
    __tablename__ = "error_logs"
    id = Column(Integer, primary_key=True, index=True)
    endpoint = Column(String)
    error_message = Column(String)
    traceback = Column(String)
    created_at = Column(DateTime, default=utc_now)
```
Administrators can review and resolve these errors from the admin panel (`GET /api/v1/admin/errors`).

### 3. Alarm Thresholds
We configure CloudWatch Alarms to send alerts via Amazon SNS to Slack/PagerDuty channels:
*   **Lambda Errors**: Trigger alert if Lambda execution error rates exceed 1% over a 5-minute window.
*   **Database CPU**: Trigger alert if Neon database CPU usage exceeds 85% for more than 15 minutes.
*   **Redis Latency**: Trigger alert if Redis read/write timeouts exceed 100ms.

---

## 🔐 Secrets Management & Key Rotation

To ensure security compliance, credentials must not be stored in git repositories or static `.env` configuration files.

### 1. SSM Parameter Resolution
AWS SAM resolves secrets dynamically at deploy time from the AWS SSM Parameter Store:
```yaml
# Example template resolution
Environment:
  Variables:
    DATABASE_URL: '{{resolve:ssm:/notepay/database_url}}'
    GEMINI_KEY_1: '{{resolve:ssm:/notepay/gemini_key_1}}'
```

### 2. Secret Key Rotation Policy
Secrets must be rotated periodically to minimize the impact of leaked credentials:
*   **AI API Keys (Groq/Gemini)**: Rotate every 6 months. Update the parameter values in the AWS Parameter Store, and trigger a CloudFront cache invalidation to force Lambdas to fetch the fresh values.
*   **Database Credentials**: Rotate every 12 months. Update the parameter in SSM, and trigger a database migration check to verify connectivity.

---

## 💾 Backups, Recovery & Disaster Planning

### 1. Neon Database Backups
*   **Daily Snapshots**: Neon automatically creates daily snapshots of the database cluster, retaining them for 30 days.
*   **Point-in-Time Recovery (PITR)**: Neon supports Point-in-Time Recovery, allowing developers to restore the database to any specific second within the last 7 days.
*   **Manual Restoration Procedure**:
    1.  Navigate to the Neon Console > Backups.
    2.  Select the target branch and choose "Restore to point in time".
    3.  Enter the target timestamp.
    4.  Click "Restore". The database cluster will spin up a new branch with the restored data. Update the SSM `/notepay/database_url` parameter to point to the new branch.

### 2. S3 Storage Backups
*   **Bucket Versioning**: The `ReceiptsBucket` is configured with versioning enabled. If a user deletes an image, the system retains the previous version, protecting against accidental deletions.
*   **Cross-Region Replication**: In production, the bucket is configured to replicate uploads automatically to a secondary AWS region, ensuring availability during regional outages.

### 3. Recovery Targets
*   **Recovery Point Objective (RPO)**: The maximum acceptable data loss window is **1 hour**. Daily backups and database write logs ensure that data can be restored to within 1 hour of an outage.
*   **Recovery Time Objective (RTO)**: The maximum acceptable time to restore the application is **4 hours**. Using AWS CloudFormation templates allows engineers to redeploy the entire stack in a new region within 30 minutes if needed.
