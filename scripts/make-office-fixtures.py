"""Hotfix O2-H2: the REAL answers of every final-step action in Office mode, saved as test fixtures.

Against the LOCAL stack only: a fresh admin signs in to office-api (as the app does), builds a tiny fleet (two drivers, two
vehicles, two places) and runs each action the app's last buttons send: create_task, create_request, book_vehicle,
decide_request (approve and decline), update_request (an approved booking changed), redecide_request (keep), update_task,
ask_drivers, reassign_task, cancel_task. Each tool's `result` is written to apps/driver/src/office/__fixtures__/<name>.json
(test data: made-up names, no keys, no tokens, no phone numbers of real people) with GET /me as me.json.

    python3 scripts/make-office-fixtures.py        (the local stack and `supabase functions serve` running)
"""
import datetime as dt
import json
import os
import pathlib
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "apps" / "driver" / "src" / "office" / "__fixtures__"
status = subprocess.run(["npx", "supabase", "status", "-o", "env"], cwd=ROOT, capture_output=True, text=True).stdout
env = dict(line.split("=", 1) for line in status.splitlines() if "=" in line)
val = lambda k: env.get(k, "").strip().strip('"')
API, ANON, SERVICE = val("API_URL").rstrip("/"), val("ANON_KEY"), val("SERVICE_ROLE_KEY")
if not API.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("local stack only (API_URL must be http://127.0.0.1 or http://localhost)")


def http(method, url, headers=None, body=None):
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=None if body is None else json.dumps(body).encode())
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            text = r.read().decode()
            return r.status, json.loads(text) if text else None
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            return e.code, json.loads(text)
        except ValueError:
            return e.code, text


def psql(sql):
    subprocess.run(["docker", "exec", "-i", "supabase_db_fame-ops", "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-c", sql],
                   check=True, capture_output=True)


email = f"fixtures.{uuid.uuid4().hex[:6]}@fame.test"
pw = "Fixt-" + uuid.uuid4().hex[:12]
code, au = http("POST", f"{API}/auth/v1/admin/users", {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"},
                {"email": email, "password": pw, "email_confirm": True})
assert code in (200, 201), (code, au)
psql(f"insert into employees (code, name, email, role, permissions, auth_user_id) values ('FIX-{uuid.uuid4().hex[:4]}', 'Fixture Admin', '{email}', 'admin', "
     f"array['view','request','approve','assign_tasks','vehicles','issues','users'], '{au['id']}')")
code, s = http("POST", f"{API}/auth/v1/token?grant_type=password", {"apikey": ANON, "Content-Type": "application/json"}, {"email": email, "password": pw})
assert code == 200, (code, s)
H = {"apikey": ANON, "Authorization": f"Bearer {s['access_token']}", "Content-Type": "application/json"}


def call(name, args):
    for _ in range(20):
        code, a = http("POST", f"{API}/functions/v1/office-api/tools/{name}", H, args)
        if code != 429:
            break
        time.sleep(5)
    if code != 200:
        raise RuntimeError(f"{name}: {code} {str(a)[:400]}")
    return a["result"]


saved = []


def save(name, data):
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n")
    saved.append(name)


code, me = http("GET", f"{API}/functions/v1/office-api/me", H)
assert code == 200
save("me", me)

tag = uuid.uuid4().hex[:4]
tomorrow = (dt.datetime.now(dt.timezone(dt.timedelta(hours=5, minutes=30))) + dt.timedelta(days=1)).date().isoformat()
d1, d2 = f"fixa{tag}", f"fixb{tag}"
call("create_driver", {"name": f"Driver A {tag}", "code": f"FA-{tag}", "username": d1, "pin": "246810", "phone": "0771234567"})
call("create_driver", {"name": f"Driver B {tag}", "code": f"FB-{tag}", "username": d2, "pin": "135791", "phone": "0771234568"})
v1, v2 = f"FX {tag}-1", f"FX {tag}-2"
call("register_vehicle", {"reg_no": v1, "make_model": "Toyota HiAce", "vehicle_type": "van", "seats": 12})
call("register_vehicle", {"reg_no": v2, "make_model": "Toyota Axio", "vehicle_type": "car", "seats": 4})
p1 = call("add_place", {"name": f"Fixture office {tag}", "lat": 6.9022, "lng": 79.8612, "kind": "office"})
p2 = call("add_place", {"name": f"Fixture site {tag}", "lat": 7.4867, "lng": 80.3647, "kind": "site"})
pid = lambda p: p.get("id") or p.get("added", {}).get("id") or p.get("place", {}).get("id")
stops = [{"type": "pickup", "what": "people", "place_id": pid(p1), "place": f"Fixture office {tag}"},
         {"type": "drop", "what": "people", "place_id": pid(p2), "place": f"Fixture site {tag}", "arrive_by": "11:00"}]

task = call("create_task", {"title": f"Team drop · {tag}", "date": tomorrow, "driver": d1, "vehicle": v1, "stops": stops, "passengers": 3})
save("create_task", task)
req = call("create_request", {"date": tomorrow, "time": "08:00", "back_by": "17:00", "stops": stops, "need_type": "van", "pax": 3, "note": "fixture"})
save("create_request", req)
book = call("book_vehicle", {"date": tomorrow, "time": "13:00", "back_by": "16:00", "stops": stops, "vehicle": v2, "driver": d2, "title": f"Booked · {tag}"})
save("book_vehicle", book)
rid = req.get("request_id") or req.get("request", {}).get("id") or req.get("id")
listed = call("list_requests", {"status": "all", "id": rid, "limit": 1})
save("list_requests_one", listed)
dec = call("decide_request", {"request_id": rid, "decision": "approve", "driver": d2, "vehicle": v1, "version": listed["requests"][0].get("version", 0)})
save("decide_request_approve", dec)
req2 = call("create_request", {"date": tomorrow, "time": "09:00", "stops": stops, "note": "to decline"})
rid2 = req2.get("request_id") or req2.get("request", {}).get("id") or req2.get("id")
save("decide_request_decline", call("decide_request", {"request_id": rid2, "decision": "decline", "reason": "No vehicle free then"}))
card = call("list_requests", {"status": "all", "id": rid, "limit": 1})["requests"][0]
upd = call("update_request", {"request_id": rid, "version": card.get("version", 0), "note": "changed after approval"})
save("update_request", upd)
card = call("list_requests", {"status": "all", "id": rid, "limit": 1})["requests"][0]
save("redecide_request_keep", call("redecide_request", {"request_id": rid, "version": card.get("version", 0), "decision": "keep"}))
tid = task.get("task_id") or task.get("task", {}).get("id") or task.get("id")
detail = call("task_detail", {"task_id": tid})
save("task_detail", detail)
save("update_task", call("update_task", {"task_id": tid, "plan_version": detail["task"].get("plan_version", 0), "title": f"Team drop · {tag} (changed)"}))
save("reassign_task", call("reassign_task", {"task_id": tid, "driver": d2}))
save("ask_drivers", call("ask_drivers", {"drivers": [d1, d2], "kind": "free_for_trip", "date": tomorrow, "from": "09:00", "to": "12:00"}))
save("cancel_task", call("cancel_task", {"task_id": tid, "reason": "fixture"}))

print(f"{len(saved)} fixtures in {OUT.relative_to(ROOT)}: {', '.join(saved)}")
