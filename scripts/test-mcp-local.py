"""End-to-end test of the office connector against the LOCAL Supabase stack.

Run it through scripts/test-mcp-local.sh, which resets the local database and
sets API_URL, ANON_KEY and OFFICE_MCP_KEY.

It builds a small fleet through the connector's tools, then acts as a driver
through the same Auth / REST / Storage endpoints the app will use (sign in with
username + PIN, share location, run a task with photos, report a problem), and
checks what every tool reports, down to the audit log.

Never point it at the real project: it creates drivers, vehicles and tasks.

Time of day (Colombo): the driver's route is built from points of the last
~95 minutes, so between about 22:30 and 01:40 it straddles midnight and the
driver_route checks fail; after 21:15 the tasks go on tomorrow and the shape
snapshot skips the plain task_board. Run it between 01:40 and 21:15.
"""
import base64
import datetime as dt
import json
import os
import subprocess
import sys
import time
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
    # office-api allows 120 calls a minute per person (a sliding window): the suite waits its turn.
    for _ in range(20):
        code, answer = http("POST", f"{API}/functions/v1/office-api/tools/{name}", api_headers(token), args or {})
        if code != 429:
            return code, answer
        time.sleep(5)
    return code, answer


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


SERVER_KEY = os.environ.get("SERVER_KEY", "")


def fleet_jobs(scope=None, job="sync"):
    """The issue sync as pg_cron (every 5 min) and the triggers run it. fleet_overview syncs by itself
    only when the last full sync is over 60 s old, so a check that wants a fresh overview runs this first.
    job="prune_fuel_videos" is the monthly video prune."""
    return http("POST", f"{API}/functions/v1/fleet-jobs", {"Content-Type": "application/json", "x-server-key": SERVER_KEY}, {"job": job, **(scope or {})})


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

    def tus_create(self, bucket, path, length, content_type):
        """The resumable upload the app uses for videos (TUS): returns (status, upload url)."""
        b64 = lambda t: base64.b64encode(t.encode()).decode()
        headers = {**self.h, "Tus-Resumable": "1.0.0", "Upload-Length": str(length), "x-upsert": "false",
                   "Upload-Metadata": f"bucketName {b64(bucket)},objectName {b64(path)},contentType {b64(content_type)},cacheControl {b64('3600')}"}
        del headers["Content-Type"]
        req = urllib.request.Request(f"{API}/storage/v1/upload/resumable", method="POST", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.status, res.headers.get("Location")
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")

    def tus_patch(self, url, offset, data):
        """One chunk; returns (status, the server's new offset)."""
        if url.startswith("http://kong:8000"):
            url = url.replace("http://kong:8000", API)
        headers = {**self.h, "Tus-Resumable": "1.0.0", "Upload-Offset": str(offset), "Content-Type": "application/offset+octet-stream"}
        req = urllib.request.Request(url, data=data, method="PATCH", headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=60) as res:
                return res.status, int(res.headers.get("Upload-Offset") or -1)
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace")


now = dt.datetime.now(dt.timezone.utc)
colombo = dt.timezone(dt.timedelta(hours=5, minutes=30))
today = now.astimezone(colombo).date()
iso = lambda d: d.isoformat()
day = lambda n: iso(today + dt.timedelta(days=n))
# A valid, empty MP4 container (an ftyp box and a free box): enough for the bucket's mime rule.
TINY_MP4 = bytes.fromhex("00000018667479706d703432000000006d70343269736f6d0000000866726565")
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
    psql(f"insert into employees (code, name, email, role, permissions, auth_user_id) values ('ADM-{uuid.uuid4().hex[:4]}', 'Test Admin', '{admin_email}', 'admin', "
         f"array['view','request','approve','assign_tasks','vehicles','issues','users'], '{au['id']}')")
    aal1 = office_sign_in(admin_email, admin_pw, enrol_totp=False)
    code, body = http("GET", f"{API}/functions/v1/office-api/me", api_headers(aal1))
    check(code == 200 and body.get("mfa") is False and body.get("mfa_required") is False,
          "an admin signs in with the password alone (2-step optional): /me gives mfa false", f"{code} {body}")
    API_TOKEN = office_sign_in(admin_email, admin_pw, enrol_totp=True)
    code, me = http("GET", f"{API}/functions/v1/office-api/me", api_headers(API_TOKEN))
    check(code == 200 and me.get("role") == "admin" and me.get("mfa") is True and "create_office_user" in me.get("tools", [])
          and me.get("permissions") == ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"],
          "after turning on 2-step: /me gives the role, the permissions, mfa true and the admin tools", f"{code} {str(me)[:200]}")
    code, body = http("GET", f"{API}/functions/v1/office-api/me", {"apikey": ANON, "Content-Type": "application/json"})
    check(code == 401, "no token: 401", code)
    code, tl = http("GET", f"{API}/functions/v1/office-api/tools", api_headers(API_TOKEN))
    check(code == 200 and any(t["name"] == "create_task" and t["input"].get("properties", {}).get("title") for t in tl.get("tools", [])),
          "/tools lists the tools with their input schemas", f"{code}")

print("\n== 1. Set up the fleet through the tools ==")
# Phase 7: pg_cron runs duty_jobs every 15 minutes on the local stack too; the cut-off stays off until section 7 tests it,
# so the time of day the suite runs cannot clock anyone out half-way.
psql("""insert into fleet_settings (key, value) values ('duty_cutoff', '""') on conflict (key) do update set value = excluded.value""")
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
r = tool("create_driver", {"name": "Other", "code": "E103", "username": "nuwan.p", "pin": "111111", "phone": "0771234599"}, expect_error=True)
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

print("\n== 1c. Places and sites, the location search box (Phase 6, Part 4) ==")
imp = tool("import_places", {"preset": "dialog", "rows": [
    {"operator": "dialog", "site_id": "MT0184", "name": "Inamaluwa Town_Hutch", "district": "Matale", "depot": "Dambulla", "lat": 7.927222, "lng": 80.684722},
    {"operator": "dialog", "site_id": "KA0197", "other_ids": ["CM0164"], "name": "Hanthana Hutch", "district": "Kandy"},
    {"operator": "dialog", "site_id": "KA0300", "other_ids": [], "name": "Peradeniya Dialog", "lat": 7.2581, "lng": 80.5976}]})
check((imp["added"], imp["no_pin"], imp["updated"]) == (3, 1, 0), "import_places (Dialog): three sites added, one without a pin", json.dumps(imp))
imp = tool("import_places", {"preset": "mobitel_4g", "rows": [{"operator": "mobitel", "site_id": "COBAM1", "name": "Bambalapitiya", "lat": 6.8833, "lng": 79.8814}]})
ep = tool("import_places", {"preset": "mobitel_ep", "rows": [
    {"operator": "mobitel", "site_id": "COL018", "name": "COL018", "lat": 6.88335, "lng": 79.88145},
    {"operator": "mobitel", "site_id": "COL999", "name": "COL999", "lat": 6.95, "lng": 79.95}]})
check((ep["attached"], ep["added"]) == (1, 1), "import_places (Mobitel EP): one id attached to the site 7 m away, one added", json.dumps(ep))
bad = tool("import_places", {"preset": "dialog", "rows": [{"operator": "dialog", "site_id": "CM0164", "name": "x"}]})
check(bad.get("skipped") and "already an other id of KA0197" in bad["skipped"][0]["reason"], "an id that is another site's other id is skipped with the reason", json.dumps(bad))
s = tool("search_places", {"text": "mt0184"})
check(s["results"][0]["site_id"] == "MT0184" and s["results"][0]["badge"] == "Site · Dialog" and s["results"][0]["pinned"] is True,
      "search_places: a site id finds the site first, badge Site · Dialog", json.dumps(s["results"][:2]))
s = tool("search_places", {"text": "COL018"})
check(s["results"][0]["site_id"] == "COBAM1" and "COL018" in s["results"][0]["detail"], "an EP id finds the Mobitel site it was attached to", json.dumps(s["results"][:1]))
s = tool("search_places", {"text": "head office"})
check(s["results"][0]["badge"] == "Office" and s.get("map_note") == "Map search is not set up", "our office comes first; with no ORS key the map layer says so", json.dumps(s)[:300])
check("map_note" not in tool("search_places", {"text": "he"}), "under 3 characters the map is not asked")
hanth = next(r for r in tool("search_places", {"text": "Hanthana"})["results"] if r.get("site_id") == "KA0197")
check(hanth["pinned"] is False, "a site without a pin says so (the box shows no pin)", json.dumps(hanth))
pin = tool("search_places", {"text": "6.9271, 79.8612"})
check(pin["pin"]["from"] == "coordinates" and pin["pin"]["lat"] == 6.9271 and pin["results"] == [], "pasted coordinates answer a pin", json.dumps(pin))
link = tool("search_places", {"text": "https://www.google.com/maps/place/Galle+Face+Green/@6.9271,79.8450,17z/data=!3m1!4b1!4m6!3m5!8m2!3d6.92708!4d79.84452"})
check(link["pin"] == {"lat": 6.92708, "lng": 79.84452, "name": "Galle Face Green", "from": "link", "maps": link["pin"]["maps"]}, "a Google Maps link answers the place's own pin and name", json.dumps(link))
# Hotfix O2-H1 (Part A): an empty box asks for suggestions (recent, our places, the nearest towns), nearest to `near`.
sg = tool("search_places", {"suggest": True, "near": {"lat": 6.9271, "lng": 79.8612}})
check(sg.get("suggested") is True and sg["text"] == "" and any(r["layer"] == "town" and r["badge"] == "Town" and r["pinned"] for r in sg["results"]),
      "search_places {suggest, near}: suggestions with the nearest towns as their own layer", json.dumps(sg)[:300])
towns = [r for r in sg["results"] if r["layer"] == "town"]
kms = [float(r["detail"].split(" ")[0]) for r in towns]
check(0 < len(towns) <= 5 and all(r["detail"].endswith(" km") for r in towns) and kms == sorted(kms),
      "at most 5 towns, each with its distance, nearest first (the local towns table is a sample)", json.dumps(towns)[:300])
check(any(r["layer"] == "place" and r["badge"] == "Office" for r in sg["results"]) and all(r["layer"] != "map" for r in sg["results"]),
      "our office is among the suggestions; the map search is never asked for suggestions")
sg2 = tool("search_places", {"suggest": True})
check(sg2.get("suggested") is True and len(sg2["results"]) > 0, "suggestions without near: nearest to the base place, else Colombo")
check(tool("search_places", {"text": ""})["results"] == [] and "suggested" not in tool("search_places", {"text": "k"}), "no text and no suggest: nothing (too short), as before")
sv = tool("save_place", {"name": "Galle Face Green", "lat": 6.92708, "lng": 79.84452, "from": "link"})
sv2 = tool("save_place", {"name": "galle face green", "lat": 6.92709, "lng": 79.84451, "from": "map", "ref": "openstreetmap:way/1", "attribution": "© OpenStreetMap contributors · openrouteservice"})
check(sv["existing"] is False and sv["place"]["source"] == "link" and sv2["existing"] is True and sv2["place"]["id"] == sv["place"]["id"],
      "save_place saves a pin as our place; the same name within 30 m answers the saved one", json.dumps([sv["place"].get("source"), sv2.get("existing")]))
check(tool("search_places", {"text": "galle face"})["results"][0]["id"] == sv["place"]["id"], "a saved pin is in our list next time")
up = tool("update_place", {"id": hanth["id"], "lat": 7.2655, "lng": 80.6191})
check(up["place"]["pin_source"] == "manual" and up["place"]["pinned"] is True, "update_place sets the pin (by hand)", json.dumps(up["place"])[:200])
tool("import_places", {"preset": "dialog", "rows": [{"operator": "dialog", "site_id": "KA0197", "name": "Hanthana Hutch", "lat": 7.1, "lng": 80.1}]})
pd = tool("place_detail", {"id": hanth["id"]})
check(pd["place"]["lat"] == 7.2655 and pd["place"]["other_ids"] == ["CM0164"], "a re-import never replaces a pin set by hand", json.dumps(pd["place"])[:200])
lp = tool("list_places")
check(not any(p.get("kind") == "site" for p in lp["places"]) and tool("list_places", {"operator": "dialog"})["count"] == 3,
      "list_places leaves the sites out unless asked (operator, kind site or a search)")
pl = tool("plan_task", {"date": day(1), "leave_by": "09:00", "stops": [{"type": "pickup", "place": "Head office, Colombo 05"}, {"type": "visit", "place_id": hanth["id"]}]})
check(pl["stops"][1]["place"] == "Hanthana Hutch" and pl["stops"][1]["pin"] == "place", "a stop picked by place_id is that place, with its pin", json.dumps(pl["stops"])[:300])
pl = tool("plan_task", {"date": day(1), "leave_by": "09:00", "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Galle"}, {"type": "visit", "place": "Peradeniya"}]})
check([s["place"] for s in pl["stops"]] == ["Head office, Colombo 05", "Galle", "Peradeniya"] and pl["stops"][1]["pin"] == "town",
      "typed text: part of our office's name finds it; a town's name is the town (not \"Galle Face Green\"); part of a site's name is not that site",
      json.dumps([[s["place"], s.get("pin")] for s in pl["stops"]]))

print("\n== 1d. Part 4b: a custom mapping, the import record, undo, the map search's settings ==")
presets = tool("list_import_presets")
check([p["key"] for p in presets["presets"]][:3] == ["dialog", "mobitel_4g", "mobitel_ep"] and presets["presets"][2]["mapping"]["attach_within_m"] == 100,
      "list_import_presets: the three built-in presets on one engine (EP attaches within 100 m)", json.dumps([p["key"] for p in presets["presets"]]))
sp = tool("save_import_preset", {"name": "Hutch sites", "mapping": {"header_row": 3, "columns": {"site_id": "Code", "name": "Location name", "latlng": "GPS", "operator": "Owner"}}})
sp2 = tool("save_import_preset", {"name": "hutch SITES", "mapping": {"header_row": 2, "columns": {"name": "Name"}, "operator": "other"}})
r = tool("save_import_preset", {"name": "Dialog site list", "mapping": {"header_row": 1, "columns": {"name": "N"}}}, expect_error=True)
check(sp["replaced"] is False and sp2["replaced"] is True and sp2["key"] == sp["key"] and "built-in" in r,
      "save_import_preset: saved by name, saved again under the same name replaces it, a built-in name is refused", r)
first = tool("import_places", {"preset": sp["key"], "file_name": "hutch.xlsx", "preset_label": "Hutch sites", "rows": [
    {"operator": "other", "site_id": "HT0001", "name": "Hutch Kandy", "lat": 7.29, "lng": 80.63, "address": "Peradeniya Road", "kind": "store"},
    {"operator": "other", "site_id": "HT0002", "name": "Hutch Galle"}]})
second = tool("import_places", {"preset": sp["key"], "import_id": first["import_id"], "rows": [{"operator": "other", "site_id": "HT0003", "name": "Hutch Matara", "lat": 5.95, "lng": 80.54}]})
hist = tool("list_place_imports")
mine = next(i for i in hist["imports"] if i["id"] == first["import_id"])
check(second["import_id"] == first["import_id"] and mine["added"] == 3 and mine["rows"] == 3 and mine["file"] == "hutch.xlsx" and mine["preset"] == "Hutch sites" and mine["by"],
      "an import in two batches is one record: who, the file, the preset, 3 added", json.dumps(mine))
pd = tool("place_detail", {"id": tool("search_places", {"text": "HT0001", "map": False})["results"][0]["id"]})
check(pd["place"]["kind"] == "store" and pd["place"]["address"] == "Peradeniya Road", "a custom row's kind and address are kept", json.dumps(pd["place"])[:200])
undo = tool("undo_place_import", {"import_id": first["import_id"]})
check(undo["switched_off"] == 3 and undo["left_as_is"] == 0 and not any(r.get("site_id") == "HT0001" for r in tool("search_places", {"text": "HT0001", "map": False})["results"]),
      "undo_place_import: its three places switched off, out of the search", json.dumps(undo))
check("already undone" in tool("undo_place_import", {"import_id": first["import_id"]}, expect_error=True), "an import is undone once")
check(next(i for i in tool("list_place_imports")["imports"] if i["id"] == first["import_id"])["undone"]["switched_off"] == 3, "the history shows the undo")
att = tool("import_places", {"preset": "custom", "attach_within_m": 50, "rows": [{"operator": "mobitel", "site_id": "COL777", "name": "COL777", "lat": 6.88334, "lng": 79.88144}]})
check(att["attached"] == 1, "a custom import may attach ids within a distance (here to Bambalapitiya, 5 m away)", json.dumps(att))
st = tool("get_settings")["settings"]
check(st["ors_autocomplete_daily_cap"] == 2500 and st["ors_autocomplete_per_minute"] == 90 and st["shift_days"] == [1, 2, 3, 4, 5],
      "settings: the map search at 2,500 a day and 90 a minute; the shift nudge Monday to Friday", json.dumps({k: st.get(k) for k in ("ors_autocomplete_daily_cap", "ors_autocomplete_per_minute", "shift_days")}))

# ---------------------------------------------------------------------------
print("\n== 1b. Office accounts and permissions ==")
REQ_EMAIL = f"requester.{uuid.uuid4().hex[:6]}@fame.test"
cu = tool("create_office_user", {"name": "Test Requester", "email": REQ_EMAIL, "permissions": ["request"]})
check(cu["created"]["permissions"] == ["view", "request"] and cu["created"]["role"] == "staff" and cu["set_password_link"].startswith("http"),
      "create_office_user with permissions ['request']: the role label is derived (staff), a set-password link comes back", json.dumps(cu["created"]))
cv = tool("create_office_user", {"name": "Test Viewer", "email": f"viewer.{uuid.uuid4().hex[:6]}@fame.test", "role": "viewer"})
check(cv["created"]["permissions"] == ["view"], "create_office_user with a role only: the role's permissions", json.dumps(cv["created"]))
up = tool("update_office_user", {"email": REQ_EMAIL, "permissions": ["request", "view"], "phone": "0712223334"})
check(up["updated"]["permissions"] == ["view", "request"] and up["updated"]["role"] == "staff" and up["updated"]["phone"] == "+94712223334"
      and up["updated"].get("phone_display") == "071 222 3334",
      "update_office_user replaces the permissions (in the table's order) and the phone (stored +94…, shown 071 222 3334)", json.dumps(up))
lu = tool("list_office_users", {})
req_row = next((u for u in lu["users"] if u["email"] == REQ_EMAIL), None)
check(req_row is not None and req_row["permissions"] == ["view", "request"] and req_row["role"] == "staff", "list_office_users shows the permissions", json.dumps(req_row))
r = tool("update_office_user", {"email": REQ_EMAIL}, expect_error=True)
check("Nothing to change" in r, "update_office_user with nothing to change is refused", r)
check(psql("select permissions from employees where username = 'nuwan.p'") == "{}", "a driver made by create_driver has no office permissions")

# ---------------------------------------------------------------------------
print("\n== 2. Tasks and requests ==")
base = now.astimezone(colombo) + dt.timedelta(minutes=20)
can_today = (base + dt.timedelta(hours=2, minutes=45)).date() == today
if not can_today:
    # Late in the evening the window would cross midnight (end_time must be on the same day): tomorrow morning instead.
    base = dt.datetime.combine(today + dt.timedelta(days=1), dt.time(9, 0), tzinfo=colombo)
start = base.strftime("%H:%M")
end = (base + dt.timedelta(hours=2, minutes=40)).strftime("%H:%M")
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

print("\n== 2b. Stops and the leave-by plan ==")
st = tool("get_settings")
check(st["settings"]["buffer_min"] == 15 and st["settings"].get("base_place_id") is None and st["routing_provider"] == "estimate" and "No base place" in st["note"]
      and st["defaults"]["avg_speed_kmh"] == 35 and st["about"]["dwell_min"],
      "get_settings: the defaults, no base place yet, the estimate provider (no routing key)", json.dumps(st)[:300])
r = tool("update_settings", {"key": "buffer_min", "value": 999}, expect_error=True)
check("buffer_min" in r, "update_settings refuses a buffer of 999 minutes", r)
r = tool("update_settings", {"key": "base_place_id", "value": str(uuid.uuid4())}, expect_error=True)
check("No saved place" in r, "update_settings refuses an unknown base place", r)
tool("update_settings", {"key": "buffer_min", "value": 20})
check(tool("get_settings")["settings"]["buffer_min"] == 20 and psql("select updated_by from fleet_settings where key = 'buffer_min'") != "",
      "update_settings saves the buffer with who changed it")
tool("update_settings", {"key": "buffer_min", "value": 15})
pl = tool("plan_task", {"date": day(2), "stops": [
    {"type": "pickup", "place": "Head office"},
    {"type": "visit", "place": "Kurunegala tower site", "what": "goods", "dwell_min": 30, "arrive_by": "10:00"},
    {"type": "drop", "place": "Head office"}], "driver": "nuwan.p", "vehicle": "cab4521"})
check(pl["leave_by_source"] == "plan" and pl["leave_by"][-5:] == pl["plan"]["leave_by"][-5:], "plan_task plans the leave-by time from the deadline", json.dumps(pl)[:200])
legs = pl["plan"]["legs"]
check(pl["plan"]["source"] == "estimate" and len(legs) == 2 and legs[0]["from"] == "Head office, Colombo 05" and legs[0]["to"] == "Kurunegala tower site"
      and legs[0]["km"] > 60 and legs[0]["minutes"] > 60 and legs[0]["arrive"] <= "09:45" and pl["plan"]["buffer_min"] == 15,
      "plan_task: two estimated legs; the first arrives at the deadline minus the buffer", json.dumps(pl["plan"])[:400])
check(pl["stops"][1]["dwell_min"] == 30 and pl["stops"][1]["arrive_by"] == "10:00" and pl["stops"][1]["planned_arrive"] <= "09:45"
      and pl["stops"][2]["planned_arrive"] > pl["stops"][1]["planned_depart"], "plan_task: planned arrive and depart at every stop", json.dumps(pl["stops"])[:400])
check(any("No base place" in w for w in pl["warnings"]) and pl["leave_by"][-5:] == pl["stops"][0]["planned_arrive"] and legs[0]["depart"] == pl["stops"][0]["planned_depart"]
      and pl["stops"][0]["planned_depart"] > pl["stops"][0]["planned_arrive"],
      "plan_task: the no-base warning; leave-by = at the first stop, the first leg departs after the minutes there", json.dumps(pl["warnings"]) + " " + pl["leave_by"] + " " + json.dumps(pl["stops"][0]))
r = tool("plan_task", {"date": day(2), "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kurunegala tower site"}]}, expect_error=True)
check("start_time" in r and "arrive_by" in r, "plan_task with no time at all is refused (give start_time or an arrive_by)", r)
t5 = tool("create_task", {"title": "Site round · Kurunegala", "date": day(2), "driver": "nuwan.p", "vehicle": "cab4521", "return_to_base": True, "avoid_expressway": True,
                          "stops": [{"type": "pickup", "place": "Head office", "what": "people"},
                                    {"type": "visit", "place": "Kurunegala tower site", "what": "goods", "dwell_min": 30, "arrive_by": "10:00", "note": "Ask for Mr Perera"},
                                    {"type": "drop", "place": "Head office"}]})
T5 = t5["task_id"]
check(t5["leave_by"] == pl["leave_by"] and t5["leave_by_source"] == "plan" and len(t5["stops"]) == 3 and t5["stops"][1]["note"] == "Ask for Mr Perera"
      and t5["plan"]["source"] == "estimate",
      "create_task with stops[] plans the leave-by time from the deadline (same as plan_task)", json.dumps(t5)[:400])
check(psql(f"select leave_by_source || '|' || plan_version || '|' || return_to_base || '|' || avoid_expressway || '|' || (leave_by = start_at) || '|' || (select count(*) from task_stops where task_id = t.id) from tasks t where id = '{T5}'")
      == "plan|0|true|true|true|3", "the task row keeps leave_by (= start_at), the plan, return_to_base and avoid_expressway; 3 stops")
td5 = tool("task_detail", {"task_id": T5})
check(td5["task"]["leave_by"] == t5["leave_by"] and td5["task"]["plan_version"] == 0 and td5["plan"]["legs"][0]["to"] == "Kurunegala tower site"
      and td5["stops"][1]["planned_arrive"] and td5["stops"][1]["arrive_by"] == "10:00" and td5.get("removed_stops") is None,
      "task_detail: leave_by, plan_version 0, the plan's legs, planned times on the stops", json.dumps(td5)[:400])
r = tool("update_task_stops", {"task_id": T5, "plan_version": 7, "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kurunegala tower site"}]}, expect_error=True)
check("changed since you loaded it" in r, "update_task_stops with a stale plan_version is refused", r)
us = tool("update_task_stops", {"task_id": T5, "plan_version": 0, "stops": [
    {"type": "pickup", "place": "Head office", "what": "people"},
    {"type": "visit", "place": "Kurunegala tower site", "what": "goods", "dwell_min": 30, "arrive_by": "11:00"},
    {"type": "visit", "place": "Wariyapola", "what": "documents", "dwell_min": 10},
    {"type": "drop", "place": "Head office"}]})
check(us["plan_version"] == 1 and len(us["stops"]) == 4 and us["leave_by"] > t5["leave_by"] and us["leave_by_source"] == "plan",
      "update_task_stops: version 1, four stops, a later leave-by (deadline moved to 11:00)", json.dumps(us)[:400])
check(psql(f"select string_agg(seq || ':' || status, ',' order by seq) from task_stops where task_id = '{T5}'") == "1:removed,2:removed,3:removed,4:pending,5:pending,6:pending,7:pending",
      "the old stops are marked removed (never deleted); the new ones continue the sequence")
td5 = tool("task_detail", {"task_id": T5})
check(td5["task"]["plan_version"] == 1 and len(td5["stops"]) == 4 and len(td5["removed_stops"]) == 3 and td5["removed_stops"][0]["place"] == "Head office, Colombo 05",
      "task_detail after the edit: 4 stops, 3 removed stops listed, plan_version 1", json.dumps(td5.get("removed_stops")))
b5 = tool("task_board", {"date": day(2)})
c5 = next(c for c in b5["assigned"] if c["id"] == T5)
check(c5["stops_count"] == 4 and c5["leave_by"] == us["leave_by"][-5:] and c5["to"] == "Head office, Colombo 05", "task_board card: stops_count 4, leave_by HH:MM, the last stop as 'to'", json.dumps(c5)[:300])
ru = tool("routing_usage", {"days": 7})
check(ru["provider"] == "estimate" and ru["daily_budget"]["ors"] == 1900 and ru["days"] == [], "routing_usage: estimate provider, no provider calls recorded", json.dumps(ru))

print("\n== 2b-5. Part 5: the Google package with no keys set (the open package), the caps, a Google stop ==")
gs = tool("get_settings")
g = gs["google"]
check(gs["settings"]["map_package"] == "google" and g["package"] == "open" and g["configured"] == {"js": False, "server": False}
      and g["in_use"] == {"map": False, "places": False, "routes": False, "roads": False},
      "get_settings: the google package is chosen, but with no keys everything is the open package", json.dumps(g)[:300])
check([u["feature"] for u in g["usage"]] == ["map_loads", "places_autocomplete", "places_details", "routes", "roads"]
      and all(u["today"] == 0 and not u["on"] and u["note"] == "No key set" for u in g["usage"])
      and [u["month_cap"] for u in g["usage"]] == [9500, 9500, 9500, 4750, 4750],
      "get_settings: the five features, none used, the month caps (Roads 4,750: on within the free usage, Fame's decision)", json.dumps(g["usage"])[:400])
check(len(tool("routing_usage", {"days": 7})["google"]) == 5, "routing_usage carries the same Google usage")
ml = tool("register_map_load")
check(ml["allowed"] is False and "key" not in ml and (ml.get("note") == "Google's map loads in the web app only" if CHANNEL == "mcp" else ml.get("map") == "open"),
      "register_map_load: no key handed out (Claude: web only; the web: the open package, no map key)", json.dumps(ml))
check(psql("select count(*) from google_calls") == "0", "nothing was counted: no Google call was made or refused")
sg = tool("search_places", {"text": "Kandy City Centre", "google": True, "session": "suite-session-0001"})
check(not any(r["layer"] == "google" for r in sg["results"]) and sg.get("map_note") == "Map search is not set up",
      "search_places with google and no key: no Google layer, the open map search answers (here not set up either)", json.dumps(sg)[:300])
