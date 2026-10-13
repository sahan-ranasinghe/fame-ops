"""End-to-end test of the office connector against the LOCAL Supabase stack.

Run it through scripts/test-mcp-local.sh, which resets the local database and
sets API_URL, ANON_KEY and OFFICE_MCP_KEY.

It builds a small fleet through the connector's tools, then acts as a driver
through the same Auth / REST / Storage endpoints the app will use (sign in with
username + PIN, share location, run a task with photos, report a problem), and
checks what every tool reports, down to the audit log.

Never point it at the real project: it creates drivers, vehicles and tasks.
"""
import base64
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

API = os.environ["API_URL"].rstrip("/")
ANON = os.environ["ANON_KEY"]
KEY = os.environ["OFFICE_MCP_KEY"]
DB_CONTAINER = os.environ.get("DB_CONTAINER", "supabase_db_fame-ops")
# Which channel the office calls go through: "mcp" (the connector, shared key) or
# "api" (office-api as a signed-in admin; 2-step is optional, the test turns it on).
CHANNEL = os.environ.get("CHANNEL", "mcp")
SERVICE = os.environ.get("SERVICE_ROLE_KEY", "")
API_TOKEN = ""
ACTOR_NAME = "Office (shared key)" if CHANNEL == "mcp" else "Test Admin"
if not API.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("This test only runs against a local stack (API_URL must be http://127.0.0.1 or http://localhost).")
MCP_URL = f"{API}/functions/v1/office-mcp/{KEY}/mcp"

failures = []
calls = 0


def check(ok, label, detail=""):
    print(("  PASS  " if ok else "  FAIL  ") + label + (f"   [{detail}]" if detail and not ok else ""))
    if not ok:
        failures.append(label)
    return ok


def http(method, url, headers=None, body=None, raw=False):
    data = None
    if body is not None:
        data = body if isinstance(body, bytes) else json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            payload = res.read()
            code = res.status
    except urllib.error.HTTPError as e:
        payload = e.read()
        code = e.code
    if raw:
        return code, payload
    text = payload.decode("utf-8", "replace")
    try:
        return code, json.loads(text) if text else None
    except json.JSONDecodeError:
        return code, text


def mcp(method, params):
    code, payload = http("POST", MCP_URL, {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "MCP-Protocol-Version": "2025-06-18",
    }, {"jsonrpc": "2.0", "id": 1, "method": method, "params": params}, raw=True)
    text = payload.decode()
    if text.lstrip().startswith(("event:", "data:")):
        lines = [l[6:] for l in text.replace("\r", "").split("\n") if l.startswith("data: ")]
        text = lines[-1]
    return code, json.loads(text)


