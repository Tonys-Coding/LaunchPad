# Garage 2.4.1 runtime dependency review

Latest follow-up: [selected dependency hardening](garage-selected-hardening-results.md)
has completed the XML and HTTP/2 updates with successful tests and build. The
"next" actions below are the historical review that led to those fixes.

Follow-up: the [XML patch is implemented and tested](garage-xml-fix-results.md).
Cargo's resolved server graph also confirms the old webpki dependency is excluded
from the tested ARM64 default-feature build.

Source reviewed: `268334bd2530fa99f8b06c7383b2e9f776691edd` (2.4.1).
**Outcome: do not migrate yet. A focused XML parser update is the next fix to test.**

## Correction to the earlier severity summary

The previous comparison counted only OSV's textual `database_specific.severity`.
Two quick-xml entries lacked that label but carried CVSS vectors rated **7.5 HIGH**
by RustSec. Therefore “one explicitly labeled high” was a narrow metadata count,
not the complete high-severity inventory. There are at least three distinct
high-rated advisories in the reviewed lockfile: webpki plus the two XML issues.
Unrated advisories remain review items, not automatic passes.

## Certificate library: likely test-only, not a production clearance

The reverse lockfile dependency graph gives these routes:

`rustls-webpki 0.101.7 <- rustls 0.21.12 <- aws-smithy-http-client 1.1.12
<- aws-smithy-runtime 1.11.1 <- Garage integration-test dependencies`.

Other routes pass through aws-sdk-s3 or aws-sdk-config/k2v-client. In
`src/garage/Cargo.toml`, aws-sdk-s3, aws-smithy-runtime and k2v-client are under
`[dev-dependencies]`. Production Consul integration declares the separate rustls
0.23 and hyper-rustls 0.27 families. No direct CRL/revocation setup was found in
Garage's own source.

This supports treating the 0.101.7 finding as **likely absent from the server build**,
not blindly upgrading its transitive dependency. Confirm with Cargo's resolved
normal/build feature graph and a build inventory before recording an artifact-level
exception. A lockfile walk is not a substitute for feature resolution, and a source
search does not prove absence inside third-party code. The reviewed release recipe
in `nix/compile.nix` enables optional discovery, metrics and telemetry features.

The [webpki advisory](https://github.com/advisories/GHSA-82j2-j2ch-gfr8) also requires
opt-in CRL checking with attacker-influenced input. No exception or suppression was
added in this step.

## XML parser: relevant server dependency, patched upstream

Workspace `Cargo.toml` pins quick-xml to the 0.39 series (lockfile 0.39.2).
`src/api/s3/Cargo.toml` and `src/api/common/Cargo.toml` depend on it normally.
The CORS, lifecycle and website configuration handlers call
`quick_xml::de::from_reader` on request bodies. Inspection of the published 0.39.2
crate confirms its deserializer constructs an `NsReader` internally.

- [RUSTSEC-2026-0194](https://rustsec.org/advisories/RUSTSEC-2026-0194.html):
  quadratic duplicate-attribute checking; fixed in quick-xml **0.41.0 or later**.
- [RUSTSEC-2026-0195](https://rustsec.org/advisories/RUSTSEC-2026-0195.html):
  unbounded namespace-declaration allocation in NsReader; fixed in **0.41.0 or later**.

These are real parser paths, although exploiting them also depends on reaching
the storage endpoint and having permission for the relevant configuration action.
LaunchPad's normal attachment upload wrapper does not expose those configuration
operations. Private networking and limited credentials reduce exposure; they do
not fix the parser. Do not disable duplicate checks or namespace validation as a
shortcut. An HTTP timeout alone does not interrupt synchronous parser computation.

## Other network-related findings

- **h2:** both locked versions match RUSTSEC-2026-0258. The reviewed S3 generic server
  explicitly uses `hyper::server::conn::http1::Builder`; that ingress path is not
  HTTP/2. Optional outgoing clients/telemetry and other binaries still need feature
  review. RustSec calls the issue low severity and lists 0.4.16 as patched; do not
  force a 0.3 dependency to 0.4 without updating its parent.
- **rustls 0.23.39:** RUSTSEC-2026-0285 concerns TLS handshake encryption levels;
  the advisory lists **0.23.45** as fixed. This series is used by optional production
  discovery clients. A compatible lockfile update should be included in subsequent
  hardening, without disabling certificate validation.
- **protobuf 2.28.0:** metrics dependencies include protobuf, while the inspected
  admin metrics code uses Prometheus TextEncoder. No input protobuf decoder was
  established here; this is not a blanket runtime exception.

Sources: [h2 advisory](https://rustsec.org/advisories/RUSTSEC-2026-0258.html),
[rustls advisory](https://osv.dev/vulnerability/RUSTSEC-2026-0285).
Memory-safety and maintenance notices elsewhere in the inventory remain open.

## Next single implementation step

In an isolated pinned source build, test upgrading quick-xml from 0.39 to 0.41.x.
This crosses pre-1.0 minor versions, so expect possible API changes. Preserve XML
validation, run Garage's XML/CORS/lifecycle/website regression tests, and add
malformed-attribute/namespace cases with resource bounds. Save the exact patch and
updated dependency inventory. Do not change LaunchPad's running storage.

Only after that targeted fix passes should we combine other compatible dependency
updates and rerun the S3 trial. A reproducible artifact/build inventory and the
single-server topology decision remain prerequisites for migration.

This review copied public source to `/tmp/launchpad-garage-audit.FbQlsc/source`
for inspection. It did not run exploit requests, modify that checkout, access user
documents, restart services, or move any data.
