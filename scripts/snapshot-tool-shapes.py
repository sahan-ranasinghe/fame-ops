#!/usr/bin/env python3
"""The shape of every connector tool's JSON answer, as a contract.

The Fame Fleet artifact (apps/office/fame-fleet.html) and, later, the office
web app read these answers field by field. This script calls each tool on
the LOCAL stack (after scripts/test-mcp-local.py has created data) and
records the set of key paths with their value types, so a refactor can be
proved not to change them:

    scripts/snapshot-tool-shapes.py --write     # scripts/tool-shapes.json (the contract)
    scripts/snapshot-tool-shapes.py --check     # fails if any tool's shape changed
    scripts/snapshot-tool-shapes.py --write-states   # records only the three task_detail states into the contract

task_detail is checked in three states (Hotfix O2-H2, 20 October 2026), each against its own fields: a task not started,
one in progress and one finished. The finished one is the suite's richest completed task (photos, fuel, projects); the
other two are made here every run, filled in fully (label, notes, contact, a project, stop addresses), on a day the
missed-task job never reaches, and started the way the driver app starts one (an update of the task's status). Before,
the first task on today's board was taken, so the answer's shape followed the time of day.

A list's shape is the union of its rows', and the contract was merged across runs ("it only grows"), so a field that only
some rows carry may be absent in a run whose data has no such row. Those fields are listed in OPTIONAL with the code that
leaves them out; one absent from this run is reported, not failed. Any other missing field still fails.

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
DB_CONTAINER = os.environ.get("DB_CONTAINER", "supabase_db_fame-ops")

# Fields a tool leaves out when its data has nothing for them (run.ts prunes absent and null fields): a run whose rows carry
# none of them is not a broken contract. Each with the code that decides it.
OPTIONAL = {
    "list_office_users": {
        "users[].can_drive": "accounts.ts can_drive: u.can_drive ?? undefined (Round 50: absent while never decided; "
                             "true granted, false taken away)",
    },
    "availability": {
        "drivers[].next_task_start": "availability.ts:186 next_task_start: next ? hhmm(next.start_at) : undefined "
                                     "(only a driver with an assigned task after the window's start)",
        # Round 4–7 (7): the holder only on a busy row while holder_contact is on (office-api's check runs before the
        # suite's Round 4–7 section; a key ending in "." covers every field under it).
        "drivers[].holder.": "tools/availability.ts:83 holder: holding ? holders.get(holding.id) : undefined (a busy driver)",
        "vehicles.groups.busy[].holder.": "tools/availability.ts holder on a busy vehicle (holdersOf; absent while holder_contact is off)",
    },
    "list_vehicles": {
        "vehicles[].check_today.": "tools/vehicles.ts:267 check_today: checks.get(v.id) (only a vehicle checked today, feature 4)",
        "vehicles[].fuel_type": "tools/vehicles.ts:167 fuel_type: v.fuel_type ?? undefined (only a vehicle with its fuel type set)",
    },
    "list_issues": {
        "issues[].pre_trip": "tools/issues.ts:83 pre_trip only on a vehicle report made by a pre-trip check (feature 4)",
    },
    "issue_history": {
        "report.office_note": "tools/issues.ts:454 office_note only when the office wrote a note on the driver's report",
    },
    "list_requests": {
        "requests[].fields.start.passengers": "tools/requests.ts:342-346 startStopFields: {} unless a stop is_start "
                                              "(passengers get in at the start)",
        "requests[].fields.start.what": "tools/requests.ts:347 what: at.what ?? undefined (the start stop's own what)",
        "requests[].trip.changed.stops": "tools/requests.ts:372-377 changed only when the office moved the time or the stops "
                                         "and no change of the requester waits",
        "requests[].trip.timeline.items[].rush_factor": "timeline.ts: rush_factor only on a leg in a rush-hour band",
        # Round 3: only on a request someone else drives, a self-drive or an expired one (office-api's check runs before
        # the suite's Round 3 section makes them).
        "requests[].driver_name": "tools/requests.ts:496 driver_name only when someone else drives",
        "requests[].driver_phone": "tools/requests.ts:497 driver_phone only when someone else drives",
        "requests[].fields.driver_name": "tools/requests.ts:547 the asked driver's name only when someone else drives",
        "requests[].fields.driver_phone": "tools/requests.ts:548 the asked driver's phone only when someone else drives",
        "requests[].self_drive_licence": "tools/requests.ts:499 only on a request the asker drives themselves",
        "requests[].expired": "tools/requests.ts:505 only on an expired request",
        "requests[].timeline.expired": "tools/requests.ts:567 only on an expired request",
    },
    # A plan's rush-hour factor is there only for a leg in a rush-hour band (settings.rush_hour): a run at another time of
    # day has none (main's CI at 16:40 Colombo recorded it, 21 October 2026).
    "task_detail": {
        # Round 4–7 (7): who holds the task (the requester, else who assigned it, as a person): through office-api the
        # assigner is the signed-in person; the connector's shared key has none (tools/holders.ts holdersOf).
        "task.holder.": "tools/tasks.ts:1988 holder: (await holdersOf(db, [task], now)).get(task.id) (absent with no requester and no assigning person)",
        "plan.legs[].factor": "plan.ts: a leg's factor only when the rush-hour factor applied to it",
        "timeline.items[].rush_factor": "timeline.ts: rush_factor only on a leg in a rush-hour band",
    },
    "plan_task": {
        "plan.legs[].factor": "plan.ts: a leg's factor only when the rush-hour factor applied to it",
        "timeline.items[].rush_factor": "timeline.ts: rush_factor only on a leg in a rush-hour band",
    },
    "live_drivers": {
        "drivers[].links: {}": "tools/locations.ts:239 links: {maps only with a position, call / whatsapp only with a phone}: "
                               "an empty object only for a driver with neither",
    },
}
TASK_STATES = ("not started", "in progress", "finished")


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


def psql(sql):
    import subprocess
    out = subprocess.run(["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-c", sql],
                         capture_output=True, text=True, check=True)
    return out.stdout.strip()


def fields_of(answer):
    out = set()
    shape(answer, "", out)
    return out


def state_tasks(today, drivers, vehicles):
    """One task per state: {state: task_id}. See the module's note."""
    import datetime as dt
    d0 = dt.date.fromisoformat(today)
    ahead = (d0 + dt.timedelta(days=20)).isoformat()
    project = ((call("find_project", {"text": "a"}).get("projects") or [{}])[0]).get("job_no")
    # Chosen the same way every run: the drivers by username, a vehicle nobody holds (so no "taken over" line).
    busy = set(psql("select coalesce(string_agg(employee_id::text, ','), '') from tasks where status = 'in_progress'").split(","))
    free = sorted((d for d in drivers if d.get("username") and d.get("active", True)), key=lambda d: d["username"])
    ids = {d["username"]: psql(f"select id from employees where username = '{d['username']}'") for d in free}
    free = [d for d in free if ids[d["username"]] not in busy] or free
    vehicle = psql("select reg_no from vehicles v where active and not in_garage and not demo and not exists "
                   "(select 1 from vehicle_assignments a where a.vehicle_id = v.id and a.to_at is null) order by reg_no limit 1") \
        or next((v["reg_no"] for v in vehicles if not v.get("in_garage")), vehicles[0]["reg_no"])
    def make(title, date, driver):
        made = call("create_task", {
            "title": title, "date": date, "start_time": "09:00", "driver": driver, "vehicle": vehicle,
            "stops": [{"type": "pickup", "what": "people", "place": "Head office", "address": "No. 1, Galle Road, Colombo 03", "note": "Gate 2"},
                      {"type": "drop", "what": "people", "place": "Kurunegala", "address": "Kurunegala town", "arrive_by": "12:00"}],
            "passengers": 3, "contact_name": "Contract Contact", "contact_phone": "0771234599", "notes": "Contract shape task",
            "label": "Contract", **({"projects": [{"project": project, "percent": 100}]} if project else {})})
        return made["task_id"]

    # Finished: the suite's richest completed task (its photos, fuel and projects), else one made and driven here.
    finished, most = None, -1
    for row in (call("list_tasks", {"from": (d0 - dt.timedelta(days=60)).isoformat(), "to": (d0 + dt.timedelta(days=30)).isoformat(),
                                    "status": "completed"}).get("tasks") or [])[:10]:
        n = len(fields_of(call("task_detail", {"task_id": row["id"]})))
        if n > most:
            finished, most = row["id"], n
    not_started = make("Contract · not started", ahead, free[0]["username"])
    runner = free[1]["username"] if len(free) > 1 else free[0]["username"]
    in_progress = make("Contract · in progress", today, runner)
    # Started as the app starts it (status, start odometer; started_at and accepted_at as the driver's trigger sets them,
    # 20261019090000_phase7_hotfix3.sql: it only runs for a driver), then the first stop reached and done.
    psql(f"update tasks set status = 'in_progress', started_at = now() - interval '30 minutes', accepted_at = now() - interval '30 minutes', start_odometer_km = 1000 where id = '{in_progress}'")
    psql(f"update task_stops set status = 'done', arrived_at = now() - interval '20 minutes', done_at = now() - interval '15 minutes' "
         f"where task_id = '{in_progress}' and seq = (select min(seq) from task_stops where task_id = '{in_progress}' and status = 'pending')")
    # And the phone on duty with three positions since the start (a session as Start work opens it, the points as the phone
    # uploads them): the running task's ETA and its GPS km are there every run, whatever the driver did before.
    who = ids[runner]
    session = psql(f"insert into duty_sessions (employee_id, vehicle_id, started_at) select '{who}', vehicle_id, now() - interval '35 minutes' "
                   f"from tasks where id = '{in_progress}' and not exists (select 1 from duty_sessions where employee_id = '{who}' and ended_at is null) "
                   f"returning id") or psql(f"select id from duty_sessions where employee_id = '{who}' and ended_at is null limit 1")
    for minutes, lat, lng in ((25, 6.9000, 79.8600), (15, 7.0500, 79.9800), (5, 7.2000, 80.1000)):
        psql(f"insert into location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m, speed_mps, source) values "
             f"('{who}', '{session}', now() - interval '{minutes} minutes', {lat}, {lng}, 8, 14, 'app') on conflict do nothing")
    if not finished:
        finished = make("Contract · finished", today, runner)
        psql(f"update tasks set status = 'in_progress', started_at = now() - interval '30 minutes', accepted_at = now() - interval '30 minutes', start_odometer_km = 1000 where id = '{finished}'")
        psql(f"update task_stops set status = 'done', arrived_at = now() - interval '10 minutes', done_at = now() - interval '5 minutes' "
             f"where task_id = '{finished}' and status = 'pending'")
        psql(f"update tasks set status = 'completed', completed_at = now(), end_odometer_km = 1042 where id = '{finished}'")
    return {"not started": not_started, "in progress": in_progress, "finished": finished}


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
    # The suite's Round 52 block leaves a driver and a van that sort first, with a new name each run (arch.<tag>, WP ARC-<tag>):
    # the contract is read on the first of the others, the names it recorded.
    driver = next((d.get("username") for d in drivers.get("drivers") or [] if not str(d.get("username")).startswith("arch.")), None) or "nobody"
    reg_no = next((v.get("reg_no") for v in vehicles.get("vehicles") or [] if not str(v.get("reg_no")).startswith("WP ARC-")), None) or "X"
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
        ("list_office_users", {}),
        ("routing_usage", {}),
        ("plan_task", {"date": board.get("date"), "leave_by": "09:00", "pickup": "Head office", "dropoff": "Kurunegala"}),
    ]
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

    def call_args(tool, args):
        # "state" names the task's state in the label only; the tool is not given it.
        return {k: v for k, v in args.items() if not (tool == "task_detail" and k == "state")}

    # task_detail in its three states (each its own label and fields), measured after every other call: the running task
    # made for it would otherwise show on the board, the overview, Live, availability and the vehicles.
    def task_states():
        # The stop-arrivals job (pg_cron, every 5 minutes) fills where the driver reached each stop: run it now, so the
        # finished task's arrivals do not depend on when its last run was.
        psql("select public.fill_stop_arrivals()")
        tasks = state_tasks(board.get("date"), drivers.get("drivers") or [], vehicles.get("vehicles") or [])
        return [("task_detail", {"task_id": tasks[state], "state": state}) for state in TASK_STATES]

    shapes = {}

    def measure(tool, args):
        label = label_of(tool, args)
        try:
            out = set()
            shape(call(tool, call_args(tool, args)), "", out)
            shapes[label] = sorted(out)
        except RuntimeError as e:
            shapes[label] = [f"ERROR: {e}"]

    for tool, args in calls:
        measure(tool, args)
    for tool, args in task_states():
        measure(tool, args)

    # Photo links and ids change every run: keep the field, drop the value.
    if mode == "--write":
        # The contract only grows: a field this run's data does not carry (an optional one) stays recorded.
        prior = json.loads(SHAPES_FILE.read_text()) if SHAPES_FILE.exists() else {}
        for label, fields in prior.items():
            if label in shapes and not any(str(f).startswith("ERROR") for f in shapes[label]):
                shapes[label] = sorted(set(shapes[label]) | set(fields))
            elif label not in shapes:
                shapes[label] = fields
        SHAPES_FILE.write_text(json.dumps(shapes, indent=1, sort_keys=True) + "\n")
        print(f"wrote {SHAPES_FILE.name}: {len(shapes)} calls, {sum(len(v) for v in shapes.values())} fields")
        return
    if mode == "--write-states":
        contract = json.loads(SHAPES_FILE.read_text())
        contract.pop('task_detail {"task_id": "<id>"}', None)
        for label, fields in shapes.items():
            if label.startswith("task_detail "):
                contract[label] = fields
        SHAPES_FILE.write_text(json.dumps(contract, indent=1, sort_keys=True) + "\n")
        print(f"wrote the three task_detail states into {SHAPES_FILE.name}")
        return
    expected = json.loads(SHAPES_FILE.read_text())
    bad = 0
    for label in sorted(set(expected) | set(shapes)):
        if label in skipped:
            print(f"  SKIP  {label}: no tasks today (the suite's tasks are on tomorrow this late); run before 21:15 Colombo to compare it")
            continue
        before, after = set(expected.get(label, [])), set(shapes.get(label, []))
        optional = OPTIONAL.get(label.split(" ", 1)[0], {})
        absent_ok = {f for f in before - after if f in optional or f.split(": ")[0] in optional
                     or any(k.endswith(".") and f.startswith(k) for k in optional)}
        missing, new = (before - after) - absent_ok, after - before
        note = f" ({len(absent_ok)} optional, absent this run: {', '.join(sorted(absent_ok))})" if absent_ok else ""
        if not missing and not new:
            print(f"  PASS  {label}: {len(after)} fields as recorded{note}")
            continue
        bad += 1
        print(f"  FAIL  {label}{note}")
        for f in sorted(missing):
            print(f"          missing: {f}")
        for f in sorted(new):
            print(f"          new:     {f}")
    print("All tool shapes match the contract." if bad == 0 else f"{bad} tool call(s) changed shape.")
    sys.exit(0 if bad == 0 else 1)


if __name__ == "__main__":
    main()
