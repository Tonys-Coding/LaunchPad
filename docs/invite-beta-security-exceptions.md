# Invite-beta security exceptions

Recorded: September 15, 2026. Scope: a small, Google-invited web beta only. These
exceptions are not approval for unrestricted public registration or the extension.

## Current dependency result

- The final backend dependency inventory contains 51 Python packages. An OSV
  query of their installed names and versions returned no vulnerability matches.
- The production frontend dependency audit reports 0 critical, 0 high, 5 moderate,
  and 1 low findings across 1,463 runtime dependencies. Moderate/low remediation is
  deferred because this beta gate blocks only high and critical risk.
- The final MongoDB and web filesystem manifests are unchanged from their clean
  container scans. The backend application-only rebuild retains the same operating
  system packages and therefore the three previously reported high matches below.
- Production no longer includes MinIO or Garage, so their findings are outside the
  deployed service set.

## Temporary backend exceptions

The three matches come from libraries pulled into the image by the free local OCR
engine. `ldd /usr/bin/tesseract` confirms that libarchive links libxml2 and zlib, so
the packages cannot honestly be called absent. LaunchPad accepts them temporarily
for this invite-only beta because the vulnerable entry conditions are not exposed
by the application path:

| Finding | Evidence and constraint | Invite-beta disposition |
| --- | --- | --- |
| CVE-2026-74860 | Debian describes a double-free in the **Python libxml2 SAX bindings** while parsing attacker-controlled XML with a DTD. The image contains neither `python3-libxml2` nor the Python `libxml2`/`lxml` modules. Flyer input is decoded as a bounded raster image before Tesseract. | Accepted temporarily; the named binding is absent. |
| CVE-2026-86140 | Debian describes a stack overflow in libxml2 validation formatting. LaunchPad does not accept XML, Tesseract configuration, or language-data uploads; authenticated flyer input is a size-limited image. | Accepted temporarily because no attacker-controlled XML reaches the linked library. Recheck when Debian stable publishes a fix. |
| CVE-2026-85091 | The advisory describes non-blocking `gzwrite()` followed by `gzprintf()`/`gzvprintf()` with stale buffers. LaunchPad does not use the gzFile write API; its linked zlib path processes bounded OCR/image input. The installed source is Debian's `really1.3.1` package, while the advisory text names upstream 1.3.1.2 through 1.3.2. | Accepted temporarily based on both call-path and version evidence; recheck when Debian resolves its currently unfixed tracker entry. |

Official records: [CVE-2026-74860](https://security-tracker.debian.org/tracker/CVE-2026-74860),
[CVE-2026-86140](https://security-tracker.debian.org/tracker/CVE-2026-86140), and
[CVE-2026-85091](https://security-tracker.debian.org/tracker/CVE-2026-85091).

## Boundaries and expiry

- Keep Google invitation allowlisting enabled and the Chrome extension unreleased.
- Keep the existing 8 MB flyer limit, authenticated OCR rate limit, private backend,
  and exact production origin/host controls.
- Re-scan when the pinned base image or Debian stable packages change.
- Remove these exceptions before open signup/public launch. The preferred long-term
  remediation is a fixed stable package set or an isolated OCR worker, not removal
  of scanner results.
