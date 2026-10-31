#!/usr/bin/env python3
"""This month's GitHub Actions minutes, from the runs themselves (Sahan, 31 October 2026; docs/ci.md).

Each job counts rounded up to the minute, as GitHub bills a private repo; the month is UTC, as GitHub's is. It is an
estimate from the run durations, read with the repo's normal access (GitHub's own billing page needs another scope).
Every checkpoint report carries its line. It always exits 0: a warning is for the report, not a failure.

    python3 scripts/ci-minutes.py            # this month
    python3 scripts/ci-minutes.py 2026-10    # another month
"""
import json
import math
import subprocess
import sys
from datetime import datetime, timezone

REPO = "sahan-ranasinghe/fame-ops"
FREE = 2000
WARN = 1500


def api(path):
    """Every page of a list answer (gh --paginate prints one JSON object per page, one after another)."""
    out = subprocess.run(["gh", "api", "--paginate", path], capture_output=True, text=True, check=True).stdout
    decoder, pages, at = json.JSONDecoder(), [], 0
    while at < len(out):
        page, at = decoder.raw_decode(out, at)
        pages.append(page)
        while at < len(out) and out[at].isspace():
            at += 1
    return pages


def stamp(text):
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def main():
    month = sys.argv[1] if len(sys.argv) > 1 else datetime.now(timezone.utc).strftime("%Y-%m")
    year, mon = map(int, month.split("-"))
    end = f"{year + 1}-01" if mon == 12 else f"{year}-{mon + 1:02d}"
    # GitHub's created filter: from the month's first second up to (not including) the next month's.
    query = f"created={month}-01T00:00:00Z..{end}-01T00:00:00Z"
    runs = [r for page in api(f"repos/{REPO}/actions/runs?per_page=100&{query}") for r in page["workflow_runs"]]
    minutes = 0
    for run in runs:
        for page in api(f"repos/{REPO}/actions/runs/{run['id']}/jobs?per_page=100&filter=all"):
            for job in page["jobs"]:
                # A job GitHub never started (the billing block, a skipped e2e) has no machine time.
                if job.get("started_at") and job.get("completed_at") and job.get("runner_name"):
                    seconds = (stamp(job["completed_at"]) - stamp(job["started_at"])).total_seconds()
                    minutes += math.ceil(max(seconds, 0) / 60)
    print(f"Actions minutes {month}: about {minutes} of {FREE} free ({len(runs)} runs, from the run durations)")
    if minutes >= WARN:
        print(f"WARNING: {WARN} reached: {max(FREE - minutes, 0)} minutes left this month. One full run is about 36.")


if __name__ == "__main__":
    main()
