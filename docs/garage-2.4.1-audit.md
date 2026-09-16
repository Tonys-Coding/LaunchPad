# Garage 2.4.1 dependency comparison

September 14, 2026. **Improved source inventory; not yet cleared for production.**
No container, storage, or user data was changed in this step.

Follow-up: the [runtime review](garage-runtime-review.md) traced webpki toward
test tooling and confirmed relevant server XML parsing paths. Two XML advisories
are rated HIGH from CVSS despite lacking the text label counted below. The table
is a metadata comparison, not a complete severity classification.

## Scope and evidence

The official `v2.4.1` annotated tag `cdc4ca791f1b0cdc8c93d2ba5a9db797c10143ad`
resolves to commit `268334bd2530fa99f8b06c7383b2e9f776691edd`. The publisher's
Forgejo API reports the tag signature verified, signer `lx / 0E496D15096376BE`.
This is publisher-reported tag verification, not an independently verified key
chain or a source-to-container attestation. No 2.4.1 image was pulled or tested.

The read-only audit queried 558 crates.io package/version entries in the immutable
lockfile. There are 574 entries total, including 16 workspace packages and no
external Git dependencies. Lockfile SHA-256:
`02ed5aba4ef8644207309f16e808abf17bcee6423efb7ae91341916e9a3598aa`.

The audit utility now accepts an explicitly validated full source commit and
retries transient network failures. The first request failed while retrieving
advisory details; the completed retry produced the report below. A partial query
was not used as evidence of success.

## Comparison

| Check | 2.3.0 snapshot | 2.4.1 snapshot |
| --- | ---: | ---: |
| Registry entries queried | 559 | 558 |
| Raw advisory matches | 50 | 21 |
| Matches explicitly labeled HIGH | 11 | 1 |
| Distinct explicitly high GHSA IDs | 10 | 1 |

Counts include aliases and multiple versions; they are not counts of independent
exploitable vulnerabilities. Unrated entries are not assumed safe. These are live
advisory-database snapshots, not an immutable proof of all upstream fixes.

The nine previously high GHSA IDs for aws-lc-sys, lz4_flex, parse_duration and
quinn-proto no longer match the 2.4.1 lockfile. The high rustls-webpki issue no longer
matches the newer webpki entry but remains for version **0.101.7**.

Remaining high finding: [GHSA-82j2-j2ch-gfr8](https://github.com/advisories/GHSA-82j2-j2ch-gfr8),
also represented by RUSTSEC-2026-0104. It describes a panic when parsing a malformed
certificate revocation list. The advisory requires opt-in CRL checking and
attacker-influenced CRL input; default rustls configuration is not affected.
Whether Garage's compiled features use this path has **not** been established.
Do not suppress it solely because LaunchPad terminates incoming HTTPS at Caddy.

Other matches include HTTP/2 and XML denial-of-service reports, Rust memory-safety
reports, TLS behavior, and maintenance notices. Several have no explicit severity
label. The 21-match inventory still requires review beyond the one labeled high.

Raw evidence: [2.4.1 audit JSON](garage-v2.4.1-osv-audit.json),
[2.3.0 audit JSON](garage-v2.3.0-osv-audit.json).

## Next bounded step

Trace the remaining webpki dependency through Garage's production build features
and check the CRL preconditions. Identify a supported parent-dependency update or
a source-backed non-applicability decision; do not force an incompatible transitive
version or remove TLS validation. Include a review of the unrated network-facing
advisories before treating the high-severity count as a clearance.

Only after resolving that assessment should another isolated build/trial occur.
Native libraries, binary provenance, and the single-server topology decision remain
separate requirements. Nothing has been migrated and no finding was suppressed.

Reproduce: `.venv/bin/python scripts/audit-garage-dependencies.py --commit 268334bd2530fa99f8b06c7383b2e9f776691edd`.
