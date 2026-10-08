#!/usr/bin/env python3
"""Runs read-odometer on the LOCAL stack over a folder of photos and prints the
status for each. Nothing here touches the real project, and the photos are
read from the folder only (never copied anywhere else).

Needs, from scripts/test-read-odometer-local.sh: API_URL, ANON_KEY,
SERVICE_ROLE_KEY (the local stack's), and a running
    npx supabase functions serve read-odometer --env-file <file with GEMINI_API_KEY and SERVER_KEY>

Usage:  test-read-odometer-local.py <photo folder> [--last-km N] [--gps-km N]
The optional last reading makes the range check active ("out_of_range").
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path

API = os.environ["API_URL"].rstrip("/")
ANON = os.environ["ANON_KEY"]
SERVICE = os.environ["SERVICE_ROLE_KEY"]
if not API.startswith(("http://127.0.0.1", "http://localhost")):
    sys.exit("Local stack only (API_URL must be http://127.0.0.1 or http://localhost).")

USERNAME = "odo.phototest"
PIN = "246813"
CODE = "TPHOTO"


def http(method, url, headers, body=None, raw=False):
    data = body if raw else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=90) as res:
            text = res.read().decode()
            return res.status, (json.loads(text) if text and text.lstrip().startswith(("{", "[")) else text)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        return e.code, (json.loads(text) if text and text.lstrip().startswith(("{", "[")) else text)


def admin_headers():
    return {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}", "Content-Type": "application/json"}


def ensure_driver():
    """A throwaway local driver account for the test (created once, reused)."""
    email = f"{USERNAME}@drivers.fame.invalid"
    code, users = http("GET", f"{API}/auth/v1/admin/users?per_page=200", admin_headers())
    user = next((u for u in (users.get("users", []) if isinstance(users, dict) else []) if u.get("email") == email), None)
    if not user:
        code, user = http("POST", f"{API}/auth/v1/admin/users", admin_headers(), {"email": email, "password": PIN, "email_confirm": True})
        if code not in (200, 201):
            sys.exit(f"could not create the local auth user: {code} {user}")
    code, rows = http("GET", f"{API}/rest/v1/employees?username=eq.{USERNAME}&select=id", admin_headers())
    if rows:
        return rows[0]["id"]
    code, rows = http("POST", f"{API}/rest/v1/employees", {**admin_headers(), "Prefer": "return=representation"},
                      {"code": CODE, "name": "Photo Test", "username": USERNAME, "role": "driver", "auth_user_id": user["id"], "active": True})
    if code != 201:
        sys.exit(f"could not create the local employee: {code} {rows}")
    return rows[0]["id"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("folder")
    parser.add_argument("--last-km", type=int, default=None)
    parser.add_argument("--gps-km", type=int, default=0)
    args = parser.parse_args()
    folder = Path(args.folder).expanduser()
    photos = sorted(p for p in folder.iterdir() if p.suffix.lower() in (".jpg", ".jpeg"))
    if not photos:
        sys.exit(f"No .jpg photos in {folder} (PNG and HEIC are not what the app uploads; convert them to JPEG first).")

    employee = ensure_driver()
    code, session = http("POST", f"{API}/auth/v1/token?grant_type=password", {"apikey": ANON, "Content-Type": "application/json"},
                         {"email": f"{USERNAME}@drivers.fame.invalid", "password": PIN})
    if code != 200:
        sys.exit(f"sign-in failed: {code} {session}")
    token = session["access_token"]
    h = {"apikey": ANON, "Authorization": f"Bearer {token}"}
    today = datetime.now(timezone(timedelta(hours=5, minutes=30))).date().isoformat()

    print(f"{'photo':40} {'status':16} {'reading':>9} {'conf':>5} {'ms':>6}  digits / note")
    for photo in photos:
        path = f"{employee}/{today}/{uuid.uuid4()}.jpg"
        code, body = http("POST", f"{API}/storage/v1/object/driver-photos/{path}", {**h, "Content-Type": "image/jpeg"},
                          photo.read_bytes(), raw=True)
        if code not in (200, 201):
            print(f"{photo.name:40} upload failed: {code} {str(body)[:80]}")
            continue
        started = time.time()
        code, reply = http("POST", f"{API}/functions/v1/read-odometer", {**h, "Content-Type": "application/json"},
                           {"path": path, "vehicle_id": None, "last_km": args.last_km, "gps_km": args.gps_km})
        ms = int((time.time() - started) * 1000)
        if code != 200:
            print(f"{photo.name:40} {'HTTP ' + str(code):16} {'':>9} {'':>5} {ms:>6}  {str(reply)[:80]}")
            continue
        reading = reply.get("reading_km")
        raw = reply.get("raw_reading_km")
        conf = reply.get("confidence")
        shown = reading if reading is not None else (f"({raw})" if raw is not None else "")
        print(f"{photo.name:40} {reply.get('status', '?'):16} {str(shown):>9} {('' if conf is None else f'{conf:.2f}'):>5} {ms:>6}  {reply.get('digits_seen', '')}")


if __name__ == "__main__":
    main()