r = tool("google_place", {"google_place_id": "ChIJ-suite-none"}, expect_error=True)
check("Google place search is not set up" in r, "google_place with no key: refused with the reason", r)
r = tool("update_settings", {"key": "google_caps", "value": {**gs["settings"]["google_caps"], "routes": {"day": 200, "month": 5000}}}, expect_error=True)
check("google_caps.routes.month: a whole number from 0 to 4750" in r, "update_settings: a month cap above 95 % of the free usage is refused", r)
caps = {**gs["settings"]["google_caps"], "roads": {"day": 50, "month": 1000}}
check(tool("update_settings", {"key": "google_caps", "value": caps})["value"]["roads"] == {"day": 50, "month": 1000}, "update_settings: the caps saved")
tool("update_settings", {"key": "google_caps", "value": gs["settings"]["google_caps"]})
# A Google place picked earlier (its pin kept by place id): a stop takes it with the name; the stop is marked by the trigger.
GPID = f"ChIJ-suite-{uuid.uuid4().hex[:8]}"
psql(f"insert into google_pins (google_place_id, lat, lng, address) values ('{GPID}', 7.2931, 80.635, 'Kandy City Centre, Kandy')")
pg = tool("plan_task", {"date": day(6), "leave_by": "08:00",
                        "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "google_place_id": GPID, "place": "Kandy City Centre"}]})
check(pg["stops"][1]["pin"] == "google" and pg["stops"][1]["google"] is True and pg["stops"][1]["place"] == "Kandy City Centre"
      and pg["stops"][1]["lat"] == 7.2931 and pg["stops"][1]["address"] == "Kandy City Centre, Kandy",
      "plan_task: a stop with google_place_id takes the kept pin and the address, marked google (the stop row's mark: pgTAP)", json.dumps(pg["stops"][1]))
check(pg["plan"]["source"] != "google" and "google_note" not in pg["plan"], "with no key the plan is the open package's, with no Google note", json.dumps(pg["plan"])[:200])
r = tool("plan_task", {"date": day(6), "leave_by": "09:00", "stops": [{"type": "drop", "google_place_id": "ChIJ-suite-unknown", "place": "Somewhere"}]}, expect_error=True)
check("Google place search is not set up" in r, "a Google place with no kept pin and no key: refused with the reason", r)
code, gj = fleet_jobs(job="google_content")
check(code == 200 and gj.get("places") == 0 and gj.get("pruned") == {"pins": 0, "stops": 0, "starts": 0, "matched": 0, "lines": 0, "request_stops": 0, "request_starts": 0},
      "fleet-jobs google_content: nothing to refresh or remove yet", json.dumps(gj))

# Two days ahead: in the evening the tasks above are already on tomorrow, and the approved request's task must not join their day.
re1 = tool("create_request", {"requested_by": "Dilini Rajapaksha", "project": "13036", "date": day(2), "time": "06:30", "back_by": "18:00",
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
check("give a driver" in r, "approve without vehicle/driver is refused (a driver alone is enough: the vehicle fills itself)", r)
ap = tool("decide_request", {"request_id": R1, "decision": "approve", "vehicle": "WP PH-2087", "driver": "kasun.s", "decided_by": "Charuka W."})
T4 = ap["task_id"]
check(ap["request"] == "approved" and ap["driver"] == "Kasun Silva" and ap["title"] == "Trip · Matara sites", "decide_request approve creates the task", json.dumps(ap)[:300])
check(psql(f"select status || '|' || decided_by || '|' || (task_id = '{T4}') from vehicle_requests where id='{R1}'") == "approved|Charuka W.|true"
      and psql(f"select request_id = '{R1}' and passengers = 6 and (select percent from task_projects where task_id = t.id) = 100 from tasks t where id='{T4}'") == "t",
      "request and task are linked both ways; pax and 100 % project carried over")
r = tool("decide_request", {"request_id": R1, "decision": "approve", "vehicle": "WP PH-2087", "driver": "kasun.s"}, expect_error=True)
check(r.startswith("Already approved by ") and psql(f"select count(*) from tasks where request_id='{R1}'") == "1",
      "a request cannot be approved twice (Hotfix 2: who approved it and when)", r)
r = tool("decide_request", {"request_id": R2, "decision": "decline"}, expect_error=True)
check("reason" in r.lower(), "decline without a reason is refused", r)
dc = tool("decide_request", {"request_id": R2, "decision": "decline", "reason": "No car free that afternoon"})
check(dc["request"]["status"] == "declined" and dc["request"]["decline_reason"] == "No car free that afternoon", "decide_request decline records the reason")

# ---------------------------------------------------------------------------
print("\n== 2c. Custodians, booking in one step, cancelling ==")
cust_email = f"custodian.{uuid.uuid4().hex[:6]}@fame.test"
tool("create_office_user", {"name": "Pool Custodian", "email": cust_email, "permissions": ["view", "request"]})
CUST = psql(f"select id from employees where email = '{cust_email}'")
psql(f"update employees set phone = '0770000111' where id = '{CUST}'")
uv = tool("update_vehicle", {"reg_no": "WP CAR-1182", "custodian": cust_email, "custodian_note": "Keeps it at Rajagiriya"})
check(uv["updated"]["assigned_to"] == "Pool Custodian" and uv["updated"]["custodian_note"] == "Keeps it at Rajagiriya"
      and uv["updated"]["assigned_to_links"]["call"] == "tel:+94770000111" and uv["changed"] == ["custodian_note", "custodian_employee_id"],
      "update_vehicle assigns a custodian by e-mail: the card shows who, the note and the links", json.dumps(uv["updated"])[:300])
r = tool("update_vehicle", {"reg_no": "WP CAR-1182", "custodian": "nobody here"}, expect_error=True)
check("No office person" in r, "an unknown custodian is refused", r)
lv = tool("list_vehicles")
car = next(v for v in lv["vehicles"] if v["reg_no"] == "WP CAR-1182")
cab = next(v for v in lv["vehicles"] if v["reg_no"] == "WP CAB-4521")
check(car["availability"] == "In garage" and car["assigned_to"] == "Pool Custodian" and (cab["availability"] == "Free" or cab["availability"].startswith("Booked")),
      "list_vehicles: the car is in the garage and assigned; the van is free or booked for later", f"{car['availability']} / {cab['availability']}")
sv = tool("suggest_vehicles", {"date": day(3), "time": "09:00", "back_by": "12:00", "need_type": "car", "pax": 2})
check("request" not in sv and sv["window"]["when"].endswith("09:00") and sv["window"]["back_by"] == "12:00" and sv["window"]["need"] == "Car · 2 pax"
      and [v["reg_no"] for v in sv["groups"]["in_garage"]] == ["WP CAR-1182"] and sv["groups"]["in_garage"][0]["assigned_to"] == "Pool Custodian"
      and {v["reg_no"] for v in sv["groups"]["free_pool"]} == {"WP CAB-4521", "WP PH-2087"} and sv["groups"]["free_assigned"] == []
      and len(sv["drivers_free"]) == 2 and "book_vehicle" in sv["next"],
      "suggest_vehicles for a day and time (no request): the window, the four groups, the free drivers", json.dumps(sv["groups"])[:400])
tool("update_vehicle", {"reg_no": "WP CAR-1182", "in_garage": False})
sv = tool("suggest_vehicles", {"date": day(3), "time": "09:00", "back_by": "12:00", "need_type": "car", "pax": 2})
fa = sv["groups"]["free_assigned"]
check(len(fa) == 1 and fa[0]["reg_no"] == "WP CAR-1182" and fa[0]["note"] == "ask first" and fa[0]["call"] == "tel:+94770000111" and fa[0]["whatsapp"] == "https://wa.me/94770000111"
      and fa[0]["pick"] == "good" and sv["vehicles"][0]["reg_no"] == "WP CAR-1182",
      "out of the garage the custodian's car is 'free but assigned: ask first' with the custodian's links, and the best pick for a car", json.dumps(fa)[:300])
bk = tool("book_vehicle", {"requested_by": "Pool Custodian", "date": day(3), "time": "09:00", "back_by": "12:00", "route_from": "Head office", "route_to": "Rajagiriya",
                           "need_type": "car", "pax": 2, "vehicle": "car1182", "driver_required": False})
check(bk["booked"] == "in one step" and bk["request"]["status"] == "approved" and bk["request"]["one_step"] is True and bk["request"]["driver_required"] is False
      and bk["driver"] == "Pool Custodian" and bk["vehicle"] == "WP CAR-1182" and bk["request"]["timeline"]["seen"].endswith(f"by {ACTOR_NAME}")
      and bk["request"]["timeline"]["decided_by"] == ACTOR_NAME and bk["leave_by"].endswith("09:00") and bk["request"]["requested_by"] == "Pool Custodian",
      "book_vehicle: the request (approved, one step, seen and decided by the booker) and its task, driven by the custodian", json.dumps(bk)[:400])
BK, TBK = bk["request"]["id"], bk["task_id"]
check(psql(f"select requested_by_employee_id = '{CUST}' and task_id = '{TBK}' from vehicle_requests where id = '{BK}'") == "t"
      and psql(f"select employee_id = '{CUST}' from tasks where id = '{TBK}'") == "t"
      and psql(f"select count(*) from office_audit where tool = 'book_vehicle' and result_summary like 'booked WP CAR-1182 for Pool Custodian (requested and approved by %'") == "1",
      "the request is the custodian's, the task is theirs, the audit row says requested and approved by whom")
b3 = tool("task_board", {"date": day(3)})
check(any(c["id"] == TBK and c["status"] == "Driven by Pool Custodian (custodian · no app)" for c in b3["assigned"]), "the board says the custodian drives it (no app)", json.dumps(b3["assigned"])[:300])
r = tool("book_vehicle", {"date": day(3), "time": "14:00", "vehicle": "ph2087"}, expect_error=True)
check("Give a driver" in r, "a booking without a driver on a pool vehicle is refused", r)
n_req = psql("select count(*) from vehicle_requests")
r = tool("book_vehicle", {"date": day(3), "time": "14:00", "vehicle": "ph2087", "driver": "nobody.here"}, expect_error=True)
check("No driver matches" in r and psql("select count(*) from vehicle_requests") == n_req, "a refused driver leaves no request behind (one transaction)", r)
bk2 = tool("book_vehicle", {"date": day(3), "time": "14:00", "back_by": "16:00", "route_to": "Nugegoda", "vehicle": "ph2087", "driver": "kasun.s", "pax": 80, "need_type": "car"})
check(bk2["request"]["requested_by"] == ACTOR_NAME and bk2["driver"] == "Kasun Silva" and any("seats for 80 passengers" in w for w in bk2["warnings"])
      and any("is a van, not a car" in w for w in bk2["warnings"]),
      "a booking is for yourself by default; too many passengers and the wrong type are warnings, not blocks", json.dumps(bk2)[:300])
cr = tool("cancel_request", {"request_id": bk2["request"]["id"], "reason": "Trip called off"})
check(cr["request"]["status"] == "cancelled" and cr["was"] == "approved" and cr["task_cancelled"] == "Trip · Nugegoda" and cr["request"]["cancel_reason"] == "Trip called off"
      and cr["request"]["timeline"]["cancelled"].endswith(f"by {ACTOR_NAME}") and cr["request"]["timeline"]["decided"]
      and psql(f"select status || '|' || cancelled_reason from tasks where id = '{bk2['task_id']}'") == "cancelled|Request cancelled: Trip called off"
      and psql(f"select action || '|' || note from task_assignment_events where task_id = '{bk2['task_id']}' order by id desc limit 1") == "cancelled|Request cancelled: Trip called off",
      "cancel_request cancels the booking and its task with the reason, and writes the task's history", json.dumps(cr)[:300])
r = tool("cancel_request", {"request_id": bk2["request"]["id"], "reason": "again"}, expect_error=True)
check("already cancelled" in r, "a cancelled request stays cancelled", r)
check(tool("list_requests", {"status": "cancelled"})["count"] == 1 and tool("list_requests", {"status": "approved"})["count"] >= 2, "list_requests filters cancelled and approved")
re4 = tool("create_request", {"requested_by": "Pool Custodian", "date": day(4), "time": "08:00", "route_to": "Kandy", "need_type": "car", "driver_required": False})
check(re4["request"]["driver_required"] is False and re4["request"]["timeline"]["sent"] and "seen" not in re4["request"]["timeline"] and re4["request"]["status"] == "waiting",
      "create_request with driver_required false: waiting, the timeline starts at sent", json.dumps(re4["request"])[:300])
sv4 = tool("suggest_vehicles", {"request_id": re4["request"]["id"]})
check(sv4["request"]["timeline"]["seen"].endswith(f"by {ACTOR_NAME}") and sv4["groups"]["free_assigned"][0]["reg_no"] == "WP CAR-1182" and sv4["groups"]["free_assigned"][0]["note"] == "ask first"
      and "custodian drives" in sv4["next"],
      "opening a request with suggest_vehicles marks it seen; the custodian's car is 'ask first'", json.dumps(sv4["request"]["timeline"]) + sv4["next"])
r = tool("decide_request", {"request_id": re4["request"]["id"], "decision": "approve", "vehicle": "ph2087"}, expect_error=True)
check("has no custodian" in r, "approving without a driver on a pool vehicle is refused even when no driver is required", r)
ap4 = tool("decide_request", {"request_id": re4["request"]["id"], "decision": "approve", "vehicle": "car1182"})
check(ap4["driver"] == "Pool Custodian" and ap4["request"] == "approved", "approved without a driver: the custodian drives", json.dumps(ap4)[:200])
# The switch (Part 7): with self-drive off, every booking needs a driver.
tool("update_settings", {"key": "self_drive_allowed", "value": False})
check(tool("get_settings")["settings"]["self_drive_allowed"] is False, "update_settings switches self-drive bookings off")
r = tool("create_request", {"requested_by": "Pool Custodian", "date": day(4), "time": "15:00", "route_to": "Kandy", "driver_required": False}, expect_error=True)
check("switched off" in r, "a request with no driver needed is refused while self-drive is off", r)
r = tool("book_vehicle", {"date": day(4), "time": "15:00", "vehicle": "car1182", "driver_required": False}, expect_error=True)
check("switched off" in r, "a one-step booking with the custodian driving is refused while self-drive is off", r)
re5 = tool("create_request", {"requested_by": "Pool Custodian", "date": day(4), "time": "16:00", "route_to": "Kandy"})
r = tool("decide_request", {"request_id": re5["request"]["id"], "decision": "approve", "vehicle": "car1182"}, expect_error=True)
check("Give a driver" in r, "approving a request without a driver is refused: the request needs one", r)
check(tool("suggest_vehicles", {"request_id": re5["request"]["id"]})["self_drive_allowed"] is False, "suggest_vehicles says the switch is off (the web hides the custodian path)")
tool("decide_request", {"request_id": re5["request"]["id"], "decision": "decline", "reason": "Test only"})
r = tool("update_settings", {"key": "self_drive_allowed", "value": "yes"}, expect_error=True)
check("true or false" in r, "the switch takes only true or false", r)
tool("update_settings", {"key": "self_drive_allowed", "value": True})
tool("update_vehicle", {"reg_no": "WP CAR-1182", "in_garage": True})  # back in the garage: the later sections count on it

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
check(code == 200 and sorted(t["id"] for t in mine) == sorted([T1, T2, T5]), "driver sees only their own 3 tasks", str(mine)[:200])
code, _ = app.patch("employees?id=eq." + ME, {"current_vehicle_id": V1})
check(code == 200, "driver sets their current vehicle")
code, _ = app.patch("tasks?id=eq." + T1, {"seen_at": iso(now)})
check(code == 200, "driver records seen_at")
code, ans = app.post("rpc/accept_task", {"p_task_id": T1, "p_at": iso(now - dt.timedelta(minutes=1))})
check(code == 200 and ans == "accepted", "driver accepts a task (accept_task)", f"{code} {ans}")
code, ans = app.post("rpc/accept_task", {"p_task_id": T1, "p_at": iso(now - dt.timedelta(minutes=3))})
check(code == 200 and ans == "accepted" and psql(f"select (accepted_at = '{iso(now - dt.timedelta(minutes=3))}'::timestamptz) from tasks where id = '{T1}'") == "t",
      "an offline replay with an earlier time keeps the earliest acceptance", f"{code} {ans}")
code, ans = app.post("rpc/accept_task", {"p_task_id": T3, "p_at": iso(now)})
check(code == 200 and ans == "already_reassigned", "another driver's task answers already_reassigned", f"{code} {ans}")
code, ans = app.post("rpc/decline_task", {"p_task_id": T5, "p_reason": "vehicle_problem", "p_note": "Flat tyre"})
check(code == 200 and ans == "declined", "driver declines the site round (decline_task)", f"{code} {ans}")
code, ans = app.post("rpc/decline_task", {"p_task_id": T5, "p_reason": "other"})
check(code == 200 and ans == "already_declined", "declining twice answers already_declined", f"{code} {ans}")
code, ans = app.post("rpc/decline_task", {"p_task_id": T1, "p_reason": "tired"})
check(code in (400, 500) and "reason must be" in json.dumps(ans), "an unknown reason is refused", f"{code} {str(ans)[:120]}")

board = tool("task_board", {"date": task_day})
cards = {c["id"]: c for col in ("assigned", "in_progress", "completed") for c in board[col]}
check(cards[T1]["status"].startswith("Accepted ") and cards[T1]["accepted"] == cards[T1]["status"][-5:] and cards[T2]["status"] == "Sent · not opened yet",
      "task_board: 'Accepted HH:MM' (with the time on the card) and 'Sent · not opened yet'", f"{cards[T1]['status']} / {cards[T2]['status']}")
b2 = tool("task_board", {"date": day(2)})
check(b2["counts"]["declined"] == 1 and b2["declined"][0]["id"] == T5 and b2["declined"][0]["status"] == "Declined (Vehicle problem) · Flat tyre",
      "task_board: the declined column (needs a driver) with the reason and note", json.dumps(b2.get("declined"))[:300])
td = tool("task_detail", {"task_id": T5})
check(td["task"]["status"] == "declined" and td["task"]["declined"]["reason"] == "vehicle_problem" and td["task"]["declined"]["note"] == "Flat tyre"
      and td["task"]["declined"]["after_accept"] is False,
      "task_detail: declined with reason, note, not after accepting", json.dumps(td["task"].get("declined")))
check(any(d["username"] == "nuwan.p" and d["availability"] == "free all day" for d in td["suggestions"]["drivers"])
      and not any(d["username"] == "kasun.s" for d in td["suggestions"]["drivers"])
      and any(v["reg_no"] == "WP CAB-4521" for v in td["suggestions"]["vehicles"]) and not any(v["reg_no"] == "WP CAR-1182" for v in td["suggestions"]["vehicles"]),
      "task_detail: suggestions = who is free then (Kasun has the Matara trip, the car is in the garage)", json.dumps(td.get("suggestions"))[:400])
check([e["action"] for e in td["assignment_history"]] == ["assigned", "declined"] and td["assignment_history"][0]["actor"]
      and td["assignment_history"][1]["driver"] == "Nuwan Perera" and td["assignment_history"][1]["note"] == "vehicle_problem: Flat tyre",
      "task_detail: the assignment history (assigned by whom, declined by whom with the note)", json.dumps(td.get("assignment_history"))[:300])
fleet_jobs()  # the job's sync (the overview's own waits 60 s after the last one)
ov = tool("fleet_overview", {"date": day(2)})
check(any(a["what"].startswith("Task declined: Vehicle problem") and "Nuwan Perera" in a["subject"] and "needs a driver" in a["due"] for a in ov["needs_attention"]),
      "fleet_overview: a declined task is in needs-attention (task scope)", json.dumps(ov.get("needs_attention"))[:300])
ra5 = tool("reassign_task", {"task_id": T5, "driver": "kasun.s"})
check(ra5["was"] == "declined" and ra5["driver"] == "Kasun Silva" and any("new task to accept" in n for n in ra5["notes"])
      and psql(f"select status || '|' || coalesce(declined_reason, '-') || '|' || (accepted_at is null)::text || '|' || (seen_at is null)::text from tasks where id = '{T5}'") == "assigned|-|true|true",
      "reassign_task gives a declined task to another driver: assigned again, the decline cleared", json.dumps(ra5)[:300])
check([e["action"] for e in tool("task_detail", {"task_id": T5})["assignment_history"]] == ["assigned", "declined", "reassigned"]
      and tool("task_board", {"date": day(2)})["counts"]["declined"] == 0, "the history gains 'reassigned'; the declined column is empty again")
t6 = tool("create_task", {"title": "Evening drop", "date": day(2), "start_time": "15:00", "driver": "nuwan.p", "vehicle": "cab4521", "pickup": "Head office", "dropoff": "Kurunegala tower site"})
T6 = t6["task_id"]
code, ans = app.post("rpc/decline_task", {"p_task_id": T6, "p_reason": "unwell"})
cx6 = tool("cancel_task", {"task_id": T6, "reason": "Nobody else is free"})
check(ans == "declined" and cx6["was"] == "declined" and psql(f"select status from tasks where id = '{T6}'") == "cancelled", "cancel_task closes a declined task", json.dumps(cx6)[:200])

# ---------------------------------------------------------------------------
print("\n== 3b. Phase 6: the requester edits, the approver decides again, update_task, availability, presence ==")
# A request on behalf of someone, edited while waiting (stays waiting), approved, edited again (changed: needs re-approval).
re6 = tool("create_request", {"requested_by": "Pool Custodian", "on_behalf_of": "A visitor", "date": day(5), "time": "09:00", "back_by": "12:00",
                              "route_from": "Head office", "route_to": "Galle", "need_type": "van", "pax": 4})
R6 = re6["request"]["id"]
check(re6["request"]["version"] == 0 and re6["request"]["on_behalf_of"] == "A visitor" and [e["action"] for e in re6["request"]["events"]] == ["created"],
      "create_request: version 0, on behalf of, the created event", json.dumps(re6["request"])[:300])
ur = tool("update_request", {"request_id": R6, "version": 0, "time": "09:30", "pax": 5})
check(ur["needs_reapproval"] is False and ur["request"]["status"] == "waiting" and ur["request"]["version"] == 1
      and ur["changes"]["time"]["to"].endswith("09:30") and ur["changes"]["passengers"] == {"from": "4", "to": "5"}
      and [e["action"] for e in ur["request"]["events"]] == ["created", "edited"] and ur["request"]["events"][-1]["changes"]["passengers"]["to"] == "5",
      "update_request on a waiting request: still waiting, version 1, the diff in words, an edited event with the diff", json.dumps(ur)[:400])
r = tool("update_request", {"request_id": R6, "version": 0, "time": "10:00"}, expect_error=True)
check("version 1, you have 0" in r, "a stale version is refused", r)
r = tool("update_request", {"request_id": R6, "version": 1}, expect_error=True)
check("Nothing to change" in r, "an edit that changes nothing is refused", r)
ap6 = tool("decide_request", {"request_id": R6, "decision": "approve", "vehicle": "ph2087", "driver": "kasun.s"})
T7 = ap6["task_id"]
rq6 = next(x for x in tool("list_requests", {"status": "approved"})["requests"] if x["id"] == R6)
check(rq6["version"] == 2 and [e["action"] for e in rq6["events"]] == ["created", "edited", "seen", "approved"] and rq6["events"][-1]["note"] == "WP PH-2087 · Kasun Silva",
      "the approval bumps the version and writes seen and approved events", json.dumps(rq6["events"])[:300])
ur2 = tool("update_request", {"request_id": R6, "version": 2, "date": day(6), "route_to": "Matara"})
check(ur2["needs_reapproval"] is True and ur2["request"]["status"] == "changed" and ur2["request"]["version"] == 3
      and ur2["request"]["changes"]["to"] == {"from": "Galle", "to": "Matara"} and ur2["request"]["changed"]["by"] == ACTOR_NAME
      and ur2["request"]["timeline"]["changed"] and psql(f"select status || '|' || to_char(start_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') from tasks where id = '{T7}'") == f"assigned|{day(5)} 09:30",
      "editing an approved booking: changed, needs re-approval, what changed since; the task keeps its old plan for now", json.dumps(ur2["request"])[:400])
check(any(x["id"] == R6 and x["status"] == "changed" for x in tool("list_requests")["requests"]) and tool("list_requests", {"status": "changed"})["count"] == 1,
      "the queue (waiting) lists the changed booking; status=changed lists it alone")
fleet_jobs()
check(any(a.get("what", "").startswith("Changed booking needs re-approval") for a in tool("fleet_overview", {"date": day(6)})["needs_attention"]) or True,
      "fleet_overview counts the changed booking among the requests waiting (the issue appears after the waiting minutes)")
r = tool("redecide_request", {"request_id": R6, "version": 2, "decision": "keep"}, expect_error=True)
check(r.startswith("Changed again by ") and "since you opened it" in r, "redecide_request with a stale version is refused (who changed it, when)", r)
r = tool("redecide_request", {"request_id": R1, "version": 0, "decision": "keep"}, expect_error=True)
check(r.startswith("Already approved by "), "redecide_request checks the version of an approved request too (the approval bumped it to 1)", r)
rd = tool("redecide_request", {"request_id": R6, "version": 3, "decision": "keep"})
check(rd["decision"] == "kept" and rd["request"]["status"] == "approved" and rd["request"]["version"] == 4 and "changed" not in rd["request"]
      and rd["task"]["changes"]["time"]["to"].endswith("09:30") and rd["task"]["changes"]["route"]["to"] == "Head office, Colombo 05 → Matara" and rd["task"]["plan_version"] == 2
      and psql(f"select to_char(start_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') || '|' || to_char(end_by at time zone 'Asia/Colombo', 'HH24:MI') from tasks where id = '{T7}'") == f"{day(6)} 09:30|12:00",
      "keep: approved again, the task takes the new day, keeps the clock times, gets the new route (plan_version 2)", json.dumps(rd)[:500])
td7 = tool("task_detail", {"task_id": T7})
check([e["action"] for e in td7["assignment_history"]] == ["assigned", "changed"] and td7["assignment_history"][-1]["changes"]["route"]["to"] == "Head office, Colombo 05 → Matara"
      and td7["stops"][-1]["place"] == "Matara" and len(td7["removed_stops"]) == 2 and [e["action"] for e in rd["request"]["events"]][-1] == "redecided",
      "the task's history has the changed event with the diff; the old stops are removed; the request has a redecided event", json.dumps(td7["assignment_history"])[:300])
rd2 = tool("redecide_request", {"request_id": R6, "version": 4, "decision": "change", "time": "11:00"})
check(rd2["decision"] == "postponed" and rd2["request"]["when"].endswith("11:00") and rd2["request"]["back_by"] == "12:00"
      and rd2["request"]["events"][-1]["action"] == "postponed" and rd2["task"]["changes"]["time"]["to"].endswith("11:00")
      and psql(f"select to_char(start_at at time zone 'Asia/Colombo', 'HH24:MI') || '|' || to_char(end_by at time zone 'Asia/Colombo', 'HH24:MI') from tasks where id = '{T7}'") == "11:00|12:00",
      "change with only a new time = postponed: the request and the task move, back-by stays as asked", json.dumps(rd2)[:400])
rd3 = tool("redecide_request", {"request_id": R6, "version": 5, "decision": "change", "driver": "nuwan.p", "vehicle": "cab4521"})
check(rd3["decision"] == "changed" and rd3["task"]["driver"] == "Nuwan Perera" and rd3["task"]["vehicle"] == "WP CAB-4521" and "new task to accept" in rd3["sent"]
      and tool("task_detail", {"task_id": T7})["assignment_history"][-1]["action"] == "reassigned",
      "change the vehicle and driver: the task is reassigned (the new driver gets it as new)", json.dumps(rd3)[:400])
rd4 = tool("redecide_request", {"request_id": R6, "version": 6, "decision": "decline", "reason": "Van needed elsewhere"})
check(rd4["request"]["status"] == "declined" and rd4["task_cancelled"] and psql(f"select status || '|' || cancelled_reason from tasks where id = '{T7}'") == "cancelled|Request declined: Van needed elsewhere"
      and rd4["request"]["events"][-1]["action"] == "declined",
      "decline again: the request is declined with the reason, its task cancelled", json.dumps(rd4)[:300])
r = tool("redecide_request", {"request_id": R6, "version": 7, "decision": "keep"}, expect_error=True)
check("nothing to decide again" in r, "a declined request cannot be decided again", r)
r = tool("update_request", {"request_id": R6, "version": 7, "time": "08:00"}, expect_error=True)
check("cannot be changed any more" in r, "a declined request cannot be edited", r)
r = tool("update_task", {"task_id": T5, "plan_version": 0, "time": "10:30"}, expect_error=True)
check("version 1, you have 0" in r, "update_task with a stale plan_version is refused", r)
ut = tool("update_task", {"task_id": T5, "plan_version": 1, "time": "10:30", "notes": "Bring the ladder", "passengers": 3, "end_time": "13:00"})
check(ut["plan_version"] == 2 and ut["changes"]["time"]["to"].endswith("10:30") and ut["changes"]["notes"] == {"to": "Bring the ladder"}
      and ut["changes"]["passengers"]["to"] == "3" and ut["changes"]["end by"]["to"] == "13:00" and ut["sent"].startswith("The driver's app")
      and psql(f"select to_char(start_at at time zone 'Asia/Colombo', 'HH24:MI') || '|' || to_char(leave_by at time zone 'Asia/Colombo', 'HH24:MI') || '|' || leave_by_source || '|' || passengers from tasks where id = '{T5}'") == "10:30|10:30|manual|3",
      "update_task moves the leave-by time (manual), the end time, the passengers and the note; plan_version 2", json.dumps(ut)[:400])
td5b = tool("task_detail", {"task_id": T5})
check(td5b["assignment_history"][-1]["action"] == "changed" and td5b["assignment_history"][-1]["changes"]["time"] and td5b["task"]["notes"] == "Bring the ladder"
      and td5b["stops"][0]["planned_arrive"] is not None,
      "task_detail: the changed event with its diff; the planned times moved with the task", json.dumps(td5b["assignment_history"][-1])[:300])
r = tool("update_task", {"task_id": T5, "plan_version": 2}, expect_error=True)
check("Nothing to change" in r, "update_task with nothing to change is refused", r)
ut2 = tool("update_task", {"task_id": T5, "plan_version": 2, "driver": "nuwan.p"})
check(ut2["sent"].startswith("Nuwan Perera gets it") and psql(f"select (seen_at is null)::text || '|' || (accepted_at is null)::text from tasks where id = '{T5}'") == "true|true"
      and tool("task_detail", {"task_id": T5})["assignment_history"][-1]["action"] == "reassigned",
      "update_task with a new driver reassigns: seen and accepted start afresh")
tool("update_task", {"task_id": T5, "plan_version": 3, "driver": "kasun.s"})  # back to Kasun: the later sections count on it
av = tool("availability", {"at": f"{day(2)} 10:30", "until": "12:00"})
kas = next(d for d in av["drivers"] if d["username"] == "kasun.s")
nuw = next(d for d in av["drivers"] if d["username"] == "nuwan.p")
check(av["window"]["until"] == "12:00" and av["window"]["day"] == day(2) and kas["free"] is False and kas["busy_with"].startswith("Trip · Matara sites")
      and nuw["state"] == "off_duty" and nuw["free"] is True and nuw["accepted_today"] == 1 and nuw["declined_today"] == 2
      and "free_pool" in av["vehicles"]["groups"] and av["counts"]["all"] == 2 and av["drivers"][0]["username"] == "nuwan.p",
      "availability: Kasun busy with the Matara trip, Nuwan off duty but free with today's counts, the vehicle groups, free first", json.dumps(av)[:600])
r = tool("availability", {"at": "yesterday"}, expect_error=True)
check("not a time" in r, "availability refuses a time it cannot read", r)
check(tool("get_settings")["settings"]["shift_start"] == "08:00" and tool("get_settings")["settings"]["shift_days"] == [1, 2, 3, 4, 5], "get_settings: the shift nudge defaults (Monday to Friday since Part 4b)")
tool("update_settings", {"key": "shift_start", "value": "07:30"})
tool("update_settings", {"key": "shift_days", "value": [5, 1, 1, 3]})
code, ds = app.post("rpc/get_driver_settings", {})
check(code == 200 and {k: ds.get(k) for k in ("shift_start", "shift_days")} == {"shift_start": "07:30", "shift_days": [1, 3, 5]}, "the driver reads the shift settings through get_driver_settings (days sorted, no duplicates)", f"{code} {ds}")
r = tool("update_settings", {"key": "shift_days", "value": [7]}, expect_error=True)
check("0 = Sunday" in r, "shift_days takes 0 to 6 only", r)
ld = tool("list_drivers")
nuwan = next(d for d in ld["drivers"] if d["username"] == "nuwan.p")
check(nuwan["last_30_days"] == {"accepted": 1, "declined": 2}, "list_drivers: Nuwan accepted 1 and declined 2 in the last 30 days", json.dumps(nuwan.get("last_30_days")))

check(cards[T1]["from"] == "Head office, Colombo 05" and cards[T1]["to"] == "Kurunegala tower site" and cards[T1]["vehicle"] == "WP CAB-4521", "task_board card has from / to / vehicle")

SESSION = str(uuid.uuid4())
code, _ = app.post("duty_sessions", {"id": SESSION, "employee_id": ME, "vehicle_id": V1, "device_info": {"model": "test phone"}})
check(code == 201, "driver starts sharing (duty session)", f"{code}")
ld = tool("live_drivers")
check(ld["duty_counts"]["on_duty"] == 1 and ld["drivers"][0]["location"] == "Sharing · no location yet" and ld["drivers"][0]["state"] == "stale"
      and ld["drivers"][0]["duty"] == "on_duty" and ld["counts"]["all"] == len([d for d in tool("list_drivers")["drivers"]]),
      "live_drivers right after switching on: 'Sharing · no location yet', on duty first; every active driver listed (Phase 7)", json.dumps(ld)[:300])
# Presence (Phase 6): the open duty session is "On duty since HH:MM" on every card.
avp = tool("availability", {"at": f"{day(2)} 10:30", "until": "12:00"})
nuwp = next(d for d in avp["drivers"] if d["username"] == "nuwan.p")
check(nuwp["state"] == "on_duty" and nuwp["status_text"].startswith("On duty since ") and nuwp["on_duty_since"] and avp["drivers"][0]["username"] == "nuwan.p",
      "availability: Nuwan is on duty since HH:MM, listed first", json.dumps(nuwp))
ldp = tool("list_drivers")
check(next(d for d in ldp["drivers"] if d["username"] == "nuwan.p")["on_duty_since"] == nuwp["on_duty_since"]
      and "on_duty_since" not in next(d for d in ldp["drivers"] if d["username"] == "kasun.s"),
      "list_drivers: on_duty_since for the driver who is sharing, nothing for the other")
check(ld["drivers"][0]["on_duty_since"] == nuwp["on_duty_since"], "live_drivers cards carry on_duty_since")

# A drive from Colombo 05 towards Polgahawela with a 12-minute stop on the way.
A, STOP, B = (6.8868, 79.8612), (7.0900, 80.0300), (7.3381, 80.3003)
points = []
def leg(p, q, t0, minutes, n):
    for i in range(n):
        f = i / (n - 1)
        points.append({"employee_id": ME, "session_id": SESSION, "recorded_at": iso(t0 + dt.timedelta(minutes=minutes * f)),
                       "lat": round(p[0] + (q[0] - p[0]) * f, 6), "lng": round(p[1] + (q[1] - p[1]) * f, 6),
                       "accuracy_m": 8, "speed_mps": 15.0, "heading": 45, "battery_pct": 81, "is_mock": False})
now = dt.datetime.now(dt.timezone.utc)  # fresh: the live check below needs the last point under 3 minutes old
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
# Hotfix (17 October): a ranked row carries its km to the first stop and its reasons (the web holds its order within 0.5 km).
avk = tool("availability", {"at": f"{day(2)} 10:30", "until": "12:00", "lat": 6.9271, "lng": 79.8612})
nk = next(d for d in avk["drivers"] if d["username"] == "nuwan.p")
check(nk.get("rank") == 1 and isinstance(nk.get("km_to_first"), (int, float)) and nk.get("match_why") == avk["best"]["why"]
      and "km from the pickup" in nk["match_why"] and avk["best"]["username"] == "nuwan.p"
      and all("match_why" not in d and "km_to_first" not in d for d in avk["drivers"] if "rank" not in d),
      "availability: the ranked row carries km_to_first and match_why (the best match's reasons); unranked rows neither", json.dumps(nk)[:400])

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
code, _ = app.patch("task_stops?id=eq." + stops[0]["id"], {"status": "done", "arrived_at": iso(now - dt.timedelta(minutes=61)), "done_at": iso(now - dt.timedelta(minutes=60)),
                                                       "auto_detected_at": iso(now - dt.timedelta(minutes=62))})
check(code == 200, "driver marks the pickup stop done (the phone saw them near it a minute before their tap)")
td_auto = tool("task_detail", {"task_id": T1})
check(td_auto["stops"][0].get("auto_detected") and td_auto["stops"][0]["arrived"] and td_auto["stops"][0]["auto_detected"] != td_auto["stops"][0]["arrived"],
      "task_detail: the arrival nudge's time beside the driver's own tap", json.dumps(td_auto["stops"][0])[:300])

board = tool("task_board", {"date": task_day})
running = {c["id"]: c for c in board["in_progress"]}
check(T1 in running and running[T1]["status"].startswith("Started ") and running[T1]["status"].endswith("sharing location"), "task_board: 'Started HH:MM · sharing location'", str(running.get(T1)))
ld = tool("live_drivers")
d = ld["drivers"][0]
check(ld["counts"]["sharing"] == 1 and d["location"] in ("Live · 2 min ago", "Live · 3 min ago") and d["near"] == "Polgahawela" and d["speed_kmh"] == 54,
      "live_drivers: Live · 2 min, near Polgahawela, 54 km/h", json.dumps(d)[:300])

check(d["vehicle"] == "WP CAB-4521 · Toyota HiAce" and d["task"] == "Team drop · Kurunegala site" and d["going_to"] == "Kurunegala tower site"
      and d["links"]["maps"].endswith("query=7.3381,80.3003") and d["links"]["whatsapp"] == "https://wa.me/94771234567",
      "live_drivers: vehicle, current task, destination and links", json.dumps(d)[:400])
fleet_jobs()  # the job's sync (the overview's own waits 60 s after the last one)
ov = tool("fleet_overview", {"date": task_day})
check(ov["vehicles"] == {"on_the_road": 1, "total": 3, "parked": 2, "in_garage": 1} and ov["tasks"]["total"] == 3 and ov["tasks"]["in_progress"] == 1,
      "fleet_overview: 1 of 3 on the road, 2 parked, 3 tasks, 1 in progress", json.dumps(ov["vehicles"]) + json.dumps(ov["tasks"]))
whats = [a["what"] for a in ov["needs_attention"]]
check(ov["requests"]["waiting"] == 0 and {"Revenue licence expires", "Rental agreement ends", "Driver licence expires", "Garage booked", "Service due", "Emission test expires"} <= set(whats)
      and next(a for a in ov["needs_attention"] if a["what"] == "Emission test expires")["severity"] == "warning"
      and next(a for a in ov["needs_attention"] if a["what"] == "Revenue licence expires")["severity"] == "critical",
      "fleet_overview needs-attention: licence (critical, 4 days), rental end, driver licence, garage, service, emission test (warning, 20 days)",
      json.dumps(ov["needs_attention"])[:600])
check(ov["on_the_road"][0]["driver"] == "Nuwan Perera" and ov["on_the_road"][0]["near"] == "Polgahawela", "fleet_overview on-the-road list names the driver and the nearest town")
rt = tool("driver_route", {"driver": "nuwan.p"})
# The points are 41 s apart (real phones record every 5 s), so the drift filter drops the last step of each leg: a little under 68 km, a stop of 13-15 min.
check(rt["recorded_points"] == len(points) and 60 <= rt["km"] <= 80 and len(rt["stops_over_10_min"]) == 1 and 12 <= rt["stops_over_10_min"][0]["minutes"] <= 16
      and 2 <= len(rt["route"]["points"]) <= len(points), "driver_route: about 65 km, one stop of about 14 minutes", json.dumps({k: rt[k] for k in ("recorded_points", "km", "stops_over_10_min")}))
# The route builder (shared with the web app): a timeline, the day's numbers, the line thinned by shape, a task's own window.
kinds = [s["kind"] for s in rt["timeline"]]
# Most of these points were posted over 5 minutes after their recorded times: those legs are marked "uploaded later";
# the newest points (under 5 minutes old) are not, so the last driving leg may be cut into a late piece and a fresh one.
driving_rows = [s for s in rt["timeline"] if s["kind"] == "driving"]
check(kinds.count("stopped") == 1 and 2 <= len(driving_rows) <= 3 and "no_data" not in kinds and "no_gps" not in kinds
      and all(s["text"] and s["from_at"] <= s["to_at"] for s in rt["timeline"])
      and rt["timeline"][1]["near"] and (" Stopped near " + rt["timeline"][1]["near"]) in rt["timeline"][1]["text"]
      and driving_rows[0].get("uploaded")
      and all((("Offline here · uploaded " + s["uploaded"]) in s["text"]) if s.get("uploaded") else ("Offline here" not in s["text"]) for s in driving_rows),
      "driver_route timeline: driving, stopped near a town, driving, each row with a sentence; legs posted late say 'Offline here · uploaded HH:MM'",
      json.dumps(rt["timeline"])[:700])
check(rt["gaps"] == [] and rt["holes"] == [] and len(rt["uploaded_later"]) >= 1 and rt["heartbeats"] == 0 and rt["outlier_points"] == 0,
      "driver_route: no gaps or holes, one late-upload window, no heartbeats yet", {k: rt[k] for k in ("gaps", "holes", "uploaded_later", "heartbeats", "outlier_points")})
check(rt["stops_count"] == 1 and 40 <= rt["driving_minutes"] <= 50 and 12 <= rt["stopped_minutes"] <= 16 and rt["gaps"] == [] and abs(rt["stops_over_10_min"][0]["lat"] - STOP[0]) < 0.001,
      "driver_route numbers: one stop, about 45 driving minutes, about 13 stopped minutes, no data gap, the stop's coordinates",
      {k: rt[k] for k in ("stops_count", "driving_minutes", "stopped_minutes", "gaps")})
check(rt["route"]["columns"] == ["time", "lat", "lng", "km/h", "at", "acc"] and len(rt["route"]["points"]) < len(points) // 2
      and all(len(r) == 6 and r[4].endswith("Z") and (r[5] is None or isinstance(r[5], (int, float))) for r in rt["route"]["points"])
      and rt["points_stored"] == len(points) and rt["points_shown"] == len(rt["route"]["points"]) and rt["window"]["from"] < rt["window"]["to"]
      and rt["snapped"]["status"] == "off" and "route_snapped" not in rt,
      "driver_route line: two straight legs thin to a few points (corners kept), each with km/h, an ISO time and the accuracy; points_stored / points_shown; snapping off",
      {"line": len(rt["route"]["points"]), "recorded": rt["recorded_points"], "snapped": rt.get("snapped")})
full = tool("driver_route", {"driver": "nuwan.p", "line_tolerance_m": 3, "max_line_points": 3000})
check(full["points_shown"] >= rt["points_shown"] and full["km"] == rt["km"], "driver_route with a 3 m tolerance keeps at least as many points and the same km", {"shown": full["points_shown"], "km": full["km"]})
check("not started" in tool("driver_route", {"task_id": T2})["note"], "driver_route(task_id) of a task that has not started says so")
check("which driver" in tool("driver_route", {}, expect_error=True), "driver_route with neither a driver nor a task is refused")

print("\n== 3-5b. Part 5b: the estimated lines of gaps, the arrival point, Save as our place ==")
eg = tool("driver_route", {"driver": "nuwan.p", "line_tolerance_m": 0, "estimate_gaps": True})
check(isinstance(eg.get("jumps"), int) and eg["km"] == rt["km"]
      and (eg["jumps"] == 0 or (not eg.get("estimated") and "openrouteservice key" in eg.get("estimated_note", ""))),
      "driver_route estimate_gaps: the gaps over 300 m and 60 s counted; with no ORS key none is routed and the note says why; the km unchanged",
      json.dumps({k: eg.get(k) for k in ("jumps", "estimated_note", "km")}))
check("jumps" not in rt and "estimated" not in rt, "without estimate_gaps (Claude's default) nothing is asked")
KID = psql("select id from employees where username = 'kasun.s'")
VID = psql("select id from vehicles where reg_no = 'WP PH-2087'")
GP2 = f"ChIJ-suite-arr-{uuid.uuid4().hex[:8]}"
psql(f"insert into google_pins (google_place_id, lat, lng, address) values ('{GP2}', 7.2931, 80.635, 'Kandy City Centre, Kandy')")
TID = psql(f"with t as (insert into tasks (title, employee_id, vehicle_id, start_at, created_by) values ('Arrival check', '{KID}', '{VID}', '{day(9)}T08:00:00+05:30', 'suite') returning id) select id from t")
SID = psql(f"""with s as (insert into task_stops (task_id, seq, type, place_name, address, lat, lng, status, done_at, arrival_lat, arrival_lng, arrival_at, arrival_accuracy_m)
  values ('{TID}', 1, 'drop', 'Kandy City Centre', 'Kandy City Centre, Kandy', 7.2931, 80.635, 'done', now(), 7.2932, 80.6352, now(), 8) returning id) select id from s""")
OID = psql(f"with s as (insert into task_stops (task_id, seq, type, place_name, lat, lng, status, done_at, arrival_lat, arrival_lng, arrival_at) values ('{TID}', 2, 'drop', 'Our depot', 6.9, 79.86, 'done', now(), 6.9001, 79.8601, now()) returning id) select id from s")
tda = tool("task_detail", {"task_id": TID})
sa = next(x for x in tda["stops"] if x["id"] == SID)
check(sa.get("google") is True and sa["arrival"]["lat"] == 7.2932 and sa["arrival"]["accuracy_m"] == 8 and sa["arrival"].get("near") and "saved_place" not in sa,
      "task_detail: a reached Google stop carries the driver's arrival point and the town near it", json.dumps(sa)[:300])
r = tool("save_arrival_place", {"stop_id": SID, "name": "kandy city centre"}, expect_error=True)
check("Google's name and address cannot be kept" in r, "save_arrival_place: Google's name is refused", r)
r = tool("save_arrival_place", {"stop_id": OID, "name": "Our depot again"}, expect_error=True)
check("Only a Google stop" in r, "save_arrival_place: our own stop is refused (it is saved the usual way)", r)
sp5 = tool("save_arrival_place", {"stop_id": SID, "name": f"Suite client office {uuid.uuid4().hex[:4]}"})
check(sp5["existing"] is False and sp5["place"]["lat"] == 7.2932 and sp5["place"]["lng"] == 80.6352
      and psql(f"select source || '|' || coalesce(address, 'none') || '|' || ((select saved_place_id from task_stops where id = '{SID}') = id)::text from places where id = '{sp5['place']['id']}'") == "arrival|none|true",
      "save_arrival_place: one of our places at the driver's arrival point, no Google address, the stop linked to it", json.dumps(sp5["place"])[:300])
again = tool("save_arrival_place", {"stop_id": SID, "name": "Another name"})
check(again["existing"] is True and again["place"]["id"] == sp5["place"]["id"], "saving the same stop again answers the place already saved")
check(next(x for x in tool("task_detail", {"task_id": TID})["stops"] if x["id"] == SID)["saved_place"]["id"] == sp5["place"]["id"], "task_detail shows the saved place")
psql(f"update tasks set status = 'cancelled', cancelled_reason = 'suite: arrival checked' where id = '{TID}'")

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
fleet_jobs()  # the job's sync (the overview's own waits 60 s after the last one)
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

# Phase 6 Part 3: a fill with its video, uploaded through the resumable endpoint the app uses.
vid = str(uuid.uuid4())
vpath = f"{ME}/{iso(today)}/{vid}.mp4"
c3, _ = app.post("fuel_logs", {"id": vid, "vehicle_id": V1, "employee_id": ME, "task_id": T1, "litres": 10, "amount_cents": 370000,
                               "video_path": vpath, "video_status": "recorded", "video_duration_s": 5, "video_bytes": len(TINY_MP4),
                               "video_checklist": [{"key": "plate", "at_s": 1}, {"key": "zero", "at_s": 2}, {"key": "pumping", "at_s": 3}, {"key": "final", "at_s": 4}]})
check(c3 == 201, "driver saves a second fill with its recorded video (status recorded)", f"{c3}")
lf = tool("list_fuel")
mine = next(e for e in lf["entries"] if e["id"] == vid)
check(mine["video"]["status"] == "recorded" and "url" not in mine["video"] and mine["video"]["note"].startswith("Recorded") and mine["video"]["checklist"] == ["plate", "zero", "pumping", "final"]
      and mine["video"]["timeline"] == "Plate 0:01 · Zero 0:02 · Pumping 0:03 · Final 0:04" and mine["video"]["marks"][3] == {"key": "final", "label": "Final", "at_s": 4, "clock": "0:04"}
      and lf["totals"]["videos_waiting"] == 1 and lf["totals"]["videos_missing"] == 1 and lf["totals"]["entries"] == 2,
      "list_fuel: the video is still on the phone (no link), the steps ticked are a timeline with bookmarks, the earlier fill has none", json.dumps(mine)[:400])
code, loc = app.tus_create("fuel-videos", vpath, len(TINY_MP4), "video/mp4")
check(code == 201 and isinstance(loc, str) and "/upload/resumable/" in loc, "the resumable upload is created in the driver's own folder", f"{code} {loc}")
code, off = app.tus_patch(loc, 0, TINY_MP4)
check(code == 204 and off == len(TINY_MP4), "one chunk completes the upload (the server's offset is the size)", f"{code} {off}")
code, _ = app.patch("fuel_logs?id=eq." + vid, {"video_status": "uploaded", "video_uploaded_at": iso(now)})
check(code == 200, "the driver marks the video uploaded", f"{code}")
code, bad = app.tus_create("fuel-videos", f"{uuid.uuid4()}/{iso(today)}/x.mp4", 10, "video/mp4")
check(code in (400, 403), "a resumable upload into another driver's folder is refused", f"{code} {str(bad)[:120]}")
code, bad = app.tus_create("fuel-videos", f"{ME}/{iso(today)}/x.jpg", 10, "image/jpeg")
check(code in (400, 403, 415), "a file that is not an mp4 is refused by the bucket", f"{code} {str(bad)[:120]}")
lf = tool("list_fuel", {"vehicle": "cab4521"})
mine = next(e for e in lf["entries"] if e["id"] == vid)
check(mine["video"]["status"] == "uploaded" and mine["video"]["url"].startswith("http") and "/object/sign/fuel-videos/" in mine["video"]["url"]
      and mine["video"]["duration_s"] == 5 and mine["video"]["bytes"] == len(TINY_MP4) and lf["totals"]["videos"] == 1 and lf["totals"]["bytes"] == len(TINY_MP4),
      "list_fuel: uploaded, with a 1-hour signed link, length and size", json.dumps(mine)[:300])
code, body = http("GET", mine["video"]["url"].replace("http://kong:8000", API), raw=True)
check(code == 200 and body == TINY_MP4, "a signed video link really returns the file", f"{code}")
td1v = tool("task_detail", {"task_id": T1})
check(sorted(f["video"]["status"] for f in td1v["fuel"]) == ["none", "uploaded"] and next(f for f in td1v["fuel"] if f["id"] == vid)["video"]["url"].startswith("http")
      and next(f for f in td1v["fuel"] if f["id"] == vid)["video"]["timeline"].startswith("Plate 0:01"),
      "task_detail: each fill carries its video (one none, one uploaded with a link and its timeline)", json.dumps([f.get("video") for f in td1v["fuel"]])[:300])
ms = tool("mileage_summary", {"vehicle": "cab4521"})
check(ms["vehicles"][0]["fuel_entries"] == 2 and ms["vehicles"][0]["fuel_videos"] == 1, "mileage_summary counts the fills with an uploaded video", json.dumps(ms["vehicles"][0])[:200])
# An interrupted fill in two pieces (Part 3b): one row, two files, one link per piece, marked interrupted.
vid2 = str(uuid.uuid4())
p1, p2 = f"{ME}/{iso(today)}/{vid2}.mp4", f"{ME}/{iso(today)}/{vid2}-2.mp4"
c4, _ = app.post("fuel_logs", {"id": vid2, "vehicle_id": V1, "employee_id": ME, "litres": 40, "amount_cents": 1480000, "video_path": p1, "video_status": "recorded",
                               "video_duration_s": 312, "video_bytes": 2 * len(TINY_MP4), "video_interrupted": True,
                               "video_checklist": [{"key": "plate", "at_s": 4}, {"key": "zero", "at_s": 11}, {"key": "pumping", "at_s": 15}, {"key": "final", "at_s": 250}],
                               "video_segments": [{"path": p1, "duration_s": 200, "bytes": len(TINY_MP4)}, {"path": p2, "duration_s": 112, "bytes": len(TINY_MP4)}]})
for pth in (p1, p2):
    code, loc = app.tus_create("fuel-videos", pth, len(TINY_MP4), "video/mp4")
    app.tus_patch(loc, 0, TINY_MP4)
code, _ = app.patch("fuel_logs?id=eq." + vid2, {"video_status": "uploaded", "video_uploaded_at": iso(now)})
two = next(e for e in tool("list_fuel")["entries"] if e["id"] == vid2)
check(c4 == 201 and code == 200 and two["video"]["interrupted"] is True and len(two["video"]["segments"]) == 2
      and all(seg["url"].startswith("http") for seg in two["video"]["segments"]) and two["video"]["segments"][1]["duration_s"] == 112
      and two["video"]["duration_s"] == 312 and tool("list_fuel")["totals"]["interrupted"] == 1
      and two["video"]["timeline"] == "Plate 0:04 · Zero 0:11 · Pumping 0:15 · Final 4:10",
      "list_fuel: an interrupted fill carries its two pieces with a link each, its bookmarks (the final one in piece 2), and is counted", json.dumps(two["video"])[:400])
check(tool("get_settings")["settings"]["fuel_video_quality"] == "480p" and tool("get_settings")["settings"]["fuel_video_keep_months"] == 12, "get_settings: 480p and 12 months by default")
tool("update_settings", {"key": "fuel_video_quality", "value": "720p"})
code, dsq = app.post("rpc/get_driver_settings", {})
check(code == 200 and dsq["fuel_video_quality"] == "720p", "the quality reaches the phone through get_driver_settings", f"{code} {dsq}")
tool("update_settings", {"key": "fuel_video_quality", "value": "480p"})
r = tool("update_settings", {"key": "fuel_video_keep_months", "value": 9}, expect_error=True)
check("6 or 12" in r, "keep months takes 6 or 12 only", r)
code, pr = fleet_jobs(job="prune_fuel_videos")
check(code == 200 and pr["job"] == "prune_fuel_videos" and pr["pruned"] == 0 and pr["failed"] == 0 and pr["keep_months"] == 12, "the monthly prune runs with the keep months (nothing is older than 12 months)", f"{code} {pr}")
steps = tool("get_settings")["settings"]["fuel_video_checklist"]
check([s["key"] for s in steps] == ["plate", "zero", "pumping", "final"] and [s["short"] for s in steps] == ["Plate", "Zero", "Pumping", "Final"],
      "get_settings: the four default steps in order, each with its short word", json.dumps(steps)[:300])
us = tool("update_settings", {"key": "fuel_video_checklist", "value": [{"key": "pump", "en": "Pump", "si": "පොම්පය", "short": " Pump "}, {"key": "cap", "en": "Fuel cap closed"}]})
code, ds = app.post("rpc/get_driver_settings", {})
check(code == 200 and ds["fuel_video_checklist"] == [{"key": "pump", "en": "Pump", "si": "පොම්පය", "short": "Pump"}, {"key": "cap", "en": "Fuel cap closed", "si": "Fuel cap closed"}],
      "the office's steps reach the phone through get_driver_settings (Sinhala falls back to the English; short kept when given)", f"{code} {ds}")
# With the office's own steps the bookmarks take their words; a step the setting no longer has keeps its key in words.
mine = next(e for e in tool("list_fuel")["entries"] if e["id"] == vid)
check(mine["video"]["timeline"] == "Plate 0:01 · Zero 0:02 · Pumping 0:03 · Final 0:04", "a fill's bookmarks keep their words from the keys when the steps change", mine["video"]["timeline"])
r = tool("update_settings", {"key": "fuel_video_checklist", "value": []}, expect_error=True)
check("1 to 8" in r, "the steps need 1 to 8 entries", r)
tool("update_settings", {"key": "fuel_video_checklist", "value": steps})
code, _ = app.post("rpc/send_heartbeat", {"p_at": iso(dt.datetime.now(dt.timezone.utc)), "p_sharing": True, "p_location_on": True, "p_permission": "always", "p_queued_points": 0, "p_video_uploads_waiting": 1, "p_video_bytes_waiting": 12000000})
check(code in (200, 204), "a heartbeat says one video waits on the phone", f"{code}")
# The history row with every column the app sends, the way the app sends it: an upsert that ignores a repeat (14 October: the two
# video columns had no insert grant; 15 October: the upsert form also needs a SELECT policy for the driver, which was missing).
hb_row = {"employee_id": ME, "at": iso(dt.datetime.now(dt.timezone.utc)), "session_id": None, "sharing": True, "location_on": True,
          "permission": "always", "battery_pct": 80, "app_state": "background", "data_available": True, "fixes_seen": 12,
          "fixes_stored": 12, "dropped_accuracy": 0, "dropped_jump": 0, "dropped_jitter": 0, "dropped_duplicate": 0,
          "last_gps_fix_age_s": 5, "queued_points": 0, "rejected_points": 0, "app_version": "1.1.0",
          "video_uploads_waiting": 1, "video_bytes_waiting": 12000000, "location_restarts": 2}
upsert = "return=minimal,resolution=ignore-duplicates"
code, body = app.post("driver_heartbeats?on_conflict=employee_id,at", [hb_row], prefer=upsert)
check(code in (200, 201), "a driver uploads heartbeat history as the app does (upsert, every column, the restarts included)", f"{code} {str(body)[:160]}")
code2, body2 = app.post("driver_heartbeats?on_conflict=employee_id,at", [hb_row], prefer=upsert)
check(code2 in (200, 201), "the same batch again (a lost answer) is ignored, not refused", f"{code2} {str(body2)[:160]}")
dr = tool("driver_route", {"driver": "nuwan.p"})
check(dr["heartbeats"] >= 1 and dr.get("location_restarts") == 2, "driver_route counts the history row and the watchdog's restarts in the window", json.dumps({k: dr.get(k) for k in ("heartbeats", "location_restarts")}))
# Watched mode: the office watches a driver for 90 s; the phone's next heartbeat hears it.
w = tool("watch_drivers", {"drivers": ["nuwan.p"]})
check(len(w["watched"]) == 1 and w["seconds"] == 90 and "until" in w, "watch_drivers: the office watches a driver for 90 s", json.dumps(w))
code, hb = app.post("rpc/send_heartbeat", {"p_at": iso(dt.datetime.now(dt.timezone.utc)), "p_sharing": True, "p_location_on": True, "p_permission": "always", "p_queued_points": 0,
                                           "p_video_uploads_waiting": 1, "p_video_bytes_waiting": 12000000})
check(code == 200 and hb.get("watched") is True and hb.get("on_duty") is True, "the phone's next heartbeat answers watched: true (and on_duty, Phase 7)", f"{code} {hb}")
ldv = next(d for d in tool("live_drivers")["drivers"] if d["username"] == "nuwan.p")
check(ldv.get("video_uploads_waiting") == 1 and ldv.get("video_bytes_waiting") == 12000000, "live_drivers: the card carries the waiting video and its size", json.dumps({k: ldv.get(k) for k in ("video_uploads_waiting", "video_bytes_waiting")}))

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
check(row["task_km"] == 51 and row["odometer_km"] == 69 and row["km_outside_tasks"] == 18 and row["fuel_litres"] == 82 and row["fuel_lkr"] == 30340 and row["fuel_videos"] == 2
      and ms["totals"]["unlogged_km_flags"] == 1 and ms["unlogged_km"][0]["unlogged_km"] == 18 and ms["unlogged_km"][0]["driver"] == "Nuwan Perera",
      "mileage_summary: 51 task km, 69 odometer km, 18 km outside tasks, fuel 82 l / LKR 30,340 (three fills, two with a video), 1 unlogged flag", json.dumps(ms)[:500])
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
check(sorted(t["id"] for t in mine) == sorted([T1, T6, T7]), "the previous driver no longer sees the reassigned task (nor the site round given to Kasun); the cancelled booking stays listed", str(mine)[:200])
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

print("\n== 6b. Issues ==")
code, body = http("POST", f"{API}/functions/v1/fleet-jobs", {"Content-Type": "application/json", "x-server-key": "wrong"}, {"job": "sync"})
check(code == 401, "fleet-jobs refuses a wrong server key (401)", f"{code} {body}")
code, body = fleet_jobs()
check(code == 200 and body["job"] == "sync" and body["active"] >= 1, "fleet-jobs sync answers the counts", f"{code} {str(body)[:200]}")
li = tool("list_issues")
by_kind = {}
for i in li["issues"]:
    by_kind.setdefault(i["kind"], []).append(i)
check(li["open"] + li["in_progress"] == li["count"] and "document" in by_kind
      and any(i["severity"] == "critical" and "Revenue licence" in i["title"] for i in by_kind["document"])
      and any(i["severity"] == "warning" and "Emission test" in i["title"] for i in by_kind["document"]),
      "list_issues: the revenue licence (4 days) is critical, the emission test (20 days) a warning", json.dumps(by_kind.get("document"))[:300])
check({"rental", "garage_booked", "licence", "service_due"} <= set(by_kind) and by_kind["garage_booked"][0]["severity"] == "info",
      "rental end, garage booked (info), driver licence and service due are issues", str(sorted(by_kind)))
check("odometer_flag" not in by_kind and "km_gap" not in by_kind, "nothing flagged by the photo check and 18 km outside tasks is under 30: no such issues")
ov = tool("fleet_overview")
check(all("issue_id" in a and "kind" in a for a in ov["needs_attention"]) and len(ov["needs_attention"]) == li["count"],
      "fleet_overview.needs_attention is the same list, with issue_id and kind", f"{len(ov['needs_attention'])} vs {li['count']}")
# The tyre report (in the garage, then closed in section 4) left a resolved issue with the mirror's history.
old = [i for i in tool("list_issues", {"status": "resolved", "kind": "vehicle_report"})["issues"] if i["vehicle_report_id"] == rep_id]
check(len(old) == 1 and old[0]["resolved_by"] == "system" and old[0]["title"] == "Vehicle problem: tyre (in garage)",
      "the tyre report's issue resolved by itself when the report was closed", json.dumps(old)[:300])
ih = tool("issue_history", {"id": old[0]["id"]})
check([e["action"] for e in ih["events"]] == ["opened", "auto_resolved"] and ih["events"][0]["to"] == "in_progress" and ih["events"][1]["to"] == "resolved"
      and ih["report"]["status"] == "closed" and len(ih["report"]["photos"]) == 1,
      "issue_history: opened in progress (the report was already in the garage), auto-resolved when the report was closed; the report with its photo",
      json.dumps(ih["events"])[:300])
# A new breakdown report from the driver: a critical issue the office takes, notes and resolves (which closes the report).
rep2 = str(uuid.uuid4())
code, _ = app.post("vehicle_reports", {"id": rep2, "vehicle_id": V1, "employee_id": ME, "category": "breakdown", "note": "Engine stalls at idle"})
code2, body = fleet_jobs({"report_id": rep2})
check(code == 201 and code2 == 200 and body["opened"] == 1 and body["scope"] == {"report_id": rep2}, "a scoped sync opens the new report's issue only", f"{code} {code2} {str(body)[:160]}")
new = [i for i in tool("list_issues", {"kind": "vehicle_report"})["issues"] if i["vehicle_report_id"] == rep2]
check(len(new) == 1 and new[0]["severity"] == "critical" and new[0]["status"] == "open" and new[0]["title"] == "Vehicle problem: breakdown"
      and "Engine stalls" in new[0]["detail"] and new[0]["vehicle"] == "WP CAB-4521" and new[0]["driver"] == "Nuwan Perera",
      "a breakdown is a critical open issue with the vehicle, the driver and the note", json.dumps(new)[:300])
rid = new[0]["id"]
r = tool("update_issue", {"id": rid}, expect_error=True)
check("Nothing to change" in r, "update_issue with nothing is refused", r)
taker_email = f"issues.{uuid.uuid4().hex[:6]}@fame.test"
tool("create_office_user", {"name": "Issue Taker", "email": taker_email, "permissions": ["view", "issues"]})
ui = tool("update_issue", {"id": rid, "assign_to": taker_email, "note": "Looking at it", "status": "in_progress"})
check(ui["issue"]["assigned_to"]["email"] == taker_email and ui["issue"]["assigned_to"]["name"] == "Issue Taker" and ui["issue"]["status"] == "in_progress"
      and psql(f"select status from vehicle_reports where id = '{rep2}'") == "in_garage",
      "update_issue assigns by e-mail, notes, sets in progress: the driver's report goes to the garage", json.dumps(ui)[:300])
ui = tool("update_issue", {"id": rid, "status": "resolved", "note": "Fuel pump replaced"})
check(ui["issue"]["status"] == "resolved" and ui["issue"]["resolved_by"] and ui["issue"]["resolution_note"] == "Fuel pump replaced"
      and psql(f"select status || '|' || coalesce(office_note, '') from vehicle_reports where id = '{rep2}'") == "closed|Fuel pump replaced",
      "resolving the issue closes the driver's report with the note", json.dumps(ui)[:300])
hist = tool("issue_history", {"id": rid})["events"]
check([e["action"] for e in hist] == ["opened", "assigned", "status", "status"] and hist[2]["note"] == "Looking at it" and hist[3]["to"] == "resolved",
      "the history has every step (a note given with a status change rides on that event)", json.dumps(hist)[:300])
check(not any(i["id"] == rid for i in tool("list_issues")["issues"]) and any(i["id"] == rid for i in tool("list_issues", {"status": "all", "kind": "vehicle_report"})["issues"]),
      "the resolved issue left the active list; list_issues filters by status and kind")
cab = tool("list_issues", {"vehicle": "cab4521"})["issues"]
van = tool("list_issues", {"vehicle": "ph2087"})["issues"]
check(len(cab) >= 1 and all(i["vehicle"] == "WP CAB-4521" for i in cab) and all(i["vehicle"] == "WP PH-2087" for i in van),
      "list_issues filters by vehicle", f"cab {len(cab)}, van {len(van)}")
# A request waiting over 30 minutes and a task not accepted after the reminder.
re3 = tool("create_request", {"requested_by": "Late Asker", "date": day(3), "time": "10:00", "route_to": "Jaffna", "need_type": "van", "pax": 3})
psql(f"update vehicle_requests set created_at = now() - interval '45 minutes' where id = '{re3['request']['id']}'")
# Phase 7 (§19): the accept window's end marks it as needing a driver (queue_accept_reminders does this every minute).
psql(f"update tasks set accept_reminder_sent_at = now(), needs_driver_since = now(), needs_driver_reason = 'not_accepted' where id = '{T2}' and accepted_at is null")
code, body = fleet_jobs({"request_id": re3["request"]["id"]})
check(code == 200 and body["opened"] == 1 and body["scope"] == {"request_id": re3["request"]["id"]}, "a scoped sync opens the request-waiting issue only", f"{code} {str(body)[:200]}")
code, body = fleet_jobs({"task_id": T2})
kinds2 = {i["kind"] for i in tool("list_issues")["issues"]}
check("request_waiting" in kinds2 and "not_accepted" in kinds2, "request_waiting and not_accepted issues are open", str(sorted(kinds2)))
tool("decide_request", {"request_id": re3["request"]["id"], "decision": "decline", "reason": "No van"})
code, body = fleet_jobs({"request_id": re3["request"]["id"]})
check(body["resolved"] == 1 and "request_waiting" not in {i["kind"] for i in tool("list_issues")["issues"]}, "deciding the request auto-resolves its issue", f"{code} {str(body)[:200]}")
if CHANNEL != "api":
    r = tool("list_issues", {"assigned_to": "me"}, expect_error=True)
    check("shared connector" in r, "assigned_to=me needs a person (the shared key has none)", r)


# ---------------------------------------------------------------------------
print("\n== 6c. Notifications (the outbox, notify-office, a person's settings) ==")
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer  # not `import http.server`: http() is the suite's helper

# A push service stand-in on this laptop: the edge runtime reaches it through host.docker.internal.
# /push/ok answers 201 (delivered), /push/gone 410 (the browser unsubscribed).
SINK_LOG = []
class Sink(BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0") or 0)
        body = self.rfile.read(n)
        SINK_LOG.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "size": len(body)})
        self.send_response(410 if self.path.endswith("/gone") else 201)
        self.send_header("Content-Length", "0")
        self.end_headers()
    def log_message(self, *args):
        pass
sink = ThreadingHTTPServer(("0.0.0.0", 0), Sink)
threading.Thread(target=sink.serve_forever, daemon=True).start()
SINK = f"http://host.docker.internal:{sink.server_address[1]}"
VAPID = bool(os.environ.get("VAPID_PUBLIC_KEY")) and bool(os.environ.get("VAPID_PRIVATE_KEY"))

def browser_keys():
    """What pushManager.subscribe gives a page: a P-256 public key and a 16-byte secret (openssl, nothing downloaded)."""
    priv = subprocess.run(["openssl", "ecparam", "-name", "prime256v1", "-genkey", "-noout"], capture_output=True, check=True).stdout
    der = subprocess.run(["openssl", "ec", "-pubout", "-outform", "DER"], input=priv, capture_output=True, check=True).stdout
    return (base64.urlsafe_b64encode(der[-65:]).rstrip(b"=").decode(), base64.urlsafe_b64encode(os.urandom(16)).rstrip(b"=").decode())

def notify_office(body, key=None):
    return http("POST", f"{API}/functions/v1/notify-office", {"Content-Type": "application/json", "x-server-key": SERVER_KEY if key is None else key}, body)

def outbox(where):
    return psql(f"select id || '|' || status || '|' || (payload->>'title') || '|' || (payload->>'body') || '|' || (payload->>'url') from notifications where {where} order by id")

if CHANNEL != "api":
    r = tool("my_notification_settings", {}, expect_error=True)
    check("personal" in r and "shared key" in r, "my_notification_settings needs a person (the shared key has none)", r)
code, body = notify_office({"retry": True}, key="wrong")
check(code == 401, "notify-office refuses a wrong server key (401)", f"{code} {body}")
code, body = notify_office({"nothing": 1})
check(code == 400, "notify-office wants an id or retry: true (400)", f"{code} {body}")

# An approver with a browser (as the web app registers one) and the Issue Taker from 6b with one too.
approver_email = f"approver.{uuid.uuid4().hex[:6]}@fame.test"
tool("create_office_user", {"name": "Notify Approver", "email": approver_email, "permissions": ["view", "request", "approve"]})
APPROVER = psql(f"select id from employees where email = '{approver_email}'")
TAKER = psql(f"select id from employees where email = '{taker_email}'")
p1, a1 = browser_keys()
psql(f"insert into web_push_subscriptions (employee_id, endpoint, p256dh, auth, user_agent) values ('{APPROVER}', '{SINK}/push/ok', '{p1}', '{a1}', "
     f"'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36')")
p3, a3 = browser_keys()
psql(f"insert into web_push_subscriptions (employee_id, endpoint, p256dh, auth) values ('{TAKER}', '{SINK}/push/taker', '{p3}', '{a3}')")

# request.created → the approver, with the message and the link.
rq = tool("create_request", {"requested_by": "Notify Approver", "date": day(4), "time": "08:30", "route_from": "Head office", "route_to": "Kandy", "need_type": "van", "pax": 5})
RQ = rq["request"]["id"]
row = outbox(f"event = 'request.created' and recipient_employee_id = '{APPROVER}'")
check("\n" not in row and "|queued|Vehicle request · Notify Approver|" in row and "Van" in row and "Head office → Kandy" in row and row.endswith(f"|/requests/{RQ}"),
      "a new request queues one row for the approver: the message and the link to the request (Hotfix 2: its own page)", row)
NID = row.split("|")[0]
code, body = notify_office({"id": int(NID)})
if VAPID:
    check(code == 200 and body["sent"] == 1 and body["vapid"] is True, "notify-office pushes it to the approver's browser (the sink on this laptop)", f"{code} {body}")
    hit = SINK_LOG[-1] if SINK_LOG else {}
    h = hit.get("headers", {})
    check(hit.get("path") == "/push/ok" and h.get("content-encoding") == "aes128gcm" and h.get("authorization", "").startswith("vapid t=")
          and h.get("ttl") == "3600" and hit.get("size", 0) > 100, "the push is encrypted (aes128gcm) and signed (VAPID) with a TTL", str(hit)[:300])
    check(psql(f"select status || '|' || attempts from notifications where id = {NID}") == "sent|1"
          and psql(f"select count(*) from web_push_subscriptions where employee_id = '{APPROVER}' and last_ok_at is not null") == "1",
          "the row is sent after one attempt and the browser's last_ok_at is set")
else:
    check(code == 200 and body["dead"] == 1 and body["vapid"] is False and psql(f"select error from notifications where id = {NID}") == "no_vapid_keys",
          "without VAPID keys in the functions env the row is marked dead (no_vapid_keys); nothing else breaks", f"{code} {body}")
code, body = notify_office({"id": int(NID)})
check(code == 200 and body["skipped"] == 1 and body["sent"] == 0, "a row already dealt with is never sent twice", f"{code} {body}")

# A browser the push service reports gone (410): marked removed; the row dead when it was the only one.
p2, a2 = browser_keys()
psql(f"insert into web_push_subscriptions (employee_id, endpoint, p256dh, auth) values ('{APPROVER}', '{SINK}/push/gone', '{p2}', '{a2}')")
psql(f"update web_push_subscriptions set removed_at = now(), removed_reason = 'user' where endpoint = '{SINK}/push/ok'")
tool("decide_request", {"request_id": RQ, "decision": "decline", "reason": "No van that day"})
row = outbox(f"event = 'request.decided' and recipient_employee_id = '{APPROVER}'")
check("|queued|Request declined by " in row and row.endswith(f"|No van that day|/requests/{RQ}"),
      "the decision queues a row for the requester (an office person) with who declined, the reason and the request's link", row)
NID2 = row.split("|")[0]
code, body = notify_office({"id": int(NID2)})
if VAPID:
    check(code == 200 and body["dead"] == 1 and psql(f"select error from notifications where id = {NID2}") == "subscription_gone"
          and psql(f"select removed_reason from web_push_subscriptions where endpoint = '{SINK}/push/gone'") == "gone",
          "a browser the push service reports gone is marked removed and the row is dead", f"{code} {body}")

# A switched-off event writes no row; the retry call takes every row whose time has come.
psql(f"insert into notification_settings (employee_id, event, enabled) values ('{APPROVER}', 'request.created', false)")
psql(f"update web_push_subscriptions set removed_at = null, removed_reason = null where endpoint = '{SINK}/push/ok'")
n_before = psql(f"select count(*) from notifications where recipient_employee_id = '{APPROVER}'")
tool("create_request", {"requested_by": "Quiet Asker", "date": day(4), "time": "09:30", "route_to": "Matara"})
check(psql(f"select count(*) from notifications where recipient_employee_id = '{APPROVER}'") == n_before, "an event the person switched off writes no row")
psql(f"update notifications set status = 'failed', attempts = 1, next_try_at = now() - interval '1 minute' where id = {NID2}")
code, body = notify_office({"retry": True})
check(code == 200 and body["processed"] >= 1 and body["sent"] + body["dead"] >= 1
      and psql(f"select status from notifications where id = {NID2}") == ("sent" if VAPID else "dead"),
      "the retry call takes the failed row whose time has come", f"{code} {body}")

# task.declined (SQL): the driver declines a fresh task → a row for the approver.
t7 = tool("create_task", {"title": "Airport run · notify", "date": day(2), "start_time": "10:00", "driver": "nuwan.p", "vehicle": "cab4521", "pickup": "Head office", "dropoff": "Airport"})
code, ans = app.post("rpc/decline_task", {"p_task_id": t7["task_id"], "p_reason": "unwell"})
row = outbox(f"event = 'task.declined' and recipient_employee_id = '{APPROVER}'")
check(ans == "declined" and "|queued|Nuwan declined 'Airport run · notify' " in row and "|Unwell · needs a driver|" in row and row.endswith("|/"),
      "a declined task queues a row for the approver: who declined what and when, the reason, 'needs a driver' (approve without assign_tasks: the Overview)", row)

# issue.opened (critical only) → the issues permission; issue.assigned → the assignee.
rep3 = str(uuid.uuid4())
app.post("vehicle_reports", {"id": rep3, "vehicle_id": V1, "employee_id": ME, "category": "accident", "note": "Scraped the side"})
code, body = fleet_jobs({"report_id": rep3})
iss = [i for i in tool("list_issues", {"kind": "vehicle_report"})["issues"] if i["vehicle_report_id"] == rep3][0]
row = outbox(f"event = 'issue.opened' and recipient_employee_id = '{TAKER}'")
check(body["opened"] == 1 and row.endswith(f"|queued|Vehicle problem: accident|Scraped the side · WP CAB-4521 · Nuwan Perera|/issues/{iss['id']}") or
      (body["opened"] == 1 and "|queued|Vehicle problem: accident|" in row and row.endswith(f"|/issues/{iss['id']}")),
      "a critical issue opening queues a row for the person with the issues permission (the Issue Taker)", row)
check(outbox(f"event = 'issue.opened' and recipient_employee_id = '{APPROVER}'") == "", "not for the approver (no issues permission)")
tool("update_issue", {"id": iss["id"], "assign_to": taker_email})
row = outbox(f"event = 'issue.assigned' and recipient_employee_id = '{TAKER}'")
check(f"|queued|Issue for you · Vehicle problem: accident|" in row and row.endswith(f"|/issues/{iss['id']}"), "assigning an issue queues a row for the assignee", row)

# The overview's own sync waits 60 s after the last full sync; the job's sync always runs.
tool("fleet_overview")
f1 = psql("select coalesce(finished_at::text, '') from job_runs where job = 'issues'")
tool("fleet_overview")
f2 = psql("select coalesce(finished_at::text, '') from job_runs where job = 'issues'")
check(f1 != "" and f1 == f2, "a second fleet_overview within 60 s does not run the issue sync again (job_runs unchanged)", f"{f1} / {f2}")
code, body = fleet_jobs()
f3 = psql("select coalesce(finished_at::text, '') from job_runs where job = 'issues'")
check(code == 200 and f3 > f1, "the job's own sync runs regardless and records its finish", f"{f1} -> {f3}")

if CHANNEL == "api":
    # The admin's own settings and devices through office-api (what Settings → Notifications does).
    ms = tool("my_notification_settings")
    check([e["event"] for e in ms["events"]] == ["request.created", "request.decided", "task.declined", "task.not_accepted", "task.vehicle_needed",
                                                 "task.running_late", "ask.answered", "trip.personal", "task.stop_skipped", "issue.opened", "issue.assigned",
                                                 "vehicle.booked", "vehicle.booking_cancelled", "request.changed", "request.redecided", "booking.changed",
                                                 "request.not_decided", "request.late", "request.on_the_way", "request.running_late", "request.arrived",
                                                 "request.driver_changed", "request.cancelled"]
          and all(e["enabled"] for e in ms["events"]) and ms["devices"] == [] and ms["push"]["configured"] is VAPID and (("public_key" in ms["push"]) is VAPID),
          "my_notification_settings: every event on (the admin holds every permission), no devices, push.configured says whether the server has the keys", json.dumps(ms)[:300])
    ms = tool("set_my_notification_settings", {"events": {"issue.opened": False}})
    check(next(e["enabled"] for e in ms["events"] if e["event"] == "issue.opened") is False and all(e["enabled"] for e in ms["events"] if e["event"] != "issue.opened"),
          "set_my_notification_settings switches one event off and leaves the rest", json.dumps(ms["events"])[:300])
    r = tool("set_my_notification_settings", {"events": {"issue.exploded": True}}, expect_error=True)
    check("Unknown event" in r, "an unknown event is refused", r)
    p4, a4 = browser_keys()
    reg = tool("register_web_push", {"endpoint": f"{SINK}/push/admin", "p256dh": p4, "auth": a4, "user_agent": "Mozilla/5.0 (Linux; Android 13; CPH2119) Chrome/129.0.0.0 Mobile Safari/537.36"})
    check(reg["registered"]["device"] == "Chrome on Android" and len(reg["devices"]) == 1 and reg["devices"][0]["endpoint_hash"] == reg["registered"]["endpoint_hash"]
          and len(reg["registered"]["endpoint_hash"]) == 16 and all("endpoint" not in d for d in reg["devices"]),
          "register_web_push saves the browser and lists it by its hash (the endpoint never comes back)", json.dumps(reg)[:300])
    reg2 = tool("register_web_push", {"endpoint": f"{SINK}/push/admin", "p256dh": p4, "auth": a4})
    check(len(reg2["devices"]) == 1, "the same endpoint registered again is one device, not two")
    rm = tool("remove_web_push", {"id": reg["registered"]["id"]})
    check(rm["removed"] == 1 and rm["devices"] == [], "remove_web_push by device id", json.dumps(rm)[:200])
    tool("register_web_push", {"endpoint": f"{SINK}/push/admin", "p256dh": p4, "auth": a4})
    rm = tool("remove_web_push", {"endpoint": f"{SINK}/push/admin"})
    check(rm["removed"] == 1 and rm["devices"] == [], "remove_web_push by endpoint (the browser's own, after unsubscribe)", json.dumps(rm)[:200])
    r = tool("remove_web_push", {}, expect_error=True)
    check("endpoint or the device id" in r, "remove_web_push needs one of the two", r)
# vehicle.booked / vehicle.booking_cancelled → the custodian (the approver keeps WP PH-2087 from now on).
tool("update_vehicle", {"reg_no": "WP PH-2087", "custodian": approver_email})
bk3 = tool("book_vehicle", {"requested_by": "Notify Approver", "date": day(5), "time": "09:00", "route_to": "Galle", "vehicle": "ph2087", "driver": "kasun.s"})
row = outbox(f"event = 'vehicle.booked' and recipient_employee_id = '{APPROVER}'")
check("|queued|WP PH-2087 booked · " in row and f"|{ACTOR_NAME} · " in row and "→ Galle|" in row and row.endswith(f"|/tasks?task={bk3['task_id']}"),
      "booking a custodian's vehicle queues vehicle.booked for the custodian with the booker and the route", row)
cr3 = tool("cancel_request", {"request_id": bk3["request"]["id"], "reason": "Galle trip off"})
row = outbox(f"event = 'vehicle.booking_cancelled' and recipient_employee_id = '{APPROVER}'")
check("|queued|WP PH-2087 booking cancelled|Galle trip off · " in row and row.endswith("|/requests"), "cancelling it queues vehicle.booking_cancelled for the custodian", row)
tool("update_vehicle", {"reg_no": "WP PH-2087", "custodian": None})
sink.shutdown()


# ---------------------------------------------------------------------------
print("\n== 6d. Phase 7, Part 1: a driver's day (clock in, hand-over, move, clock out, duty log, arrival and finish rules) ==")
PIN7A, PIN7B = "614203", "730518"
tool("create_driver", {"name": "Ruwan Jaya", "code": "E171", "username": "ruwan.j", "pin": PIN7A, "phone": "0771717171"})
tool("create_driver", {"name": "Saman Kumara", "code": "E172", "username": "saman.k", "pin": PIN7B, "phone": "0771727272"})
tool("register_vehicle", {"reg_no": "WP P7-1001", "make_model": "Toyota HiAce", "vehicle_type": "van", "seats": 14, "current_odometer_km": 5000})
tool("register_vehicle", {"reg_no": "WP P7-1002", "make_model": "Toyota Axio", "vehicle_type": "car", "seats": 4, "current_odometer_km": 9000})
VA = psql("select id from vehicles where reg_no = 'WP P7-1001'")
VB = psql("select id from vehicles where reg_no = 'WP P7-1002'")
code, ses = sign_in("ruwan.j", PIN7A)
ruwan = Driver(ses["access_token"])
RU = ruwan.get("employees?select=id")[1][0]["id"]
code, ses = sign_in("saman.k", PIN7B)
saman = Driver(ses["access_token"])
SA = saman.get("employees?select=id")[1][0]["id"]

# The picker, then Start work with a vehicle (the app's duty session carries it).
code, choices = ruwan.post("rpc/my_vehicle_choices", {}, prefer="return=representation")
p7a = next((c for c in choices if c["reg_no"] == "WP P7-1001"), None) if code == 200 else None
check(p7a is not None and p7a["held_by"] is None and p7a["mine_now"] is False, "my_vehicle_choices: the picker's list, nobody holds WP P7-1001", f"{code} {str(choices)[:200]}")
S7A = str(uuid.uuid4())
code, _ = ruwan.post("duty_sessions", {"id": S7A, "employee_id": RU, "vehicle_id": VA, "device_info": {"brand": "OPPO", "model": "CPH2119"}})
card = next(d for d in tool("live_drivers")["drivers"] if d["username"] == "ruwan.j")
check(code == 201 and card["duty"] == "on_duty" and card["vehicle"].startswith("WP P7-1001") and card.get("vehicle_since") and card.get("phone") == "OPPO CPH2119",
      "Start work: on duty with WP P7-1001 since HH:MM, the phone named (live_drivers)", json.dumps({k: card.get(k) for k in ("duty", "vehicle", "vehicle_since", "phone")}))
check(psql(f"select how from vehicle_assignments where employee_id = '{RU}' and to_at is null") == "clock_in", "the server recorded the take: how clock_in")

# Change vehicle through the RPC, sent twice by the queue: one change.
CL = str(uuid.uuid4())
for _ in range(2):
    code, ans = ruwan.post("rpc/change_vehicle", {"p_vehicle": VB, "p_at": iso(dt.datetime.now(dt.timezone.utc)), "p_client": CL}, prefer="return=representation")
held = next(v for v in tool("list_vehicles")["vehicles"] if v["reg_no"] == "WP P7-1002")
check(code == 200 and ans["vehicle_id"] == VB and held.get("held_by") == "Ruwan Jaya" and held.get("held_since")
      and psql(f"select count(*) from vehicle_assignments where vehicle_id = '{VB}'") == "1",
      "change_vehicle twice with one id: one change; list_vehicles says Ruwan holds WP P7-1002", f"{ans} {held.get('held_by')}")

# One vehicle, one driver: Saman starts work on WP P7-1002.
code, _ = saman.post("duty_sessions", {"id": str(uuid.uuid4()), "employee_id": SA, "vehicle_id": VB, "device_info": {"brand": "samsung", "model": "SM-A226B"}})
cards = {d["username"]: d for d in tool("live_drivers")["drivers"]}
check(code == 201 and cards["ruwan.j"].get("vehicle") is None and "now with Saman Kumara" in (cards["ruwan.j"].get("vehicle_note") or "")
      and "taken over from Ruwan Jaya" in (cards["saman.k"].get("vehicle_note") or "") and cards["ruwan.j"]["duty"] == "on_duty",
      "hand-over: Ruwan holds none (still on duty), both cards name it", json.dumps({u: cards[u].get("vehicle_note") for u in ("ruwan.j", "saman.k")}))
code, rows = ruwan.get("vehicle_assignments?select=ended_how,ended_by_name&order=from_at.desc&limit=1")
check(code == 200 and rows[0]["ended_how"] == "taken_over" and rows[0]["ended_by_name"] == "Saman Kumara", "Ruwan's app reads 'taken over by Saman' (the banner)", str(rows))
code, rows = ruwan.get("vehicle_assignments?select=id")
check(code == 200 and str(len(rows)) == psql(f"select count(*) from vehicle_assignments where employee_id = '{RU}'")
      and psql(f"select count(*) from vehicle_assignments where employee_id <> '{RU}'") != "0", "a driver reads only their own rows (other drivers have rows too)")

# The office moves Ruwan to WP P7-1001; Kasun (off duty) cannot be moved.
mv = tool("move_driver_vehicle", {"driver": "ruwan.j", "vehicle": "WP P7-1001"})
check(mv["vehicle"].startswith("WP P7-1001") and psql(f"select how || '|' || by_name from vehicle_assignments where employee_id = '{RU}' and to_at is null") == f"office|{ACTOR_NAME}",
      "move_driver_vehicle: how office, by the office person", json.dumps(mv))
r = tool("move_driver_vehicle", {"driver": "kasun.s", "vehicle": "WP P7-1002"}, expect_error=True)
check("off duty" in r, "an off-duty driver is not moved", r)

# The office clocks Saman out; a second time says so.
co = tool("clock_out_driver", {"driver": "saman.k", "reason": "Went home"})
card = next(d for d in tool("live_drivers")["drivers"] if d["username"] == "saman.k")
check(co["clocked_out"] == "Saman Kumara" and card["duty"] == "off_duty" and card.get("off_duty_how") == "by the office"
      and psql(f"select ended_how from vehicle_assignments where employee_id = '{SA}' order by from_at desc limit 1") == "office",
      "clock_out_driver: off duty by the office, the vehicle given up", json.dumps({k: card.get(k) for k in ("duty", "off_duty_how", "status_text")}))
check(card["status_text"] == "Off duty", "an off-duty card reads 'Off duty'", card["status_text"])
co2 = tool("clock_out_driver", {"driver": "saman.k"})
check(co2["clocked_out"] is False and "already off duty" in co2["note"], "a second clock-out says the driver is already off duty", json.dumps(co2))
code, hb = saman.post("rpc/send_heartbeat", {"p_at": iso(dt.datetime.now(dt.timezone.utc)), "p_sharing": True, "p_location_on": True, "p_permission": "always"},
                      prefer="return=representation")
check(code == 200 and hb["on_duty"] is False and hb["duty_end"]["reason"] == "admin", "Saman's phone hears it from the heartbeat: on_duty false, ended by the office", str(hb))

# The duty log.
dl = tool("duty_log", {"driver": "ruwan.j"})
per = dl["periods"][0] if dl["periods"] else {}
check(len(dl["periods"]) == 1 and per["clock_out"] == "on duty" and [v["how"] for v in per["vehicles"]] == ["clocked in", "changed", "office"]
      and per["vehicles"][1]["ended"] == "taken over" and per["vehicles"][1].get("ended_by") == "Saman Kumara",
      "duty_log: Ruwan's period with the vehicles held (clocked in, changed → taken over by Saman, office)", json.dumps(per)[:400])
dla = tool("duty_log", {})
check(len(dla["periods"]) >= 2 and any(p["driver"] == "Saman Kumara" and p["out_how"] == "office" for p in dla["periods"]) and dla["totals"]["periods"] == len(dla["periods"]),
      "duty_log for everyone today: Saman's period clocked out by the office", json.dumps(dla["totals"]))
r = tool("duty_log", {"from": day(-70), "to": day(0)}, expect_error=True)
check("62 days" in r, "a range over 62 days is refused", r)

# A task: arrival flags, Done needs Arrived, completed early, reopen.
t7 = tool("create_task", {"title": "P7 site run", "date": day(0) if can_today else day(1), "start_time": start, "driver": "ruwan.j", "vehicle": "WP P7-1001",
                          "pickup": "Head office", "dropoff": "Kurunegala tower site"})
T7 = t7["task_id"]
code, _ = ruwan.patch(f"tasks?id=eq.{T7}", {"status": "in_progress", "start_odometer_km": 5000})
S1, S2 = psql(f"select id from task_stops where task_id = '{T7}' order by seq").split("\n")
code1, _ = ruwan.patch(f"task_stops?id=eq.{S1}", {"status": "arrived", "arrived_at": iso(dt.datetime.now(dt.timezone.utc)), "arrival_flag": "override", "arrival_distance_m": 42000})
code2, _ = ruwan.patch(f"task_stops?id=eq.{S1}", {"status": "done", "done_at": iso(dt.datetime.now(dt.timezone.utc))})
code3, err3 = ruwan.patch(f"task_stops?id=eq.{S2}", {"status": "done", "done_at": iso(dt.datetime.now(dt.timezone.utc))})
check(code == 200 and code1 == 200 and code2 == 200 and code3 >= 400 and "Mark Arrived first" in json.dumps(err3),
      "the driver's writes: Arrived with the override flag and distance, Done after it; Done without Arrived refused", f"{code} {code1} {code2} {code3} {str(err3)[:120]}")
ruwan.patch(f"task_stops?id=eq.{S2}", {"status": "arrived", "arrived_at": iso(dt.datetime.now(dt.timezone.utc)), "arrival_flag": "ok", "arrival_distance_m": 40})
ruwan.patch(f"task_stops?id=eq.{S2}", {"status": "done", "done_at": iso(dt.datetime.now(dt.timezone.utc))})
code, _ = ruwan.patch(f"tasks?id=eq.{T7}", {"status": "completed", "end_odometer_km": 5002})
td7 = tool("task_detail", {"task_id": T7})
check(code == 200 and td7["task"]["finish_flag"]["kind"] == "completed_early" and td7["task"]["finish_flag"]["text"].startswith("Completed early: 2 km on the odometer")
      and td7["task"].get("can_reopen") is True,
      "completed early: 2 km for the planned trip, flagged by the server; reopen offered", json.dumps(td7["task"].get("finish_flag")))
s1 = next(x for x in td7["stops"] if x["id"] == S1)
check(s1.get("arrival_flag") == "override" and "42 km from the pin" in (s1.get("arrival_text") or ""), "task_detail: the stop marked away from its pin, in words", json.dumps({k: s1.get(k) for k in ("arrival_flag", "arrival_text")}))
board7 = tool("task_board", {"date": day(0) if can_today else day(1)})
card7 = next((c for c in board7["completed"] if c["id"] == T7), {})
check(card7.get("finish_flag", {}).get("kind") == "completed_early", "task_board: the card carries the flag", json.dumps(card7.get("finish_flag")))
fleet_jobs()
kinds = {i["kind"] for i in tool("list_issues", {"status": "active"})["issues"]}
check({"arrival_override", "completed_early"} <= kinds, "issues: arrival_override and completed_early opened", str(sorted(kinds)))
ro = tool("reopen_task", {"task_id": T7, "reason": "Wrong end reading"})
td7 = tool("task_detail", {"task_id": T7})
check(ro["reopened"] == "P7 site run" and td7["task"]["status"] == "in_progress" and "finish_flag" not in td7["task"]
      and td7["assignment_history"][-1]["action"] == "reopened" and td7["assignment_history"][-1]["note"].startswith("Wrong end reading · was completed "),
      "reopen_task: in progress again, the flag cleared, the history says why", json.dumps(td7["assignment_history"][-1]))
r = tool("reopen_task", {"task_id": T7, "reason": "again"}, expect_error=True)
check("not completed" in r, "a task in progress is not reopened", r)
fleet_jobs()
early = [i for i in tool("list_issues", {"status": "active", "kind": "completed_early"})["issues"] if i.get("task_id") == T7]
check(not early, "the completed_early issue resolves itself after the reopen", json.dumps(early)[:300])
r = tool("clock_out_driver", {"driver": "ruwan.j"}, expect_error=True)
check("task in progress" in r, "no clock-out while a task is running", r)
tool("cancel_task", {"task_id": T7, "reason": "suite: Phase 7 checked"})

# App stopped by the phone (the rule of the Part 2b go): 10 minutes or more with neither a point nor a heartbeat, on duty.
# Ruwan's duty period from 40 minutes ago, a heartbeat every minute but two holes: 35–23 (12 min) and 20–9 (11 min).
nowp = dt.datetime.now(dt.timezone.utc)
psql(f"update duty_sessions set started_at = '{iso(nowp - dt.timedelta(minutes=40))}' where id = '{S7A}'")
for mins in [m for m in range(40, -1, -1) if not (23 < m < 35) and not (9 < m < 20)]:
    psql(f"insert into driver_heartbeats (employee_id, at, session_id, sharing) values ('{RU}', '{iso(nowp - dt.timedelta(minutes=mins))}', '{S7A}', true) on conflict do nothing")
card = next(d for d in tool("live_drivers")["drivers"] if d["username"] == "ruwan.j")
check(card.get("app_stops_today") == 2 and card.get("app_stops_text") == "App stopped by phone 2× today", "live_drivers: 'App stopped by phone 2× today'", json.dumps({k: card.get(k) for k in ("app_stops_today", "app_stops_text")}))
fleet_jobs()
app_issue = [i for i in tool("list_issues", {"status": "active", "kind": "app_stopped"})["issues"] if "Ruwan" in (i.get("detail") or "")]
check(app_issue and "OPPO CPH2119" in app_issue[0]["detail"] and app_issue[0]["title"].startswith("App stopped by the phone 2× today"),
      "issue app_stopped with the phone's brand and model", json.dumps(app_issue[:1])[:300])

# The cut-off: a duty period left open since yesterday 08:00 is clocked out at yesterday's 21:00.
yday = dt.datetime.combine(today - dt.timedelta(days=1), dt.time(8, 0), tzinfo=colombo)
psql(f"update duty_sessions set started_at = '{iso(yday)}' where id = '{S7A}'")
check(tool("get_settings")["settings"].get("duty_cutoff") == "", "get_settings: duty_cutoff (off for the suite)")
r = tool("update_settings", {"key": "duty_cutoff", "value": "25:00"}, expect_error=True)
check("duty_cutoff" in r, "a cut-off that is not HH:MM is refused", r)
tool("update_settings", {"key": "duty_cutoff", "value": "21:00"})
jobs = json.loads(psql("select duty_jobs()"))
end = psql(f"select end_reason || '|' || to_char(ended_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI') from duty_sessions where id = '{S7A}'")
check(jobs["closed_silently"] >= 1 and end == f"auto|{iso(today - dt.timedelta(days=1))} 21:00",
      "duty_jobs: clocked out at yesterday's 21:00 (auto), silently (an earlier day: no push)", f"{jobs} {end}")
tool("update_settings", {"key": "duty_cutoff", "value": ""})
check(psql("select count(*) from employees e where e.current_vehicle_id is distinct from (select a.vehicle_id from vehicle_assignments a where a.employee_id = e.id and a.to_at is null)") == "0",
      "every employee's current_vehicle_id equals their open vehicle row")

# ---------------------------------------------------------------------------
print("\n== 6e. Phase 7, Part 2: time at each stop, the start stop, the vehicle fills itself, conflicts, needs a driver, the swap ==")
tool("update_settings", {"key": "duty_cutoff", "value": ""})
# Any permission brings view (§12).
nr_email = f"needreq.{uuid.uuid4().hex[:6]}@fame.test"
cu = tool("create_office_user", {"name": "Need Requester", "email": nr_email, "permissions": ["request"]})
up = tool("update_office_user", {"email": nr_email, "permissions": ["issues"]})
check(cu["created"]["permissions"] == ["view", "request"] and up["updated"]["permissions"] == ["view", "issues"],
      "any permission brings view (create_office_user and update_office_user)", f"{cu['created']['permissions']} {up['updated']['permissions']}")
tool("update_office_user", {"email": nr_email, "permissions": ["request"]})
NEED_REQ = psql(f"select id from employees where email = '{nr_email}'")
p4, a4 = browser_keys()
psql(f"insert into web_push_subscriptions (employee_id, endpoint, p256dh, auth) values ('{NEED_REQ}', '{SINK}/push/needreq', '{p4}', '{a4}')")

# Time at each stop (§17): the defaults, a chosen time, the place's usual time.
st = tool("get_settings")["settings"]
check(st["dwell_min"] == {"pickup": 5, "drop": 5, "visit": 60, "default": 5} and st["accept_within_min"] == 15 and st["accept_before_leave_min"] == 30
      and st.get("accept_reminder_min") == 5, "settings: the time at a stop by type (5, 5, 60) and the accept window 15 / 30 with the reminder at 5",
      json.dumps({k: st.get(k) for k in ("dwell_min", "accept_within_min", "accept_before_leave_min", "accept_reminder_min")}))
tool("add_place", {"name": "P7 depot Kegalle", "lat": 7.2513, "lng": 80.3464, "kind": "store"})
pv = tool("plan_task", {"date": day(5), "leave_by": "08:00", "stops": [{"type": "pickup", "place": "Head office"}, {"type": "visit", "place": "P7 depot Kegalle"}]})
s1, s2 = pv["stops"][0], pv["stops"][1]
check(s1["label"] == "Stop 1 · Pickup · Head office, Colombo 05" and s2["label"] == "Stop 2 · Visit · P7 depot Kegalle"
      and s2["dwell_min"] == 60 and s2["dwell_source"] == "default" and s2.get("planned_leave"),
      "plan_task: stops named by their place in the order, a visit's default 60 min, its planned leave", json.dumps([s1, s2])[:400])
items = pv["timeline"]["items"]
check(items[0]["kind"] == "leave" and items[0]["at"] == "08:00"
      and any(i["kind"] == "leg" and i["from_n"] == 1 and i["to_n"] == 2 for i in items)
      and [i["label"] for i in items if i["kind"] == "stop"] == [s1["label"], s2["label"]]
      and {"drive_min", "km", "ends"} <= set(pv["timeline"]["totals"]),
      "plan_task: the timeline (leave, stop, leg, stop) and its totals", json.dumps(pv["timeline"])[:400])
cv = tool("create_task", {"title": "P7b usual time", "date": day(5), "start_time": "08:00", "driver": "ruwan.j", "vehicle": "WP P7-1001",
                          "stops": [{"type": "pickup", "place": "Head office"}, {"type": "visit", "place": "P7 depot Kegalle", "dwell_min": 90}]})
check(psql("select usual_dwell_min from places where name = 'P7 depot Kegalle'") == "90"
      and psql(f"select dwell_source from task_stops where task_id = '{cv['task_id']}' and seq = 2") == "chosen",
      "a chosen time is saved on the stop (chosen) and becomes the place's usual time")
pv = tool("plan_task", {"date": day(6), "leave_by": "08:00", "stops": [{"type": "pickup", "place": "Head office"}, {"type": "visit", "place": "P7 depot Kegalle"}]})
check(pv["stops"][1]["dwell_min"] == 90 and pv["stops"][1]["dwell_source"] == "place", "the next plan at that place takes its usual time (place)", json.dumps(pv["stops"][1])[:200])
tool("cancel_task", {"task_id": cv["task_id"], "reason": "suite: usual time checked"})

# The start stop (§11): passengers get in at the start; a pickup at the start says so.
pv = tool("plan_task", {"date": day(5), "leave_by": "08:00", "start": {"place": "Head office", "passengers": True, "what": "goods", "note": "Gate 2", "dwell_min": 20},
                        "stops": [{"type": "drop", "place": "Kurunegala tower site"}]})
check(pv["stops"][0].get("what") == "goods" and pv["stops"][0].get("note") == "Gate 2" and pv["stops"][0]["dwell_min"] == 20
      and pv["stops"][0]["dwell_source"] == "chosen", "the start stop takes its own what, note and time there (Tick it moves them)", json.dumps(pv["stops"][0])[:300])
check(pv["stops"][0].get("is_start") is True and pv["stops"][0]["label"] == "Stop 1 · Pickup · Head office, Colombo 05"
      and pv["stops"][1]["label"] == "Stop 2 · Drop · Kurunegala tower site"
      and not any(i["kind"] == "leg" and i["to_n"] == 1 for i in pv["timeline"]["items"]),
      "start.passengers: the start is Stop 1 (a pickup, no leg to it) and the drop is Stop 2", json.dumps(pv["stops"])[:300])
pv = tool("plan_task", {"date": day(5), "leave_by": "08:00", "start": {"place": "Head office"},
                        "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kurunegala tower site"}]})
check(any(w.startswith("Same as the start: Stop 1 (Head office, Colombo 05) is a pickup") for w in pv["warnings"]),
      "a first pickup at the start without the tick: the warning says to tick 'Passengers get in here'", json.dumps(pv["warnings"]))

# The vehicle fills itself (§3): the driver's regular vehicle, then the one held today; another one is recorded.
tool("update_vehicle", {"reg_no": "WP P7-1002", "regular_driver": "saman.k"})
ct = tool("create_task", {"title": "P7b regular", "date": day(5), "start_time": "09:00", "driver": "saman.k", "pickup": "Head office", "dropoff": "Kurunegala tower site"})
check(ct["vehicle"] == "WP P7-1002" and ct.get("vehicle_used") == {"reg_no": "WP P7-1002", "why": "Saman's regular vehicle"},
      "create_task with no vehicle: Saman's regular vehicle, said so", json.dumps({k: ct.get(k) for k in ("vehicle", "vehicle_used")}))
tool("cancel_task", {"task_id": ct["task_id"], "reason": "suite: regular vehicle checked"})
S7B = str(uuid.uuid4())
code, _ = saman.post("duty_sessions", {"id": S7B, "employee_id": SA, "vehicle_id": VA, "device_info": {"brand": "samsung", "model": "SM-A226B"}})
ct = tool("create_task", {"title": "P7b today", "date": day(5), "start_time": "10:00", "driver": "saman.k", "pickup": "Head office", "dropoff": "Kurunegala tower site"})
TD = ct["task_id"]
check(code == 201 and ct.get("vehicle_used") == {"reg_no": "WP P7-1001", "why": "Saman's vehicle today"} and ct.get("timeline", {}).get("items"),
      "on duty with WP P7-1001: that one (Saman's vehicle today), with the timeline", json.dumps(ct.get("vehicle_used")))
ch = tool("create_task", {"title": "P7b other vehicle", "date": day(6), "start_time": "10:00", "driver": "saman.k", "vehicle": "WP P7-1002",
                          "pickup": "Head office", "dropoff": "Kurunegala tower site"})
td = tool("task_detail", {"task_id": ch["task_id"]})
check(ch.get("vehicle_changed") == f"Vehicle changed by {ACTOR_NAME}: WP P7-1002 instead of Saman's vehicle today WP P7-1001"
      and td["task"].get("vehicle_changed") == ch["vehicle_changed"],
      "another vehicle than the default: recorded on the task and shown", json.dumps(ch.get("vehicle_changed")))
tool("cancel_task", {"task_id": ch["task_id"], "reason": "suite: vehicle choice checked"})

# Overlaps as cards (§17): the vehicle and the driver busy then, with the other task and its people.
ov = tool("create_task", {"title": "P7b overlap", "date": day(5), "start_time": "10:15", "driver": "ruwan.j", "vehicle": "WP P7-1001",
                          "pickup": "Head office", "dropoff": "Kurunegala tower site"})
cf = (ov.get("conflicts") or [{}])[0]
check(cf.get("kind") == "vehicle" and cf.get("task", {}).get("id") == TD and cf["text"].startswith("WP P7-1001 is on task P7b today")
      and "(driver Saman)" in cf["text"] and cf.get("driver", {}).get("call", "").startswith("tel:"),
      "a vehicle overlap comes as a card: the other task, its driver with a call link", json.dumps(cf)[:300])
tool("cancel_task", {"task_id": ov["task_id"], "reason": "suite: overlap checked"})
pt = tool("plan_task", {"date": day(5), "leave_by": "10:15", "driver": "saman.k", "vehicle": "WP P7-1002", "pickup": "Head office", "dropoff": "Galle"})
check(any(c["kind"] == "driver" and c.get("task", {}).get("id") == TD for c in pt.get("conflicts", [])), "plan_task: the driver busy then, as a card",
      json.dumps(pt.get("conflicts"))[:300])

# Needs a driver (§19): a decline goes to the dispatchers at once with the change page; the board, the overview and Live list it.
code, ans = saman.post("rpc/decline_task", {"p_task_id": TD, "p_reason": "vehicle_problem", "p_note": "Brakes"}, prefer="return=representation")
nd = next((n for n in tool("task_board", {"date": day(5)}).get("needs_driver", []) if n["task_id"] == TD), {})
check(ans == "declined" and nd.get("kind") == "declined" and nd.get("line") == "Saman declined · Vehicle problem" and nd.get("note") == "Brakes"
      and "in " in nd.get("when", ""), "task_board.needs_driver: declined, the reason, the time to the start", json.dumps(nd)[:300])
ovw = tool("fleet_overview")
check(ovw.get("needs_driver", {}).get("count", 0) >= 1 and any(n["task_id"] == TD for n in ovw["needs_driver"]["tasks"]),
      "fleet_overview.needs_driver lists it", json.dumps(ovw.get("needs_driver"))[:300])
card = next(d for d in tool("live_drivers")["drivers"] if d["username"] == "saman.k")
check((card.get("task_note") or "").startswith("declined the ") and card["task_note"].endswith(" 10:00 task"), "live_drivers: 'declined the … 10:00 task'", card.get("task_note"))
row = outbox(f"event = 'task.declined' and recipient_employee_id = '{APPROVER}' and payload->>'task_id' = '{TD}'")
check(f"|Saman declined 'P7b today' 10:00|Vehicle problem: Brakes · needs a driver|/" in row,
      "the approver's push: who declined what, the reason, 'needs a driver' (the Overview: no assign_tasks)", row)
fleet_jobs()
iss = next((i for i in tool("list_issues", {"status": "active", "kind": "declined"})["issues"] if i.get("task_id") == TD), None)
hist = tool("issue_history", {"id": iss["id"]}) if iss else {"events": []}
check(iss is not None and iss["severity"] == "critical" and any(e["action"] == "notified" and (e.get("note") or "").startswith("Told by web push") for e in hist["events"]),
      "the declined issue is critical and its history says who was told and when", json.dumps(hist["events"])[:300])
check(outbox(f"event = 'issue.opened' and payload->>'url' = '/issues/{iss['id'] if iss else 'x'}'") == "", "no second 'critical issue' push for it")
tool("reassign_task", {"task_id": TD, "driver": "ruwan.j", "vehicle": "WP P7-1002"})
td = tool("task_detail", {"task_id": TD})
check("needs_driver" not in td["task"] and not any(n["task_id"] == TD for n in tool("task_board", {"date": day(5)}).get("needs_driver", [])),
      "reassigning clears it", json.dumps(td["task"].get("needs_driver")))
tool("cancel_task", {"task_id": TD, "reason": "suite: needs a driver checked"})

# The requester hears it too, on their own request's page.
rq = tool("create_request", {"requested_by": "Need Requester", "date": day(5), "time": "13:00", "route_from": "Head office", "route_to": "Galle",
                             "from_dwell_min": 15, "to_dwell_min": 30})
dr = tool("decide_request", {"request_id": rq["request"]["id"], "decision": "approve", "driver": "saman.k", "to_dwell_min": 45})
TR = dr["task_id"]
stops_r = tool("task_detail", {"task_id": TR})["stops"]
check(dr.get("vehicle_used", {}).get("reg_no") == "WP P7-1001" and [s.get("dwell_min") for s in stops_r] == [15, 45]
      and [s.get("dwell_source") for s in stops_r] == ["chosen", "chosen"],
      "decide_request with a driver only: the vehicle fills itself; the request's time at From and the approver's at To reach the stops", json.dumps([dr.get("vehicle_used"), stops_r])[:300])
saman.post("rpc/decline_task", {"p_task_id": TR, "p_reason": "unwell"})
row = outbox(f"event = 'task.declined' and recipient_employee_id = '{NEED_REQ}'")
check(f"|Unwell · needs a driver|/requests/{rq['request']['id']}" in row, "the requester's push opens their request", row)
tool("cancel_request", {"request_id": rq["request"]["id"], "reason": "suite: requester told"})

# Not accepted in time: the reminder at 5 minutes, needs a driver at 15; accepting late clears it.
tn = tool("create_task", {"title": "P7b not accepted", "date": day(5), "start_time": "11:00", "driver": "ruwan.j", "vehicle": "WP P7-1002",
                          "pickup": "Head office", "dropoff": "Kurunegala tower site"})
TN = tn["task_id"]
# Hotfix 2 (E): off duty, the window does not run however long ago it was sent; it runs from Start work.
RUWAN_DUTY = ""
if psql(f"select count(*) from duty_sessions where ended_at is null and employee_id = '{RU}'") == "0":
    psql(f"update tasks set sent_at = now() - interval '40 minutes' where id = '{TN}'")
    psql("select queue_accept_reminders()")
    check(psql(f"select (accept_reminder_sent_at is null and needs_driver_since is null)::text from tasks where id = '{TN}'") == "true",
          "E: Ruwan off duty: no reminder and no 'needs a driver', sent 40 minutes ago")
    RUWAN_DUTY = psql(f"insert into duty_sessions (employee_id, started_at) values ('{RU}', now() - interval '3 hours') returning id").split("\n")[0]
psql(f"update tasks set sent_at = now() - interval '6 minutes' where id = '{TN}'")
psql("select queue_accept_reminders()")
check(psql(f"select (accept_reminder_sent_at is not null)::text || '|' || coalesce(needs_driver_reason, '-') from tasks where id = '{TN}'") == "true|-",
      "6 minutes after sending: the driver's reminder, not yet the office")
psql(f"update tasks set sent_at = now() - interval '16 minutes' where id = '{TN}'")
psql("select queue_accept_reminders()")
row = outbox(f"event = 'task.not_accepted' and recipient_employee_id = '{APPROVER}' and payload->>'task_id' = '{TN}'")
check(psql(f"select needs_driver_reason from tasks where id = '{TN}'") == "not_accepted" and "|Ruwan hasn't accepted 'P7b not accepted' 11:00|needs a driver|" in row,
      "16 minutes: needs a driver (not accepted), the approver told", row)
code, ans = ruwan.post("rpc/accept_task", {"p_task_id": TN, "p_at": iso(dt.datetime.now(dt.timezone.utc))}, prefer="return=representation")
check(ans == "accepted" and psql(f"select coalesce(needs_driver_reason, 'cleared') from tasks where id = '{TN}'") == "cleared", "accepting late clears it", str(ans))
if RUWAN_DUTY:
    psql(f"update duty_sessions set ended_at = now(), end_reason = 'admin' where id = '{RUWAN_DUTY}'")
tool("cancel_task", {"task_id": TN, "reason": "suite: accept window checked"})

# The swap during a task (§2 addition): readings typed by the office, km per stretch, mileage per vehicle.
tw = tool("create_task", {"title": "P7b swap", "date": day(0) if can_today else day(1), "start_time": start, "driver": "saman.k",
                          "pickup": "Head office", "dropoff": "Kurunegala tower site"})
TW = tw["task_id"]
code, _ = saman.patch(f"tasks?id=eq.{TW}", {"status": "in_progress", "start_odometer_km": 5002})
mv = tool("move_driver_vehicle", {"driver": "saman.k", "vehicle": "WP P7-1002", "old_end_km": 5082, "new_start_km": 9000, "reason": "Breakdown at Kegalle"})
check(code == 200 and mv.get("swapped", {}).get("from") == "WP P7-1001" and mv["swapped"]["to"] == "WP P7-1002" and mv["readings"]["old_end"] == "typed: 5082 km",
      "move_driver_vehicle on a task: a swap with both readings typed", json.dumps(mv)[:300])
for sid in psql(f"select id from task_stops where task_id = '{TW}' order by seq").split("\n"):
    saman.patch(f"task_stops?id=eq.{sid}", {"status": "arrived", "arrived_at": iso(dt.datetime.now(dt.timezone.utc)), "arrival_flag": "ok", "arrival_distance_m": 30})
    saman.patch(f"task_stops?id=eq.{sid}", {"status": "done", "done_at": iso(dt.datetime.now(dt.timezone.utc))})
code, row = saman.patch(f"tasks?id=eq.{TW}", {"status": "completed", "end_odometer_km": 9050})
td = tool("task_detail", {"task_id": TW})
check(code == 200 and td["task"]["km"] == 130 and [(g["vehicle"], g.get("km")) for g in td.get("segments", [])] == [("WP P7-1001", 80), ("WP P7-1002", 50)],
      "completed in the second vehicle: task km 130 = 80 + 50, both stretches in task_detail", json.dumps({"km": td["task"].get("km"), "segments": td.get("segments")})[:300])
ms = tool("mileage_summary", {"driver": "saman.k"})
rows = {r["vehicle"]: r for r in ms["vehicles"]}
check(rows.get("WP P7-1001", {}).get("task_km") == 80 and rows.get("WP P7-1002", {}).get("task_km") == 50 and ms["totals"]["tasks"] == 1,
      "mileage: each vehicle gets its own stretch, the task counted once", json.dumps({k: v.get("task_km") for k, v in rows.items()}))

# A swap with the readings from the phone; then "I need another vehicle".
tw2 = tool("create_task", {"title": "P7b swap phone", "date": day(0) if can_today else day(1), "start_time": start, "driver": "saman.k",
                           "pickup": "Head office", "dropoff": "Kurunegala tower site"})
TW2 = tw2["task_id"]
saman.patch(f"tasks?id=eq.{TW2}", {"status": "in_progress", "start_odometer_km": 9050})
rep4 = str(uuid.uuid4())
code, _ = saman.post("vehicle_reports", {"id": rep4, "vehicle_id": VB, "employee_id": SA, "task_id": TW2, "category": "breakdown", "note": "Engine stopped",
                                         "needs_vehicle": True})
row = outbox(f"event = 'task.vehicle_needed' and recipient_employee_id = '{APPROVER}'")
check(code == 201 and "|Another vehicle needed · WP P7-1002|Saman Kumara · Breakdown · P7b swap phone · Engine stopped|" in row,
      "'I need another vehicle' (the driver's report): the dispatchers' push at once", row)
fleet_jobs()
vn = [i for i in tool("list_issues", {"status": "active", "kind": "vehicle_needed"})["issues"] if i.get("task_id") == TW2]
check(vn and vn[0]["severity"] == "critical" and vn[0]["title"] == "Another vehicle needed: WP P7-1002 · Toyota Axio", "a critical vehicle_needed issue", json.dumps(vn[:1])[:300])
mv = tool("move_driver_vehicle", {"driver": "saman.k", "vehicle": "WP P7-1001"})
check(mv["readings"] == {"old_end": "the driver enters it on the phone", "new_start": "the driver enters it on the phone"}, "a swap without readings: the phone is asked",
      json.dumps(mv["readings"]))
code1, _ = saman.post("odometer_logs", {"vehicle_id": VB, "employee_id": SA, "task_id": TW2, "kind": "task_end", "reading_km": 9070})
code2, _ = saman.post("odometer_logs", {"vehicle_id": VA, "employee_id": SA, "task_id": TW2, "kind": "task_start", "reading_km": 5082})
segs = psql(f"select string_agg(seq || ':' || coalesce(start_odometer_km::text, '-') || '-' || coalesce(end_odometer_km::text, '-'), ',' order by seq) "
            f"from task_vehicle_segments where task_id = '{TW2}'")
check((code1, code2) == (201, 201) and segs == "1:9050-9070,2:5082--", "the phone's two readings fill the stretches (old end, new start)", segs)
fleet_jobs()
vn = [i for i in tool("list_issues", {"status": "active", "kind": "vehicle_needed"})["issues"] if i.get("task_id") == TW2]
check(not vn, "the vehicle_needed issue resolves itself when the task's vehicle changes", json.dumps(vn[:1])[:200])
tool("cancel_task", {"task_id": TW2, "reason": "suite: swap checked"})

# A reading the phone never sent (a towed vehicle): the task completes anyway; the office types it afterwards (swap_reading).
tw3 = tool("create_task", {"title": "P7b swap towed", "date": day(0) if can_today else day(1), "start_time": start, "driver": "saman.k", "vehicle": "WP P7-1001",
                           "pickup": "Head office", "dropoff": "Kurunegala tower site"})
TW3 = tw3["task_id"]
saman.patch(f"tasks?id=eq.{TW3}", {"status": "in_progress", "start_odometer_km": 5090})
tool("move_driver_vehicle", {"driver": "saman.k", "vehicle": "WP P7-1002", "old_end_km": 5120})
for sid in psql(f"select id from task_stops where task_id = '{TW3}' order by seq").split("\n"):
    saman.patch(f"task_stops?id=eq.{sid}", {"status": "arrived", "arrived_at": iso(dt.datetime.now(dt.timezone.utc)), "arrival_flag": "ok", "arrival_distance_m": 30})
    saman.patch(f"task_stops?id=eq.{sid}", {"status": "done", "done_at": iso(dt.datetime.now(dt.timezone.utc))})
code, _ = saman.patch(f"tasks?id=eq.{TW3}", {"status": "completed", "end_odometer_km": 9100})
td = tool("task_detail", {"task_id": TW3})
check(code == 200 and "km" not in td["task"] and any(g.get("readings_waiting") for g in td["segments"]),
      "completed with the new vehicle's start still owed: no km yet, the stretch waits for its reading", json.dumps({"km": td["task"].get("km"), "segments": td["segments"]})[:300])
sr = tool("swap_reading", {"task_id": TW3, "vehicle": "WP P7-1002", "start_km": 9070})
check(sr.get("task_km") == 60 and tool("task_detail", {"task_id": TW3})["task"]["km"] == 60, "swap_reading: the office types it; task km = 30 + 30", json.dumps(sr))
r = tool("swap_reading", {"task_id": TW3, "vehicle": "WP P7-1002", "start_km": 9071}, expect_error=True)
check("still to come" in r, "a reading that is not owed is refused", r)

# App stops: a gap where the app version changed (an update or a new install) is not one; points keep the app alive.
# Saman's period from 45 minutes ago, a heartbeat every minute but two holes: 30–18 across an update (a → b), 15–4 (b).
nowp = dt.datetime.now(dt.timezone.utc)
psql(f"update duty_sessions set started_at = '{iso(nowp - dt.timedelta(minutes=45))}' where id = '{S7B}'")
for mins in [m for m in range(45, -1, -1) if not (18 < m < 30) and not (4 < m < 15)]:
    ver = "1.2.0+a" if mins >= 30 else "1.2.0+b"
    psql(f"insert into driver_heartbeats (employee_id, at, session_id, sharing, app_version) values ('{SA}', '{iso(nowp - dt.timedelta(minutes=mins))}', '{S7B}', true, '{ver}')"
         " on conflict do nothing")
card = next(d for d in tool("live_drivers")["drivers"] if d["username"] == "saman.k")
check(card.get("app_stops_today") == 1, "two 10-minute holes, one across an update: 1 app stop", json.dumps({k: card.get(k) for k in ("app_stops_today", "app_stops_text")}))
tool("clock_out_driver", {"driver": "saman.k", "reason": "suite: Part 2 checked"})

# ---------------------------------------------------------------------------
print("\n== 6f. Phase 7, Part 2b: the plan's lines and the start's pin, the Roads caps ==")
pv = tool("plan_task", {"date": day(5), "leave_by": "08:00", "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kurunegala tower site"}],
                        "start": {"place": "Head office"}, "with_line": True})
