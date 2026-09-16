# Storage security assessment

Assessment date: September 15, 2026. The production decision is complete:
LaunchPad will use an independently provisioned private S3-compatible bucket.
Neither the vulnerable MinIO image nor the single-node Garage candidate is in the
normal production service set. MinIO remains local-development infrastructure only.

The production overlay requires the endpoint, region, bucket name, and bucket-scoped
credential; it does not start storage or try to create the bucket. The repeatable
`scripts/test-production-storage-config.sh` probe verifies Head, Put, Get, List, and
Delete using a unique `launchpad/system-checks/` object and removes that object.
The same probe passed against the local S3-compatible path on September 15.

The assessment below is retained as the reason the bundled storage candidates were
rejected, not as a remaining choice or migration plan.

## Outcome

Follow-up: the [isolated Garage trial](garage-trial-results.md) passed storage and
archive compatibility checks. Its container scan indexed zero packages, so source
dependency/build verification remains open. Official Garage guidance also requires
reconsidering the original single-server production topology before selecting it.

Do not launch with the current custom MinIO image unchanged. Some findings depend
on unused identity features, but two concern ordinary object-upload authentication.
Updating its Go dependencies alone does not fix the MinIO application code.

The Garage compatibility/security trial was completed and passed functionally, but
its single-node deployment guidance is unsuitable for this production beta. No real
user files were copied and local MinIO data was not changed.

## Exposure and evidence

- The checked-in Compose files do not publish storage ports. Running local and test
  storage containers likewise have no host port bindings. They remain reachable
  by peers on their Docker networks; the shared network is not a strict backend-only
  storage boundary.
- LaunchPad's backend makes the S3 requests. It does not return S3 credentials or
  presigned URLs to users, forward arbitrary storage headers, or expose S3 Select.
- The backend currently uses storage root credentials. Production should instead
  use an application credential limited to the LaunchPad bucket, with provisioning
  and administrative credentials separate.
- OIDC/LDAP are absent from checked-in storage environment settings. Persisted
  identity configuration was **not** inspected, so runtime non-applicability has
  not been established. No secrets or stored documents were retrieved in this review.

| Finding | Applicability assessment | Disposition |
| --- | --- | --- |
| [CVE-2026-33322](https://github.com/minio/minio/security/advisories/GHSA-5cx5-wh4m-82fh) | MinIO OIDC token verification; requires that identity integration and knowledge of its client secret. LaunchPad Google login is separate. | Configuration-dependent; not suppressed. |
| [CVE-2026-33419](https://github.com/minio/minio/security/advisories/GHSA-jv87-32hw-hh99) | MinIO LDAP login enumeration/brute force. No LDAP integration in Compose. | Configuration-dependent; verify persisted settings before any exception. |
| [CVE-2026-41145](https://github.com/minio/minio/security/advisories/GHSA-hv4r-mvr4-25vw) | Upload signature bypass with a known valid access key and storage network access; secret key not required. | Relevant vulnerable upload code; retain as a blocker. |
| [CVE-2026-40344](https://github.com/minio/minio/security/advisories/GHSA-9c4q-hq6p-c237) | Unsigned-trailer upload authentication issues. Advisory overlaps the query-credential issue above. | Keep both scanner IDs; do not assume seven independent exploit paths. |
| [CVE-2026-39414](https://github.com/minio/minio/security/advisories/GHSA-h749-fxx7-pwpg) | Authenticated S3 Select CSV processing can exhaust memory. LaunchPad does not call Select, but the storage service supports it. | Reduced application exposure, not a code fix. |
| [CVE-2026-34204](https://github.com/minio/minio/security/advisories/GHSA-3rh2-v3gr-35p9) | A storage writer can inject encryption metadata via replication headers. LaunchPad constructs its own upload request. | Reduced application exposure; still present for direct storage callers. |
| CVE-2018-1000538 | The pinned source includes the historical streaming-hash DoS fix. The scanner compares a Go pseudo-version against a date-style release version. | Source-level evidence supports a version-matching false positive; no scanner suppression added. |

For the 2018 issue, the [fix commit](https://github.com/minio/minio/commit/9c8b7306f55f2c8c0a5c7cea9a8db9d34be8faa7)
changes request hashing to streaming. The [GitHub ancestry comparison](https://github.com/minio/minio/compare/9c8b7306f55f2c8c0a5c7cea9a8db9d34be8faa7...7aac2a2c5b7c882e68c1ce017d8256be2feea27f)
returned the fix as merge base, with the pinned source 7,659 commits ahead and zero
behind. The Dockerfile pins that source and alters dependencies, not those handlers.
This evidence does not dismiss any 2026 issue.

## Remediation options

1. **Recommended trial: Garage, self-hosted.** Its documented S3 operations cover
   LaunchPad's current needs. It avoids taking ownership of a private MinIO security
   fork. It must pass our tests and an image/dependency scan before selection.
2. **AIStor:** the MinIO advisories identify fixes in this separate distribution.
   Assess its current licensing and operating requirements with the owner before
   selecting it. It is not an automatic in-place upgrade decision.
3. **Patch the MinIO fork:** possible, but requires reviewing/backporting multiple
   application fixes, regression tests, and ongoing security maintenance. Not the
   preferred maintenance burden for this small beta.

Private networking and request filters can reduce exposure temporarily; they do
not justify declaring the current image patched. No external storage service or
paid subscription is required merely to run the proposed local trial.

## Bounded next implementation step

Create a separate test-only Garage service with empty volumes, disposable keys,
and no publicly exposed S3/admin ports. Pin its release/digest and scan that exact
artifact, including unfixed vulnerabilities. Do not change default Compose files.

Test the existing boto3 path for bucket health, Put/Get/Head/Delete, paginated
ListObjectsV2, content type preservation, empty files, and the largest allowed
attachment. Verify the installed SDK's checksum/signing behavior rather than
disabling integrity checks to make a test pass. Confirm unauthorized access fails.
Exercise the existing portable attachment backup/restore code on dummy data.

Garage uses bucket/key permissions rather than AWS IAM policies. Pre-provision the
bucket with administrative tooling; normal application credentials should not
need bucket-creation rights. Configure its region consistently in both backend
and maintenance clients. The [S3 compatibility reference](https://garagehq.deuxfleurs.fr/documentation/reference-manual/s3-compatibility/)
lists the needed operations but also warns that real compatibility testing is
necessary. It lacks object versioning; LaunchPad currently does not use it.

Only after that trial passes should a separate approved migration step modify
production configuration. Preserve object keys referenced by MongoDB, compare
object counts/byte sizes/content hashes, freeze writes during final copying, and
keep the old storage intact for rollback. Use new destination volumes—never mount
MinIO's internal data directory into a different storage engine. A single-server
deployment still needs off-server backups; local replicas are not server-loss protection.

The backend's three high findings and other release gates remain separate work.
