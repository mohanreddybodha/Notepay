"""
storage.py — Consolidated Storage Layer for Notepay
Handles dual-mode storage: AWS S3 when RECEIPTS_BUCKET is configured, local disk fallback for dev/testing.
"""
import os
import uuid
import boto3


class StorageService:
    @staticmethod
    def upload_receipt(event_id: str, contents: bytes, content_type: str = "image/jpeg") -> str:
        """Upload a receipt file to S3 or local storage, returning the uniform storage key."""
        s3_bucket = os.getenv("RECEIPTS_BUCKET")
        if s3_bucket:
            receipt_key = f"receipts/{event_id}/{uuid.uuid4().hex}.jpg"
            s3_client = boto3.client('s3')
            s3_client.put_object(
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
