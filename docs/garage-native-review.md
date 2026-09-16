# Garage native-library review and SQLite safeguard

September 15, 2026. This is a scoped review, not a blanket security clearance.
Production storage has not changed. A production Garage deployment is still
subject to the topology and source-maintenance decision below.

## SQLite: add a defense, retain the version finding

The bundled SQLite is 3.51.1. Its [upstream CVE list](https://www.sqlite.org/cves.html)
identifies CVE-2026-11822 and CVE-2026-11824 as the same FTS5 heap-write issue,
fixed in 3.53.2, requiring arbitrary SQL execution and defensive mode disabled.
FTS5 is enabled by this libsqlite3-sys build, so it cannot simply be excluded.

Garage's SQLite adapter binds object keys and values using SQL parameters. Its
interpolated tree names come from internal table-name constants, not bucket names
or uploaded contents. The database path comes from administrator configuration;
uploaded attachments are not opened as SQLite databases. This review checked
`src/db/sqlite_adapter.rs`, `src/table/data.rs`, and model table-name constants.

The [saved patch](../docker/garage/sqlite-defensive.patch) explicitly enables
`SQLITE_DBCONFIG_DEFENSIVE` in every pooled connection's initialization hook,
including replacement connections. Errors propagate instead of silently disabling
the safeguard. Existing journaling and synchronization settings are preserved.
This mitigates the documented disabled-defensive-mode prerequisite; it is not
a claim that SQLite itself was upgraded or all SQL bugs are eliminated.

[SQLite configuration documentation](https://www.sqlite.org/c3ref/c_dbconfig_defensive.html)
describes the protection against database-corrupting SQL features. Release-profile
tests passed for both normal sync settings, parameterized SQL-looking key data,
and rejection of direct schema writes. Garage's existing SQLite and LMDB database
tests also passed: **4 tests total**. The existing tests exercise CRUD, transactions
and rollback, ordered iteration, and range reads.

The optimized server rebuilt successfully in 3 minutes 22 seconds, then the
new exact image passed the real-SDK upload/access-control/object backup/restore
trial again (8 dummy objects including a 10 MB file, exact restored hashes).
No live storage or user records were used.

- Binary SHA-256: `ee562de191d65b6f04de7477fd6085f3fd38d6aa589e72a1365a109a24d1ff26`.
- Image: `launchpad-garage-candidate:2.4.1-xml-h2-defensive`.
- Immutable local image index: `sha256:0d8cc163079d1c9b837e4f0e249b5a050042af9d6262593da5622380bab8e5f4`.
- ARM64 manifest: `sha256:b03b19538f0c43d5f44652196a6996047d468a9fd2753869470bb7f9c75803cf`.
- [New raw scan](garage-candidate-defensive-scan.sarif.json) and
  [SBOM](garage-candidate-defensive.sbom.json): 9 runtime packages, 0 critical,
  0 high, 0 medium, 7 low findings. Static-library coverage limits still apply.
- Cargo.lock is unchanged; the selected registry dependency inventory remains the
  same. The patched source is saved in the build recipe alongside the XML/h2 fixes.

The initial offline database-test invocation lacked the `mktemp` test dependency;
the successful retry downloaded that locked package and completed all checks.
Build/test logs remain in the stopped `launchpad-garage-defensive-build` container.
Release artifacts: `/tmp/launchpad-garage-defensive-artifact.48lXYh`.
The disposable trial's containers/network were removed, with dummy volume
`launchpad-garage-trial-c0dd6182_trial_data` retained. No user data was deleted.

Older SQLite issues fixed by 3.51.1 are not outstanding simply because the scanner
does not index the bundled copy. The newer zipfile-extension CVE-2025-70873 concerns
an extension not used by the reviewed adapter; no dynamic extension-loading or
ZIP-to-SQL operation was found. Do not extend these conclusions to arbitrary SQL
execution, operator-supplied corrupt databases, or future extension features.

## libsodium: do not mark the bundled version patched

libsodium-sys 0.2.7 bundles libsodium 1.0.18, independent of the patched Debian
package installed in the builder. CVE-2025-69277 remains a version-level match.
The [upstream maintainer's explanation](https://00f.net/2025/12/30/libsodium-vulnerability/)
identifies low-level Ed25519 point validation and distinguishes it from ordinary
signing APIs. Version 1.0.21 includes the fix.

No direct `crypto_core_ed25519_is_valid_point` invocation was found in Garage or
its kuska wrappers. However, the old release binary includes the shared internal
`ge25519_is_on_main_subgroup` implementation. The bundled C source also calls it
from public-key conversion, and kuska's handshake calls that conversion. The
server-side path verifies authenticated client material and an Ed25519 signature
before conversion, reducing the attack surface. These are mitigating facts, not
proof that the vulnerable helper was compiled out. We have not declared this
dependency clean or silently suppressed its finding.

If choosing to operate this custom Garage build, use a maintained patched sodium
library and re-test the actual cluster handshake instead of treating a source grep
or the OS-package scan as sufficient clearance. This additional maintenance is a
real consideration in the storage-provider decision.

## Other bundled libraries

- zstd 1.5.7: reviewed the [upstream release](https://github.com/facebook/zstd/releases/tag/v1.5.7)
  and [security page](https://github.com/facebook/zstd/security). No published
  advisory was listed there at review time. Garage uses the library to compress
  and decode storage blocks, not the zstd command-line program or dictionary
  training interface. This is not an exhaustive guarantee about unknown bugs.
- LMDB header 0.9.70: compiled as an optional engine but not selected by the trial's
  explicit SQLite configuration. The [reported mdb_load input issue](https://lists.openldap.org/hyperkitty/list/openldap-bugs%40openldap.org/thread/VO42N3U73N5TTBZYQ4BANIVXA4CPYNDU/)
  concerns a separate command-line tool, not the selected metadata path. Re-review
  LMDB before changing the configured engine; do not transfer unrelated OpenLDAP
  server CVEs to the library without checking the affected component.

These entries complement the [selected Rust audit](garage-selected-hardening-results.md)
and [runtime image scan](garage-candidate-results.md). None substitutes for the
other. The final release gate must cover the exact architecture and enabled features.

## Production decision needed

The [official Garage configuration guidance](https://garagehq.deuxfleurs.fr/documentation/reference-manual/configuration/)
explicitly reserves replication factor 1 for test deployments. Running multiple
containers on one physical server is not protection from that server failing.
Backups are required but do not turn one node into a replicated cluster.

Recommendation: do not replace MinIO with this single-node candidate in the
currently planned one-server beta. The compatibility trial is useful and retained,
but adopting Garage also means owning these patches and a replicated deployment.
Discuss managed S3-compatible attachment storage versus a self-hosted replicated
service before provisioning or migrating anything. Either can remain independent
of Emergent; no external storage account has been created or configured.

While that user choice is pending, the next independent implementation work is
the account-write protection for quotas, imports, and deletion. The full six-stage
production goal remains active, with storage selection still an explicit release gate.
