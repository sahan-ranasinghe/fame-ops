#!/usr/bin/env python3
"""The shape of every connector tool's JSON answer, as a contract.

The Fame Fleet artifact (apps/office/fame-fleet.html) and, later, the office
web app read these answers field by field. This script calls each tool on
the LOCAL stack (after scripts/test-mcp-local.py has created data) and
records the set of key paths with their value types, so a refactor can be
proved not to change them:

    scripts/snapshot-tool-shapes.py --write     # scripts/tool-shapes.json (the contract)
    scripts/snapshot-tool-shapes.py --check     # fails if any tool's shape changed

Needs API_URL and OFFICE_MCP_KEY (the local serve's), and optionally
CHANNEL=api with API_TOKEN (an office session) to go through office-api
instead of office-mcp. Writes are never called here.
"""

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = os.environ["API_URL"].rstrip("/")
if not API.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("Local stack only.")
CHANNEL = os.environ.get("CHANNEL", "mcp")
SHAPES_FILE = Path(__file__).with_name("tool-shapes.json")


def http(method, url, headers, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body is not None else None, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            return res.status, res.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def call(tool, args):
    if CHANNEL == "api":
        code, text = http("POST", f"{API}/functions/v1/office-api/tools/{tool}",
                          {"Content-Type": "application/json", "Authorization": f"Bearer {os.environ['API_TOKEN']}"}, args)
        if code != 200:
            raise RuntimeError(f"{tool}: office-api {code} {text[:200]}")
        return json.loads(text)["result"]
    key = os.environ["OFFICE_MCP_KEY"]
    code, text = http("POST", f"{API}/functions/v1/office-mcp/{key}/mcp",
                      {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"},
                      {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": tool, "arguments": args}})
    if text.lstrip().startswith(("event:", "data:")):
        text = [l[6:] for l in text.replace("\r", "").split("\n") if l.startswith("data: ")][-1]
    message = json.loads(text)
    if "result" not in message:
        raise RuntimeError(f"{tool}: connector error: {json.dumps(message.get('error'))[:300]}")
    answer = message["result"]
    if answer.get("isError"):
        raise RuntimeError(f"{tool}: {answer['content'][0]['text']}")
    return json.loads(answer["content"][0]["text"])


def shape(value, prefix, out):
    """Collects 'path: type' entries. Lists are collapsed to one entry of their item types."""
    if isinstance(value, dict):
        if not value:
            out.add(f"{prefix}: {{}}")
        for k, v in value.items():
            shape(v, f"{prefix}.{k}" if prefix else k, out)
    elif isinstance(value, list):
        if not value:
            out.add(f"{prefix}[]: empty")
        for item in value:
            shape(item, f"{prefix}[]", out)
    else:
        t = "null" if value is None else "bool" if isinstance(value, bool) else "number" if isinstance(value, (int, float)) else "string"
        out.add(f"{prefix}: {t}")


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else "--check"
    # What the artifact reads, with arguments it uses. Ids come from the lists.
    drivers = call("list_drivers", {})
    vehicles = call("list_vehicles", {})
    board = call("task_board", {})
    requests = call("list_requests", {"status": "all"})
    driver = (drivers.get("drivers") or [{}])[0].get("username") or "nobody"
    reg_no = (vehicles.get("vehicles") or [{}])[0].get("reg_no") or "X"
    task_id = next((t["id"] for col in ("in_progress", "assigned", "completed") for t in board.get(col, [])), None)
    request_id = (requests.get("requests") or [{}])[0].get("id")

    calls = [
        ("fleet_overview", {}),
        ("live_drivers", {}),
        ("driver_route", {"driver": driver}),
        ("list_drivers", {}),
        ("list_drivers", {"include_inactive": True}),
        ("list_vehicles", {}),
        ("list_vehicles", {"filter": "documents_expiring"}),
        ("list_places", {}),
        ("task_board", {}),
        ("task_board", {"date": board.get("date")}),
        ("list_requests", {"status": "all"}),
        ("list_requests", {"status": "waiting"}),
        ("mileage_summary", {}),
        ("mileage_summary", {"vehicle": reg_no}),
        ("mileage_summary", {"driver": driver}),
        ("list_vehicle_reports", {"status": "all"}),
        ("find_project", {"text": "a"}),
    ]
    if task_id:
        calls.append(("task_detail", {"task_id": task_id}))
    if request_id:
        calls.append(("suggest_vehicles", {"request_id": request_id}))

    def label_of(tool, args):
        # Ids and dates differ every run: the label names the argument, not the value.
        shown = {k: ("<id>" if k.endswith("_id") else "<date>" if k == "date" else v) for k, v in args.items()}
        return f"{tool} {json.dumps(shown, sort_keys=True)}"

    shapes = {}
    for tool, args in calls:
        label = label_of(tool, args)
        try:
            out = set()
            shape(call(tool, args), "", out)
            shapes[label] = sorted(out)
        except RuntimeError as e:
            shapes[label] = [f"ERROR: {e}"]

    # Photo links and ids change every run: keep the field, drop the value.
    if mode == "--write":
        SHAPES_FILE.write_text(json.dumps(shapes, indent=1, sort_keys=True) + "\n")
        print(f"wrote {SHAPES_FILE.name}: {len(shapes)} calls, {sum(len(v) for v in shapes.values())} fields")
        return
    expected = json.loads(SHAPES_FILE.read_text())
    bad = 0
    for label in sorted(set(expected) | set(shapes)):
        before, after = set(expected.get(label, [])), set(shapes.get(label, []))
        if before == after:
            print(f"  PASS  {label}: {len(after)} fields unchanged")
            continue
        bad += 1
        print(f"  FAIL  {label}")
        for f in sorted(before - after):
            print(f"          missing: {f}")
        for f in sorted(after - before):
            print(f"          new:     {f}")
    print("All tool shapes match the contract." if bad == 0 else f"{bad} tool call(s) changed shape.")
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
