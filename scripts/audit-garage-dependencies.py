#!/usr/bin/env python3
"""Read-only OSV audit of the pinned Garage release lockfile (Python 3.11+).

Queries public package/version metadata only. Does not inspect application data,
install dependencies, change images, or suppress findings. This is a source
inventory check, not proof of which dependencies were compiled into a binary.
"""
import hashlib
import argparse
import re
from datetime import datetime, timezone
import json
import tomllib
import urllib.request
import urllib.error
import http.client
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor

COMMIT = "7b119c0b4fa58ab3cb6d5db435fe52d990f6a7aa"


def select_packages(packages, inventory):
    """Fail closed if a captured Cargo normal/build inventory cannot be matched."""
    selected = set()
    for line in inventory.splitlines():
        if not line.strip() or line.startswith("#"):
            continue
        match = re.fullmatch(r"([\w-]+) v([^\s]+)(?: \(.*\))?", line)
        if not match:
            raise ValueError(f"Unrecognized inventory line: {line!r}")
        selected.add(match.groups())
    if not selected:
        raise ValueError("Dependency inventory is empty")
    available = {(p["name"], p["version"]) for p in packages}
    if selected - available:
        raise ValueError(f"Inventory packages missing from lockfile: {sorted(selected - available)}")
    chosen = [p for p in packages if (p["name"], p["version"]) in selected]
    if len(chosen) != len(selected):
        raise ValueError("Ambiguous package identity: same name/version from multiple sources")
    return chosen


def fetch(url, data=None):
    req = urllib.request.Request(url, data=data, headers={
        "User-Agent": "LaunchPad-dependency-audit", "Content-Type": "application/json"})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                return response.read()
        except urllib.error.HTTPError as exc:
            if exc.code not in (429, 500, 502, 503, 504) or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, http.client.RemoteDisconnected):
            if attempt == 2:
                raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--commit", default=COMMIT, help="Verified full immutable source commit")
    parser.add_argument("--lockfile", type=Path, help="Audit a local patched Cargo.lock")
    parser.add_argument("--inventory", type=Path, help="Restrict to a captured Cargo normal/build inventory")
    parser.add_argument("--output", type=Path, help="Save generated JSON report")
    args = parser.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}", args.commit):
        parser.error("--commit must be a full 40-character lowercase commit hash")
    lock_url = f"https://git.deuxfleurs.fr/Deuxfleurs/garage/raw/commit/{args.commit}/Cargo.lock"
    raw = args.lockfile.read_bytes() if args.lockfile else fetch(lock_url)
    packages = tomllib.loads(raw.decode())["package"]
    lock_packages = len(packages)
    inventory_raw = args.inventory.read_bytes() if args.inventory else None
    if inventory_raw is not None:
        packages = select_packages(packages, inventory_raw.decode())
    registry = [p for p in packages if p.get("source", "").startswith("registry+")]
    git = [p for p in packages if p.get("source", "").startswith("git+")]
    queries = [{"package": {"name": p["name"], "ecosystem": "crates.io"},
                "version": p["version"]} for p in registry]
    responses = []
    for start in range(0, len(queries), 100):
        result = json.loads(fetch("https://api.osv.dev/v1/querybatch",
                                  json.dumps({"queries": queries[start:start + 100]}).encode()))
        assert len(result["results"]) == len(queries[start:start + 100])
        responses.extend(result["results"])
    affected = [(p, item["id"]) for p, result in zip(registry, responses)
                for item in result.get("vulns", [])]
    ids = sorted({identifier for _, identifier in affected})
    with ThreadPoolExecutor(max_workers=4) as pool:
        advisories = dict(zip(ids, pool.map(
            lambda identifier: json.loads(fetch(f"https://api.osv.dev/v1/vulns/{identifier}")), ids)))
    findings = []
    for package, identifier in affected:
        advisory = advisories[identifier]
        findings.append({
            "package": package["name"], "version": package["version"], "id": identifier,
            "summary": advisory.get("summary"), "aliases": advisory.get("aliases", []),
            "severity": advisory.get("severity", []),
            "database_specific": advisory.get("database_specific", {}),
            "withdrawn": advisory.get("withdrawn"),
            "details": advisory.get("details"),
            "affected": advisory.get("affected", []),
            "url": f"https://osv.dev/vulnerability/{identifier}",
        })
    report = json.dumps({"source_commit": args.commit, "source_url": lock_url,
                      "local_lockfile": str(args.lockfile) if args.lockfile else None,
                      "scope": "selected-normal-build" if args.inventory else "workspace-lockfile",
                      "inventory_sha256": hashlib.sha256(inventory_raw).hexdigest() if inventory_raw is not None else None,
                      "selected_packages": len(packages),
                      "audited_at": datetime.now(timezone.utc).isoformat(),
                      "lock_sha256": hashlib.sha256(raw).hexdigest(),
                      "lock_packages": lock_packages, "registry_packages_queried": len(registry),
                      "unqueried_git_dependencies": [{"name": p["name"], "version": p["version"],
                                                       "source": p["source"]} for p in git],
                      "workspace_packages": len(packages) - len(registry) - len(git),
                      "findings": findings}, indent=2)
    if args.output:
        args.output.write_text(report + "\n")
        print(f"Saved {len(findings)} advisory matches for {len(registry)} registry packages to {args.output}")
    else:
        print(report)


if __name__ == "__main__":
    main()
