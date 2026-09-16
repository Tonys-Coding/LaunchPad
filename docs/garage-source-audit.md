# Garage 2.3.0 source and provenance audit

Follow-up: [Garage 2.4.1 comparison](garage-2.4.1-audit.md) is now complete.

September 14, 2026. **Do not promote the tested 2.3.0 image to production.**
The source inventory has known dependency advisories; the prior empty container
scan was not a clean dependency audit. Runtime exploitability still requires
build-feature and call-path analysis.

## Dependency findings

The repeatable script `scripts/audit-garage-dependencies.py` retrieves an immutable
lockfile and queries OSV's crates.io package/version API. Only public dependency
metadata was sent; no application data or credentials were accessed.

- Tag object: `9458d51c9d3c215651a7e7c01e3a3c212615e978` (`v2.3.0`).
- Source commit: `7b119c0b4fa58ab3cb6d5db435fe52d990f6a7aa`.
- Cargo.lock SHA-256: `ccdfa382044cbbb38dd45448463607d9952893ea41165f25cc1232e42fb66739`.
- 574 lockfile entries: 559 registry entries queried, 15 workspace packages,
  no external Git dependencies.
- 50 raw advisory matches across 17 package names. These include aliases,
  multiple versions, maintenance notices and lower/unrated severities; they are
  **not 50 distinct exploitable vulnerabilities**.
- Eleven package/version/advisory matches explicitly labeled HIGH in returned
  metadata, representing ten distinct GHSA IDs. Missing severity is not assumed safe.

Full evidence: [OSV audit JSON](garage-v2.3.0-osv-audit.json).

| Package/version | Explicitly high GHSA IDs |
| --- | --- |
| aws-lc-sys 0.37.0 | 394x-vwmw-crm3; 65p9-r9h6-22vj; 9f94-5g5w-gf6r; hfpc-8r3f-gw53; vw5v-4f2q-w9xf |
| lz4_flex 0.11.5 | vvp9-7p8x-rfvv |
| parse_duration 2.1.1 | qpgv-g792-wh6x |
| quinn-proto 0.11.13 | 4w2j-m93h-cj5j; 6xvm-j4wr-6v98 |
| rustls-webpki 0.101.7 and 0.103.9 | 82j2-j2ch-gfr8 |

Individual summaries, aliases, severity metadata and source URLs are in the JSON.
No findings were suppressed. The lockfile can include optional/build/test packages;
this audit does not prove every dependency is compiled into the tested binary.
Workspace flaws, Rust standard library and bundled native libraries require
additional coverage. This is not an exhaustive security review.

## Binary provenance

- Image index: `sha256:866bd13ed2038ba7e7190e840482bc27234c4afaf77be8cfa439ae088c1e4690`.
- ARM64 manifest: `sha256:2d3f94a89a8a02dc49fa75594d6df67ed9c6ffe08fe55ed023d0c9776f71a9bd`.
- Container `/garage` binary SHA-256:
  `8ced2ad3040262571de08aa600959aa51f97576d55da7946fcde6f66140705e2`.
- The [official ARM64 release download](https://garagehq.deuxfleurs.fr/_releases/v2.3.0/aarch64-unknown-linux-musl/garage)
  has the same hash: a byte-for-byte match to the tested container binary.
- Version output identifies 2.3.0 with bundled-libs, consul-discovery, fjall,
  journald, k2v, kubernetes-discovery, lmdb, metrics, sqlite, syslog, telemetry-otlp.
- Inspected image index contains platform manifests, not provenance/SBOM
  attestations; image labels are absent. Forgejo reports the tag verification as
  false (`gpg.error.not_signed_commit`). No trusted signature chain was established.

The matching publisher artifacts provide integrity evidence, **not** independent
reproducibility or a verified source-to-binary attestation. These gaps alone do not
imply tampering. The [release-process documentation](https://garagehq.deuxfleurs.fr/documentation/development/release-process/)
describes Nix builds/publication but does not itself bind this binary to the audited
source. No source rebuild was attempted in this bounded step.

## Next bounded step

The [official release index](https://garagehq.deuxfleurs.fr/_releases.json) lists
2.4.1 binaries dated September 8, 2026. The quick-start example selected 2.3.0,
not the newest release. Audit immutable 2.4.1 source and compare findings before
another compatibility trial or any dependency backporting. Do not assume the newer
release is clean. Leave the existing trial and real MinIO storage unchanged.

The single-server production topology concern remains separate. No migration,
account change, or running service restart occurred. The temporary inspection
container was removed. Local application health still passes.
