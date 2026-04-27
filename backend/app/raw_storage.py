from __future__ import annotations

import re
from typing import Any

from .config import env_value


def persist_raw_upload(plan_id: str, filename: str, content_type: str, data: bytes) -> dict[str, Any] | None:
    bucket = env_value("RAW_PLAN_BUCKET_NAME", "").strip()
    if not bucket:
        return None

    import boto3

    key = f"plans/{plan_id}/{_safe_filename(filename)}"
    client = boto3.client("s3", region_name=env_value("AWS_REGION", "ap-southeast-1"))
    client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type or "application/octet-stream",
        ServerSideEncryption="AES256",
    )
    return {"bucket": bucket, "key": key}


def read_raw_upload(bucket: str, key: str) -> bytes:
    import boto3

    client = boto3.client("s3", region_name=env_value("AWS_REGION", "ap-southeast-1"))
    response = client.get_object(Bucket=bucket, Key=key)
    return response["Body"].read()


def _safe_filename(filename: str) -> str:
    base = filename.rsplit("/", 1)[-1].rsplit("\\", 1)[-1].strip() or "floor-plan-upload"
    return re.sub(r"[^A-Za-z0-9._-]+", "-", base)[:120]
