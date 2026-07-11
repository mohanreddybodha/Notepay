"""
storage.py — Consolidated Storage Layer for Notepay
Handles dual-mode storage: AWS S3 when RECEIPTS_BUCKET is configured, local disk fallback for dev/testing.
"""
import os
import uuid
import boto3
from fastapi import HTTPException
from fastapi.responses import FileResponse, StreamingResponse

# Allowed image magic-byte signatures (content-based validation, not just extension)
_ALLOWED_MAGIC: dict[str, bytes] = {
    "image/jpeg":  b"\xff\xd8\xff",
    "image/png":   b"\x89PNG\r\n\x1a\n",
    "image/gif":   b"GIF8",
    "image/webp":  b"RIFF",
}
_MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


def validate_receipt_content(contents: bytes, declared_content_type: str = "") -> str:
    """Validate that the file bytes match a known image signature.
    Returns the detected content_type string or raises HTTPException(400)."""
    for mime, magic in _ALLOWED_MAGIC.items():
        if contents[:len(magic)] == magic:
            return mime
    raise HTTPException(
        status_code=400,
        detail="Invalid file: only JPEG, PNG, GIF, or WEBP images are accepted"
    )

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
        """Upload a receipt file to S3 or local storage, returning the uniform storage key.
        Validates magic bytes before storing — prevents non-image content from being stored."""
        if len(contents) > _MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=400, detail="File too large (max 5MB)")
        detected_type = validate_receipt_content(contents, content_type)
        s3_bucket = os.getenv("RECEIPTS_BUCKET")
        safe_ext = {"image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp"}.get(detected_type, "jpg")
        if s3_bucket:
            receipt_key = f"receipts/{event_id}/{uuid.uuid4().hex}.{safe_ext}"
            _get_s3_client().put_object(
                Bucket=s3_bucket,
                Key=receipt_key,
                Body=contents,
                ContentType=detected_type
            )
            return receipt_key
        else:
            base_dir = os.path.dirname(os.path.abspath(__file__))
            local_dir = os.path.join(base_dir, f"uploads/receipts/{event_id}")
            os.makedirs(local_dir, exist_ok=True)
            local_filename = f"uploads/receipts/{event_id}/{uuid.uuid4().hex}.{safe_ext}"
            abs_local_path = os.path.join(base_dir, local_filename)
            with open(abs_local_path, "wb") as f:
                f.write(contents)
            return f"local://{local_filename}"


storage_service = StorageService()