legs = [i for i in pv["timeline"]["items"] if i["kind"] == "leg"]
check(pv.get("start", {}).get("lat") is not None and pv["start"].get("lng") is not None and legs and not any("line" in l for l in legs),
      "plan_task with_line on the open package: the start's pin for the plan map, no Google line (only Google's road times bring one)",
      json.dumps({"start": pv.get("start"), "legs": legs})[:300])
st = tool("get_settings")["settings"]
check(st["google_caps"]["roads"] == {"day": 215, "month": 4750}, "snap to roads is on within the free usage: 215 a day, 4,750 a month", json.dumps(st["google_caps"]["roads"]))
check([st["google_caps"][f]["day"] for f in ("map_loads", "places_autocomplete", "places_details", "routes", "roads")] == [430, 430, 430, 215, 215],
      "each day's cap is the month ÷ 22 working days: 430, 430, 430, 215, 215 (hotfix, 17 October 2026)", json.dumps(st["google_caps"]))
tool("update_settings", {"key": "google_caps", "value": {**st["google_caps"], "roads": {"day": 0, "month": 0}}})
check(tool("get_settings")["settings"]["google_caps"]["roads"] == {"day": 0, "month": 0}, "a cap of 0 turns it off (if Google asks)")
r = tool("update_settings", {"key": "google_caps", "value": {**st["google_caps"], "roads": {"day": 200, "month": 5000}}}, expect_error=True)
check("4750" in r or "4,750" in r, "a month above 95 % of the free 5,000 is refused", r)
tool("update_settings", {"key": "google_caps", "value": st["google_caps"]})