def api_headers(token):
    return {"apikey": ANON, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def totp(secret_b32):
    """A TOTP code for a base32 secret (RFC 6238: SHA-1, 30 s, 6 digits), to enrol the second step in the test."""
    import base64, hmac, hashlib, struct, time
    key = base64.b32decode(secret_b32.upper() + "=" * (-len(secret_b32) % 8))
    counter = struct.pack(">Q", int(time.time()) // 30)
    digest = hmac.new(key, counter, hashlib.sha1).digest()
    offset = digest[-1] & 0x0F
    return str((struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % 1_000_000).zfill(6)


def office_sign_in(email, password, enrol_totp):
    """Signs an office user in; with enrol_totp, enrols a TOTP factor and verifies it (the session becomes aal2)."""
    code, s = http("POST", f"{API}/auth/v1/token?grant_type=password", {"apikey": ANON, "Content-Type": "application/json"},
                   {"email": email, "password": password})
    if code != 200:
        raise RuntimeError(f"sign-in failed for {email}: {code} {s}")
    token = s["access_token"]
    if not enrol_totp:
        return token
    code, f = http("POST", f"{API}/auth/v1/factors", api_headers(token), {"factor_type": "totp", "friendly_name": "test", "issuer": "Fame Fleet"})
    if code != 200:
        raise RuntimeError(f"TOTP enrol failed: {code} {f} (is [auth.mfa.totp] enabled in config.toml?)")
    code, c = http("POST", f"{API}/auth/v1/factors/{f['id']}/challenge", api_headers(token), {})
    code, v = http("POST", f"{API}/auth/v1/factors/{f['id']}/verify", api_headers(token), {"challenge_id": c["id"], "code": totp(f["totp"]["secret"])})
    if code != 200:
        raise RuntimeError(f"TOTP verify failed: {code} {v}")
    return v["access_token"]


def api_call(token, name, args):
    return http("POST", f"{API}/functions/v1/office-api/tools/{name}", api_headers(token), args or {})


def tool(name, args=None, expect_error=False):
    """Returns the tool's JSON result, or its error text when expect_error."""
    global calls
    calls += 1
    if CHANNEL == "api":
        code, answer = api_call(API_TOKEN, name, args)
        if code == 200:
            if expect_error:
                raise RuntimeError(f"{name}: expected an error, got {str(answer)[:200]}")
            return answer["result"]
        text = answer.get("error", "") if isinstance(answer, dict) else str(answer)
        if isinstance(answer, dict) and answer.get("issues"):
            text += ": " + "; ".join(f"{i['path']} {i['message']}" for i in answer["issues"])
        if code in (400, 403, 409) and expect_error:
            return text
        raise RuntimeError(f"{name}: office-api {code}: {text or str(answer)[:200]}")
    code, answer = mcp("tools/call", {"name": name, "arguments": args or {}})
    result = answer.get("result")
    if result is None:
        raise RuntimeError(f"{name}: protocol error {answer}")
    text = result["content"][0]["text"]
    if result.get("isError"):
        if expect_error:
            return text
        raise RuntimeError(f"{name}: tool error: {text}")
    if expect_error:
        raise RuntimeError(f"{name}: expected an error, got {text[:200]}")
    return json.loads(text)


def psql(sql):
    out = subprocess.run(
        ["docker", "exec", "-i", DB_CONTAINER, "psql", "-U", "postgres", "-d", "postgres", "-X", "-q", "-A", "-t", "-c", sql],
        capture_output=True, text=True, check=True)
    return out.stdout.strip()


def sign_in(username, pin):
    return http("POST", f"{API}/auth/v1/token?grant_type=password", {"apikey": ANON, "Content-Type": "application/json"},
                {"email": f"{username}@drivers.fame.invalid", "password": pin})


class Driver:
    """What the Fame Driver app does, with the driver's own token."""

    def __init__(self, token):
        self.h = {"apikey": ANON, "Authorization": f"Bearer {token}", "Content-Type": "application/json"}

    def get(self, path):
        return http("GET", f"{API}/rest/v1/{path}", self.h)

    def post(self, path, body, prefer="return=minimal"):
        return http("POST", f"{API}/rest/v1/{path}", {**self.h, "Prefer": prefer}, body)

    def patch(self, path, body):
        return http("PATCH", f"{API}/rest/v1/{path}", {**self.h, "Prefer": "return=representation"}, body)

    def upload(self, path, data):
        return http("POST", f"{API}/storage/v1/object/driver-photos/{path}", {**self.h, "Content-Type": "image/jpeg"}, data)


now = dt.datetime.now(dt.timezone.utc)
colombo = dt.timezone(dt.timedelta(hours=5, minutes=30))
today = now.astimezone(colombo).date()
iso = lambda d: d.isoformat()
day = lambda n: iso(today + dt.timedelta(days=n))
TINY_JPEG = bytes.fromhex(
    "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432"
    "ffc0000b080001000101011100ffc4001f0000010501010101010100000000000000000102030405060708090a0bffc400b5100002010303020403050504040000017d01020300041105122131410613516107227114"
    "328191a1082342b1c11552d1f02433627282090a161718191a25262728292a3435363738393a434445464748494a535455565758595a636465666768696a737475767778797a838485868788898a92939495969798999a"
    "a2a3a4a5a6a7a8a9aab2b3b4b5b6b7b8b9bac2c3c4c5c6c7c8c9cad2d3d4d5d6d7d8d9dae1e2e3e4e5e6e7e8e9eaf1f2f3f4f5f6f7f8f9faffda0008010100003f00fbfcffd9")

# ---------------------------------------------------------------------------
if CHANNEL == "api":
    print("\n== 0. An admin signs in to office-api ==")
    if not SERVICE:
        sys.exit("CHANNEL=api needs SERVICE_ROLE_KEY (scripts/test-mcp-local.sh exports it).")
    admin_email = f"admin.{uuid.uuid4().hex[:6]}@fame.test"
    admin_pw = "Adm1n-" + uuid.uuid4().hex[:10]
    code, au = http("POST", f"{API}/auth/v1/admin/users", {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"},
                    {"email": admin_email, "password": admin_pw, "email_confirm": True})
    check(code in (200, 201), "the test admin's sign-in is created (service role, local only)", f"{code} {str(au)[:120]}")
    psql(f"insert into employees (code, name, email, role, auth_user_id) values ('ADM-{uuid.uuid4().hex[:4]}', 'Test Admin', '{admin_email}', 'admin', '{au['id']}')")
    aal1 = office_sign_in(admin_email, admin_pw, enrol_totp=False)
    code, body = http("GET", f"{API}/functions/v1/office-api/me", api_headers(aal1))
    check(code == 200 and body.get("mfa") is False and body.get("mfa_required") is False,
          "an admin signs in with the password alone (2-step optional): /me gives mfa false", f"{code} {body}")
    API_TOKEN = office_sign_in(admin_email, admin_pw, enrol_totp=True)
    code, me = http("GET", f"{API}/functions/v1/office-api/me", api_headers(API_TOKEN))
    check(code == 200 and me.get("role") == "admin" and me.get("mfa") is True and "create_office_user" in me.get("tools", []),
          "after turning on 2-step: /me gives the role, mfa true and the admin tools", f"{code} {str(me)[:200]}")
    code, body = http("GET", f"{API}/functions/v1/office-api/me", {"apikey": ANON, "Content-Type": "application/json"})
    check(code == 401, "no token: 401", code)
    code, tl = http("GET", f"{API}/functions/v1/office-api/tools", api_headers(API_TOKEN))
    check(code == 200 and any(t["name"] == "create_task" and t["input"].get("properties", {}).get("title") for t in tl.get("tools", [])),
          "/tools lists the tools with their input schemas", f"{code}")

print("\n== 1. Set up the fleet through the tools ==")
tool("add_rental_company", {"name": "Lanka Rent-a-Car", "phone": "0112345678"})
tool("add_rental_company", {"name": "City Wheels"})
r = tool("add_rental_company", {"name": "lanka rent-a-car"}, expect_error=True)
check("already exists" in r.lower(), "a duplicate rental company is refused with a clear message", r)

v1 = tool("register_vehicle", {
    "reg_no": "wp cab-4521", "make_model": "Toyota HiAce", "vehicle_type": "van", "seats": 14,
    "rental_company": "Lanka Rent", "rent_until": day(11), "monthly_rent_lkr": 180000, "monthly_km_allowance": 3000,
    "current_odometer_km": 84500, "service_interval_km": 5000, "last_service_odometer_km": 80620,
    "next_service_date": day(10), "licence_expiry": day(4), "insurance_expiry": day(200), "emission_expiry": day(20)})
check(v1["registered"]["reg_no"] == "WP CAB-4521", "register_vehicle normalises the plate to WP CAB-4521")
check(v1["registered"]["documents"]["lic"]["chip"] == "red" and v1["registered"]["documents"]["emi"]["chip"] == "orange"
      and v1["registered"]["documents"]["ins"]["chip"] == "ok", "document chips: licence in 4 days = red, emission in 20 days = orange, insurance = ok")
check(v1["registered"]["monthly_rent_lkr"] == 180000 and psql("select monthly_rent_cents from vehicles where reg_no='WP CAB-4521'") == "18000000",
      "rent is stored as cents (18,000,000) and shown as LKR 180,000")
tool("register_vehicle", {"reg_no": "WP PH-2087", "make_model": "Nissan Caravan", "vehicle_type": "van", "seats": 12,
                          "rental_company": "City Wheels", "monthly_km_allowance": 3000, "current_odometer_km": 51200})
tool("register_vehicle", {"reg_no": "WP CAR-1182", "make_model": "Toyota Axio", "vehicle_type": "car", "seats": 4,
                          "rental_company": "City Wheels", "monthly_km_allowance": 2500})
r = tool("register_vehicle", {"reg_no": "WP CAB-4521"}, expect_error=True)
check("already exists" in r.lower(), "a duplicate plate is refused", r)
r = tool("update_vehicle", {"reg_no": "car1182", "in_garage": True, "garage_booked_date": day(2)})
check(r["in_garage"] is True and r["updated"]["reg_no"] == "WP CAR-1182", "update_vehicle finds 'car1182' and marks it in garage")

PIN1, PIN2 = "482913", "175046"
d1 = tool("create_driver", {"name": "Nuwan Perera", "code": "E101", "username": "Nuwan.P", "pin": PIN1, "phone": "0771234567"})
check(d1["created"]["username"] == "nuwan.p" and d1["created"]["has_login"] and PIN1 not in json.dumps(d1),
      "create_driver lower-cases the username, creates the sign-in, and does not echo the PIN")
check(d1["created"]["whatsapp"] == "https://wa.me/94771234567" and d1["created"]["call"] == "tel:+94771234567", "phone links: wa.me/9477… and tel:+9477…")
tool("create_driver", {"name": "Kasun Silva", "code": "E102", "username": "kasun.s", "pin": PIN2, "phone": "+94 71 555 0102"})
r = tool("create_driver", {"name": "Other", "code": "E103", "username": "nuwan.p", "pin": "111111"}, expect_error=True)
check("already used" in r, "a duplicate username is refused", r)
code, answer = mcp("tools/call", {"name": "create_driver", "arguments": {"name": "Bad", "code": "E104", "username": "bad.pin", "pin": "12345"}})
check(answer.get("result", {}).get("isError") is True or "error" in answer, "a 5-digit PIN is rejected before anything runs")
check(psql("select count(*) from auth.users where email like '%@drivers.fame.invalid' and email_confirmed_at is not null") == "2",
      "2 Auth users exist with @drivers.fame.invalid emails, both confirmed")
check(psql("select string_agg(username, ',' order by username) from employees") == "kasun.s,nuwan.p", "usernames are stored on employees")
tool("update_driver", {"username": "nuwan.p", "licence_expiry": day(9)})

tool("add_place", {"name": "Head office, Colombo 05", "address": "Havelock Road, Colombo 05", "lat": 6.8868, "lng": 79.8612, "kind": "office"})
tool("add_place", {"name": "Kurunegala tower site", "lat": 7.4839, "lng": 80.3683, "kind": "site"})
r = tool("add_place", {"name": "Half a pin", "lat": 7.0}, expect_error=True)
check("both lat and lng" in r, "a place with only lat is refused", r)

imp = tool("import_projects", {"projects": [
    {"project_id": "7559274000001234001", "project_name": "13021_TRKAN1", "customer_id": "7559274000000111001", "customer_name": "ZTE Lanka (PVT) Ltd", "status": "active"},
    {"project_id": "7559274000001234002", "project_name": "13036_Facility Management_Oct_MS", "customer_name": "Mobitel (Pvt) Ltd", "status": "active"},
    {"project_id": "7559274000001234003", "project_name": "13019_BTKAT3", "customer_name": "ZTE Lanka (PVT) Ltd", "status": "active"},
    {"project_id": "7559274000001234001", "project_name": "13021_TRKAN1", "customer_name": "ZTE Lanka (PVT) Ltd", "status": "active"}]})
check(imp["saved"] == 3 and imp["duplicates_in_batch"] == 1, "import_projects saves 3 and reports the 1 duplicate in the batch")
imp2 = tool("import_projects", {"projects": [{"project_id": "7559274000001234003", "project_name": "13019_BTKAT3", "customer_name": "ZTE Lanka (PVT) Ltd", "status": "inactive"}]})
check(psql("select count(*) || '/' || (select status from projects where job_no='13019') from projects") == "3/inactive", "importing again updates instead of duplicating")
for text, rule, name in [("13021_trkan1", "name", "13021_TRKAN1"), ("trkan1", "short_name", "13021_TRKAN1"),
                         ("13036", "job_no", "13036_Facility Management_Oct_MS"), ("facility", "contains", "13036_Facility Management_Oct_MS")]:
    f = tool("find_project", {"text": text})
    check(f["matched_by"] == rule and f["count"] == 1 and f["projects"][0]["name"] == name, f"find_project '{text}' matches by {rule}", json.dumps(f)[:200])
f = tool("find_project", {"text": "130"})
check(f["matched_by"] == "contains" and f["count"] == 3, "find_project '130' lists all 3 candidates")
f = tool("find_project", {"text": "1302_"})
check(f["count"] == 0, "'_' in the search text is not treated as a wildcard")

# ---------------------------------------------------------------------------
print("\n== 2. Tasks and requests ==")
start = (now.astimezone(colombo) + dt.timedelta(minutes=20)).strftime("%H:%M")
end = (now.astimezone(colombo) + dt.timedelta(hours=3)).strftime("%H:%M")
can_today = (now.astimezone(colombo) + dt.timedelta(hours=3, minutes=5)).date() == today
task_day = iso(today) if can_today else day(1)
r = tool("create_task", {"title": "Bad split", "date": task_day, "start_time": start, "driver": "nuwan.p", "vehicle": "cab4521",
                         "pickup": "Head office", "dropoff": "Kurunegala tower site",
                         "projects": [{"project": "13021", "percent": 60}, {"project": "13036", "percent": 30}]}, expect_error=True)
check("total 90" in r, "a project split of 90 % is refused", r)
r = tool("create_task", {"title": "No such project", "date": task_day, "start_time": start, "driver": "nuwan.p", "vehicle": "cab4521",
                         "pickup": "Head office", "dropoff": "Kurunegala tower site", "projects": [{"project": "99999", "percent": 100}]}, expect_error=True)
check("No project matches" in r, "an unknown project is refused", r)
check(psql("select count(*) from tasks") == "0", "the refused attempts saved nothing")

t1 = tool("create_task", {"title": "Team drop · Kurunegala site", "date": task_day, "start_time": start, "end_time": end,
                          "driver": "Nuwan", "vehicle": "WP CAB-4521", "pickup": "head office", "dropoff": "Kurunegala tower site",
                          "passengers": 5, "contact_name": "Ashan W.", "contact_phone": "0779998877",
                          "projects": [{"project": "13036", "percent": 60}, {"project": "TRKAN1", "percent": 40}], "created_by": "Charuka W."})
T1 = t1["task_id"]
check(t1["pickup"] == "Head office, Colombo 05" and t1["driver"] == "Nuwan Perera" and t1["vehicle"] == "WP CAB-4521",
      "create_task resolves 'Nuwan', the plate and the saved place 'head office'")
check(any("revenue licence" in w for w in t1["warnings"]) is False and isinstance(t1["warnings"], list), "no false 'expired document' warning (licence expires in 4 days, not yet)")
check(psql(f"select label || '|' || (select count(*) from task_stops where task_id=t.id) || '|' || (select string_agg(percent::text, '+' order by percent desc) from task_projects where task_id=t.id) from tasks t where id='{T1}'")
      == "Facility Management_Oct_MS +1|2|60.00+40.00", "task saved with 2 stops, a 60/40 split and a label from the project")
check("wa.me/94771234567?text=" in t1["links"]["whatsapp_driver"] and "google.com%2Fmaps%2Fdir" in t1["links"]["whatsapp_driver"],
      "WhatsApp link to the driver carries the task text and a navigate link")

t2 = tool("create_task", {"title": "Return team · Head office", "date": task_day, "start_time": start, "driver": "nuwan.p", "vehicle": "cab4521",
                          "pickup": "Kurunegala tower site", "dropoff": "Somewhere not saved"})
T2 = t2["task_id"]
check(any("WP CAB-4521 is booked" in w for w in t2["warnings"]) and any("Nuwan Perera has another task" in w for w in t2["warnings"]),
      "a second task at the same time warns about the vehicle and the driver, but is still created", json.dumps(t2["warnings"]))
check(any("not a saved place" in n for n in t2["notes"]) and t2["projects"] == "Fame internal (no project)", "free-text drop-off is noted; no project = Fame internal")
t3 = tool("create_task", {"title": "Bank documents run", "date": task_day, "start_time": start, "driver": "kasun.s", "vehicle": "car1182",
                          "pickup": "Head office", "dropoff": "Fort, Colombo 01"})
T3 = t3["task_id"]
check(any("in the garage" in w for w in t3["warnings"]), "assigning a vehicle that is in the garage gives a warning", json.dumps(t3["warnings"]))

re1 = tool("create_request", {"requested_by": "Dilini Rajapaksha", "project": "13036", "date": day(1), "time": "06:30", "back_by": "18:00",
                              "route_from": "Head office", "route_to": "Matara sites", "need_type": "van", "pax": 6, "tools": True})
R1 = re1["request"]["id"]
check(re1["request"]["need"] == "Van · 6 pax + tools" and re1["request"]["route"] == "Head office → Matara sites" and re1["request"]["status"] == "waiting",
      "create_request: 'Van · 6 pax + tools', route, status waiting", json.dumps(re1["request"]))
re2 = tool("create_request", {"requested_by": "Sakuni Herath", "project": "HR", "date": day(2), "time": "14:00", "route_to": "Rajagiriya", "need_type": "car", "pax": 2})
R2 = re2["request"]["id"]
check(re2["project_linked"].startswith("no") and re2["request"]["project"] == "HR", "a request for 'HR' keeps a plain label (not a Zoho project)")
lr = tool("list_requests")
check(lr["count"] == 2 and lr["requests"][0]["id"] == R1, "list_requests shows the 2 waiting requests, soonest first")
sv = tool("suggest_vehicles", {"request_id": R1})
by_plate = {v["reg_no"]: v for v in sv["vehicles"]}
check(by_plate["WP CAR-1182"]["availability"] == "in garage" and by_plate["WP CAR-1182"]["pick"] == "no"
      and by_plate["WP PH-2087"]["availability"] == "free all day" and sv["vehicles"][0]["pick"] == "good",
      "suggest_vehicles: car in garage = no; vans free all day, best first", json.dumps(sv["vehicles"])[:400])
r = tool("decide_request", {"request_id": R1, "decision": "approve"}, expect_error=True)
check("vehicle and a driver" in r, "approve without vehicle/driver is refused", r)
ap = tool("decide_request", {"request_id": R1, "decision": "approve", "vehicle": "WP PH-2087", "driver": "kasun.s", "decided_by": "Charuka W."})
T4 = ap["task_id"]
check(ap["request"] == "approved" and ap["driver"] == "Kasun Silva" and ap["title"] == "Trip · Matara sites", "decide_request approve creates the task", json.dumps(ap)[:300])
check(psql(f"select status || '|' || decided_by || '|' || (task_id = '{T4}') from vehicle_requests where id='{R1}'") == "approved|Charuka W.|true"
      and psql(f"select request_id = '{R1}' and passengers = 6 and (select percent from task_projects where task_id = t.id) = 100 from tasks t where id='{T4}'") == "t",
      "request and task are linked both ways; pax and 100 % project carried over")
r = tool("decide_request", {"request_id": R1, "decision": "approve", "vehicle": "WP PH-2087", "driver": "kasun.s"}, expect_error=True)
check("already approved" in r and psql(f"select count(*) from tasks where request_id='{R1}'") == "1", "a request cannot be approved twice", r)
r = tool("decide_request", {"request_id": R2, "decision": "decline"}, expect_error=True)
check("reason" in r.lower(), "decline without a reason is refused", r)
dc = tool("decide_request", {"request_id": R2, "decision": "decline", "reason": "No car free that afternoon"})
check(dc["request"]["status"] == "declined" and dc["request"]["decline_reason"] == "No car free that afternoon", "decide_request decline records the reason")

# ---------------------------------------------------------------------------
print("\n== 3. The driver's side (as the app will do it) ==")
code, session = sign_in("nuwan.p", PIN1)
check(code == 200 and "access_token" in session, "driver signs in with username + PIN (no email confirmation needed)", str(session)[:200])
code, bad = sign_in("nuwan.p", "000000")
check(code == 400, "a wrong PIN is refused", f"{code}")
app = Driver(session["access_token"])
code, me = app.get("employees?select=id,name,code,username,current_vehicle_id")
check(code == 200 and len(me) == 1 and me[0]["username"] == "nuwan.p", "driver reads exactly their own employee row", str(me)[:200])
ME = me[0]["id"]
code, vehicles = app.get("vehicles?select=id,reg_no,make_model,vehicle_type,seats,current_odometer_km,monthly_km_allowance,in_garage,active&order=reg_no")
check(code == 200 and [v["reg_no"] for v in vehicles] == ["WP CAB-4521", "WP CAR-1182", "WP PH-2087"], "driver reads the nine vehicle columns by name")
V1 = next(v["id"] for v in vehicles if v["reg_no"] == "WP CAB-4521")
code, err = app.get("vehicles?select=*")
check(code in (401, 403) and "permission denied" in json.dumps(err), "select * on vehicles is refused for the driver (REST)", f"{code} {str(err)[:120]}")
code, mine = app.get("tasks?select=id,title,status&order=title")
check(code == 200 and sorted(t["id"] for t in mine) == sorted([T1, T2]), "driver sees only their own 2 tasks", str(mine)[:200])
code, _ = app.patch("employees?id=eq." + ME, {"current_vehicle_id": V1})
check(code == 200, "driver sets their current vehicle")
code, _ = app.patch("tasks?id=eq." + T1, {"seen_at": iso(now)})
check(code == 200, "driver records seen_at")

board = tool("task_board", {"date": task_day})
cards = {c["id"]: c for col in ("assigned", "in_progress", "completed") for c in board[col]}
check(cards[T1]["status"].startswith("Seen by driver ") and cards[T2]["status"] == "Sent · not opened yet", "task_board: 'Seen by driver HH:MM' and 'Sent · not opened yet'",
      f"{cards[T1]['status']} / {cards[T2]['status']}")
check(cards[T1]["from"] == "Head office, Colombo 05" and cards[T1]["to"] == "Kurunegala tower site" and cards[T1]["vehicle"] == "WP CAB-4521", "task_board card has from / to / vehicle")

SESSION = str(uuid.uuid4())
code, _ = app.post("duty_sessions", {"id": SESSION, "employee_id": ME, "vehicle_id": V1, "device_info": {"model": "test phone"}})
check(code == 201, "driver starts sharing (duty session)", f"{code}")
ld = tool("live_drivers")
check(ld["counts"]["all"] == 1 and ld["drivers"][0]["location"] == "Sharing · no location yet" and ld["drivers"][0]["state"] == "stale",
      "live_drivers right after switching on: 'Sharing · no location yet'", json.dumps(ld)[:300])

# A drive from Colombo 05 towards Polgahawela with a 12-minute stop on the way.
A, STOP, B = (6.8868, 79.8612), (7.0900, 80.0300), (7.3381, 80.3003)
points = []
def leg(p, q, t0, minutes, n):
    for i in range(n):
        f = i / (n - 1)
        points.append({"employee_id": ME, "session_id": SESSION, "recorded_at": iso(t0 + dt.timedelta(minutes=minutes * f)),
                       "lat": round(p[0] + (q[0] - p[0]) * f, 6), "lng": round(p[1] + (q[1] - p[1]) * f, 6),
                       "accuracy_m": 8, "speed_mps": 15.0, "heading": 45, "battery_pct": 81, "is_mock": False})
t0 = now - dt.timedelta(minutes=62)
leg(A, STOP, t0, 20, 30)
for i in range(13):
    # Parked: a fix a minute with a few metres of GPS jitter (a fix repeating the exact coordinates would be a cached one, and is dropped).
    points.append({"employee_id": ME, "session_id": SESSION, "recorded_at": iso(t0 + dt.timedelta(minutes=21 + i)),
                   "lat": round(STOP[0] + (i % 3 - 1) * 0.00002, 6), "lng": round(STOP[1] + ((i * 7) % 5 - 2) * 0.00002, 6),
                   "accuracy_m": 6, "speed_mps": 0, "heading": 0, "battery_pct": 80, "is_mock": False})
leg(STOP, B, t0 + dt.timedelta(minutes=35), 25, 40)
points[-1]["recorded_at"] = iso(now - dt.timedelta(minutes=2))
code, _ = app.post("location_points?on_conflict=employee_id,recorded_at", points, prefer="resolution=ignore-duplicates,return=minimal")
check(code == 201, f"driver uploads {len(points)} location points", f"{code}")
code, _ = app.post("location_points?on_conflict=employee_id,recorded_at", points[:10], prefer="resolution=ignore-duplicates,return=minimal")
check(code in (200, 201) and psql(f"select count(*) from location_points where employee_id='{ME}'") == str(len(points)), "re-uploading the same points adds nothing")

code, row = app.patch("tasks?id=eq." + T1, {"status": "in_progress", "start_odometer_km": 84530})
check(code == 200 and row[0]["status"] == "in_progress" and row[0]["started_at"], "driver starts the task with start odometer 84,530", str(row)[:200])

def photo(kind, **links):
    pid = str(uuid.uuid4())
    path = f"{ME}/{iso(today)}/{pid}.jpg"
    c1, _ = app.upload(path, TINY_JPEG)
    c2, _ = app.post("photos", {"id": pid, "employee_id": ME, "kind": kind, "storage_path": path, **links})
    return pid, (c1, c2)

p_start, codes = photo("odometer")
check(codes == (200, 201), "driver uploads an odometer photo into their own folder and records it", str(codes))
code, _ = app.post("odometer_logs", {"vehicle_id": V1, "employee_id": ME, "kind": "manual", "reading_km": 84512, "logged_at": iso(now - dt.timedelta(hours=20))})
code2, _ = app.post("odometer_logs", {"vehicle_id": V1, "employee_id": ME, "task_id": T1, "kind": "task_start", "reading_km": 84530, "ocr_value": 84530, "photo_id": p_start,
                                      "logged_at": iso(now - dt.timedelta(minutes=60))})
check((code, code2) == (201, 201), "driver logs yesterday's reading (84,512) and the task start reading (84,530) with its photo")
code, other = app.upload(f"{uuid.uuid4()}/{iso(today)}/x.jpg", TINY_JPEG)
check(code in (400, 403), "uploading into another employee's folder is refused", f"{code} {str(other)[:120]}")

code, stops = app.get(f"task_stops?select=id,seq&task_id=eq.{T1}&order=seq")
code, _ = app.patch("task_stops?id=eq." + stops[0]["id"], {"status": "done", "arrived_at": iso(now - dt.timedelta(minutes=61)), "done_at": iso(now - dt.timedelta(minutes=60))})
check(code == 200, "driver marks the pickup stop done")

board = tool("task_board", {"date": task_day})
running = {c["id"]: c for c in board["in_progress"]}
check(T1 in running and running[T1]["status"].startswith("Started ") and running[T1]["status"].endswith("sharing location"), "task_board: 'Started HH:MM · sharing location'", str(running.get(T1)))
ld = tool("live_drivers")
d = ld["drivers"][0]
check(ld["counts"]["sharing"] == 1 and d["location"] in ("Live · 2 min", "Live · 3 min") and d["near"] == "Polgahawela" and d["speed_kmh"] == 54,
      "live_drivers: Live · 2 min, near Polgahawela, 54 km/h", json.dumps(d)[:300])

check(d["vehicle"] == "WP CAB-4521 · Toyota HiAce" and d["task"] == "Team drop · Kurunegala site" and d["going_to"] == "Kurunegala tower site"
      and d["links"]["maps"].endswith("query=7.3381,80.3003") and d["links"]["whatsapp"] == "https://wa.me/94771234567",
      "live_drivers: vehicle, current task, destination and links", json.dumps(d)[:400])
ov = tool("fleet_overview", {"date": task_day})
check(ov["vehicles"] == {"on_the_road": 1, "total": 3, "parked": 2, "in_garage": 1} and ov["tasks"]["total"] == 3 and ov["tasks"]["in_progress"] == 1,
      "fleet_overview: 1 of 3 on the road, 2 parked, 3 tasks, 1 in progress", json.dumps(ov["vehicles"]) + json.dumps(ov["tasks"]))
whats = [a["what"] for a in ov["needs_attention"]]
check(ov["requests"]["waiting"] == 0 and {"Revenue licence expires", "Rental agreement ends", "Driver licence expires", "Garage booked", "Service due"} <= set(whats)
      and "Emission test expires" not in whats, "fleet_overview needs-attention: licence, rental end, driver licence, garage, service (and not the emission test due in 20 days)",
      json.dumps(ov["needs_attention"])[:600])
check(ov["on_the_road"][0]["driver"] == "Nuwan Perera" and ov["on_the_road"][0]["near"] == "Polgahawela", "fleet_overview on-the-road list names the driver and the nearest town")
rt = tool("driver_route", {"driver": "nuwan.p"})
# The points are 41 s apart (real phones record every 5 s), so the drift filter drops the last step of each leg: a little under 68 km, a stop of 13-15 min.
check(rt["recorded_points"] == len(points) and 60 <= rt["km"] <= 80 and len(rt["stops_over_10_min"]) == 1 and 12 <= rt["stops_over_10_min"][0]["minutes"] <= 16
      and 2 <= len(rt["route"]["points"]) <= len(points), "driver_route: about 65 km, one stop of about 14 minutes", json.dumps({k: rt[k] for k in ("recorded_points", "km", "stops_over_10_min")}))
# The route builder (shared with the web app): a timeline, the day's numbers, the line thinned by shape, a task's own window.
kinds = [s["kind"] for s in rt["timeline"]]
check(kinds.count("stopped") == 1 and kinds.count("driving") == 2 and "no_data" not in kinds and all(s["text"] and s["from_at"] <= s["to_at"] for s in rt["timeline"])
      and rt["timeline"][1]["near"] and rt["timeline"][1]["text"].endswith(" Stopped near " + rt["timeline"][1]["near"]),
      "driver_route timeline: driving, stopped near a town, driving, each row with a sentence", json.dumps(rt["timeline"])[:500])
check(rt["stops_count"] == 1 and 40 <= rt["driving_minutes"] <= 50 and 12 <= rt["stopped_minutes"] <= 16 and rt["gaps"] == [] and abs(rt["stops_over_10_min"][0]["lat"] - STOP[0]) < 0.001,
      "driver_route numbers: one stop, about 45 driving minutes, about 13 stopped minutes, no data gap, the stop's coordinates",
      {k: rt[k] for k in ("stops_count", "driving_minutes", "stopped_minutes", "gaps")})
check(rt["route"]["columns"] == ["time", "lat", "lng", "km/h", "at"] and len(rt["route"]["points"]) < len(points) // 2
      and all(len(r) == 5 and r[4].endswith("Z") for r in rt["route"]["points"]) and rt["window"]["from"] < rt["window"]["to"],
      "driver_route line: two straight legs thin to a few points (corners kept), each with km/h and an ISO time", {"line": len(rt["route"]["points"]), "recorded": rt["recorded_points"]})
check("not started" in tool("driver_route", {"task_id": T2})["note"], "driver_route(task_id) of a task that has not started says so")
check("which driver" in tool("driver_route", {}, expect_error=True), "driver_route with neither a driver nor a task is refused")

# --- The phone's heartbeat and the one status rule ---------------------------
check(d["status"] == "live" and d["status_text"].startswith("Live · ") and d["last_position_at"] == d["updated"][-5:] and d["signal"]["sharing"] is True,
      "live_drivers: the new status is live, with the last position time and the raw signal", json.dumps({k: d.get(k) for k in ("status", "status_text", "last_position_at", "signal")})[:300])

# The phone's heartbeat: Location switched off 12 minutes ago, still off now (two heartbeats, as the app sends them).
# A point under 3 minutes old always means live, so first let the newest point age to 4 minutes (test-only, straight in the table).
psql(f"update driver_latest set recorded_at = now() - interval '4 minutes' where employee_id='{ME}'")
d = tool("live_drivers")["drivers"][0]
check(d["status"] == "no_signal" and d["status_text"].startswith("No signal since ") and d["state"] == "sharing",
      "4 minutes without a point: no_signal (the old 15-minute state is still 'sharing')", json.dumps({k: d.get(k) for k in ("status", "status_text", "state")}))
hb = lambda minutes_ago, on, perm="always", queued=0: app.post("rpc/send_heartbeat", {
    "p_at": iso(now - dt.timedelta(minutes=minutes_ago)), "p_sharing": True, "p_location_on": on, "p_permission": perm,
    "p_battery_pct": 77, "p_app_version": "1.1.0+test", "p_queued_points": queued})
code1, _ = hb(12, False); code2, _ = hb(0, False, queued=4)
check(code1 in (200, 204) and code2 in (200, 204), "driver sends two heartbeats with Location off (12 min ago and now)", f"{code1} {code2}")
ld = tool("live_drivers")
d = ld["drivers"][0]
check(d["status"] == "location_off" and d["status_text"].startswith("Location off since ") and d["queued_points"] == 4 and d["app_version"] == "1.1.0+test"
      and ld["status_counts"]["location_off"] == 1 and ld["counts"]["sharing"] == 1,
      "live_drivers: status location_off since the first off heartbeat; the old 'sharing' state is unchanged", json.dumps({k: d.get(k) for k in ("status", "status_text", "queued_points", "app_version")}) + str(ld["status_counts"]))
check(tool("live_drivers", {"filter": "location_off"})["drivers"][0]["username"] == d["username"], "live_drivers filter=location_off finds the driver")
ov = tool("fleet_overview")
road = [r for r in ov["on_the_road"] if r["driver"] == d["driver"]]
check(road and road[0]["status"] == "location_off" and road[0]["last_position_at"] == d["last_position_at"], "fleet_overview: on the road carries the status too", json.dumps(road)[:300])
whats = [a["what"] for a in ov["needs_attention"]]
check("Driver's location is off" in whats and any(a["level"] == "red" and a["due"].startswith("for 1") for a in ov["needs_attention"] if a["what"] == "Driver's location is off"),
      "fleet_overview: a running task with Location off for 12 min needs attention (red, 'for 12 min')", json.dumps(ov["needs_attention"])[:400])
# Location back on, no new point for a while: no signal; then a fresh point: live again.
code3, _ = hb(-0.2, True)
d = tool("live_drivers")["drivers"][0]
check(code3 in (200, 204) and d["status"] == "no_signal" and d["status_text"].startswith("No signal since "), "heartbeat with Location on but the last point is old: no_signal", json.dumps({k: d.get(k) for k in ("status", "status_text")}))
code4, _ = app.post("location_points?on_conflict=employee_id,recorded_at", [{"employee_id": ME, "session_id": SESSION, "recorded_at": iso(now - dt.timedelta(seconds=30)),
    "lat": B[0], "lng": B[1], "accuracy_m": 8, "speed_mps": 15.0, "heading": 45, "battery_pct": 81, "is_mock": False}], prefer="resolution=ignore-duplicates,return=minimal")
d = tool("live_drivers")["drivers"][0]
check(code4 == 201 and d["status"] == "live", "a fresh point makes the driver live again", d.get("status_text"))
# A backlog that arrives late (older points uploaded after newer ones): the route is still in time order, the latest position unchanged.
late = [{"employee_id": ME, "session_id": SESSION, "recorded_at": iso(t0 - dt.timedelta(minutes=30 - i)), "lat": A[0] - 0.01 * i, "lng": A[1], "accuracy_m": 8,
         "speed_mps": 10.0, "heading": 0, "battery_pct": 85, "is_mock": False} for i in range(5)]
code5, _ = app.post("location_points?on_conflict=employee_id,recorded_at", late, prefer="resolution=ignore-duplicates,return=minimal")
route_late = tool("driver_route", {"driver": "nuwan.p"})
times = [r[0] for r in route_late["route"]["points"]]
check(code5 == 201 and route_late["recorded_points"] == len(points) + 1 + 5 and times == sorted(times) and route_late["first_point"] == times[0],
      "a backlog uploaded late is placed by recorded_at in driver_route (first point is now the oldest)", {"first": route_late.get("first_point"), "n": route_late.get("recorded_points")})
check(psql(f"select to_char(recorded_at at time zone 'UTC', 'HH24:MI') from driver_latest where employee_id='{ME}'") == (now - dt.timedelta(seconds=30)).strftime("%H:%M"),
      "driver_latest keeps the newest point, not the last uploaded one")
# The task's own window: it started after the drive, so a point recorded now (after Start task) is the only one inside it.
code6, _ = app.post("location_points?on_conflict=employee_id,recorded_at", [{"employee_id": ME, "session_id": SESSION, "recorded_at": iso(dt.datetime.now(dt.timezone.utc)),
    "lat": B[0] + 0.001, "lng": B[1], "accuracy_m": 8, "speed_mps": 12.0, "heading": 45, "battery_pct": 80, "is_mock": False}], prefer="resolution=ignore-duplicates,return=minimal")
tr = tool("driver_route", {"task_id": T1})
check(tr["task"]["id"] == T1 and tr["task"]["title"] == "Team drop · Kurunegala site" and tr["driver"] == "Nuwan Perera" and code6 == 201 and tr["recorded_points"] == 1
      and tr["task"].get("completed") is None and tr["window"]["from"] == tr["task"]["started"],
      "driver_route(task_id): the task's own window from Start task to now, no driver needed", json.dumps({k: tr.get(k) for k in ("task", "recorded_points", "km", "window")})[:300])

rep_id = str(uuid.uuid4())
code, _ = app.post("vehicle_reports", {"id": rep_id, "vehicle_id": V1, "employee_id": ME, "task_id": T1, "category": "tyre", "note": "Front left tyre is worn"})
p_rep, codes = photo("vehicle_report", vehicle_report_id=rep_id)
check(code == 201 and codes == (200, 201), "driver reports a tyre problem with a photo")
p_end, _ = photo("odometer")
p_fuel, _ = photo("fuel_receipt")
c1, _ = app.post("odometer_logs", {"vehicle_id": V1, "employee_id": ME, "task_id": T1, "kind": "task_end", "reading_km": 84581, "ocr_value": 84587, "photo_id": p_end})
c2, _ = app.post("fuel_logs", {"vehicle_id": V1, "employee_id": ME, "task_id": T1, "litres": 32, "amount_cents": 1184000, "receipt_photo_id": p_fuel, "odometer_km": 84581})
code, row = app.patch("tasks?id=eq." + T1, {"status": "completed", "end_odometer_km": 84581})
check((c1, c2, code) == (201, 201, 200) and row[0]["km"] == 51, "driver logs end odometer + fuel and completes the task: 51 km", str(row)[:200])

# ---------------------------------------------------------------------------
print("\n== 4. What the office sees afterwards ==")
td = tool("task_detail", {"task_id": T1})
check(td["task"]["status"] == "completed" and td["task"]["km"] == 51 and td["task"]["status_line"].endswith("51 km logged")
      and td["task"]["contact"]["call"] == "tel:+94779998877", "task_detail: completed, 51 km, contact call link", json.dumps(td["task"])[:400])
check(td["unlogged_km"] == {"km": 18, "last_logged_km": 84512, "last_logged_at": td["unlogged_km"]["last_logged_at"], "start_km": 84530},
      "task_detail flags 18 unlogged km before the start (84,512 -> 84,530)", json.dumps(td.get("unlogged_km")))
check([p["percent"] for p in td["projects"]] in ([60, 40], [40, 60]) and td["stops"][0]["status"] == "done" and td["stops"][0]["navigate"].endswith("destination=6.8868%2C79.8612"),
      "task_detail: project split, stop status and navigate link", json.dumps(td["stops"])[:300])
urls = [o["photo"] for o in td["odometer"]] + [td["fuel"][0]["receipt_photo"]] + td["vehicle_reports"][0]["photos"]
check(len(urls) == 4 and all(u.startswith("http") and "token=" in u and "/object/sign/driver-photos/" in u for u in urls), "task_detail gives 4 signed photo links", str(urls)[:300])
signed = urls[0].replace("http://kong:8000", API)
code, body = http("GET", signed, raw=True)
check(code == 200 and body == TINY_JPEG, "a signed link really returns the photo", f"{code}")
token = urllib.parse.parse_qs(urllib.parse.urlparse(signed).query)["token"][0]
exp = json.loads(base64.urlsafe_b64decode(token.split(".")[1] + "=="))
check(3500 <= exp["exp"] - exp["iat"] <= 3600, "the signed link is valid for 1 hour", str(exp["exp"] - exp["iat"]))
code, body = http("GET", f"{API}/storage/v1/object/public/driver-photos/{ME}/{iso(today)}/x.jpg", raw=True)
code2, _ = http("GET", signed.split("?")[0], raw=True)
check(code in (400, 404) and code2 in (400, 401, 403), "without the signature the photo is not reachable", f"{code} {code2}")
check(td["fuel"][0]["litres"] == 32 and td["fuel"][0]["amount_lkr"] == 11840 and td["odometer"][-1]["camera_read"] == 84587, "task_detail: fuel 32 l / LKR 11,840 and the camera's reading")

lv = tool("list_vehicles")
cab = next(v for v in lv["vehicles"] if v["reg_no"] == "WP CAB-4521")
check(cab["km_this_month"] == 69 and cab["odometer_km"] == 84581 and cab["status"] == "Available" and cab["rented_from"] == "Lanka Rent-a-Car",
      "list_vehicles: 69 km this month by odometer (84,512 -> 84,581), odometer updated, Available again", json.dumps(cab)[:400])
check(cab["next_service"].startswith("In 1,039 km or ") and lv["counts"] == {"all": 3, "on_task": 0, "available": 2, "in_garage": 1, "documents_expiring": 1},
      "list_vehicles: 'In 1,039 km or <date>' and the filter counts", cab["next_service"] + json.dumps(lv["counts"]))
check(tool("list_vehicles", {"filter": "in_garage"})["vehicles"][0]["reg_no"] == "WP CAR-1182" and len(tool("list_vehicles", {"filter": "documents_expiring"})["vehicles"]) == 1,
      "list_vehicles filters: in_garage and documents_expiring")
ms = tool("mileage_summary")
gap_km = sum(v.get("between_tasks_km", 0) + v.get("overnight_km", 0) for v in ms["vehicles"])
check(gap_km == 18 and ms["biggest_gaps"][0]["km"] == 18 and ms["biggest_gaps"][0]["driver"] == "Nuwan Perera"
      and ms["biggest_gaps"][0]["to_task"] == "Team drop · Kurunegala site",
      "mileage_summary: 18 km outside tasks (84,512 -> 84,530) is the biggest gap, with the driver and the task it led to", json.dumps(ms.get("biggest_gaps"))[:300])
row = next(v for v in ms["vehicles"] if v["vehicle"] == "WP CAB-4521")
check(row["task_km"] == 51 and row["odometer_km"] == 69 and row["km_outside_tasks"] == 18 and row["fuel_litres"] == 32 and row["fuel_lkr"] == 11840
      and ms["totals"]["unlogged_km_flags"] == 1 and ms["unlogged_km"][0]["unlogged_km"] == 18 and ms["unlogged_km"][0]["driver"] == "Nuwan Perera",
      "mileage_summary: 51 task km, 69 odometer km, 18 km outside tasks, fuel 32 l / LKR 11,840, 1 unlogged flag", json.dumps(ms)[:500])
ms2 = tool("mileage_summary", {"driver": "kasun", "vehicle": "cab4521"})
check(ms2["totals"]["tasks"] == 0 and ms2["totals"]["unlogged_km_flags"] == 0, "mileage_summary narrowed to another driver shows nothing of Nuwan's")
vr = tool("list_vehicle_reports")
check(vr["count"] == 1 and vr["reports"][0]["category"] == "tyre" and len(vr["reports"][0]["photos"]) == 1 and vr["reports"][0]["driver"] == "Nuwan Perera",
      "list_vehicle_reports: the tyre report with its photo", json.dumps(vr)[:300])
ur = tool("update_vehicle_report", {"id": rep_id, "status": "in_garage", "office_note": "Booked at the garage for Friday"})
check(ur["status"] == "in_garage" and "not marked as in the garage" in ur["note"], "update_vehicle_report -> in_garage, and reminds that the vehicle itself is not marked")
ur = tool("update_vehicle_report", {"id": rep_id, "status": "closed"})
check(ur["status"] == "closed" and psql(f"select closed_at is not null and office_note = 'Booked at the garage for Friday' from vehicle_reports where id='{rep_id}'") == "t",
      "update_vehicle_report -> closed sets closed_at and keeps the note")
check(tool("list_vehicle_reports")["count"] == 0 and tool("list_vehicle_reports", {"status": "closed"})["count"] == 1, "closed reports leave the default list")

# ---------------------------------------------------------------------------
print("\n== 5. Changing tasks and drivers ==")
r = tool("reassign_task", {"task_id": T1, "driver": "kasun.s"}, expect_error=True)
check("completed" in r, "a completed task cannot be reassigned", r)
ra = tool("reassign_task", {"task_id": T2, "driver": "kasun.s", "vehicle": "WP PH-2087"})
check(ra["driver"] == "Kasun Silva" and ra["vehicle"] == "WP PH-2087" and psql(f"select seen_at is null from tasks where id='{T2}'") == "t", "reassign_task moves the task to Kasun and resets 'seen'")
code, mine = app.get("tasks?select=id")
check(sorted(t["id"] for t in mine) == [T1], "the previous driver no longer sees the reassigned task")
r = tool("cancel_task", {"task_id": T1, "reason": "x"}, expect_error=True)
check("already completed" in r, "a completed task cannot be cancelled", r)
ca = tool("cancel_task", {"task_id": T3, "reason": "Bank closed today"})
check(ca["was"] == "assigned" and psql(f"select status || '|' || cancelled_reason from tasks where id='{T3}'") == "cancelled|Bank closed today" and "wa.me/94715550102" in ca["tell_the_driver"]["whatsapp"],
      "cancel_task cancels with the reason and gives a WhatsApp link to tell the driver")
r = tool("task_detail", {"task_id": str(uuid.uuid4())}, expect_error=True)
check("No task has the id" in r, "an unknown task id gives a clear message", r)

NEW_PIN = "903317"
rp = tool("reset_pin", {"username": "nuwan.p", "pin": NEW_PIN})
check(NEW_PIN not in json.dumps(rp) and sign_in("nuwan.p", PIN1)[0] == 400 and sign_in("nuwan.p", NEW_PIN)[0] == 200, "reset_pin: the old PIN stops working, the new one works, and it is not echoed")
off = tool("set_driver_active", {"username": "nuwan.p", "active": False})
code, rows = app.get("tasks?select=id")
code2, rows2 = app.get("vehicles?select=reg_no")
check(off["active"] is False and rows == [] and rows2 == [], "set_driver_active false: the driver's existing session sees nothing at once", f"{rows} {rows2}")
check(sign_in("nuwan.p", NEW_PIN)[0] == 400 and psql(f"select end_reason from duty_sessions where id='{SESSION}'") == "admin"
      and psql(f"select sharing from driver_latest where employee_id='{ME}'") == "f", "…cannot sign in again, and location sharing was ended by the office")
ldx = tool("list_drivers")
check(ldx["count"] == 1 and tool("list_drivers", {"include_inactive": True})["count"] == 2, "list_drivers hides the switched-off driver unless asked")
on = tool("set_driver_active", {"username": "nuwan.p", "active": True})
check(sign_in("nuwan.p", NEW_PIN)[0] == 200, "set_driver_active true: the driver can sign in again")
r = tool("reset_pin", {"username": "nobody.here", "pin": "123456"}, expect_error=True)
check("No driver matches" in r, "an unknown driver gives a clear message", r)

# ---------------------------------------------------------------------------
print("\n== 6. Audit log ==")
audit = psql("select count(*) from office_audit where channel <> 'driver'")
check(int(audit) == calls, f"office_audit has one row per office tool call ({calls})", audit)
named = psql(f"select count(*) from office_audit where channel = '{'web' if CHANNEL == 'api' else 'claude'}' and actor_name = '{ACTOR_NAME}'")
check(int(named) == calls, f"every office call carries the person's name ({ACTOR_NAME}) and the channel ({'web' if CHANNEL == 'api' else 'claude'})", named)
drv = psql("select string_agg(tool || ':' || actor_name, ',' order by id) from office_audit where channel = 'driver'")
check("driver_task_in_progress:Nuwan Perera" in drv and "driver_task_completed:Nuwan Perera" in drv and "driver_report:Nuwan Perera" in drv,
      "the driver app's start, finish and problem report are in the same log, with the driver's name and channel driver", drv)
check(psql("select count(*) from office_audit where result_summary = 'started'") == "0", "every audit row was completed with a result")
leaks = psql(f"select count(*) from office_audit where args_summary ~ '({PIN1}|{PIN2}|{NEW_PIN}|111111)' or result_summary ~ '({PIN1}|{PIN2}|{NEW_PIN})'")
check(leaks == "0" and psql("select count(*) from office_audit where tool in ('create_driver','reset_pin') and args_summary like '%\"pin\":\"[hidden]\"%'") == "5",
      "no PIN appears anywhere in the audit log (shown as [hidden])", leaks)
print("   sample rows:")
for line in psql("select tool || '  |  ' || left(args_summary, 70) || '  |  ' || left(result_summary, 80) from office_audit where tool in ('create_driver','create_task','decide_request','cancel_task','reset_pin') order by id limit 7").split("\n"):
    print("     " + line)
check(psql("select count(*) from office_audit where result_summary like 'refused:%'") != "0" and psql("select count(*) from office_audit where result_summary like 'error:%'") == "0",
      "refused calls are logged as 'refused: …'; there were no internal errors", psql("select tool || ': ' || result_summary from office_audit where result_summary like 'error:%' limit 3"))

if CHANNEL == "api":
    print("\n== 7. The same answers through office-api as through the connector ==")
    shapes = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "snapshot-tool-shapes.py"), "--check"],
                            env={**os.environ, "CHANNEL": "api", "API_TOKEN": API_TOKEN}, capture_output=True, text=True)
    check(shapes.returncode == 0, "every read tool's JSON through office-api has the same shape as the connector's contract (scripts/tool-shapes.json)",
          shapes.stdout[-600:] + shapes.stderr[-300:])

    print("\n== 8. Roles: a staff member on office-api ==")
    staff_email = f"staff.{uuid.uuid4().hex[:6]}@fame.test"
    created = tool("create_office_user", {"name": "Test Staff", "email": staff_email, "role": "staff"})
    check(created["created"]["role"] == "staff" and created["set_password_link"].startswith("http") and "token" in created["set_password_link"],
          "create_office_user returns a one-time set-password link (no password typed anywhere)", str(created)[:200])
    # The person would open the link; the test sets the password through the admin API instead.
    staff_uid = psql(f"select auth_user_id from employees where email = '{staff_email}'")
    staff_pw = "St4ff-" + uuid.uuid4().hex[:10]
    code, _ = http("PUT", f"{API}/auth/v1/admin/users/{staff_uid}", {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"}, {"password": staff_pw})
    staff_token = office_sign_in(staff_email, staff_pw, enrol_totp=False)
    code, me = http("GET", f"{API}/functions/v1/office-api/me", api_headers(staff_token))
    check(code == 200 and me.get("role") == "staff" and sorted(me.get("tools", [])) == ["create_request", "find_project", "list_places", "list_requests", "task_detail"],
          "staff signs in without a second step and sees only the request tools", f"{code} {str(me)[:200]}")
    code, body = api_call(staff_token, "task_board", {})
    check(code == 403, "staff cannot see the task board (403)", f"{code} {body}")
    code, body = api_call(staff_token, "list_requests", {"status": "all"})
    check(code == 200 and body["result"]["count"] == 0, "staff see none of the office's requests", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "create_request", {"requested_by": "Somebody Else", "date": day(3), "time": "09:00", "route_to": "Galle", "pax": 2})
    check(code == 200 and body["result"]["request"]["requested_by"] == "Test Staff", "a staff request is always in their own name", f"{code} {str(body)[:200]}")
    code, body = api_call(staff_token, "list_requests", {"status": "all"})
    check(code == 200 and body["result"]["count"] == 1, "and they see that one request", f"{code} {str(body)[:160]}")
    off = tool("set_office_user_active", {"email": staff_email, "active": False})
    code, body = http("GET", f"{API}/functions/v1/office-api/me", api_headers(staff_token))
    check(off["active"] is False and code in (401, 403), "switched off: the same session is refused at once (the sign-in is banned)", f"{code} {body}")
    key = tool("create_office_key", {"email": admin_email, "label": "test"})
    # The function builds the URL from its own SUPABASE_URL; locally that is the docker-internal host, so point it at the stack.
    key_url = API + "/functions/v1" + key["connector_url"].split("/functions/v1", 1)[1]
    check("/office-mcp/" in key_url and key_url.endswith("/mcp"), "the connector URL has the connector's shape", key["connector_url"])
    def mcp_tools_list(url):
        code, lst = http("POST", url,
                         {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18"},
                         {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}, raw=True)
        text = lst.decode()
        if text.lstrip().startswith(("event:", "data:")):
            text = [l[6:] for l in text.replace("\r", "").split("\n") if l.startswith("data: ")][-1]
        try:
            message = json.loads(text)
        except json.JSONDecodeError:
            return code, [], text[:200]
        tools = message.get("result", {}).get("tools", []) if isinstance(message, dict) else []
        return code, [t["name"] for t in tools], text[:200]
    code, names, raw_text = mcp_tools_list(key_url)
    check(code == 200 and "create_office_user" in names, "a personal connector key opens the connector as that person (admin tools listed)", f"{code} {names[:3] or raw_text}")
    row = psql("select actor_name || '|' || channel from office_audit where tool = 'create_office_key' order by id desc limit 1")
    check(row == "Test Admin|web", "the key was made by Test Admin through the web channel (audit)", row)
    code, _ = api_call(API_TOKEN, "revoke_office_key", {"key_id": key["key_id"]})
    code, names, raw_text = mcp_tools_list(key_url)
    check(code == 404, "a revoked key answers 404 like any wrong key", f"{code} {raw_text}")


print(f"\n{calls} tool calls. " + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED:"))
for f in failures:
    print("  - " + f)
sys.exit(1 if failures else 0)
