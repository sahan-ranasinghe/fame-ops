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
import time
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
        for _ in range(20):
            code, text = http("POST", f"{API}/functions/v1/office-api/tools/{tool}",
                              {"Content-Type": "application/json", "Authorization": f"Bearer {os.environ['API_TOKEN']}"}, args)
            if code != 429:  # 120 calls a minute per person: wait for the window
                break
            time.sleep(5)
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


# Who decided (Hotfix 2, K): present, and with the person's number and photo, only when a named person decided (the web
# app, a personal key); the shared key of the connector has no person. Their fields depend on who calls, not on the tool,
# so they are left out of the comparison (the web's types record them: apps/office/src/data/types.ts PersonAt).
PERSON_DEPENDENT = {"approved_by", "declined_by", "cancelled_by"}


def shape(value, prefix, out):
    """Collects 'path: type' entries. Lists are collapsed to one entry of their item types."""
    if isinstance(value, dict):
        if not value:
            out.add(f"{prefix}: {{}}")
        for k, v in value.items():
            if k in PERSON_DEPENDENT:
                continue
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
    import datetime as dt
    drivers = call("list_drivers", {})
    vehicles = call("list_vehicles", {})
    board = call("task_board", {})
    requests = call("list_requests", {"status": "all"})
    driver = (drivers.get("drivers") or [{}])[0].get("username") or "nobody"
    reg_no = (vehicles.get("vehicles") or [{}])[0].get("reg_no") or "X"
    has_tasks = lambda b: any(b.get(col) for col in ("in_progress", "assigned", "completed"))
    # Late in the evening the test suite puts its tasks on tomorrow: look at that day, and
    # leave today's (empty) board out rather than compare it with a recorded day that had tasks.
    skipped = set()
    if not has_tasks(board):
        tomorrow = (dt.date.fromisoformat(board["date"]) + dt.timedelta(days=1)).isoformat()
        alt = call("task_board", {"date": tomorrow})
        if has_tasks(alt):
            board = alt
            skipped.add("task_board {}")
    task_id = next((t["id"] for col in ("in_progress", "assigned", "completed") for t in board.get(col, [])), None)
    # availability's window around one of the board's own tasks (a fixed 09:00–12:00 found no busy vehicle when the suite ran
    # late in the morning, and the recorded busy group then went "missing"): from its time, three hours.
    import re
    task_time = next((t.get("time") or t.get("leave_by") for col in ("assigned", "in_progress") for t in board.get(col, [])
                      if re.fullmatch(r"\d{2}:\d{2}", str(t.get("time") or t.get("leave_by") or ""))), "09:00")
    until = f"{min(int(task_time[:2]) + 3, 23):02d}:{task_time[3:]}" if int(task_time[:2]) < 21 else "23:59"
    # A request with a project when there is one, so the recorded shape keeps request.project.
    rows = requests.get("requests") or []
    request_id = next((r["id"] for r in rows if r.get("project")), (rows[0] if rows else {}).get("id"))

    calls = [
        ("fleet_overview", {}),
        ("live_drivers", {}),
        ("driver_route", {"driver": driver}),
        ("duty_log", {}),
        ("duty_log", {"driver": driver}),
        ("list_drivers", {}),
        ("list_drivers", {"include_inactive": True}),
        ("list_vehicles", {}),
        ("list_vehicles", {"filter": "documents_expiring"}),
        ("list_places", {}),
        ("list_places", {"operator": "dialog"}),
        ("search_places", {"text": "MT0184", "map": False}),
        ("search_places", {"text": "6.9271, 79.8612"}),
        ("list_import_presets", {}),
        ("list_place_imports", {}),
        *([] if skipped else [("task_board", {})]),
        ("task_board", {"date": board.get("date")}),
        ("list_requests", {"status": "all"}),
        ("list_requests", {"status": "waiting"}),
        ("list_requests", {"status": "changed"}),
        ("availability", {"at": f"{board.get('date')} {task_time}", "until": until}),
        ("mileage_summary", {}),
        ("mileage_summary", {"vehicle": reg_no}),
        ("mileage_summary", {"driver": driver}),
        ("list_fuel", {}),
        ("list_vehicle_reports", {"status": "all"}),
        ("find_project", {"text": "a"}),
        ("list_issues", {}),
        ("list_issues", {"status": "all"}),
        ("get_settings", {}),
        ("routing_usage", {}),
        ("plan_task", {"date": board.get("date"), "leave_by": "09:00", "pickup": "Head office", "dropoff": "Kurunegala"}),
    ]
    if task_id:
        calls.append(("task_detail", {"task_id": task_id}))
    site_id = (call("list_places", {"operator": "dialog"}).get("places") or [{}])[0].get("id")
    if site_id:
        calls.append(("place_detail", {"id": site_id}))
    issue_id = (call("list_issues", {"status": "all"}).get("issues") or [{}])[0].get("id")
    if issue_id:
        calls.append(("issue_history", {"id": issue_id}))
    if request_id:
        calls.append(("suggest_vehicles", {"request_id": request_id}))

    def label_of(tool, args):
        # Ids and dates differ every run: the label names the argument, not the value.
        shown = {k: ("<id>" if k == "id" or k.endswith("_id") else "<date>" if k == "date" else "<time>" if k in ("at", "until") else v)
                 for k, v in args.items()}
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
        if label in skipped:
            print(f"  SKIP  {label}: no tasks today (the suite's tasks are on tomorrow this late); run before 21:15 Colombo to compare it")
            continue
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
