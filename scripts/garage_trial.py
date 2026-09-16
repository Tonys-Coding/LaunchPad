"""Real SDK and portable archive checks, restricted to a disposable S3 endpoint."""
import hashlib
import json
import os
import subprocess
import sys

import boto3
import botocore
from botocore import UNSIGNED
from botocore.config import Config
from botocore.exceptions import ClientError
import server
import maintenance

assert os.environ["S3_ENDPOINT_URL"] == "http://garage:3900"
assert os.environ["S3_BUCKET"] == "launchpad-garage-trial"
bucket = server.S3_BUCKET
server.init_storage()
print(f"SDK boto3={boto3.__version__}, botocore={botocore.__version__}", flush=True)

objects = {
    "trial/empty.txt": (b"", "text/plain"),
    "trial/space and unicode-é.txt": (b"dummy attachment", "text/plain"),
    "trial/max.bin": (os.urandom(server.MAX_UPLOAD_BYTES), "application/octet-stream"),
}
for index in range(5):
    objects[f"trial/page-{index}.txt"] = (f"page-{index}".encode(), "text/plain")
expected = {key: (hashlib.sha256(data).hexdigest(), mime, len(data))
            for key, (data, mime) in objects.items()}

def verify_all():
    for key, (digest, mime, size) in expected.items():
        data, actual_mime = server.get_object(key)
        assert hashlib.sha256(data).hexdigest() == digest, key
        assert actual_mime == mime, key
        head = server.s3.head_object(Bucket=bucket, Key=key)
        assert head["ContentLength"] == size
    pages = list(server.s3.get_paginator("list_objects_v2").paginate(
        Bucket=bucket, PaginationConfig={"PageSize": 2}))
    assert len(pages) >= 4
    assert {item["Key"] for page in pages for item in page.get("Contents", [])} == set(expected)

for key, (data, mime) in objects.items():
    server.put_object(key, data, mime)
verify_all()
print("PASS: health, put/get/head, byte hashes, types, empty/10MB objects, pagination", flush=True)

for config, secret in [(Config(signature_version=UNSIGNED), "unused"),
                       (Config(signature_version="s3v4"), "deliberately-wrong-secret")]:
    denied = boto3.client("s3", endpoint_url=os.environ["S3_ENDPOINT_URL"],
                          region_name="garage", aws_access_key_id=os.environ["S3_ACCESS_KEY"],
                          aws_secret_access_key=secret, config=config)
    for operation in [lambda: denied.get_object(Bucket=bucket, Key="trial/empty.txt"),
                      lambda: denied.put_object(Bucket=bucket, Key="trial/unauthorized", Body=b"no")]:
        try:
            operation()
        except ClientError as exc:
            assert exc.response["ResponseMetadata"]["HTTPStatusCode"] in (400, 403)
        else:
            raise AssertionError("Unauthorized storage access succeeded")
print("PASS: anonymous and invalid-signature reads/writes rejected", flush=True)

archive = subprocess.run([sys.executable, "/app/maintenance.py", "export-objects"],
                         check=True, stdout=subprocess.PIPE).stdout
for key in expected:
    server.delete_object(key)
assert list(maintenance.object_keys(server.s3, bucket)) == []
server.put_object("trial/extra-after-backup", b"extra", "text/plain")
subprocess.run([sys.executable, "/app/maintenance.py", "restore-objects", "--replace"],
               input=archive, check=True)
verify_all()
print("PASS: delete + portable backup/restore, replacement, exact content verification", flush=True)
for key in expected:
    server.delete_object(key)
assert list(maintenance.object_keys(server.s3, bucket)) == []
print(json.dumps({"result": "passed", "objects": len(expected),
                  "max_bytes": server.MAX_UPLOAD_BYTES, "archive_bytes": len(archive)}))
