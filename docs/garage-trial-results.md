# Garage isolated trial results

September 14, 2026. **Compatibility passed; security clearance remains incomplete.**
No migration was performed and default/production Compose files were not changed.

Follow-up: the [source/provenance audit](garage-source-audit.md) found high-severity
dependency matches. The container binary matches the official release download,
but 2.3.0 should not be promoted to production.

## Artifacts and isolation

- Garage `v2.3.0`, pinned image digest
  `sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690`, Linux ARM64.
- Test client: existing LaunchPad production backend image `bb5c27cf9753`, with
  boto3 1.43.64 and botocore 1.43.93; no checksum validation settings overridden.
- Dedicated internal Docker network, new test volume, randomly generated disposable
  credentials, no host ports, and no admin or website listener.
- Only dummy objects; no production/local databases or storage volumes attached.
- Trial containers and network removed afterward. The test volume
  `launchpad-garage-trial-f3240e3c_trial_data` remains for inspection; dummy S3 objects
  were deleted by the test. Existing LaunchPad containers were not restarted.

## Passing checks

The trial ran LaunchPad's existing storage helpers and maintenance archive code:

- Bucket health check with a pre-provisioned bucket.
- Eight objects, including empty, Unicode/space-containing keys, and a random
  10,485,760-byte attachment (the current 10 MiB limit).
- Put/Get/Head, SHA-256 byte verification, content types, and paginated listings
  with page size two.
- Anonymous and incorrect-signature reads and writes rejected.
- Portable attachment archive export, deletion of the original dummy objects,
  restore with replacement of an extra object, and exact post-restore verification.
- Final object deletion and empty-bucket verification.

This is an S3 compatibility trial, not the full application UI/ownership suite or
an encrypted off-server recovery test. Encryption was exercised in the earlier
isolated MinIO restore drill, not this trial. Bucket creation uses Garage's test
bootstrap mechanism; production least-privilege provisioning remains to be built.

## Security scan limitation

`docker scout cves --only-severity critical,high local://dxflrs/garage:v2.3.0`
reported zero findings **and indexed zero packages**. The image contains a compiled
Rust binary without package metadata the scanner could identify. This result does
not establish that Garage or its dependencies are free of high/critical issues.

The official [v2.3.0 Cargo.lock](https://git.deuxfleurs.fr/Deuxfleurs/garage/raw/tag/v2.3.0/Cargo.lock)
is available. A source dependency audit and evidence linking the source/build to
the pinned binary (or a reproducible build with an SBOM) remain required. Do not
mark the storage security release gate complete based on this image scan.

## Production topology constraint

Garage's [official configuration guidance](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)
limits replication factor one to test deployments; its
[single-node quick start](https://garagehq.deuxfleurs.fr/documentation/quick-start/)
explicitly warns against production use without redundancy. This trial uses one
node solely for compatibility testing. It is not a recommended production layout.

The original LaunchPad plan specifies one Linux server. Garage therefore is not
yet approved as a drop-in production choice: resolve the redundancy/server-count
tradeoff with the owner before any migration. Multiple containers on one server
do not provide protection from loss of that server, and backups are not live redundancy.

## Repeat the trial

From the project directory, run `bash scripts/test-garage.sh`. It uses only the
standalone `compose.garage-trial.yaml`, creates a unique project, and requires the
existing `launchpad-production-backend:latest` image locally. It does not build or
modify the user's application. Fresh runs retain separate test volumes; do not
confuse those volumes with the real MinIO volumes.

## Next bounded step

Audit Garage v2.3.0's source dependencies and build provenance. Report whether it
can pass the security gate before asking for a production topology decision.
Do not copy user data, replace MinIO, or provision additional servers in that step.
