#!/usr/bin/env python3
"""Probe LaunchPad's configured S3 bucket without exposing credentials."""

import hashlib
import os
import uuid

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError


required = ("S3_ENDPOINT_URL", "S3_ACCESS_KEY", "S3_SECRET_KEY", "S3_BUCKET", "S3_REGION")
missing = [name for name in required if not os.environ.get(name)]
if missing:
    raise SystemExit(f"Missing required storage settings: {', '.join(missing)}")

bucket = os.environ["S3_BUCKET"]
key = f"launchpad/system-checks/{uuid.uuid4().hex}.txt"
payload = b"LaunchPad storage connection check\n"
client = boto3.client(
    "s3",
    endpoint_url=os.environ["S3_ENDPOINT_URL"],
    aws_access_key_id=os.environ["S3_ACCESS_KEY"],
    aws_secret_access_key=os.environ["S3_SECRET_KEY"],
    region_name=os.environ["S3_REGION"],
    config=Config(signature_version="s3v4"),
)

try:
    client.head_bucket(Bucket=bucket)
    client.put_object(Bucket=bucket, Key=key, Body=payload, ContentType="text/plain")
    metadata = client.head_object(Bucket=bucket, Key=key)
    downloaded = client.get_object(Bucket=bucket, Key=key)["Body"].read()
    listed = client.list_objects_v2(Bucket=bucket, Prefix=key).get("Contents", [])
    assert metadata["ContentLength"] == len(payload)
    assert hashlib.sha256(downloaded).digest() == hashlib.sha256(payload).digest()
    assert any(item.get("Key") == key for item in listed)
finally:
    try:
        client.delete_object(Bucket=bucket, Key=key)
    except ClientError:
        pass

try:
    client.head_object(Bucket=bucket, Key=key)
except ClientError as exc:
    code = str(exc.response.get("Error", {}).get("Code", ""))
    if code not in {"404", "NoSuchKey", "NotFound"}:
        raise
else:
    raise RuntimeError("Storage probe object was not removed")

print("LaunchPad storage connection check passed")