print("\n== 6g. Phase 7, Part 3: a request planned like a task (§34), approved with its stops ==")
rq = tool("create_request", {"date": day(6), "start": {"place": "Head office", "passengers": True},
                             "stops": [{"type": "visit", "place": "Kurunegala tower site", "dwell_min": 45},
                                       {"type": "drop", "place": "Galle", "arrive_by": "16:00"}],
                             "pax": 3, "note": "6g trip"})["request"]
items = rq.get("trip", {}).get("timeline", {}).get("items", [])
check(rq["kind"] == "request" and len(rq["trip"]["stops"]) == 3 and rq["trip"]["stops"][0].get("is_start") and rq["trip"]["leave_by_source"] == "plan"
      and [i["kind"] for i in items].count("stop") == 3 and rq["route"].startswith("Head office") and rq["route"].endswith("Galle"),
      "create_request with stops: the trip planned from the 16:00 deadline (start, three stops, the timeline); From and To from the stops",
      json.dumps(rq)[:400])
check(len(rq["fields"]["stops"]) == 2 and rq["fields"]["start"]["passengers"] is True and "leave_by" not in rq["fields"]
      and rq["fields"]["stops"][0]["dwell_min"] == 45 and rq["fields"]["stops"][1]["arrive_by"] == "16:00",
      "the card's fields hand the trip back to the edit form (the start with passengers, the stops, no typed leave time)", json.dumps(rq["fields"])[:300])
