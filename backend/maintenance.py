"""Stream Launchpad's S3-compatible objects to and from a portable archive."""

import argparse
import io
import json
import os
import sys
import tarfile
import shutil
import tempfile

import boto3
from botocore.config import Config


def storage_client():
    return boto3.client(
        "s3",
        endpoint_url=os.environ.get("S3_ENDPOINT_URL") or None,
        aws_access_key_id=os.environ.get("S3_ACCESS_KEY") or None,
        aws_secret_access_key=os.environ.get("S3_SECRET_KEY") or None,
        region_name=os.environ.get("S3_REGION", "us-east-1"),
        config=Config(signature_version="s3v4"),
    )


def object_keys(client, bucket):
    paginator = client.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=bucket):
        for item in page.get("Contents", []):
            yield item["Key"]


def export_objects():
    client = storage_client()
    bucket = os.environ.get("S3_BUCKET", "launchpad")
    objects = []
    for key in object_keys(client, bucket):
        response = client.head_object(Bucket=bucket, Key=key)
        objects.append({
            "key": key,
            "content_type": response.get("ContentType", "application/octet-stream"),
            "size": response["ContentLength"],
        })

    with tarfile.open(fileobj=sys.stdout.buffer, mode="w|gz") as archive:
        manifest_data = json.dumps({"version": 1, "objects": objects}, indent=2).encode()
        manifest = tarfile.TarInfo("manifest.json")
        manifest.size = len(manifest_data)
        manifest.mode = 0o600
        archive.addfile(manifest, io.BytesIO(manifest_data))

        for index, metadata in enumerate(objects):
            response = client.get_object(Bucket=bucket, Key=metadata["key"])
            info = tarfile.TarInfo(f"objects/{index}")
            info.size = metadata["size"]
            info.mode = 0o600
            try:
                archive.addfile(info, response["Body"])
            finally:
                response["Body"].close()


def restore_objects(replace):
    client = storage_client()
    bucket = os.environ.get("S3_BUCKET", "launchpad")
    # Validate the complete archive before replacing any existing object.
    # Spill to disk so total attachment size cannot exhaust process memory.
    with tempfile.TemporaryFile() as snapshot:
        shutil.copyfileobj(sys.stdin.buffer, snapshot)
        snapshot.seek(0)
        with tarfile.open(fileobj=snapshot, mode="r:gz") as archive:
            restore_validated_archive(client, bucket, archive, replace)


def restore_validated_archive(client, bucket, archive, replace):
    first = archive.next()
    if not first or first.name != "manifest.json" or not first.isfile():
        raise RuntimeError("Invalid object archive: manifest.json must be first")
    manifest_file = archive.extractfile(first)
    manifest = json.load(manifest_file)
    if manifest.get("version") != 1:
        raise RuntimeError("Unsupported object archive version")

    objects = manifest.get("objects", [])
    if not isinstance(objects, list):
        raise RuntimeError("Invalid object manifest")
    validated = []
    keys = set()
    for index, metadata in enumerate(objects):
        member = archive.next()
        if not member or member.name != f"objects/{index}" or not member.isfile():
            raise RuntimeError(f"Invalid object archive entry {index}")
        key = metadata.get("key")
        if not isinstance(key, str) or not key or key.startswith("/") or ".." in key.split("/"):
            raise RuntimeError(f"Unsafe object key at entry {index}")
        if key in keys:
            raise RuntimeError(f"Duplicate object key at entry {index}")
        keys.add(key)
        expected_size = metadata.get("size")
        if member.size != expected_size:
            raise RuntimeError(f"Object size mismatch at entry {index}")
        # Force a full read now, catching truncation before deleting data.
        with archive.extractfile(member) as body:
            while body.read(64 * 1024):
                pass
        validated.append((metadata, member))
    if archive.next() is not None:
        raise RuntimeError("Unexpected trailing object archive entry")
    if replace:
        for key in object_keys(client, bucket):
            client.delete_object(Bucket=bucket, Key=key)
    for metadata, member in validated:
        client.put_object(
            Bucket=bucket,
            Key=metadata["key"],
            Body=archive.extractfile(member),
            ContentType=metadata.get("content_type", "application/octet-stream"),
        )


def main():
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    subcommands.add_parser("export-objects")
    restore = subcommands.add_parser("restore-objects")
    restore.add_argument("--replace", action="store_true")
    args = parser.parse_args()

    if args.command == "export-objects":
        export_objects()
    else:
        restore_objects(args.replace)


if __name__ == "__main__":
    main()
