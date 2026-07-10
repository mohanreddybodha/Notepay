"""
storage.py — Consolidated Storage Layer for Notepay
Handles dual-mode storage: AWS S3 when RECEIPTS_BUCKET is configured, local disk fallback for dev/testing.
"""
import os
import uuid
import boto3
from fastapi import HTTPException
from fastapi.responses import FileResponse, StreamingResponse

# Module-level S3 client — created once per Lambda container, reused across requests
_s3_client = None


def _get_s3_client():
    """Return a cached boto3 S3 client. Created once per process/Lambda container."""
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client('s3')
    return _s3_client


def fetch_receipt_response(receipt_key: str):
    """
    Fetch a receipt image and return a FastAPI response.
    Handles both AWS S3 and local disk fallback transparently.
    Used by both donation and expense receipt endpoints — single source of truth.
    """
    s3_bucket = os.getenv("RECEIPTS_BUCKET")
    if not s3_bucket or receipt_key.startswith("local://"):
        # Local dev fallback
        local_path = receipt_key.replace("local://", "")
        base_dir = os.path.dirname(os.path.abspath(__file__))
        abs_local_path = os.path.join(base_dir, local_path)
        if not os.path.exists(abs_local_path):
            raise HTTPException(status_code=404, detail="Receipt image not found on local disk")
        return FileResponse(abs_local_path)

    try:
        obj = _get_s3_client().get_object(Bucket=s3_bucket, Key=receipt_key)
        return StreamingResponse(obj['Body'], media_type=obj['ContentType'])
    except Exception as e:
        print(f"Failed to fetch receipt from S3 (key={receipt_key}): {e}")
        raise HTTPException(status_code=404, detail="Receipt image not found in storage")


class StorageService:
    @staticmethod
    def upload_receipt(event_id: str, contents: bytes, content_type: str = "image/jpeg") -> str:
        """Upload a receipt file to S3 or local storage, returning the uniform storage key."""
        s3_bucket = os.getenv("RECEIPTS_BUCKET")
        if s3_bucket:
            receipt_key = f"receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            _get_s3_client().put_object(
                Bucket=s3_bucket,
                Key=receipt_key,
                Body=contents,
                ContentType=content_type or 'image/jpeg'
            )
            return receipt_key
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            local_dir = os.path.join(base_dir, f"uploads/receipts/{event_id}")
            os.makedirs(local_dir, exist_ok=True)
            local_filename = f"uploads/receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            abs_local_path = os.path.join(base_dir, local_filename)
            with open(abs_local_path, "wb") as f:
                f.write(contents)
            return f"local://{local_filename}"


storage_service = StorageService()