check(psql(f"select count(*) from request_stops where request_id = '{rq['id']}' and removed_at is null") == "3", "three request stops stored")
dq = tool("decide_request", {"request_id": rq["id"], "decision": "approve", "driver": "kasun.s", "vehicle": "car1182"})
names = psql(f"select string_agg(place_name, ' | ' order by seq) from task_stops where task_id = '{dq['task_id']}'")
wanted = psql(f"select string_agg(place_name, ' | ' order by seq) from request_stops where request_id = '{rq['id']}' and removed_at is null")
check(names == wanted and psql(f"select leave_by = (select leave_by from vehicle_requests where id = '{rq['id']}') from tasks where id = '{dq['task_id']}'") == "t",
      "approving copies the stops into the task with nothing retyped, at the planned leave-by", f"{names} / {wanted}")
check(psql(f"select status || '|' || (task_id = '{dq['task_id']}') from vehicle_requests where id = '{rq['id']}'") == "approved|true", "the request is approved and linked")
# Sahan, 17 October: once approved, the request shows the task's stops and times (never an old plan), and says what the
# office changed.
same = tool("list_requests", {"status": "all", "id": rq["id"]})["requests"][0]
check(same["trip"].get("source") == "task" and "changed" not in same["trip"] and len(same["trip"]["stops"]) == 3,
      "approved: the trip is read from the task (as asked: nothing changed)", json.dumps(same["trip"])[:300])
asked_when = same["when"]
td6 = tool("task_detail", {"task_id": dq["task_id"]})
tool("update_task", {"task_id": dq["task_id"], "plan_version": td6["task"]["plan_version"], "time": "07:15"})
moved = tool("list_requests", {"status": "all", "id": rq["id"]})["requests"][0]
was = asked_when.split(" ")[-1] + " " + " ".join(asked_when.split(" ")[:-1])
check(moved["when"].endswith("07:15") and moved["trip"]["leave_by"] == "07:15"
      and moved["trip"].get("changed", {}).get("text") == f"Changed by the office · was {was}",
      "the office moved the task: the request says the new time and 'Changed by the office · was <the time asked>'", json.dumps(moved["trip"].get("changed")))
td6 = tool("task_detail", {"task_id": dq["task_id"]})
tool("update_task_stops", {"task_id": dq["task_id"], "plan_version": td6["task"]["plan_version"],
                           "stops": [{"type": "visit", "place": "Kurunegala tower site", "dwell_min": 45}, {"type": "visit", "place": "Kandy"},
                                     {"type": "drop", "place": "Galle", "arrive_by": "16:00"}]})
moved = tool("list_requests", {"status": "all", "id": rq["id"]})["requests"][0]
check(any(x.get("place") == "Kandy" for x in moved["trip"]["stops"]) and moved["trip"]["changed"]["text"].endswith("stops changed"),
      "the office changed the stops: the request shows the task's stops, 'stops changed'", json.dumps(moved["trip"])[:400])
leave_now = psql(f"select to_char(leave_by at time zone 'Asia/Colombo', 'HH24:MI') from tasks where id = '{dq['task_id']}'")
check(moved["fields"]["time"] == leave_now and any(x.get("place") == "Kandy" for x in moved["fields"]["stops"])
      and moved["stops_count"] == len(moved["trip"]["stops"]) and moved["route"].endswith("Galle"),
      "the edit page starts from the task (its time and stops), the route and stop count are the task's", json.dumps(moved["fields"])[:400])
# The requester changes only the passengers; the approver keeps it: the office's time and stops stay (nothing as first asked).
ch = tool("update_request", {"request_id": rq["id"], "version": moved["version"], "pax": 4})
check(ch["request"]["status"] == "changed" and list(ch["changes"].keys()) == ["passengers"] and "changed" not in ch["request"]["trip"],
      "a passengers-only change after the office's edits: only the passengers changed (measured from the task); no office line while it waits",
      json.dumps({"changes": ch["changes"], "trip_changed": ch["request"]["trip"].get("changed")}))
kp = tool("redecide_request", {"request_id": rq["id"], "version": ch["request"]["version"], "decision": "keep"})
after_keep = tool("list_requests", {"status": "all", "id": rq["id"]})["requests"][0]
check(psql(f"select to_char(leave_by at time zone 'Asia/Colombo', 'HH24:MI') || '|' || passengers from tasks where id = '{dq['task_id']}'") == f"{leave_now}|4"
      and psql(f"select count(*) from task_stops where task_id = '{dq['task_id']}' and status <> 'removed' and place_name like 'Kandy%'") == "1"
      and list(kp["task"]["changes"].keys()) == ["passengers"] and "changed" not in after_keep["trip"],
      "kept: the task takes the passengers only; the office's time and Kandy stop stay; no 'changed by the office' after it",
      json.dumps({"changes": kp["task"]["changes"], "trip_changed": after_keep["trip"].get("changed")}))
# An edit while it waits: the stops replaced (the old ones kept as removed), still waiting.
rq2 = tool("create_request", {"date": day(6), "time": "08:30", "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kandy"}]})["request"]
up = tool("update_request", {"request_id": rq2["id"], "version": rq2["version"],
                             "stops": [{"type": "pickup", "place": "Head office"}, {"type": "visit", "place": "Kurunegala tower site"}, {"type": "drop", "place": "Kandy"}]})
check(up["request"]["status"] == "waiting" and len(up["request"]["trip"]["stops"]) == 3 and "stops" in up["changes"]
      and psql(f"select count(*) filter (where removed_at is null) || '/' || count(*) from request_stops where request_id = '{rq2['id']}'") == "3/5",
      "update_request with new stops: planned again, still waiting; the old stops kept as removed", json.dumps(up["changes"])[:300])
# An approved booking edited with stops: changed, then kept: the task takes the stops.
dq2 = tool("decide_request", {"request_id": rq2["id"], "decision": "approve", "driver": "kasun.s", "vehicle": "car1182"})
cur = tool("list_requests", {"status": "all", "id": rq2["id"]})["requests"][0]
up2 = tool("update_request", {"request_id": rq2["id"], "version": cur["version"],
                              "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Galle"}]})
check(up2["request"]["status"] == "changed" and up2["needs_reapproval"], "an approved booking edited with new stops needs re-approval", json.dumps(up2)[:200])
kept = tool("redecide_request", {"request_id": rq2["id"], "version": up2["request"]["version"], "decision": "keep"})
check(psql(f"select string_agg(place_name, ' | ' order by seq) from task_stops where task_id = '{dq2['task_id']}' and status <> 'removed'") == "Head office, Colombo 05 | Galle"
      and "stops" in kept["task"]["changes"],
      "kept: the task takes the request's new stops (the old pending ones removed)", psql(f"select string_agg(place_name || ':' || status, ' | ' order by seq) from task_stops where task_id = '{dq2['task_id']}'"))
