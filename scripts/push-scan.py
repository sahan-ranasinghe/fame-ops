#!/usr/bin/env python3
"""The key scan before a push (Sahan, 20 October 2026; CLAUDE.md, GitHub).

Usage: python3 scripts/push-scan.py <ref>...   (e.g. main phase8-o4)

Scans `git log -p <refs> --not --remotes=origin` (exactly what a push would send) for four shapes: a Supabase secret
key, a Google API key, a PEM private key and a service account's private key field. Prints the number of matches not
in scripts/push-scan-allow.txt, then one line per match as commit, file, line, shape and the value masked (first 4, last
4, length): never the value. Exit 1 when that number is not 0.

The shapes are built here from pieces so that this file never matches itself. Lines a commit adds and its context lines
are scanned; a removed line is not (the commit that added it is scanned, or is already on origin).
"""
import re
import subprocess
import sys
from pathlib import Path

SHAPES = {
    "sb_secret": "sb_" + "secret_" + r"[A-Za-z0-9_-]{20,}",
    "AIza": "AI" + "za" + r"[0-9A-Za-z_-]{30,}",
    "private key": "-----BEGIN " + r"(RSA |EC )?" + "PRIVATE" + " KEY",
    '"private_key"': '"private' + '_key":',
}
ALLOW_FILE = Path(__file__).with_name("push-scan-allow.txt")


def allowed() -> set:
    entries = set()
    for raw in ALLOW_FILE.read_text().splitlines() if ALLOW_FILE.exists() else []:
        line = raw.split("#", 1)[0].strip()
        if line:
            entries.add(line)
    return entries


def mask(value: str) -> str:
    return f"{value[:4]}…{value[-4:]} (length {len(value)})"


def main(refs: list) -> int:
    if not refs:
        print(__doc__)
        return 2
    log = subprocess.run(["git", "log", "-p", "--format=COMMIT %H", *refs, "--not", "--remotes=origin"],
                         capture_output=True, text=True, check=True).stdout
    allow = allowed()
    found, skipped = [], []
    commit = path = None
    line_no = 0
    for line in log.splitlines():
        if line.startswith("COMMIT "):
            commit = line[7:]
            continue
        if line.startswith("+++ "):
            path = line[6:] if line.startswith("+++ b/") else None
            continue
        hunk = re.match(r"@@ -\d+(?:,\d+)? \+(\d+)", line)
        if hunk:
            line_no = int(hunk.group(1)) - 1
            continue
        if line.startswith("+") or line.startswith(" "):
            line_no += 1
        else:
            continue
        for shape, pattern in SHAPES.items():
            m = re.search(pattern, line)
            if not m:
                continue
            entry = f"{commit}:{path}:{line_no}"
            (skipped if entry in allow else found).append((entry, shape, mask(m.group(0))))
    print(len(found))
    for entry, shape, masked in found:
        print(f"  {entry}  {shape}  {masked}")
    for entry, shape, masked in skipped:
        print(f"  allowlisted: {entry}  {shape}  {masked}")
    return 1 if found else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