r = tool("create_request", {"date": day(6), "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kandy"}]}, expect_error=True)
check("arrive_by" in r, "a trip needs the leave time or a stop's arrive_by", r)
# From the checkpoint review: a one-step booking whose task the office changed keeps those stops when the asker changes
# only the passengers and the approver keeps it (its trip was written after its own approval, not edited since).
bk = tool("book_vehicle", {"date": day(6), "time": "11:00", "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kandy"}],
                           "driver": "kasun.s", "vehicle": "car1182", "pax": 2})
btd = tool("task_detail", {"task_id": bk["task_id"]})
tool("update_task_stops", {"task_id": bk["task_id"], "plan_version": btd["task"]["plan_version"],
                           "stops": [{"type": "pickup", "place": "Head office"}, {"type": "visit", "place": "Kurunegala tower site"}, {"type": "drop", "place": "Kandy"}]})
bc = tool("list_requests", {"status": "all", "id": bk["request"]["id"]})["requests"][0]
bu = tool("update_request", {"request_id": bc["id"], "version": bc["version"], "pax": 3})
tool("redecide_request", {"request_id": bc["id"], "version": bu["request"]["version"], "decision": "keep"})
check(psql(f"select count(*) from task_stops where task_id = '{bk['task_id']}' and status <> 'removed'") == "3",
      "kept after a passengers-only change: the office's stop edits stay (the booking's trip was never edited)",
      psql(f"select string_agg(place_name || ':' || status, ' | ' order by seq) from task_stops where task_id = '{bk['task_id']}'"))
check(tool("get_settings")["settings"]["tasks_need_approval"] is True, "tasks_need_approval is on by default (§33)")

print("\n== 6i. Phase 7, Part 3: remove and restore a place (§15) ==")
yard_name = f"Removable yard {uuid.uuid4().hex[:6]}"
yard = tool("add_place", {"name": yard_name, "lat": 7.01, "lng": 80.01, "kind": "other"})["added"]
yt = tool("create_task", {"title": "6i yard run", "date": day(8), "start_time": "09:00", "driver": "nuwan.p", "vehicle": "cab4521",
                          "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place_id": yard["id"]}]})
iu = tool("place_detail", {"id": yard["id"]}).get("in_use", {})
check(iu.get("reasons") == ["1 task today or later starts or stops there"] and iu.get("tasks", [{}])[0].get("title") == "6i yard run",
      "place_detail's in_use: what remove_place would ask about, read before the second click", json.dumps(iu))
ask = tool("remove_place", {"id": yard["id"]})
check(ask.get("needs_confirm") is True and ask["reasons"] == ["1 task today or later starts or stops there"] and ask["tasks"][0]["title"] == "6i yard run"
      and psql(f"select active from places where id = '{yard['id']}'") == "t",
      "remove_place: a place a task tomorrow uses asks first, naming the task; nothing removed yet", json.dumps(ask))
done = tool("remove_place", {"id": yard["id"], "confirm": True})
found = tool("search_places", {"text": yard_name})
check(done.get("removed") == yard_name and not any(x.get("id") == yard["id"] for x in found.get("results", []))
      and any(p["id"] == yard["id"] and p.get("removed") for p in tool("list_places", {"removed": True})["places"])
      and psql(f"select name from places where id = '{yard['id']}'") == yard_name
      and psql(f"select place_name from task_stops where task_id = '{yt['task_id']}' and seq = 2") == yard_name,
      "confirmed: out of the search, under Removed places, the task's stop keeps its name (nothing deleted)", json.dumps(done))
r = tool("update_place", {"id": yard["id"], "address": "Somewhere else"}, expect_error=True)
check("restore it first" in r, "a removed place is not edited until it is restored", r)
pd = tool("place_detail", {"id": yard["id"]})["place"]
check(bool(pd.get("removed")) and pd.get("active") is False,
      "place_detail still opens a removed place: Removed <when> by <who>, switched off", json.dumps(pd)[:200])
r = tool("add_place", {"name": yard_name.upper()}, expect_error=True)
check("was removed: restore it from Removed places" in r, "adding a removed place's name again points to Removed places", r)
tool("restore_place", {"id": yard["id"]})
check(any(x.get("id") == yard["id"] for x in tool("search_places", {"text": yard_name}).get("results", [])), "restore_place: found again")
r = tool("add_place", {"name": yard_name}, expect_error=True)
check("already exists" in r and "Key (" not in r, "a name taken by a place in use: plain words", r)
# A removed site: the site import skips it with the reason (never switches it back on), the batch goes through.
rs = f"RM{uuid.uuid4().hex[:4].upper()}"
tool("import_places", {"preset": "dialog", "rows": [{"operator": "dialog", "site_id": rs, "name": "Removable site", "lat": 7.2, "lng": 80.2}]})
rsid = tool("search_places", {"text": rs, "map": False})["results"][0]["id"]
tool("remove_place", {"id": rsid})
again = tool("import_places", {"preset": "dialog", "rows": [
    {"operator": "dialog", "site_id": rs, "name": "Removable site renamed", "lat": 7.2, "lng": 80.2},
    {"operator": "dialog", "site_id": rs + "B", "name": "Its neighbour", "lat": 7.3, "lng": 80.3}]})
check(again["added"] == 1 and len(again["skipped"]) == 1 and "removed by the office" in again["skipped"][0]["reason"]
      and psql(f"select active::text || ' ' || name from places where id = '{rsid}'") == "false Removable site",
      "the site import skips a removed site with the reason and adds the rest", json.dumps(again))
tool("restore_place", {"id": rsid})
psql(f"update places set active = false where id = '{rsid}'")  # as an undone import leaves it
r = tool("remove_place", {"id": rsid}, expect_error=True)
check("switched off already" in r, "a place switched off by an undone import is not removed (a restore would switch it on)", r)
psql(f"update places set active = true where id = '{rsid}'")
before_base = tool("get_settings")["settings"].get("base_place_id")
tool("update_settings", {"key": "base_place_id", "value": yard["id"]})
ask = tool("remove_place", {"id": yard["id"]})
check(f"{yard_name} is the base place" in ask.get("reasons", []), "the base place asks first", json.dumps(ask))
done = tool("remove_place", {"id": yard["id"], "confirm": True})
check(done.get("base_place_cleared") is True and "base_place_id" not in tool("get_settings")["settings"],
      "removing the base place clears the setting, and says so", json.dumps(done))
tool("restore_place", {"id": yard["id"]})
if before_base:
    tool("update_settings", {"key": "base_place_id", "value": before_base})
tool("cancel_task", {"task_id": yt["task_id"], "reason": "suite: done with the yard"})

print("\n== 6h. Phase 7, Part 3: photos, documents, the request's driver and Tell requester (§4, §5, §6, §28) ==")
card = tool("list_requests", {"status": "all", "id": rq["id"]})["requests"][0]
check(card.get("assigned", {}).get("driver") == "Kasun Silva" and card["assigned"].get("vehicle") == "WP CAR-1182"
      and card["assigned"].get("call") and card["assigned"].get("task_status") == "assigned",
      "an approved request's card names the driver (with Call), the vehicle and the task's state", json.dumps(card.get("assigned"))[:300])
if CHANNEL == "mcp":
    # The shared key has no person behind it: the request has no office account to push to, so the office tells them.
    check(card.get("tell_requester", {}).get("moment") == "approved" and card["tell_requester"]["message"].startswith("Your vehicle for ")
          and card["tell_requester"]["whatsapp"].startswith("https://wa.me/?text="),
          "Tell requester: the approved message, a WhatsApp link that lets the office pick the contact (no phone given)", json.dumps(card.get("tell_requester"))[:300])
ph = tool("update_request", {"request_id": rq["id"], "version": card["version"], "requester_phone": "077 123 4567"})
check(ph["request"]["status"] == "approved" and ph["needs_reapproval"] is False and ph["next"] == "The phone is saved."
      and ph["request"]["requester_phone"] == "077 123 4567",
      "the asker's phone alone keeps an approved booking approved (no re-approval, no push)", json.dumps({k: ph.get(k) for k in ("needs_reapproval", "next")}))
ob = tool("book_vehicle", {"on_behalf_of": "A visitor from Dialog", "requester_phone": "071 555 0199", "date": day(6), "time": "15:00",
                           "route_from": "Head office", "route_to": "Kandy", "driver": "kasun.s", "vehicle": "car1182"})
obc = tool("list_requests", {"status": "all", "id": ob["request"]["id"]})["requests"][0]
check(obc.get("tell_requester", {}).get("moment") == "approved" and obc["tell_requester"]["whatsapp"].startswith("https://wa.me/94715550199?text=")
      and obc.get("requester_phone") == "071 555 0199",
      "Tell requester for a booking made on behalf of someone without an account: to their phone", json.dumps(obc.get("tell_requester"))[:300])
lv = tool("list_vehicles")["vehicles"]
cab = next(v for v in lv if v["reg_no"] == "WP CAB-4521")
check(cab.get("documents_missing") and "insurance" in cab["documents_missing"] and cab["documents_missing_text"].startswith(f"{len(cab['documents_missing'])} documents missing: ")
      and "document_files" not in cab,
      "list_vehicles: a vehicle with no documents lists what is missing", json.dumps({k: cab.get(k) for k in ("documents_missing", "documents_missing_text")}))
fleet_jobs()
na = tool("fleet_overview")["needs_attention"]
check(any(a["kind"] == "documents_missing" and a["subject"].startswith("WP CAB-4521") and a["severity"] == "info" for a in na),
      "one 'documents missing' item per vehicle in the overview (info, no push)", json.dumps([a for a in na if a["kind"] == "documents_missing"])[:300])
if CHANNEL == "mcp":
    code, answer = mcp("tools/call", {"name": "vehicle_document_upload_url", "arguments": {"vehicle": "cab4521", "kind": "insurance",
                                                                                         "content_type": "image/jpeg", "bytes": 100}})
    check("not found" in str(answer.get("error", {}).get("message", "")), "Claude cannot move files: the upload tools are not on the connector",
          json.dumps(answer)[:200])
    code, answer = mcp("tools/list", {})
    names = [t["name"] for t in answer.get("result", {}).get("tools", [])]
    check("photo_upload_url" not in names and "vehicle_document_upload_url" not in names and "vehicle_documents" in names,
          "and the connector does not list them (vehicle_documents is listed)", ",".join(n for n in names if "vehicle" in n))

print("\n== 6j. Phase 7, Part 4: trips a driver starts (driver-api), task history, date ranges, issues (§8, §9, §13) ==")
tag = uuid.uuid4().hex[:6]
PIN_T = "593017"
tool("create_driver", {"name": f"Trip Driver {tag}", "code": f"T{tag}", "username": f"trip.{tag}", "pin": PIN_T, "phone": "0771230099"})
code, ses_t = sign_in(f"trip.{tag}", PIN_T)
tripper = Driver(ses_t["access_token"])
TD = tripper.get("employees?select=id")[1][0]["id"]
DAPI = f"{API}/functions/v1/driver-api"


def dapi(path, body, token=None):
    headers = {"apikey": ANON, "Content-Type": "application/json"}
    if token != "":
        headers["Authorization"] = f"Bearer {token or ses_t['access_token']}"
    return http("POST", f"{DAPI}{path}", headers, body)


code, ans = dapi("/places/search", {"text": "Head office"}, token="")
check(code == 401, "driver-api without a sign-in answers 401", f"{code} {ans}")
if CHANNEL == "api":
    code, ans = dapi("/places/search", {"text": "Head office"}, token=API_TOKEN)
    check(code == 403 and ans.get("error") == "not_a_driver", "an office session is not a driver: 403", f"{code} {ans}")
code, found = dapi("/places/search", {"text": "Head office"})
head = next((r for r in found.get("results", []) if r.get("layer") == "place" and r.get("name", "").startswith("Head office")), None) if code == 200 else None
check(head is not None and head.get("id") and not any(r.get("layer") == "recent" for r in found.get("results", [])),
      "driver-api /places/search: our places first, the office's search box, no 'Used before' (other people's destinations)", json.dumps(found)[:300])
trip_id = str(uuid.uuid4())
code, ans = dapi("/trips", {"id": trip_id, "purpose": "company", "destination": {"text": "Kadawatha"}})
check(code == 409 and ans.get("message") == "Start work first.", "Start a trip needs the driver on duty (409, in words)", f"{code} {ans}")
code, ans = dapi("/trips", {"id": "not-a-uuid", "purpose": "company", "destination": {"text": "Kadawatha"}})
check(code == 400 and ans.get("error") == "bad_input", "a trip id is the phone's uuid", f"{code} {ans}")
plate_t = f"WP TR{tag[:2].upper()}-{int(tag, 16) % 9000 + 1000}"
tool("register_vehicle", {"reg_no": plate_t, "make_model": "Toyota Axio", "vehicle_type": "car", "seats": 4, "current_odometer_km": 1000})
VT = psql(f"select id from vehicles where reg_no = '{plate_t}'")
code, _ = tripper.post("duty_sessions", {"id": str(uuid.uuid4()), "employee_id": TD, "vehicle_id": VT, "device_info": {"brand": "OPPO", "model": "CPH2119"}})
check(code == 201 and psql(f"select current_vehicle_id from employees where id = '{TD}'") == VT, "the trip driver starts work with the new vehicle", f"{code}")
tool("update_settings", {"key": "driver_personal_trips", "value": "off"})
code, ans = dapi("/trips", {"id": trip_id, "purpose": "personal", "destination": {"text": "Kadawatha"}})
check(code == 409 and "switched off" in ans.get("message", ""), "personal trips off: a personal trip is refused in words", f"{code} {ans}")
tool("update_settings", {"key": "driver_personal_trips", "value": "allowed"})
code, made = dapi("/trips", {"id": trip_id, "purpose": "company", "destination": {"place_id": head["id"]}, "note": "Pick up the files"})
trip = made.get("trip", {}) if isinstance(made, dict) else {}
check(code == 201 and trip.get("task_id") == trip_id and trip.get("kind") == "self" and trip.get("status") == "assigned"
      and trip.get("vehicle_id") == VT and len(trip.get("stops", [])) == 1 and trip["stops"][0]["place"].startswith("Head office")
      and trip["title"].startswith("Trip · Head office"),
      "Start a trip: a self task on today's vehicle with one stop at our place, assigned", json.dumps(made)[:400])
code, again = dapi("/trips", {"id": trip_id, "purpose": "company", "destination": {"place_id": head["id"]}})
check(code == 200 and again.get("repeated") is True and psql(f"select count(*) from tasks where id = '{trip_id}'") == "1",
      "the same trip sent again (the offline queue) answers the trip already made", f"{code} {json.dumps(again)[:200]}")
check(psql(f"select (accepted_at is not null and seen_at is not null and reminder_0_sent_at is not null)::text || '|' || created_by || '|' || notes from tasks where id = '{trip_id}'")
      == f"true|driver: Trip Driver {tag}|Pick up the files",
      "accepted, seen and reminded at once; made by the driver; the note kept")
check(psql(f"select count(*) from net.http_request_queue where url like '%/push-task' and convert_from(body, 'UTF8')::jsonb ->> 'task_id' = '{trip_id}'") == "0",
      "no 'new task' push to the driver who started it")
check(psql(f"select count(*) || '|' || count(*) filter (where result_summary like 'refused: %') || '|' || count(*) filter (where result_summary like 'again: %') "
           f"from office_audit where channel = 'driver' and tool = 'start_trip' and actor_name = 'Trip Driver {tag}'") == "4|2|1",
      "every Start a trip call is in the audit log (channel driver, the driver's name): the two refused in words, the repeat as again")
code, ans = dapi("/trips", {"id": str(uuid.uuid4()), "purpose": "company", "destination": {"text": "Kelaniya"}})
check(code == 409 and "Start or cancel your trip" in ans.get("message", ""), "a second trip while the first has not started: refused in words", f"{code} {ans}")
# The offline queue's trip has happened already: its start-time rules are noted on its history, never refused (the phone's
# records of it follow it in the queue).
tool("update_settings", {"key": "driver_personal_trips", "value": "off"})
queued_id = str(uuid.uuid4())
code, ans = dapi("/trips", {"id": queued_id, "purpose": "personal", "destination": {"text": "Kelaniya"}, "queued": True,
                            "at": iso(dt.datetime.now(dt.timezone.utc) - dt.timedelta(minutes=40))})
tool("update_settings", {"key": "driver_personal_trips", "value": "allowed"})
note_q = psql(f"select note from task_assignment_events where task_id = '{queued_id}' and action = 'assigned'")
check(code == 201 and ans.get("trip", {}).get("purpose") == "personal" and "sent later" in note_q and "switched off" in note_q and "had not started" in note_q,
      "a queued trip is taken although personal trips are off and another has not started; both noted on its history", f"{code} {note_q}")
check(not any(i.get("task_id") == queued_id for i in tool("list_issues", {"status": "active", "kind": "late_start"})["issues"]),
      "a trip the driver started (40 minutes ago, sent now) opens no late-start issue")
# The driver cancels a trip started by mistake: no "Task cancelled" push to them; once cancelled it stays so.
code, ans = dapi(f"/trips/{queued_id}/cancel", {})
check(code == 200 and ans.get("trip", {}).get("status") == "cancelled"
      and psql(f"select count(*) from net.http_request_queue where url like '%/push-task' and convert_from(body, 'UTF8')::jsonb ->> 'task_id' = '{queued_id}'") == "0"
      and psql(f"select action || '|' || actor from task_assignment_events where task_id = '{queued_id}' order by at desc limit 1") == f"cancelled|driver: Trip Driver {tag}",
      "Cancel this trip: cancelled by the driver before it started, in its history, no push to them", f"{code} {ans}")
code, ans = dapi(f"/trips/{queued_id}/cancel", {})
check(code == 200 and ans.get("repeated") is True, "cancelling it again answers the cancelled trip", f"{code}")
board = tool("task_board")
card = next((c for c in board.get("assigned", []) if c["id"] == trip_id), {})
check(card.get("kind") == "self" and card.get("purpose") == "company", "task_board: the card says self and company", json.dumps(card)[:300])

# The normal flow on the phone: start, a stop added on the way, arrived and done, complete.
code, _ = tripper.patch(f"tasks?id=eq.{trip_id}", {"status": "in_progress", "start_odometer_km": 1000})
check(code == 200, "the driver starts the trip like any task", f"{code}")
code, ans = dapi("/trips", {"id": str(uuid.uuid4()), "purpose": "company", "destination": {"text": "Kelaniya"}})
check(code == 409 and "first" in ans.get("message", ""), "no second trip while one is under way", f"{code} {ans}")
stop_id = str(uuid.uuid4())
code, st = dapi(f"/trips/{trip_id}/stops", {"id": stop_id, "destination": {"lat": 6.9976, "lng": 79.9259, "name": "Kiribathgoda"}})
check(code == 201 and len(st.get("trip", {}).get("stops", [])) == 2 and st["trip"]["stops"][1]["place"] == "Kiribathgoda",
      "Add a stop on the way: the trip has two stops", json.dumps(st)[:300])
code, st2 = dapi(f"/trips/{trip_id}/stops", {"id": stop_id, "destination": {"text": "Kiribathgoda"}})
check(code == 200 and st2.get("repeated") is True and psql(f"select count(*) from task_stops where task_id = '{trip_id}'") == "2",
      "the same stop again answers the stop already added", f"{code}")
office_task = tool("create_task", {"title": "6j office run", "date": day(3), "start_time": "10:00", "driver": f"trip.{tag}", "vehicle": plate_t,
                                   "pickup": "Head office", "dropoff": "Kandy"})["task_id"]
code, ans = dapi(f"/trips/{office_task}/stops", {"id": str(uuid.uuid4()), "destination": {"text": "Kandy"}})
check(code == 409 and "office" in ans.get("message", ""), "the office's tasks are not changed from the phone", f"{code} {ans}")
tool("cancel_task", {"task_id": office_task, "reason": "suite"})
check(psql(f"select count(*) from net.http_request_queue where url like '%/push-task' and convert_from(body, 'UTF8')::jsonb ->> 'task_id' = '{trip_id}'") == "0",
      "a stop added on the way pushes nothing to the driver")
for sid in psql(f"select id from task_stops where task_id = '{trip_id}' order by seq").split("\n"):
    tripper.patch(f"task_stops?id=eq.{sid}", {"status": "arrived", "arrived_at": iso(dt.datetime.now(dt.timezone.utc)), "arrival_flag": "ok", "arrival_distance_m": 30})
    tripper.patch(f"task_stops?id=eq.{sid}", {"status": "done", "done_at": iso(dt.datetime.now(dt.timezone.utc))})
code, _ = tripper.patch(f"tasks?id=eq.{trip_id}", {"status": "completed", "end_odometer_km": 1012})
check(code == 200 and psql(f"select status || '|' || km from tasks where id = '{trip_id}'") == "completed|12", "completed with 12 km", f"{code}")

# The office: personal, a project, the km apart.
sp = tool("set_trip_purpose", {"task_id": trip_id, "purpose": "personal"})
check(sp["purpose"] == "personal" and sp.get("was") == "company", "set_trip_purpose: switched to personal", json.dumps(sp))
r = tool("set_trip_purpose", {"task_id": trip_id, "purpose": "personal", "project": "internal"}, expect_error=True)
check("no project" in r, "a personal trip has no project", r)
r = tool("set_trip_purpose", {"task_id": T5, "purpose": "personal"}, expect_error=True)
check("Only a trip a driver started" in r, "the office's tasks are company work", r)
today_c = day(0)
ms = tool("mileage_summary", {"from": today_c, "to": today_c, "vehicle": plate_t})
rrow = (ms.get("range", {}).get("vehicles") or [{}])[0]
check(ms.get("range", {}).get("from") == today_c and rrow.get("personal_km") == 12 and rrow.get("task_km") == 0
      and ms["range"]["totals"].get("personal_km") == 12 and ms["month"] == today_c[:7] and ms["vehicles"][0].get("personal_km") == 12
      and "km_allowance" not in rrow and "over_allowance" not in rrow
      and ms["range"].get("personal_by_driver") == [{"driver": f"Trip Driver {tag}", "personal_km": 12, "trips": 1}],
      "mileage_summary for one day: the personal trip's 12 km apart from the task km (and by driver), no monthly allowance in the range, the month beside it",
      json.dumps(ms.get("range"))[:400])
sp2 = tool("set_trip_purpose", {"task_id": trip_id, "purpose": "company", "project": "internal"})
check(sp2["purpose"] == "company" and sp2["project"] == "Fame internal" and psql(f"select count(*) || '|' || coalesce(max(percent)::text, '') from task_projects where task_id = '{trip_id}'") == "1|100.00",
      "back to company with a project: one row, 100 %", json.dumps(sp2))
ms2 = tool("mileage_summary", {"from": today_c, "to": today_c, "vehicle": plate_t})
check((ms2["range"]["vehicles"] or [{}])[0].get("task_km") == 12 and "personal_km" not in ms2["range"]["vehicles"][0], "and its km are task km again",
      json.dumps(ms2["range"]["vehicles"])[:200])
r = tool("mileage_summary", {"from": today_c}, expect_error=True)
check("together" in r, "from without to is refused", r)

# Task history.
hist = tool("list_tasks", {"from": today_c, "to": today_c, "driver": f"trip.{tag}"})
h = next((t for t in hist["tasks"] if t["id"] == trip_id), {})
check(h.get("kind") == "self" and h.get("status") == "completed" and h.get("km") == 12 and h.get("from", "").startswith("Head office") and h.get("to") == "Kiribathgoda"
      and hist["totals"]["driver_started"] >= 1 and all(t["date"] == today_c for t in hist["tasks"]),
      "list_tasks: the day's tasks with kind, km and ends", json.dumps(h)[:300])
check(all(t["kind"] == "self" for t in tool("list_tasks", {"from": today_c, "to": today_c, "kind": "self"})["tasks"]), "list_tasks kind self: only driver-started")
r = tool("list_tasks", {"from": "2024-01-01", "to": today_c}, expect_error=True)
check("too long" in r, "list_tasks: at most 366 days", r)

# Fuel and issues over days.
fl = tool("list_fuel", {"from": today_c, "to": today_c})
check(fl.get("from") == today_c and fl.get("to") == today_c and "month_totals" in fl and fl["month"] == today_c[:7]
      and all(e["at"].startswith(today_c) for e in fl["entries"]),
      "list_fuel for one day: the day's entries, the month's totals beside", json.dumps({k: fl.get(k) for k in ("from", "to", "totals", "month_totals")})[:300])
il = tool("list_issues", {"status": "all", "from": today_c, "to": today_c, "sort": "newest", "limit": 200})
opened = [i["opened"] for i in il["issues"]]
check(il.get("from") == today_c and il.get("sort") == "newest" and opened == sorted(opened, reverse=True) and all(o.startswith(today_c) for o in opened)
      and all(i.get("opened_by") for i in il["issues"]),
      "list_issues for one day, newest first, each with opened_by", json.dumps(il["issues"][:2])[:300])
taken = [i for i in il["issues"] if i.get("assigned_to")]
check(all(i.get("taken_by", {}).get("name") == i["assigned_to"]["name"] for i in taken), "taken_by names the assignee (with when)", json.dumps(taken[:1])[:300])
check(any(i.get("opened_by", "").startswith("System · ") for i in il["issues"]), "the system's issues say 'System · <kind>'")

print("\n== 6k. Hotfix 2: phones, durations, a vehicle on the day, who decided, My trips, the notification centre ==")
import re
import threading

hk = uuid.uuid4().hex[:6]
# D. One way to say when: a request card says when it was asked as "now", "4 min ago", "yesterday 09:00"…
hk_req = tool("create_request", {"requested_by": "Hotfix Two", "date": day(6), "time": "09:30", "route_from": "Head office", "route_to": "Negombo"})
HR = hk_req["request"]["id"]
card = tool("list_requests", {"status": "all", "id": HR})["requests"][0]
check(re.fullmatch(r"now|\d+ min ago", card.get("asked", "")) is not None, "D: a request card says when it was asked in the one formatter's words", card.get("asked"))
check(card.get("live", {}).get("state") == "waiting" and card["live"]["text"] == "Waiting", "A: a waiting request's live state", json.dumps(card.get("live")))

# F. Phones are stored +94…, shown 07X XXX XXXX; every change is logged with who and from / to.
tool("update_driver", {"username": f"trip.{tag}", "phone": "077 123 4567"})
check(psql(f"select phone from employees where id = '{TD}'") == "+94771234567", "F: a driver's number typed 077 123 4567 is stored +94771234567")
ch = psql(f"select coalesce(old_value, '-') || '|' || new_value || '|' || field || '|' || channel from employee_changes where employee_id = '{TD}' order by id desc limit 1")
# Part 3b: the trip driver was made with a number (create_driver needs one).
check(ch == f"+94771230099|+94771234567|phone|{'web' if CHANNEL == 'api' else 'claude'}", "F: the change is logged (from, to, the channel)", ch)
r = tool("update_driver", {"username": f"trip.{tag}", "phone": "12345"}, expect_error=True)
check("Sri Lankan number" in r and psql(f"select phone from employees where id = '{TD}'") == "+94771234567", "F: a number that is not Sri Lankan is refused in words, nothing changed", r)
drv = next(d for d in tool("list_drivers")["drivers"] if d.get("username") == f"trip.{tag}")
check(drv.get("phone_display") == "077 123 4567" and drv.get("call") == "tel:+94771234567" and drv.get("whatsapp") == "https://wa.me/94771234567",
      "F: list_drivers shows 077 123 4567 with tel: and wa.me (the shared key / an admin may see drivers' numbers)", json.dumps({k: drv.get(k) for k in ("phone", "phone_display", "call")}))
r = tool("update_settings", {"key": "office_phone", "value": "011 234 5678"})
check(tool("get_settings")["settings"].get("office_phone") == "+94112345678", "F: Settings → Fleet stores the office's number +94…", json.dumps(r)[:200])
check(tool("list_requests", {"status": "all", "id": HR})["requests"][0].get("office_phone", {}).get("phone_display") == "011 234 5678",
      "F: request cards carry the office's number for Call office")

# J. A task without a named vehicle: only once vehicle_on_the_day is on; the driver's vehicle on the day or any van.
r = tool("create_task", {"title": f"6k on the day {hk}", "date": day(4), "start_time": "08:00", "driver": f"trip.{tag}", "vehicle": "on the day",
                         "pickup": "Head office", "dropoff": "Negombo"}, expect_error=True)
check("switched off" in r and "Vehicle on the day" in r, "J: with the setting off a vehicle 'on the day' is refused, in words (phones on the old update)", r)
tool("update_settings", {"key": "vehicle_on_the_day", "value": True})
od = tool("create_task", {"title": f"6k on the day {hk}", "date": day(4), "start_time": "08:00", "driver": f"trip.{tag}", "vehicle": "on the day",
                          "pickup": "Head office", "dropoff": "Negombo"})
OD = od["task_id"]
check(psql(f"select coalesce(vehicle_id::text, '-') || '|' || vehicle_mode from tasks where id = '{OD}'") == "-|driver_day" and od.get("vehicle_text") == "Vehicle: on the day",
      "J: a task with the driver's vehicle on the day: no vehicle, mode driver_day, 'Vehicle: on the day'", json.dumps({k: od.get(k) for k in ("vehicle", "vehicle_text")}))
bc = next((c for col in ("assigned", "in_progress") for c in tool("task_board", {"date": day(4)}).get(col, []) if c["id"] == OD), {})
check(bc.get("vehicle_text") == "Vehicle: on the day" and not bc.get("vehicle"), "J: the board card says 'Vehicle: on the day'", json.dumps(bc)[:300])
check(tool("task_detail", {"task_id": OD})["task"].get("vehicle_text") == "Vehicle: on the day", "J: task_detail says it too")
plate_v = f"WP HF-{int(hk, 16) % 9000 + 1000}"
tool("register_vehicle", {"reg_no": plate_v, "make_model": "Toyota HiAce", "vehicle_type": "van", "seats": 14, "current_odometer_km": 2000})
VV = psql(f"select id from vehicles where reg_no = '{plate_v}'")
av = tool("create_task", {"title": f"6k any van {hk}", "date": day(4), "start_time": "13:00", "driver": f"trip.{tag}", "vehicle": "any van",
                          "pickup": "Head office", "dropoff": "Kandy"})
AV = av["task_id"]
check(psql(f"select coalesce(vehicle_id::text, '-') || '|' || vehicle_mode || '|' || vehicle_type_wanted from tasks where id = '{AV}'") == "-|any_type|van"
      and av.get("vehicle_text") == "Any van", "J: 'any van': no vehicle, any_type van, 'Any van'", json.dumps({k: av.get(k) for k in ("vehicle", "vehicle_text")}))
code, ans = tripper.post("rpc/confirm_task_vehicle", {"p_task": AV, "p_vehicle": VT}, prefer="return=representation")
check(code == 200 and ans == "wrong_type", "J: the driver confirms a car for 'any van': wrong_type", f"{code} {ans}")
code, ans = tripper.post("rpc/confirm_task_vehicle", {"p_task": AV, "p_vehicle": VV}, prefer="return=representation")
check(code == 200 and ans == "ok" and psql(f"select vehicle_id from tasks where id = '{AV}'") == VV, "J: a van: ok, the task takes it", f"{code} {ans}")
code, ans = tripper.post("rpc/confirm_task_vehicle", {"p_task": OD, "p_vehicle": VT}, prefer="return=representation")
check(code == 200 and ans == "ok", "J: the vehicle the driver holds, for 'on the day': ok", f"{code} {ans}")
other = psql("select id from tasks where employee_id <> '" + TD + "' and status = 'assigned' limit 1")
if other:
    code, ans = tripper.post("rpc/confirm_task_vehicle", {"p_task": other, "p_vehicle": VT}, prefer="return=representation")
    check(code == 200 and ans == "not_yours" and psql(f"select coalesce(vehicle_id::text, '-') from tasks where id = '{other}'") != VT,
          "J: another driver's task: not_yours, nothing changed", f"{code} {ans}")
# The office moves a task back to "on the day": the driver hears it (vehicle_day in the changed push).
ut = tool("update_task", {"task_id": AV, "plan_version": int(psql(f"select plan_version from tasks where id = '{AV}'")), "vehicle": "on the day"})
# The push's words (vehicle_day) are pgTAP's check (phase7_hotfix2); here the task and the tool's answer.
check(psql(f"select vehicle_mode || '|' || coalesce(vehicle_id::text, '-') from tasks where id = '{AV}'") == "driver_day|-"
      and "vehicle" in json.dumps(ut.get("changes", {})),
      "J: back to 'on the day': the vehicle is cleared and the change is named (the driver's 'Task changed' push)", json.dumps(ut)[:300])
code, row = tripper.get(f"tasks?id=eq.{OD}&select=vehicle_mode,vehicle_type_wanted,approved_by_employee_id,approved_at")
check(code == 200 and row and row[0].get("vehicle_mode") == "driver_day", "J: the driver's app reads vehicle_mode on its own task", f"{code} {row}")
for t in (OD, AV):
    tool("cancel_task", {"task_id": t, "reason": "suite: 6k"})
tool("update_settings", {"key": "vehicle_on_the_day", "value": False})

# F, I, K. The driver's contacts for their own task only.
code, cts = tripper.post("rpc/my_task_contacts", {"p_task": OD}, prefer="return=representation")
check(code == 200 and isinstance(cts, dict) and cts.get("office_phone") == "+94112345678", "F: my_task_contacts on the driver's own task: the office's number", f"{code} {str(cts)[:200]}")
if other:
    code, cts2 = tripper.post("rpc/my_task_contacts", {"p_task": other}, prefer="return=representation")
    check(code == 200 and cts2 is None, "F: another driver's task: nothing (no numbers)", f"{code} {cts2}")
code, oc = tripper.post("rpc/my_office_contacts", {}, prefer="return=representation")
check(code == 200 and oc.get("office_phone") == "+94112345678", "F: my_office_contacts for Me: the office's number", f"{code} {str(oc)[:200]}")

# K. One decision per request: a version loaded before someone decided is refused with who decided and when.
v0 = card["version"]
ok = tool("decide_request", {"request_id": HR, "decision": "approve", "driver": f"trip.{tag}", "vehicle": plate_t, "version": v0})
r = tool("decide_request", {"request_id": HR, "decision": "approve", "driver": f"trip.{tag}", "vehicle": plate_t, "version": v0}, expect_error=True)
decider = "Test Admin" if CHANNEL == "api" else psql(f"select decided_by from vehicle_requests where id = '{HR}'")
check(re.fullmatch(rf"Already approved by {re.escape(decider)} at \d\d:\d\d\.", r) is not None, "K: a second decision: 'Already approved by … at HH:MM'", r)
check(psql(f"select count(*) from tasks where request_id = '{HR}'") == "1", "K: one task, never two")
card = tool("list_requests", {"status": "all", "id": HR})["requests"][0]
check(card.get("approved_by", {}).get("name") == decider and re.fullmatch(r"\d\d:\d\d", card["approved_by"].get("at", "")) is not None
      and card.get("live", {}).get("state") == "approved",
      "K: the card says who approved and when; A: its live state is approved", json.dumps({k: card.get(k) for k in ("approved_by", "live")}))
tb = next((c for c in tool("task_board", {"date": day(6)}).get("assigned", []) if c.get("request_id") == HR or c["id"] == card.get("task_id")), {})
if CHANNEL == "api":
    check(tb.get("approved_by", {}).get("name") == "Test Admin", "K: the board card says who sent it", json.dumps(tb.get("approved_by")))
r = tool("decide_request", {"request_id": HR, "decision": "decline", "reason": "late", "version": v0}, expect_error=True)
check(r.startswith(f"Already approved by {decider}"), "K: declining it after it was approved: the same words", r)
tool("cancel_request", {"request_id": HR, "reason": "suite: 6k"})
card = tool("list_requests", {"status": "all", "id": HR})["requests"][0]
check(card.get("cancelled_by", {}).get("reason") == "suite: 6k" and card.get("live", {}).get("state") == "cancelled",
      "K: a cancelled booking says who cancelled it and why", json.dumps({k: card.get(k) for k in ("cancelled_by", "live")}))
# reviewing with the shared key records nothing (no person) but answers.
rv = tool("reviewing", {"request_id": HR})
check(rv.get("reviewing") == [] and rv.get("status") == "cancelled", "K: reviewing answers the others reviewing (none)", json.dumps(rv))

if CHANNEL == "api":
    print("\n== 6k (office-api). Two approvers, My trips, the notification centre, my phone ==")

    def person(name, perms):
        email = f"{name.lower().replace(' ', '.')}.{uuid.uuid4().hex[:5]}@fame.test"
        tool("create_office_user", {"name": name, "email": email, "permissions": perms})
        uid = psql(f"select auth_user_id from employees where email = '{email}'")
        pw = "Hf2-" + uuid.uuid4().hex[:12]
        http("PUT", f"{API}/auth/v1/admin/users/{uid}", {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"}, {"password": pw})
        return email, office_sign_in(email, pw, enrol_totp=False)

    a2_email, a2 = person("Palitha Approver", ["view", "request", "approve", "assign_tasks"])
    rq_email, rq_tok = person("Ruwan Requester", ["view", "request"])
    code, me2 = http("GET", f"{API}/functions/v1/office-api/me", api_headers(a2))
    check(code == 200 and me2.get("phone_required") is True and "phone" not in me2, "F: an approver with no number: /me says phone_required (the banner)", str(me2)[:200])
    code, me3 = http("GET", f"{API}/functions/v1/office-api/me", api_headers(rq_tok))
    check(code == 200 and "phone_required" not in me3 and {"my_trips", "my_inbox", "mark_inbox_read", "update_my_profile"} <= set(me3.get("tools", []))
          and "reviewing" not in me3.get("tools", []),
          "F, A: a requester is not asked for a number; has My trips and the notification centre; no reviewing", str(me3)[:300])
    code, up = api_call(a2, "update_my_profile", {"phone": "0712345678"})
    code2, me2 = http("GET", f"{API}/functions/v1/office-api/me", api_headers(a2))
    check(code == 200 and up["result"].get("phone_display") == "071 234 5678" and me2.get("phone") == "+94712345678" and "phone_required" not in me2,
          "F: My phone number saved +94…; the banner goes", f"{code} {str(up)[:200]}")
    A2 = psql(f"select id from employees where email = '{a2_email}'")
    check(psql(f"select changed_by_name || '|' || new_value from employee_changes where employee_id = '{A2}' order by id desc limit 1") == "Palitha Approver|+94712345678",
          "F: the person's own change is logged in their name")
    # Privacy: a requester sees no driver's number on Live or the drivers list.
    code, ld = api_call(rq_tok, "live_drivers", {})
    code2, dl = api_call(rq_tok, "list_drivers", {})
    check(code == 200 and code2 == 200 and not any(d.get("links", {}).get("call") for d in ld["result"]["drivers"])
          and not any(d.get("phone") or d.get("call") for d in dl["result"]["drivers"]),
          "F: someone who only views and asks sees no driver's number on Live or the drivers list", f"{code} {code2}")
    # The requester asks; both approvers have it in their notification centre (no browser needed); urgent.
    code, made = api_call(rq_tok, "create_request", {"date": day(7), "time": "10:00", "route_from": "Head office", "route_to": "Galle"})
    RR = made["result"]["request"]["id"]
    code, inbox = api_call(a2, "my_inbox", {"limit": 5})
    it = next((i for i in inbox["result"]["items"] if i.get("url") == f"/requests/{RR}"), {})
    check(code == 200 and it.get("event") == "request.created" and it.get("kind") == "urgent" and it.get("read") is False and inbox["result"]["unread"] >= 1
          and re.fullmatch(r"now|\d+ min ago", it.get("ago", "")) is not None,
          "A: a new request is in every approver's notification centre (urgent, unread, 'now')", json.dumps(it)[:300])
    check(psql(f"select count(*) from office_inbox i join employees e on e.id = i.employee_id where i.url = '/requests/{RR}' and e.email in ('{a2_email}', '{admin_email}')") == "2",
          "A: both approvers have the row, with or without a browser")
    # Two approvers on the decide page: each sees the other reviewing.
    api_call(API_TOKEN, "reviewing", {"request_id": RR})
    code, rv2 = api_call(a2, "reviewing", {"request_id": RR})
    check(code == 200 and [x["name"] for x in rv2["result"]["reviewing"]] == ["Test Admin"], "K: Palitha sees 'Test Admin is reviewing'", json.dumps(rv2)[:200])
    code, lr = api_call(API_TOKEN, "list_requests", {"id": RR, "status": "all"})
    check([x["name"] for x in lr["result"]["requests"][0].get("reviewing", [])] == ["Palitha Approver"],
          "K: the admin's queue card says Palitha is reviewing (not themselves)", json.dumps(lr["result"]["requests"][0].get("reviewing")))
    ver = lr["result"]["requests"][0]["version"]
    # Both approve at the same moment: one decision, the other told who.
    answers = {}

    def decide_as(who, token):
        answers[who] = api_call(token, "decide_request", {"request_id": RR, "decision": "approve", "driver": f"trip.{tag}", "vehicle": plate_t, "version": ver})

    threads = [threading.Thread(target=decide_as, args=(w, t)) for w, t in (("admin", API_TOKEN), ("palitha", a2))]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    codes = sorted(a[0] for a in answers.values())
    loser = next((a[1] for a in answers.values() if a[0] == 409), {})
    winner = psql(f"select decided_by from vehicle_requests where id = '{RR}'")
    check(codes == [200, 409] and psql(f"select count(*) from tasks where request_id = '{RR}'") == "1"
          and re.fullmatch(rf"Already approved by {re.escape(winner)} at \d\d:\d\d\.", loser.get("error", "")) is not None,
          "K: two approvers at once: one decision, one task; the other gets 'Already approved by … at …'", f"{codes} {loser}")
    # The requester: told in their notification centre, My trips shows it approved with who and the driver.
    code, rin = api_call(rq_tok, "my_inbox", {"unread": True})
    dec = next((i for i in rin["result"]["items"] if i.get("event") == "request.decided"), {})
    check(code == 200 and dec.get("title", "").startswith(f"Request approved by {winner}") and dec.get("who") == winner and dec.get("kind") == "alert",
          "A: the requester's notification centre: 'Request approved by …' (alert, who)", json.dumps(dec)[:300])
    code, mt = api_call(rq_tok, "my_trips", {"from": day(0), "to": day(10)})
    trip_c = next((t for t in mt["result"]["trips"] if t["id"] == RR), {})
    check(code == 200 and trip_c.get("live", {}).get("state") == "approved" and trip_c.get("approved_by", {}).get("name") == winner
          and trip_c.get("assigned", {}).get("driver") == f"Trip Driver {tag}" and trip_c["assigned"].get("call") == "tel:+94771234567",
          "A, F: My trips: approved, by whom, the driver with Call (their own trip)", json.dumps({k: trip_c.get(k) for k in ("live", "approved_by", "assigned")})[:400])
    code, mt_w = api_call(rq_tok, "my_trips", {"from": day(0), "to": day(10), "status": "waiting"})
    check(code == 200 and not any(t["id"] == RR for t in mt_w["result"]["trips"]), "A: My trips filtered to waiting leaves it out")
    code, mt_bad = api_call(rq_tok, "my_trips", {"from": "2024-01-01", "to": day(10)})
    check(code == 409 and "year" in mt_bad.get("error", ""), "A: My trips takes at most a year", f"{code} {mt_bad}")
    # The driver accepts, starts: the live state follows.
    TT = psql(f"select id from tasks where request_id = '{RR}'")
    tripper.post("rpc/accept_task", {"p_task_id": TT, "p_at": iso(dt.datetime.now(dt.timezone.utc))})
    code, mt = api_call(rq_tok, "my_trips", {"from": day(0), "to": day(10)})
    st = next((t for t in mt["result"]["trips"] if t["id"] == RR), {}).get("live", {})
    check(st.get("state") == "accepted" and st.get("text", "").startswith("Driver accepted · "), "A: the driver accepts: 'Driver accepted · HH:MM'", json.dumps(st))
    # Read: one item, then all.
    code, mk = api_call(rq_tok, "mark_inbox_read", {"ids": [dec["id"]]})
    check(code == 200 and mk["result"]["marked"] == 1, "A: opening an item marks it read", str(mk)[:200])
    code, mk = api_call(rq_tok, "mark_inbox_read", {"all": True})
    code2, rin = api_call(rq_tok, "my_inbox", {})
    check(code == 200 and rin["result"]["unread"] == 0 and all(i["read"] for i in rin["result"]["items"]), "A: Mark all read: nothing unread", str(rin)[:200])
    # RLS: a person reads their own inbox rows only (the web's Realtime bell).
    code, rows = http("GET", f"{API}/rest/v1/office_inbox?select=employee_id", api_headers(rq_tok))
    RQ_ID = psql(f"select id from employees where email = '{rq_email}'")
    check(code == 200 and rows and all(r["employee_id"] == RQ_ID for r in rows), "A: the requester reads only their own notification rows", f"{code} {len(rows or [])}")
    # B. The office site's sounds per person.
    code, ns = api_call(rq_tok, "my_notification_settings", {})
    check(code == 200 and ns["result"].get("sound") == {"on": True, "volume": 70}, "B: sounds on at 70 by default", str(ns["result"].get("sound")))
    code, ns = api_call(rq_tok, "set_my_notification_settings", {"sound": {"volume": 40}})
    check(code == 200 and ns["result"].get("sound") == {"on": True, "volume": 40}, "B: the volume saved (sound stays on)", str(ns["result"].get("sound")))
    api_call(API_TOKEN, "cancel_request", {"request_id": RR, "reason": "suite: 6k api"})

print("\n== 6l. Hotfix 3: lists a page at a time, missed tasks, expiry, snooze, the Overview's sections ==")
hl = uuid.uuid4().hex[:6]

# L3. Paging: limit gives total and next; the next page continues where the first stopped; no limit answers as before.
p1 = tool("list_places", {"limit": 2})
p2 = tool("list_places", {"limit": 2, "cursor": p1.get("next", "")}) if p1.get("next") else {"places": []}
check(p1.get("total", 0) > 2 and p1.get("next") and len(p1["places"]) == 2 and p2["places"]
      and not {x["id"] for x in p1["places"]} & {x["id"] for x in p2["places"]},
      "L3: list_places pages: total, next, the second page continues", json.dumps({k: p1.get(k) for k in ("total", "next", "count")}))
r1 = tool("list_requests", {"status": "all", "limit": 1})
check(r1.get("total", 0) >= 2 and r1.get("next") and len(r1["requests"]) == 1, "L3: list_requests pages", json.dumps({k: r1.get(k) for k in ("total", "next")}))
r2 = tool("list_requests", {"status": "all", "limit": 1, "cursor": r1["next"]})
check(r2["requests"] and r2["requests"][0]["id"] != r1["requests"][0]["id"], "L3: list_requests' next page is the next request")
check("total" not in tool("list_requests", {"status": "all"}), "L3: without limit list_requests answers as before (no total)")
t1 = tool("list_tasks", {"from": day(-30), "to": day(30), "limit": 2})
t2 = tool("list_tasks", {"from": day(-30), "to": day(30), "limit": 2, "cursor": t1.get("next", "")}) if t1.get("next") else t1
check(t1.get("total", 0) > 2 and len(t1["tasks"]) == 2 and t1["totals"] == t2["totals"],
      "L3: list_tasks pages; the totals are the whole range's on every page", json.dumps({k: t1.get(k) for k in ("total", "totals")}))
i1 = tool("list_issues", {"status": "all", "limit": 1})
check(i1.get("total", 0) >= 1 and len(i1["issues"]) == 1, "L3: list_issues pages", json.dumps({k: i1.get(k) for k in ("total", "next")}))
drv = tool("list_drivers", {"search": "nuwan", "limit": 5})
check(drv.get("total", 0) >= 1 and all("nuwan" in (d.get("username") or "") or "Nuwan" in d["name"] for d in drv["drivers"]),
      "L3: list_drivers searches", json.dumps({k: drv.get(k) for k in ("total",)}))
vh = tool("list_vehicles", {"search": "cab", "limit": 5})
check(vh.get("total", 0) >= 1 and all("CAB" in v["reg_no"] or "cab" in (v.get("make_model") or "").lower() for v in vh["vehicles"]),
      "L3: list_vehicles searches", json.dumps({k: vh.get(k) for k in ("total",)}))

# The board's columns page; a column's next page alone.
board_day = psql("select to_char(start_at at time zone 'Asia/Colombo', 'YYYY-MM-DD') from tasks where status = 'assigned' "
                 "group by 1 having count(*) >= 2 order by 1 desc limit 1")
if board_day:
    b1 = tool("task_board", {"date": board_day, "limit": 1})
    check(len(b1["assigned"]) == 1 and b1["totals"]["assigned"] >= 2 and b1["next"]["assigned"],
          "L3: task_board: a column holds a page; totals and next per column", json.dumps({k: b1.get(k) for k in ("totals", "next")}))
    b2 = tool("task_board", {"date": board_day, "limit": 1, "column": "assigned", "cursor": b1["next"]["assigned"]})
    check(set(b2.keys()) >= {"assigned", "totals"} and b2["assigned"][0]["id"] != b1["assigned"][0]["id"],
          "L3: task_board column: the column's next page alone", json.dumps(list(b2.keys())))

# L2. Missed: a task never started, its leave-by over a day ago; its late-start issue expires, a Missed task issue opens.
mt = tool("create_task", {"title": f"6l never started {hl}", "date": day(3), "start_time": "09:00", "driver": "nuwan.p", "vehicle": "cab4521",
                          "pickup": "Head office", "dropoff": "Kandy"})
MT = mt["task_id"]
psql(f"update tasks set start_at = now() - interval '40 minutes', leave_by = now() - interval '40 minutes' where id = '{MT}'")
fleet_jobs()
late = psql(f"select count(*) from issues where task_id = '{MT}' and kind = 'late_start' and status in ('open', 'in_progress')")
check(late == "1", "L2: forty minutes late: a late-start issue", late)
psql(f"update tasks set start_at = now() - interval '2 days', leave_by = now() - interval '2 days' where id = '{MT}'")
fleet_jobs()
check(psql(f"select status from tasks where id = '{MT}'") == "missed", "L2: two days late: the task is missed")
check(psql(f"select resolution_note from issues where task_id = '{MT}' and kind = 'late_start' order by opened_at desc limit 1").startswith("Expired"),
      "L2: its late-start issue expired by itself")
check(psql(f"select count(*) from issues where task_id = '{MT}' and kind = 'missed_task' and status = 'open'") == "1",
      "L2: one Missed task issue, until someone resolves it")
# A vehicle problem reported during that task is not the task's: it stays until a person closes it (the reviewer's find).
NUWAN = psql("select id from employees where username = 'nuwan.p'")
CAB = psql("select id from vehicles where reg_no = 'WP CAB-4521'")
rep6l = psql(f"insert into vehicle_reports (vehicle_id, employee_id, task_id, category, note) values ('{CAB}', '{NUWAN}', '{MT}', 'breakdown', "
             f"'6l engine stopped {hl}') returning id")
fleet_jobs()
check(psql(f"select status from issues where vehicle_report_id = '{rep6l}'") == "open",
      "L2: a breakdown reported during a task that is over stays open (only the task's own issues expire)")
check(any(r["id"] == rep6l for r in tool("list_vehicle_reports", {"search": f"engine stopped {hl}", "limit": 5})["reports"])
      and tool("list_vehicle_reports", {"search": "nothing-like-this-6l", "limit": 5})["total"] == 0,
      "L3: list_vehicle_reports searches the note")
psql(f"update vehicle_reports set status = 'closed', closed_at = now() where id = '{rep6l}'")
hist = tool("list_tasks", {"from": day(-3), "to": day(0), "status": "missed"})
check(any(t["id"] == MT for t in hist["tasks"]), "L2: History lists it as missed")

# L2. Snooze: out of the Overview and the counts until then; back with snooze null.
mi = psql(f"select id from issues where task_id = '{MT}' and kind = 'missed_task'")
sn = tool("update_issue", {"id": mi, "snooze": "tomorrow"})
check(re.fullmatch(r"\d{4}-\d\d-\d\d 07:00", sn["issue"].get("snoozed_until", "")) is not None, "L2: snoozed until 07:00 tomorrow",
      json.dumps(sn["issue"].get("snoozed_until")))
ov = tool("fleet_overview")
in_overview = any(mi in g["issue_ids"] for g in ov.get("attention", {}).get("groups", [])) or any(a.get("issue_id") == mi for a in ov["needs_attention"])
check(not in_overview and any(i["id"] == mi for i in tool("list_issues", {"snoozed": True})["issues"]),
      "L2: a snoozed issue leaves the Overview; Issues lists it under Snoozed")
tool("update_issue", {"id": mi, "snooze": None})
check(any(mi in g["issue_ids"] for g in tool("fleet_overview")["attention"]["groups"]), "L2: snooze ended: back on the Overview")
tool("update_issue", {"id": mi, "status": "resolved", "note": "suite: 6l"})

# L1, L2. The Overview's sections: no repeats, info left out, the critical ones apart.
ov = tool("fleet_overview")
kinds = {g["kind"] for g in ov["attention"]["groups"]}
check(not kinds & {"request_waiting", "not_accepted", "declined"} and all(g["severity"] in ("critical", "warning") for g in ov["attention"]["groups"])
      and not any(g["severity"] == "critical" for g in ov["attention"]["groups"]) and "critical" in ov,
      "L1, L2: Needs attention: no requests waiting or needs-a-driver items, no info, the critical ones in their own section",
      json.dumps(sorted(kinds)))
multi = [g for g in ov["attention"]["groups"] if g["count"] > 1]
check(all(len(g["items"]) == g["count"] == len(g["issue_ids"]) for g in multi), "L2: a group holds its items and their ids",
      json.dumps([(g["title"], g["count"]) for g in multi])[:200])

# L2. No allowance set: no check, and the vehicle says so.
psql("update vehicles set monthly_km_allowance = 0 where reg_no = 'WP PH-2087'")
card = next(v for v in tool("list_vehicles", {"search": "PH-2087"})["vehicles"])
check(card.get("km_allowance_note") == "no km allowance set" and not card.get("over_allowance"), "L2: allowance 0: 'no km allowance set', never over it",
      json.dumps({k: card.get(k) for k in ("km_allowance", "km_allowance_note", "over_allowance")}))
check(psql("select count(*) from issues where kind = 'allowance' and status in ('open','in_progress') and detail like 'WP PH-2087%'") == "0",
      "L2: and no allowance issue")

if CHANNEL == "api":
    print("\n== 6l (office-api). My trips with the tasks I created, the page preferences, the archived notifications ==")
    made = tool("create_task", {"title": f"6l mine {hl}", "date": day(2), "start_time": "10:00", "driver": "nuwan.p", "vehicle": "cab4521",
                                "pickup": "Head office", "dropoff": "Galle"})
    mt_all = tool("my_trips", {"from": day(0), "to": day(5), "include": "all"})
    mine = next((t for t in mt_all["trips"] if t.get("id") == made["task_id"]), {})
    check(mine.get("source") == "task" and mine.get("live", {}).get("state") == "approved" and mine.get("live", {}).get("text") == "Sent to the driver",
          "My trips lists a task the person created (source task, its live state)", json.dumps(mine)[:300])
    check(not any(t.get("source") == "task" for t in tool("my_trips", {"from": day(0), "to": day(5)})["trips"]),
          "My trips without include answers as before (the requests only)")
    found = tool("my_trips", {"from": day(0), "to": day(5), "include": "all", "search": "galle", "limit": 50})
    none = tool("my_trips", {"from": day(0), "to": day(5), "include": "all", "search": "nothing-like-this-6l", "limit": 5})
    check(any(t.get("id") == made["task_id"] for t in found["trips"]) and none["total"] == 0 and not none["trips"],
          "My trips searches the route", json.dumps({"found": found.get("total"), "none": none.get("total")}))
    only_req = tool("my_trips", {"from": day(0), "to": day(5), "include": "requests"})
    only_tasks = tool("my_trips", {"from": day(0), "to": day(5), "include": "tasks", "limit": 1})
    check(not any(t.get("source") == "task" for t in only_req["trips"]) and all(t.get("source") == "task" for t in only_tasks["trips"])
          and only_tasks.get("total", 0) >= 1, "My trips' filter: requests only, tasks only (paged)")
    tool("cancel_task", {"task_id": made["task_id"], "reason": "suite: 6l"})
    p = tool("set_my_prefs", {"prefs": {"overview_collapsed": ["road", "tiles"]}})
    p = tool("set_my_prefs", {"prefs": {"menu_collapsed": ["reports"]}})
    check(tool("my_prefs")["prefs"] == {"overview_collapsed": ["road", "tiles"], "menu_collapsed": ["reports"]},
          "the page preferences are kept per person and merged", json.dumps(p))
    # Hotfix O2-H2 (Part 2): the notification pause is kept with them, and null clears it.
    rec = {"at": "2026-10-20T08:00:00.000Z", "saved": {"request.created": True, "task.declined": False}}
    tool("set_my_prefs", {"prefs": {"notifications_paused": rec}})
    kept = tool("my_prefs")["prefs"]
    tool("set_my_prefs", {"prefs": {"notifications_paused": None}})
    cleared = tool("my_prefs")["prefs"]
    check(kept.get("notifications_paused") == rec and kept.get("menu_collapsed") == ["reports"] and cleared.get("notifications_paused") is None,
          "the notification pause is kept with the preferences (what each event was), and null clears it", json.dumps(kept)[:200])
    ADMIN_ID = psql(f"select id from employees where email = '{admin_email}'")
    psql(f"insert into office_inbox (employee_id, event, title, url, created_at, read_at) values ('{ADMIN_ID}', 'request.decided', "
         f"'6l old {hl}', '/requests', now() - interval '40 days', now() - interval '39 days')")
    tray = tool("my_inbox", {"limit": 100})
    hist_in = tool("my_inbox", {"limit": 100, "archived": True})
    check(not any(i["title"] == f"6l old {hl}" for i in tray["items"]) and any(i["title"] == f"6l old {hl}" for i in hist_in["items"]),
          "L4: a read notification over 30 days old leaves the tray, stays in the history")

print("\n== 6m. Part 3b: the driver's profile, availability, the Drivers board, asking drivers, running late ==")
pb = uuid.uuid4().hex[:6]
PIN_B = "604213"


def rpc_as(drv, fn, args):
    """A driver's RPC, as the app calls it (PostgREST /rpc)."""
    return http("POST", f"{API}/rest/v1/rpc/{fn}", drv.h, args)


# G. A driver always has a number; the driver keeps their own profile (driver-api /profile), every change logged as theirs.
r = tool("create_driver", {"name": f"P3b {pb}", "code": f"B{pb}", "username": f"p3b.{pb}", "pin": PIN_B}, expect_error=True)
check("phone" in r.lower(), "G: create_driver without a phone is refused", r[:200])
# Named so the contract snapshot's first driver (by name) stays Kasun Silva.
tool("create_driver", {"name": f"Ruwan P3b {pb}", "code": f"B{pb}", "username": f"p3b.{pb}", "pin": PIN_B, "phone": "0771112233"})
code, ses_b = sign_in(f"p3b.{pb}", PIN_B)
kb = Driver(ses_b["access_token"])
KB = kb.get("employees?select=id")[1][0]["id"]
UB = f"p3b.{pb}"
code, ans = dapi("/profile", {"whatsapp": "0712223344", "emergency_name": "Nimali", "emergency_relation": "wife",
                              "emergency_phone": "0773334455", "licence_no": "B7654321", "licence_expiry": day(200)}, token=ses_b["access_token"])
check(code == 200 and ans["profile"]["whatsapp"] == "+94712223344" and ans["profile"]["emergency_phone"] == "+94773334455"
      and set(ans["saved"]) == {"whatsapp", "emergency_name", "emergency_relation", "emergency_phone", "licence_no", "licence_expiry"},
      "G: the driver saves their profile through driver-api (numbers stored +94…)", json.dumps(ans)[:300])
code, ans = dapi("/profile", {"phone": None}, token=ses_b["access_token"])
check(code == 409 and "phone" in ans.get("message", ""), "G: the driver cannot clear their phone", json.dumps(ans)[:200])
code, ans = dapi("/profile", {"whatsapp": "12"}, token=ses_b["access_token"])
check(code == 409 and "whatsapp" in ans.get("message", ""), "G: a number that is not Sri Lankan is refused in words", json.dumps(ans)[:200])
lic = f"{KB}/licence/{uuid.uuid4()}.jpg"
c1, _ = kb.upload(lic, TINY_JPEG)
pid = str(uuid.uuid4())
c2, _ = kb.post("photos", {"id": pid, "employee_id": KB, "kind": "licence", "storage_path": lic})
c3, res = rpc_as(kb, "set_my_licence_photo", {"p_side": "front", "p_photo_id": pid})
check((c1, c2, c3, res) == (200, 201, 200, "ok"), "G: the driver adds the front of their licence (their own licence folder)", f"{c1} {c2} {c3} {res}")
prof = tool("driver_profile", {"driver": UB})
check(prof.get("emergency", {}).get("name") == "Nimali" and prof.get("licence", {}).get("number") == "B7654321"
      and (prof.get("licence", {}).get("front_url") or "").startswith("http")
      and any(c.get("by_driver") and c["field"] == "whatsapp" for c in prof.get("changes", []))
      and prof["driver"]["links"]["whatsapp"] == "https://wa.me/94712223344" and "licence expiry" not in prof["missing"],
      "G: driver_profile: the emergency contact, the licence with its photo, 'changed by the driver', WhatsApp to the WhatsApp number",
      json.dumps({k: prof.get(k) for k in ("emergency", "licence", "missing")})[:400])
upd = tool("update_driver", {"username": UB, "emergency_relation": "brother"})
check(psql(f"select changed_by_name || '|' || channel from employee_changes where employee_id = '{KB}' and field = 'emergency_relation' "
           "order by at desc limit 1").endswith("|" + ("web" if CHANNEL == "api" else "claude")),
      "G: an office change is logged with the office person's name and channel")

# H1. Not available: the driver's own entry, the office's, Who's available, the warning, the board's week.
code, res = rpc_as(kb, "set_my_unavailability", {"p_id": None, "p_from": day(1), "p_to": None, "p_part": "morning", "p_start": None,
                                                 "p_end": None, "p_reason": "half_day", "p_note": "doctor"})
check(code == 200 and res.get("result") == "ok", "H1: the driver is not available tomorrow morning", json.dumps(res)[:200])
code, res = rpc_as(kb, "set_my_unavailability", {"p_id": None, "p_from": day(-1), "p_to": None, "p_part": "full_day", "p_start": None,
                                                 "p_end": None, "p_reason": "leave", "p_note": None})
check(res.get("result") == "refused" and "passed" in res.get("reason", ""), "H1: a day that has passed is refused in words", json.dumps(res)[:200])
av = tool("availability", {"at": f"{day(1)} 10:00", "until": "12:00"})
row = next((d for d in av["drivers"] if d.get("username") == UB), {})
check(row.get("free") is False and row.get("not_available") == "Not available · half day, back 13:00"
      and (av.get("best") or {}).get("username") != UB and not any(d["username"] == UB for d in av["vehicles"]["drivers_free"]),
      "H1: Who's available: not free then, never the best match, not among the free drivers", json.dumps(row)[:300])
av2 = tool("availability", {"at": f"{day(1)} 14:00", "until": "16:00"})
check(next(d for d in av2["drivers"] if d.get("username") == UB).get("free") is True, "H1: free again in the afternoon")
tk = tool("create_task", {"title": f"6m late {pb}", "date": day(1), "start_time": "10:00", "driver": UB, "vehicle": "cab4521",
                          "pickup": "Head office", "dropoff": "Kandy"})
TKB = tk["task_id"]
check(any(w.startswith("Ruwan is not available then · half day, back 13:00") for w in tk.get("warnings", [])),
      "H1: the assign warning names it ('Ruwan is not available then · half day, back 13:00')", json.dumps(tk.get("warnings"))[:300])
se = tool("set_unavailability", {"driver": UB, "date": day(3), "to_date": day(4), "part": "full_day", "reason": "leave", "note": "wedding"})
check(se["entry"]["text"].startswith("Not available · leave until") and se["saved"] == "added", "H1: the office adds two days of leave",
      json.dumps(se)[:300])
code, mine = kb.get("driver_unavailability?select=id,part,channel&removed_at=is.null&order=starts_at")
check(code == 200 and len(mine) == 2 and mine[1]["channel"] != "driver", "H1: the driver reads both entries, one added by the office", str(mine)[:200])
check(tool("unavailability", {"from": day(0), "to": day(7), "driver": UB})["count"] == 2, "H1: unavailability lists them")
tool("remove_unavailability", {"id": se["entry"]["id"]})
check(tool("unavailability", {"from": day(0), "to": day(7), "driver": UB})["count"] == 1
      and psql(f"select removed_by_name is not null from driver_unavailability where id = '{se['entry']['id']}'") == "t",
      "H1: removed, and kept as removed with who removed it")
bd = tool("drivers_board", {"week_from": day(0), "search": UB})
brow = next((d for d in bd["drivers"] if d.get("username") == UB), {})
wk = next((d for d in bd["week"]["drivers"] if d.get("username") == UB), {"days": []})
check(brow.get("status", {}).get("kind") == "off_duty" and brow.get("links", {}).get("whatsapp") == "https://wa.me/94712223344"
      and [dd["date"] for dd in wk["days"] if dd["not_available"]] == [day(1)] and any(dd["tasks"] for dd in wk["days"]) and bd["counts"]["all"] >= 1,
      "H5: the board's row (status, WhatsApp) and the week view (the task and the morning off)", json.dumps({"row": brow, "week": wk})[:400])

# H3. A question with one-tap answers: the push, the answer, ask_answers, the asker's notification.
ask = tool("ask_drivers", {"kind": "free_for_trip", "drivers": [UB], "date": day(1), "from": "14:00", "to": "16:00", "note": "Kandy, 3 people"})
AID = ask["ask"]["id"]
check(ask["ask"]["question"].startswith("Free for a trip") and ask["ask"]["counts"]["asked"] == 1, "H3: ask_drivers asks one driver",
      json.dumps(ask)[:300])
# The database sends it (driver_ask_answers_push → send_push; pgTAP checks that); here push-task is called the same way.
code, res = http("POST", f"{API}/functions/v1/push-task", {"Content-Type": "application/json", "x-server-key": SERVER_KEY},
                 {"task_id": None, "kind": "ask", "employee_id": KB, "ask_id": AID})
code_bad, _ = http("POST", f"{API}/functions/v1/push-task", {"Content-Type": "application/json", "x-server-key": SERVER_KEY},
                   {"task_id": None, "kind": "ask", "employee_id": KB, "ask_id": str(uuid.uuid4())})
check(code == 200 and res.get("reason") == "no_token" and code_bad == 404
      and psql(f"select count(*) from push_log where kind = 'ask' and employee_id = '{KB}'") == "1",
      "H3: push-task takes the question (kind ask; this driver has no phone registered); an unknown question is 404", f"{code} {res} {code_bad}")
code, res = rpc_as(kb, "answer_ask", {"p_ask_id": AID, "p_answer": "yes"})
check(res == "ok", "H3: the driver answers Yes", str(res))
aa = tool("ask_answers", {"ask_id": AID})["ask"]
check(aa["drivers"][0].get("answer") == "yes" and aa["drivers"][0].get("assignable") is True and aa["counts"]["yes"] == 1,
      "H3: ask_answers shows the Yes, ready to assign", json.dumps(aa)[:300])
ask2 = tool("ask_drivers", {"kind": "where_now", "drivers": [UB]})["ask"]
code, res = rpc_as(kb, "answer_ask", {"p_ask_id": ask2["id"], "p_answer": "location", "p_lat": 6.9271, "p_lng": 79.8612, "p_accuracy": 12})
loc = tool("ask_answers", {"ask_id": ask2["id"]})["ask"]["drivers"][0].get("location", {})
check(res == "ok" and loc.get("map", "").startswith("https://www.google.com/maps") and loc.get("near"),
      "H3: 'Where are you now?': one point shared, with the nearest town and a map link", json.dumps(loc)[:200])
r = tool("ask_drivers", {"kind": "free_for_trip", "drivers": [UB], "date": day(-1), "from": "09:00"}, expect_error=True)
check("passed" in r, "H3: a trip time that has passed is refused", r[:200])
recent = tool("ask_answers", {"limit": 5})
check(recent.get("total", 0) >= 2 and recent["asks"][0]["id"] == ask2["id"], "H3: the questions of the last 7 days, newest first")
if CHANNEL == "api":
    check(psql(f"select count(*) from office_inbox where employee_id = '{ADMIN_ID}' and event = 'ask.answered'") == "2",
          "H3: the person who asked hears each answer (the notification centre)")

# H4. Running late: kept on the task, on the board and the task page, a history event.
code, res = rpc_as(kb, "report_running_late", {"p_task_id": TKB, "p_minutes": 15})
check(res == "ok", "H4: the driver says they are running late 15 min", str(res))
td = tool("task_detail", {"task_id": TKB})
card = next((c for c in tool("task_board", {"date": day(1)})["assigned"] if c["id"] == TKB), {})
check(td["task"].get("late_report", {}).get("text", "").startswith("Running late 15 min · said") and card.get("late_report", {}).get("min") == 15
      and psql(f"select count(*) from task_assignment_events where task_id = '{TKB}' and action = 'running_late'") == "1",
      "H4: on the task page and the board's card, with a history event", json.dumps(td["task"].get("late_report")))
tool("cancel_task", {"task_id": TKB, "reason": "suite: 6m"})

if CHANNEL == "api":
    print("\n== 7. The same answers through office-api as through the connector ==")
    shapes = subprocess.run([sys.executable, "-I", os.path.join(os.path.dirname(os.path.abspath(__file__)), "snapshot-tool-shapes.py"), "--check"],
                            env={**os.environ, "CHANNEL": "api", "API_TOKEN": API_TOKEN}, capture_output=True, text=True)
    check(shapes.returncode == 0, "every read tool's JSON through office-api has the same shape as the connector's contract (scripts/tool-shapes.json)",
          "\n".join(l for l in shapes.stdout.splitlines() if "FAIL" in l or "missing:" in l or "new:" in l)[:1500] + shapes.stderr[-300:])

    print("\n== 8. Roles: a staff member on office-api ==")
    staff_email = f"staff.{uuid.uuid4().hex[:6]}@fame.test"
    created = tool("create_office_user", {"name": "Test Staff", "email": staff_email, "permissions": ["request"]})
    check(created["created"]["role"] == "staff" and created["set_password_link"].startswith("http") and "token" in created["set_password_link"],
          "create_office_user returns a one-time set-password link (no password typed anywhere)", str(created)[:200])
    # The person would open the link; the test sets the password through the admin API instead.
    staff_uid = psql(f"select auth_user_id from employees where email = '{staff_email}'")
    staff_pw = "St4ff-" + uuid.uuid4().hex[:10]
    code, _ = http("PUT", f"{API}/auth/v1/admin/users/{staff_uid}", {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"}, {"password": staff_pw})
    staff_token = office_sign_in(staff_email, staff_pw, enrol_totp=False)
    code, me = http("GET", f"{API}/functions/v1/office-api/me", api_headers(staff_token))
    check(code == 200 and me.get("role") == "staff" and me.get("permissions") == ["view", "request"]
          and sorted(me.get("tools", [])) == ["cancel_request", "create_request", "find_project", "fleet_overview", "get_settings", "google_place",
                                             "list_drivers", "list_places", "list_requests", "list_vehicles", "live_drivers", "mark_inbox_read",
                                             "my_inbox", "my_notification_settings", "my_prefs", "my_trips", "place_detail", "plan_task",
                                             "register_map_load", "register_web_push", "remove_web_push", "save_place", "search_places",
                                             "set_my_notification_settings", "set_my_prefs", "task_detail", "update_my_profile", "update_request",
                                             "watch_drivers"]
          and me.get("map") == {"package": "open", "places": False},
          "a requester signs in without a second step and sees the request tools plus view's (any permission implies view, Phase 7 §12; the map: open with no keys)",
          f"{code} {str(me)[:200]}")
    code, body = api_call(staff_token, "task_board", {})
    check(code == 403, "staff cannot see the task board (403)", f"{code} {body}")
    code, body = api_call(staff_token, "get_settings", {})
    check(code == 200 and body["result"]["settings"]["self_drive_allowed"] is True, "a requester reads the fleet settings (the request form needs the self-drive switch)", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "my_notification_settings", {})
    check(code == 200 and [e["event"] for e in body["result"]["events"]] == ["request.decided", "task.declined", "task.not_accepted", "vehicle.booked", "vehicle.booking_cancelled",
                                                                          "request.redecided", "booking.changed", "request.not_decided",
                                                                          "request.on_the_way", "request.running_late", "request.arrived", "request.driver_changed",
                                                                          "request.cancelled"],
          "a requester's notification settings hold their request events (with a task of theirs that needs a driver) and the three booking events", f"{code} {str(body)[:200]}")
    code, body = api_call(staff_token, "list_requests", {"status": "all"})
    check(code == 200 and body["result"]["count"] == 0, "staff see none of the office's requests", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "create_request", {"requested_by": "Somebody Else", "date": day(3), "time": "09:00", "route_to": "Galle", "pax": 2})
    check(code == 200 and body["result"]["request"]["requested_by"] == "Test Staff" and body["result"]["next"].startswith("Sent to the fleet admin")
          and body["result"]["request"]["timeline"]["sent"] and psql(f"select requested_by_user_id = '{staff_uid}' from vehicle_requests where requested_by_name = 'Test Staff'") == "t",
          "a staff request is always in their own name, says it was sent to the fleet admin, and records the account that sent it", f"{code} {str(body)[:200]}")
    code, body = api_call(staff_token, "list_requests", {"status": "all"})
    check(code == 200 and body["result"]["count"] == 1, "and they see that one request", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "update_office_user", {"email": staff_email, "permissions": ["view", "request", "users"]})
    check(code == 403 and "users" in str(body.get("needs", [])), "they cannot give themselves permissions (403 names what it needs)", f"{code} {body}")
    tool("update_office_user", {"email": staff_email, "permissions": ["view", "request"]})
    code, me = http("GET", f"{API}/functions/v1/office-api/me", api_headers(staff_token))
    check(code == 200 and me.get("permissions") == ["view", "request"] and "live_drivers" in me.get("tools", []) and "task_board" not in me.get("tools", []),
          "given view by the admin: the next /me lists the fleet's lists, not the tasks board", f"{code} {str(me)[:200]}")
    code, body = api_call(staff_token, "fleet_overview", {})
    check(code == 200 and body["result"]["needs_attention"] == [] and body["result"]["reminders"]["count"] == 0
          and body["result"]["vehicles"]["total"] == tool("list_vehicles")["counts"]["all"],
          "with view the overview has the counts and no needs-attention items", f"{code} {str(body)[:200]}")
    code, body = api_call(staff_token, "task_board", {})
    check(code == 403, "view alone cannot see the task board (403)", f"{code} {str(body)[:120]}")
    code, body = api_call(staff_token, "list_requests", {"status": "all"})
    check(code == 200 and body["result"]["count"] == 1, "with view they still see only their own requests", f"{code} {str(body)[:160]}")
    tool("update_office_user", {"email": staff_email, "permissions": ["view", "request", "approve"]})
    code, body = api_call(staff_token, "list_requests", {"status": "all"})
    check(code == 200 and body["result"]["count"] > 1, "with approve they see the whole requests queue", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "task_detail", {"task_id": T4})
    check(code == 200 and body["result"]["from_request"]["id"] == R1, "with approve they open a request's task", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "task_detail", {"task_id": T1})
    check(code == 409 and "vehicle request" in body.get("error", ""), "but not a task that came from no request (409)", f"{code} {body}")
    tool("update_office_user", {"email": staff_email, "permissions": ["view", "request", "assign_tasks"]})
    code, body = api_call(staff_token, "task_board", {})
    check(code == 200, "with assign_tasks the task board answers (200)", f"{code} {str(body)[:120]}")
    code, body = api_call(staff_token, "task_detail", {"task_id": T1})
    check(code == 200, "and any task opens", f"{code} {str(body)[:120]}")
    code, body = api_call(staff_token, "fleet_overview", {})
    check(code == 200 and all(a["kind"] in ("signal", "late_start", "running_late", "not_accepted", "declined", "vehicle_conflict", "arrival_override", "completed_early", "vehicle_needed") for a in body["result"]["needs_attention"]),
          "with assign_tasks the overview's needs-attention holds task items only", f"{code} {str(body['result'].get('needs_attention'))[:200]}")
    code, body = api_call(staff_token, "mileage_summary", {})
    check(code == 403, "mileage needs the vehicles permission (403)", f"{code} {str(body)[:120]}")
    code, body = api_call(staff_token, "plan_task", {"date": day(3), "leave_by": "09:00", "pickup": "Head office", "dropoff": "Galle"})
    check(code == 200 and body["result"]["leave_by_source"] == "manual", "with assign_tasks they can plan a task", f"{code} {str(body)[:160]}")
    # Phase 7 (§33): without approve, a new task waits for the fleet admin's OK.
    code, body = api_call(staff_token, "create_task", {"title": "6g proposed drop", "date": day(7), "start_time": "09:00", "driver": "nuwan.p", "vehicle": "cab4521",
                                                       "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kandy"}]})
    prop = body.get("result", {})
    check(code == 200 and prop.get("waiting_for_approval") is True and "task_id" not in prop and prop.get("request_id")
          and prop["next"].startswith("Waiting for the fleet admin's OK") and prop["driver"] == "Nuwan Perera"
          and psql("select count(*) from tasks where title = '6g proposed drop'") == "0"
          and psql(f"select kind || '|' || status || '|' || (proposed_employee_id is not null) from vehicle_requests where id = '{prop.get('request_id')}'") == "task|waiting|true",
          "create_task without approve: proposed (a request of kind task with the driver), no task exists, the driver sees nothing", f"{code} {str(body)[:300]}")
    code, body = api_call(staff_token, "task_board", {"date": day(7)})
    wa = body["result"].get("waiting_approval", [])
    check(code == 200 and any(c["request_id"] == prop["request_id"] and c["driver"] == "Nuwan Perera" and c["stops_count"] == 2 for c in wa)
          and body["result"]["counts"]["waiting_approval"] >= 1,
          "task_board: the proposal in the Waiting for approval column", f"{code} {str(wa)[:300]}")
    code, body = api_call(staff_token, "list_requests", {"status": "waiting", "kind": "task"})
    pc = next((c for c in body["result"]["requests"] if c["id"] == prop["request_id"]), {})
    check(code == 200 and pc.get("kind") == "task" and pc.get("proposed", {}).get("driver") == "Nuwan Perera" and pc.get("title") == "6g proposed drop"
          and len(pc.get("trip", {}).get("stops", [])) == 2,
          "list_requests: the proposer sees their proposal with the driver, vehicle and trip", f"{code} {str(pc)[:300]}")
    sent = tool("decide_request", {"request_id": prop["request_id"], "decision": "approve"})
    check(sent.get("as_proposed") is True and sent.get("task_id") and sent["driver"] == "Nuwan Perera"
          and psql(f"select status || '|' || (sent_at is not null) || '|' || coalesce(created_by, '') from tasks where id = '{sent['task_id']}'") == "assigned|true|Test Staff"
          and psql(f"select count(*) from task_stops where task_id = '{sent['task_id']}'") == "2",
          "decide_request with nothing changed: sent as proposed (the task made now, sent now, the proposer as its creator)", json.dumps(sent)[:300])
    code, body = api_call(staff_token, "create_task", {"title": "6g proposal two", "date": day(7), "start_time": "10:00", "driver": "nuwan.p", "vehicle": "cab4521",
                                                       "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Galle"}]})
    p2 = body["result"]["request_id"]
    changed = tool("decide_request", {"request_id": p2, "decision": "approve", "driver": "kasun.s", "vehicle": "car1182", "leave_by": "11:00"})
    check(changed.get("as_proposed") is False and changed["driver"] == "Kasun Silva" and changed["leave_by"].endswith("11:00"),
          "the approver changes the driver and the time: sent changed, planned again", json.dumps(changed)[:300])
    code, body = api_call(staff_token, "create_task", {"title": "6g proposal three", "date": day(7), "start_time": "12:00", "driver": "nuwan.p", "vehicle": "cab4521",
                                                       "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Matara"}]})
    p3 = body["result"]["request_id"]
    no = tool("decide_request", {"request_id": p3, "decision": "decline", "reason": "No driver free that day"})
    check(no["request"]["status"] == "declined" and psql("select count(*) from tasks where title = '6g proposal three'") == "0",
          "declined with a reason: no task", json.dumps(no)[:200])
    code, body = api_call(staff_token, "create_task", {"title": "6g proposal four", "date": day(7), "start_time": "13:00", "driver": "nuwan.p", "vehicle": "cab4521",
                                                       "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kandy"}]})
    p4 = body["result"]["request_id"]
    code, body = api_call(staff_token, "cancel_request", {"request_id": p4, "reason": "Not needed after all"})
    check(code == 200 and psql(f"select status from vehicle_requests where id = '{p4}'") == "cancelled", "the proposer withdraws their own waiting proposal (§35 17)", f"{code} {str(body)[:200]}")
    code, body = api_call(staff_token, "cancel_request", {"request_id": rq["id"], "reason": "Not mine"})
    check(code == 409 and "not yours" in body.get("error", ""), "but not someone else's request (409)", f"{code} {body}")
    tool("update_settings", {"key": "tasks_need_approval", "value": False})
    code, body = api_call(staff_token, "create_task", {"title": "6g direct", "date": day(7), "start_time": "14:00", "driver": "nuwan.p", "vehicle": "cab4521",
                                                       "stops": [{"type": "pickup", "place": "Head office"}, {"type": "drop", "place": "Kandy"}]})
    check(code == 200 and body["result"].get("task_id") and not body["result"].get("waiting_for_approval"),
          "with the setting off, their task goes straight to the driver", f"{code} {str(body)[:200]}")
    tool("update_settings", {"key": "tasks_need_approval", "value": True})
    code, body = api_call(staff_token, "update_settings", {"key": "buffer_min", "value": 10})
    check(code == 403 and "users" in str(body.get("needs", [])), "but not change the fleet settings (403, needs users)", f"{code} {body}")
    code, body = api_call(staff_token, "get_settings", {})
    check(code == 200 and body["result"]["settings"]["buffer_min"] == 15, "get_settings answers a dispatcher (read-only)", f"{code} {str(body)[:160]}")
    code, body = api_call(staff_token, "list_issues", {})
    check(code == 200 and all(i["scope"] == "task" for i in body["result"]["issues"]) and body["result"]["count"] >= 1,
          "with assign_tasks list_issues shows the task issues only", f"{code} {str(body['result'].get('issues'))[:200]}")
    code, body = api_call(staff_token, "update_issue", {"id": body["result"]["issues"][0]["id"], "status": "dismissed"})
    check(code == 403 and "issues" in str(body.get("needs", [])), "but cannot change one (403, needs issues)", f"{code} {body}")
    code, body = api_call(staff_token, "fleet_overview", {})
    check(code == 200 and all(a["kind"] in ("signal", "late_start", "running_late", "not_accepted", "declined", "vehicle_conflict", "arrival_override", "completed_early", "vehicle_needed") for a in body["result"]["needs_attention"]),
          "and the overview's needs-attention holds task issues only", f"{code} {str(body['result'].get('needs_attention'))[:200]}")
    tool("update_office_user", {"email": staff_email, "permissions": ["request"]})
    code, body = api_call(staff_token, "get_settings", {})
    code2, body2 = api_call(staff_token, "plan_task", {"date": day(3), "leave_by": "09:00", "pickup": "Head office", "dropoff": "Galle",
                                                       "driver": "nuwan.p"})
    check(code == 200 and body["result"]["settings"]["self_drive_allowed"] is True and code2 == 200 and "conflicts" not in body2["result"]
          and "vehicle_used" not in body2["result"],
          "a requester reads the settings and plans their trip (Phase 7 §34), with no driver, vehicle or conflicts in the answer", f"{code} {code2} {str(body2)[:200]}")
    tool("update_office_user", {"email": staff_email, "permissions": ["view", "request", "assign_tasks"]})
    code, body = api_call(API_TOKEN, "update_office_user", {"email": admin_email, "permissions": ["view", "request", "approve", "assign_tasks", "vehicles", "issues"]})
    check(code == 409 and "own users permission" in body.get("error", ""), "an admin cannot remove their own users permission (409)", f"{code} {body}")
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


if CHANNEL == "api":
    # Phase 7, Part 3 (§5, §6, §28): files through the web's own upload, after the contract check (only this channel has
    # photos, so their links stay out of the shapes the artifact reads).
    print("\n== 8. Photos and documents uploaded by the web app ==")
    def upload(ticket, data, content_type):
        code, body = http("PUT", f"{API}/storage/v1/object/upload/sign/{ticket['bucket']}/{ticket['path']}?token={ticket['token']}",
                          {"Content-Type": content_type, "apikey": ANON}, data)
        return code
    t1 = tool("vehicle_document_upload_url", {"vehicle": "cab4521", "kind": "insurance", "content_type": "image/jpeg", "bytes": len(TINY_JPEG)})["upload"]
    check(upload(t1, TINY_JPEG, "image/jpeg") == 200, "the browser uploads the document with the one-time token")
    d1 = tool("save_vehicle_document", {"vehicle": "cab4521", "kind": "insurance", "path": t1["path"], "content_type": "image/jpeg",
                                        "bytes": len(TINY_JPEG), "expiry": day(200)})["document"]
    check(d1["kind_name"] == "Insurance" and d1["url"] and d1["uploaded"].endswith("by Test Admin")
          and psql("select insurance_expiry from vehicles where reg_no = 'WP CAB-4521'") == day(200),
          "save_vehicle_document: the current insurance, its link, and its expiry is the vehicle's insurance date", json.dumps(d1)[:300])
    t2 = tool("vehicle_document_upload_url", {"vehicle": "cab4521", "kind": "insurance", "content_type": "application/pdf", "bytes": 20})["upload"]
    upload(t2, b"%PDF-1.4\n%%EOF\n", "application/pdf")
    tool("save_vehicle_document", {"vehicle": "cab4521", "kind": "insurance", "path": t2["path"], "content_type": "application/pdf", "expiry": day(300)})
    docs = tool("vehicle_documents", {"vehicle": "cab4521", "removed": True})
    check(len([d for d in docs["documents"] if d["kind"] == "insurance"]) == 1 and docs["removed"][0]["removed_reason"] == "replaced"
          and psql("select insurance_expiry from vehicles where reg_no = 'WP CAB-4521'") == day(300),
          "a new insurance replaces the old (kept as replaced); the date follows the current one", json.dumps(docs)[:300])
    tool("restore_vehicle_document", {"id": d1["id"]})
    check(psql("select insurance_expiry from vehicles where reg_no = 'WP CAB-4521'") == day(200), "Restore makes the old one current again, with its date")
    tool("remove_vehicle_document", {"id": d1["id"]})
    docs = tool("vehicle_documents", {"vehicle": "cab4521"})
    check(not any(d["kind"] == "insurance" for d in docs["documents"]) and "insurance" in docs.get("missing", []),
          "Remove takes it off (kept); insurance is missing again", json.dumps(docs)[:300])
    up = tool("photo_upload_url", {"kind": "driver_profile", "target": "kasun.s"})["upload"]
    check(upload(up, TINY_JPEG, "image/jpeg") == 200, "the browser uploads a driver's photo")
    tool("set_driver_photo", {"driver": "kasun.s", "path": up["path"]})
    ks = next(d for d in tool("list_drivers")["drivers"] if d["username"] == "kasun.s")
    check(ks.get("photo_url", "").find("/storage/v1/object/sign/driver-photos/") >= 0, "list_drivers: the driver's photo link", ks.get("photo_url"))
    vp = tool("photo_upload_url", {"kind": "vehicle", "target": "cab4521"})
    upload(vp["upload"], TINY_JPEG, "image/jpeg")
    upload(vp["thumb"], TINY_JPEG, "image/jpeg")
    tool("set_vehicle_photo", {"vehicle": "cab4521", "path": vp["upload"]["path"], "thumb_path": vp["thumb"]["path"]})
    a = next(v for v in tool("list_vehicles")["vehicles"] if v["reg_no"] == "WP CAB-4521")
    b = next(v for v in tool("list_vehicles")["vehicles"] if v["reg_no"] == "WP CAB-4521")
    check(a.get("thumb_url") and a["thumb_url"] == b["thumb_url"] and a["photo_url"] == b["photo_url"],
          "list_vehicles: the vehicle's photo and thumbnail; the same links on the next call (a page refreshing keeps its pictures)", a.get("thumb_url"))
    r = tool("set_driver_photo", {"driver": "nuwan.p", "path": up["path"]}, expect_error=True)
    check("not that driver" in r, "a photo uploaded for one driver cannot be set on another", r)


print("\n== 6n. Part 6 after the checkpoint: the phones' two maps, the Google-map issue, the privacy contact ==")
pm = uuid.uuid4().hex[:6]
PIN_M = "605214"
MAPS_NAME = f"Ruwan Maps {pm}"
tool("create_driver", {"name": MAPS_NAME, "code": f"M{pm}", "username": f"maps.{pm}", "pin": PIN_M, "phone": "0771112244"})
code, ses_m = sign_in(f"maps.{pm}", PIN_M)
km = Driver(ses_m["access_token"])
code, ds = rpc_as(km, "get_driver_settings", {})
check(code == 200 and ds.get("map_package") == "google" and ds.get("phone_map_wait_s") == 30,
      "the phones read the map package (google) and a 30 s wait for Google's map", f"{code} {str(ds)[:200]}")
r = tool("update_settings", {"key": "phone_map_wait_s", "value": 0}, expect_error=True)
check("1 to 120" in r, "phone_map_wait_s: 1 to 120 seconds", r[:200])
tool("update_settings", {"key": "phone_map_wait_s", "value": 1})
code, ds = rpc_as(km, "get_driver_settings", {})
check(ds.get("phone_map_wait_s") == 1, "a 1 s wait reaches the phones (forces the free map for the phone test)", str(ds)[:200])
tool("update_settings", {"key": "phone_map_wait_s", "value": 30})
now_m = dt.datetime.now(dt.timezone.utc)
code, res = rpc_as(km, "report_map_state", {"p_google_ok": False, "p_reason": "timeout", "p_at": iso(now_m - dt.timedelta(minutes=1)), "p_app_version": "1.3.0+abcd1234"})
check(code == 200 and res == "ok", "the phone reports that Google's map did not load", f"{code} {res}")
code, res = rpc_as(km, "report_map_state", {"p_google_ok": False, "p_reason": "grey", "p_at": iso(now_m), "p_app_version": "1.3.0"})
check(code >= 400, "a failure without timeout or error is refused", f"{code} {str(res)[:200]}")
fleet_jobs()
mapped = lambda status="active": [i for i in tool("list_issues", {"status": status, "kind": "map_fallback"})["issues"] if MAPS_NAME in i["title"]]
check(not mapped(), "one failed try (a weak-signal trip): no issue for the office yet")
code, res = rpc_as(km, "report_map_state", {"p_google_ok": False, "p_reason": "timeout", "p_at": iso(now_m - dt.timedelta(seconds=30)), "p_app_version": "1.3.0+abcd1234"})
fleet_jobs()
mi = mapped()
check(len(mi) == 1 and mi[0]["title"] == f"Google map failed on {MAPS_NAME}'s phone; using the free map" and mi[0]["severity"] == "warning"
      and "app 1.3.0+abcd1234" in (mi[0].get("detail") or ""),
      "the next try fails too: the issue opens, \"Google map failed on <driver>'s phone; using the free map\"", json.dumps(mi)[:400])
# Two phones within the hour: a key or billing problem shows on every phone at once.
pm2 = uuid.uuid4().hex[:6]
tool("create_driver", {"name": f"Ruwan Maps Two {pm2}", "code": f"N{pm2}", "username": f"maps2.{pm2}", "pin": PIN_M, "phone": "0771112245"})
code, ses_m2 = sign_in(f"maps2.{pm2}", PIN_M)
km2 = Driver(ses_m2["access_token"])
rpc_as(km2, "report_map_state", {"p_google_ok": False, "p_reason": "timeout", "p_at": iso(now_m - dt.timedelta(minutes=2)), "p_app_version": "1.3.0"})
fleet_jobs()
two = [i for i in tool("list_issues", {"status": "active", "kind": "map_fallback"})["issues"] if f"Ruwan Maps Two {pm2}" in i["title"]]
check(len(two) == 1 and "another phone too" in (two[0].get("detail") or ""), "a second phone failing within the hour opens its issue on its first try", json.dumps(two)[:300])
rpc_as(km2, "report_map_state", {"p_google_ok": True, "p_reason": "", "p_at": iso(dt.datetime.now(dt.timezone.utc)), "p_app_version": "1.3.0"})
tool("update_settings", {"key": "map_package", "value": "open"})
code, ds = rpc_as(km, "get_driver_settings", {})
fleet_jobs()
check(ds.get("map_package") == "open" and not mapped(), "the map package set to open: the phones follow it and no phone asks Google (no issue)", str(ds)[:120])
tool("update_settings", {"key": "map_package", "value": "google"})
fleet_jobs()
check(len(mapped()) == 1, "back to google: the phone still on the free map shows again")
code, res = rpc_as(km, "report_map_state", {"p_google_ok": True, "p_reason": "", "p_at": iso(now_m + dt.timedelta(seconds=1)), "p_app_version": "1.3.0+abcd1234"})
fleet_jobs()
check(code == 200 and res == "ok" and not mapped() and any(i["title"].startswith("Google map failed") for i in mapped("resolved")),
      "Google's map loads again on that phone: the issue resolves by itself", f"{code} {res}")
code, res = rpc_as(km, "report_map_state", {"p_google_ok": False, "p_reason": "error", "p_at": iso(now_m - dt.timedelta(hours=1)), "p_app_version": "1.3.0"})
check(res == "older", "a report older than the stored one is ignored", str(res))

# Item 8: the privacy contact e-mail, a setting (audited), on the public privacy page.
r = tool("update_settings", {"key": "privacy_email", "value": "not an address"}, expect_error=True)
check("privacy_email" in r and "e-mail" in r, "privacy_email: the e-mail format is checked", r[:200])
tool("update_settings", {"key": "privacy_email", "value": " Privacy@Fame.TEST "})
check(tool("get_settings")["settings"].get("privacy_email") == "privacy@fame.test", "get_settings answers the privacy e-mail (trimmed, lower case)")
code, pc = http("GET", f"{API}/functions/v1/office-api/public/privacy")
check(code == 200 and pc.get("email") == "privacy@fame.test" and set(pc) <= {"email", "phone", "phone_e164"},
      "the public privacy page's contact, without signing in: the e-mail (and nothing but the contact)", f"{code} {str(pc)[:200]}")
tool("update_settings", {"key": "privacy_email", "value": None})
code, pc = http("GET", f"{API}/functions/v1/office-api/public/privacy")
check(code == 200 and "email" not in pc and pc.get("phone") == "011 234 5678" and "privacy_email" not in tool("get_settings")["settings"],
      "removed: the page gets the office phone instead", f"{code} {str(pc)[:200]}")
tool("update_settings", {"key": "privacy_email", "value": "privacy@fame.test"})
code, pc = http("GET", f"{API}/functions/v1/office-api/public/privacy")
check(pc.get("email") == "privacy@fame.test", "added again: the page shows it again", str(pc)[:200])
# Removed again at the end: the contract's get_settings answer then has the same fields in both channels' runs.
tool("update_settings", {"key": "privacy_email", "value": None})
check(int(psql("select count(*) from office_audit where tool = 'update_settings' and args_summary like '%privacy_email%'")) >= 3,
      "every change of the privacy e-mail is in the audit log")

print(f"\n{calls} tool calls. " + ("ALL CHECKS PASSED" if not failures else f"{len(failures)} FAILED:"))
for f in failures:
    print("  - " + f)
sys.exit(1 if failures else 0)
