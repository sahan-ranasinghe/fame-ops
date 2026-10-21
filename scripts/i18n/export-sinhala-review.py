#!/usr/bin/env python3
"""The Sinhala review export (Sahan, 22 October 2026): every text a person sees, with its English, its current Sinhala and
empty "Corrected Sinhala" / "Reason" columns, for an outside reviewer. Read-only: it reads the sources and writes only
docs/i18n/ (gitignored working files).

    python3 scripts/i18n/export-sinhala-review.py

Sources:
  - apps/driver/src/i18n/en.json + si.json: the driver app, Office mode and /m/ (one app); where each key is used comes
    from the code (every string literal that is a key, and `prefix.${x}` templates);
  - the server's sentences people see: refusals (ToolError), warnings, the office's notifications (TypeScript and the
    latest SQL definitions); the ones Office mode already says in Sinhala are found with the app's own reader
    (scripts/i18n/patterns.ts → statusWords.ts sentenceWords);
  - the driver's push texts (push-task, English and Sinhala);
  - the /m/ offline page and both web manifests.
The site (apps/office) has no Sinhala: it is English only, so it has no rows but its manifest.

Out: docs/i18n/sinhala-review-N.xlsx (sheets Review, Glossary, Read me) and .csv (the Review sheet, UTF-8 with a BOM so
Excel reads the Sinhala), at most 400 rows a file, identical English kept together; docs/i18n/sinhala-review-glossary.csv.
"""

from __future__ import annotations

import collections
import csv
import json
import os
import pathlib
import re
import subprocess
import sys
import zipfile
from xml.sax.saxutils import escape

ROOT = pathlib.Path(__file__).resolve().parents[2]
APP = ROOT / "apps/driver"
SRC = APP / "src"
FN = ROOT / "supabase/functions"
OUT = ROOT / "docs/i18n"
MAX_ROWS = 400

COLUMNS = [
    "id", "surface", "screen", "element", "English", "current Sinhala", "placeholders", "max length", "notes",
    "same English (group)", "Corrected Sinhala", "Reason",
]

# ---------------------------------------------------------------------------------------------------------------------
# The app's keys
# ---------------------------------------------------------------------------------------------------------------------


def flat(d, p=""):
    if isinstance(d, dict):
        for k, v in d.items():
            yield from flat(v, f"{p}{k}.")
    elif isinstance(d, list):
        for i, v in enumerate(d):
            yield from flat(v, f"{p}{i}.")
    else:
        yield p[:-1], d


EN = dict(flat(json.loads((SRC / "i18n/en.json").read_text())))
SI = dict(flat(json.loads((SRC / "i18n/si.json").read_text())))
KEYS = set(EN)

LITERAL = re.compile(r"'((?:[^'\\\n]|\\.)*)'|\"((?:[^\"\\\n]|\\.)*)\"|`((?:[^`\\]|\\.)*)`", re.S)


def code_files():
    for f in sorted(list(SRC.rglob("*.ts")) + list(SRC.rglob("*.tsx"))):
        s = str(f)
        if ".test." in s or "__tests__" in s or "/i18n/" in s:
            continue
        yield f


def usages():
    """key → [(file relative to src, line number, line index in the file's lines)]; prefixes the same."""
    direct = collections.defaultdict(list)
    prefixed = collections.defaultdict(list)
    for f in code_files():
        text = f.read_text()
        rel = str(f.relative_to(SRC))
        for m in LITERAL.finditer(text):
            v = m.group(1) or m.group(2) or m.group(3) or ""
            line = text.count("\n", 0, m.start()) + 1
            if "${" in v:
                pre = v.split("${")[0]
                if pre.count(".") >= 1 and pre not in ("office.",) and any(k.startswith(pre) for k in KEYS):
                    prefixed[pre].append((rel, line))
                continue
            if v in KEYS:
                direct[v].append((rel, line))
            elif v.endswith(".") and v not in ("office.",) and any(k.startswith(v) for k in KEYS):
                prefixed[v].append((rel, line))
    out = {}
    for k in KEYS:
        if k in direct:
            out[k] = (direct[k], False)
            continue
        best = max((p for p in prefixed if k.startswith(p)), key=len, default=None)
        out[k] = (prefixed[best], True) if best else ([], False)
    return out


DRIVER_TABS = {"index": "Today", "mileage": "Mileage", "fuel": "Fuel", "report": "Report", "me": "Me", "_layout": "Tab bar"}
OFFICE_TABS = {"index": "Home", "approve": "Approve", "tasks": "Tasks", "live": "Live", "drivers": "Drivers", "more": "More",
               "trips": "My trips", "_layout": "Tab bar"}


def words(name: str) -> str:
    name = re.sub(r"\[[^\]]+\]", "", name).strip("-_ ")
    name = re.sub(r"([a-z])([A-Z])", r"\1 \2", name).replace("-", " ").replace("_", " ").strip()
    return name[:1].upper() + name[1:].lower() if name else name


def is_office(rel: str) -> bool:
    return rel.startswith(("app/office/", "components/office/", "office/"))


def screen_of(rel: str) -> str:
    """apps/driver/src/<rel> → the screen a person knows."""
    p = re.sub(r"\.(web\.)?tsx?$", "", rel)
    if p.startswith("app/(tabs)/"):
        return "Driver · " + DRIVER_TABS.get(p.split("/")[-1], words(p.split("/")[-1]))
    if p.startswith("app/office/(tabs)/"):
        return "Office · " + OFFICE_TABS.get(p.split("/")[-1], words(p.split("/")[-1]))
    if p == "app/_layout":
        return "App start"
    if p.startswith("app/office/"):
        parts = [words(x) for x in p[len("app/office/"):].split("/") if x not in ("index", "_layout")]
        return "Office · " + " · ".join(x for x in parts if x) or "Office"
    if p.startswith("app/"):
        parts = [words(x) for x in p[len("app/"):].split("/") if x not in ("index", "_layout")]
        return "Driver · " + " · ".join(x for x in parts if x)
    if p.startswith("components/office/"):
        return "Office · part: " + words(p.split("/")[-1])
    if p.startswith("components/patterns/"):
        return "Shared part: " + words(p.split("/")[-1])
    if p.startswith("components/"):
        return "Driver · part: " + words(p.split("/")[-1])
    if p.startswith("office/"):
        name = re.sub(r"(Logic|Words)$", "", p.split("/")[-1])
        return "Office · " + words(name) + " (words)"
    return words(p.split("/")[-1]) + " (app)"


BUTTONISH = re.compile(r"<(\w*Button\w*|Btn|\w*Slide\w*|Pressable\w*Button|ActionRow|StickyActions|PrimaryAction)\b")
CHIPISH = re.compile(r"<(\w*Chip\w*|Pill|Badge\w*|Tag)\b")
TITLEISH = re.compile(r"variant=['\"](title|h1|h2|h3|heading|display)['\"]|<(PageTop|ScreenHeader|Header|SectionTitle)\b")
PROP = re.compile(r"(\w+)\s*[=:]\s*\{?\s*(?:t|tt|tr|translate)\(\s*$")
VERBS = {"save", "cancel", "send", "start", "retry", "tryagain", "done", "close", "apply", "clear", "next", "back", "confirm",
         "accept", "decline", "ok", "yes", "no", "edit", "change", "add", "remove", "call", "whatsapp", "navigate", "open",
         "submit", "continue", "skip", "undo", "discard", "keep", "approve", "assign", "book", "signout", "signin", "logout",
         "login", "upload", "record", "stop", "finish", "share", "copy", "reset", "refresh", "reload", "view", "viewall",
         "loadmore", "use", "pick", "choose", "select", "turnon", "turnoff", "allow"}


TAG_ELEMENT = {
    "Button": "button", "StickyActions": "button", "LoadMore": "button", "Pill": "chip", "ChoiceChip": "chip", "StatusChip": "chip",
    "Notice": "message", "ErrorNotice": "error / message", "FleetError": "error / message", "ListFailed": "error / message",
    "ListEmpty": "empty state", "Section": "section title", "BackHeader": "title", "Screen": "title", "Sheet": "title",
    "Field": "label", "Tile": "tile label", "ChoiceRow": "choice (option)", "Tabs": "tab", "TextInput": "hint (placeholder)",
}
TXT_VARIANT = {"title": "title", "heading": "title", "big": "title", "label": "label", "small": "small text", "muted": "small text",
               "strong": "text", "body": "text", "button": "button"}


def enclosing_tag(ctx: str) -> str | None:
    """The element the text is written into: the last tag opened before it (a Txt by its variant)."""
    tags = list(re.finditer(r"<([A-Z]\w*)\b([^<>]*)", ctx))
    if not tags:
        return None
    name, attrs = tags[-1].group(1), tags[-1].group(2)
    if name in ("Txt", "Text"):
        v = re.search(r"variant=['\"](\w+)['\"]", attrs)
        return TXT_VARIANT.get(v.group(1), "text") if v else "text"
    if name in TAG_ELEMENT:
        return TAG_ELEMENT[name]
    if name.endswith("Button"):
        return "button"
    if name.endswith("Chip"):
        return "chip"
    return None


def element_of(key: str, uses: list[tuple[str, int]], files: dict[str, list[str]]) -> str:
    last = key.split(".")[-1]
    low = last.lower()
    top = key.split(".")[0]
    if top == "channel":
        return "notification channel description" if low.endswith("desc") else "notification channel name"
    if top in ("tabs",) or ".tabs." in key or low.startswith("tab"):
        return "tab"
    if top in ("days", "daysShort", "months"):
        return "day / month name"
    if key.startswith(("office.chip.", "office.status.")):
        return "chip"
    votes = collections.Counter()
    for rel, line in uses[:12]:
        lines = files.setdefault(rel, (SRC / rel).read_text().split("\n"))
        here = lines[line - 1]
        ctx = "\n".join(lines[max(0, line - 5):line])
        pos = here.find(key)
        before = here[:pos] if pos >= 0 else here
        m = PROP.search(before.rstrip("'\"`"))
        prop = m.group(1).lower() if m else ""
        if "scheduleNotificationAsync" in ctx or "presentNotification" in ctx or (rel == "lib/notifications.ts" and prop in ("title", "body")):
            votes["notification " + ("body" if prop == "body" else "title")] += 3
        elif prop == "placeholder":
            votes["hint (placeholder)"] += 3
        elif prop in ("accessibilitylabel", "arialabel", "accessibilityhint"):
            votes["screen-reader label"] += 3
        elif prop in ("headertitle",):
            votes["title"] += 3
        elif BUTTONISH.search(ctx) and prop in ("label", "title", "text", ""):
            votes["button"] += 2
        elif CHIPISH.search(ctx):
            votes["chip"] += 2
        elif prop in ("title", "heading"):
            votes["title"] += 2
        elif prop in ("hint", "help", "sub", "subtitle", "helper", "caption", "description", "detail"):
            votes["hint"] += 2
        elif prop in ("error", "errortext", "problem", "reason") or "Alert.alert" in ctx:
            votes["error / message"] += 1
        elif TITLEISH.search(ctx):
            votes["title"] += 1
        elif prop == "label":
            votes["label"] += 1
        else:
            tag = enclosing_tag(ctx[:len(ctx) - len(here)] + before)
            if tag:
                votes[tag] += 1
    if votes:
        return votes.most_common(1)[0][0]
    if low.endswith("title") or low in ("heading", "header"):
        return "title"
    if "placeholder" in low:
        return "hint (placeholder)"
    if "hint" in low or "help" in low or low.endswith(("sub", "subtitle", "desc")):
        return "hint"
    if re.search(r"err|fail|couldnt|cant|invalid|refused|problem", low):
        return "error / message"
    if "empty" in low:
        return "empty state"
    if "chip" in low or "badge" in low:
        return "chip"
    if low.replace("_", "") in VERBS or "button" in low or low.endswith(("btn", "cta")):
        return "button"
    if "label" in low:
        return "label"
    return "text"


MAX_LEN = {
    "tab": "10",
    "button": "28 (14 when two buttons share a row)",
    "chip": "16",
    "notification title": "40 (one line when folded)",
    "notification body": "90 (two lines when folded)",
    "notification channel name": "40",
    "title": "26 when it is a screen's header (one line)",
    "day / month name": "4 for the short names",
}

# What each group of keys is about (the first part of the key; office.* by its second part): the "when it's shown" in notes.
GROUP_NOTE = {
    "arrival": "The driver's 'Arrived at <stop>?' notification (near a stop, the app in the background).",
    "arrive": "Arriving at a stop on the task screen: how far the driver is, 'I'm here' when the pin is wrong.",
    "ask": "A question from the office to the driver (free for a trip? when at the office? where are you?) and the answer.",
    "avail": "The driver's availability: the times they can't take trips (leave, half day).",
    "call": "Call buttons (the contact, the person who asked, the fleet admin).",
    "channel": "Android's notification channels (Settings → Apps → Fame Fleet → Notifications).",
    "common": "Common words used on many screens (OK, Cancel, Yes).",
    "complete": "Finishing a task: the last checks before Save & finish.",
    "crash": "The page shown when the app hits an error.",
    "date": "Day words for dates (Today, Yesterday, Tomorrow).",
    "days": "Day names in dates (Mon 19 Oct).", "daysShort": "Two-letter day names in calendars.", "months": "Month names in dates.",
    "disclosure": "Before Android asks for location: why the app records location on duty (required by Google Play).",
    "docs": "The vehicle's documents the driver can show at a roadside check.",
    "done": "Short confirmations after saving (Fuel saved, Task started).",
    "dur": "Durations and countdowns (in 5 min, 2 h ago).",
    "duty": "Start work / Finish work (clocking in and out with today's vehicle).",
    "fuel": "The Fuel tab and logging a fuel fill with its video.",
    "gate": "The 'Turn on Location' cover when Location is off or not allowed.",
    "geofence": "Prompts near a stop during a task (arrived? done?).",
    "late": "Running late: the driver tells the office how late.",
    "list": "Lists with nothing in them.",
    "log": "Log mileage: the odometer photo and reading at the start and end of a task.",
    "login": "The sign-in screen (username and 6-digit PIN).",
    "map": "Map controls and messages.",
    "me": "The driver's Me tab (profile, phone, language, sign out).",
    "mileage": "The driver's Mileage tab (this month's km).",
    "permissions": "The first-run permission steps (location, notifications, battery).",
    "phonePrompt": "Asking the driver for their phone number.",
    "phoneSetup": "Phone setup: the steps per phone brand so the app keeps running.",
    "preview": "A task shown in full before the driver accepts it.",
    "profile": "The driver's profile (phone, WhatsApp, emergency contact, licence).",
    "profilePhoto": "The driver's own photo.",
    "push": "The test notification on Me.",
    "report": "Report a problem with the vehicle (breakdown, accident, tyre…).",
    "service": "The ongoing notification while on duty (Android's location service).",
    "shift": "The 'At work?' reminder to start work.",
    "stop": "A stop's name and type on a task (Pickup, Drop-off, Visit).",
    "swap": "The office moved a running task to another vehicle.",
    "tabs": "The driver app's bottom tabs.",
    "task": "The driver's task screen (in progress, stops, navigate, finish).",
    "today": "The driver's Today screen (next task, later tasks, on duty).",
    "tracking": "Location recording problems and how to fix them.",
    "trip": "A trip the driver starts themselves (company work or personal).",
    "vehicle": "Choosing the driver's vehicle.",
    "vehicleConfirm": "'Which vehicle?' before starting a task with no vehicle yet.",
    "vehiclePhoto": "Adding a photo of the vehicle.",
    "vehicleType": "Vehicle types (car, van, double cab, lorry).",
    "web": "The mobile website only (/m/: install, desktop view, browser notifications).",
    "where": "The place search's groups (our places, used recently).",
    "patterns": "Shared controls on every list and form (search, filters, dates, the time picker, Load more).",
    "office.activity": "Office · Activity log (admins: who changed what).",
    "office.alerts": "Office · the notification centre.",
    "office.approve": "Office · the Approve tab (requests waiting for a decision).",
    "office.ask": "Office · Ask drivers (sending a question).", "office.asks": "Office · the questions asked and the answers.",
    "office.attendance": "Office · today's attendance on the Drivers board.",
    "office.away": "Office · a driver who is not available (leave, half day), as a sentence.",
    "office.chip": "Office · the short status chip at the right of a task row.",
    "office.common": "Office · common words.",
    "office.decide": "Office · deciding a request (approve, change, decline).",
    "office.drivers": "Office · the Drivers tab, a driver's page and their day route.",
    "office.error": "Office · connection and sign-in errors.",
    "office.give": "Office · Give it a driver (a task that needs a driver).",
    "office.history": "Office · a driver's driven route and playback.", "office.history2": "Office · Task history.",
    "office.home": "Office · Home (the greeting, the tiles, the day's lists).",
    "office.issues": "Office · Issues (everything that needs attention).",
    "office.line": "Office · a task's status sentence from the server, in the person's language.",
    "office.live": "Office · Live (drivers on the map).",
    "office.login": "The sign-in screen's Driver | Office choice and the office sign-in.",
    "office.maint": "Office · Maintenance (vehicle problems drivers reported).",
    "office.media": "Office · photos and documents of vehicles and drivers.",
    "office.more": "Office · the More tab.",
    "office.notif": "Office · notification settings.",
    "office.people": "Office · managing drivers and office users (More → People).",
    "office.permission": "Office · permission names.", "office.permissionText": "Office · what each permission allows.",
    "office.pin": "Office · checking a place's pin on the map.",
    "office.places": "Office · Places (saved places and operators' sites).",
    "office.preset": "Office · role presets (a set of permissions with a name).",
    "office.profile": "Office · My profile.",
    "office.reminders": "Office · Reminders (documents and services due).",
    "office.reports": "Office · Reports (mileage, fuel, km outside tasks).",
    "office.request": "Office · a request's page.", "office.requests": "Office · the requests list.",
    "office.saved": "Office · the confirmation after saving (snackbar).",
    "office.status": "Office · a task's state in one word.",
    "office.tabs": "Office · the bottom tabs.",
    "office.task": "Office · a task's page (driver, stops, timeline, changes).",
    "office.tasks": "Office · the Tasks tab (the day's board).",
    "office.tell": "Office · Tell the person who asked (call or message them).",
    "office.timeline": "Office · each stop's planned and actual times.",
    "office.trip": "Office · the trip form (Request a vehicle / Assign a task: Where, When, Who, Review).",
    "office.trips": "Office · My trips (the person's own requests).",
    "office.vehicles": "Office · Vehicles (list, page, register, documents).",
    "office.warn": "Office · the server's warnings when assigning or planning, in the person's language.",
    "office.when": "Office · how a day and time are put together.",
    "office.who": "Office · Who drives? (a driver, I'll drive myself, someone else).",
    "office.why": "Office · why a driver is the best match (on duty, free, distance).",
}


def group_note(key: str) -> str:
    parts = key.split(".")
    return GROUP_NOTE.get(".".join(parts[:2]) if parts[0] == "office" else parts[0], "")


PLACEHOLDER = re.compile(r"\{\{?\s*(\w+)\s*\}?\}")

PLACEHOLDER_MEANING = {
    "name": "a person's name", "driver": "a driver's name", "asker": "the name of the person who asked", "who": "a person's name",
    "time": "a time, 08:30", "leave": "the leave-by time, 08:30", "at": "a time", "from": "a start time or place",
    "to": "an end time or place", "until": "an end time", "when": "a day and time, Mon 19 Oct 08:30", "day": "a day name",
    "date": "a date", "n": "a number", "count": "a number", "total": "a number", "km": "kilometres (a number)",
    "min": "minutes (a number)", "minutes": "minutes (a number)", "plate": "a number plate, WP CAB-4521",
    "vehicle": "a vehicle (plate)", "reg_no": "a number plate", "stop": "a stop's name", "place": "a place's name",
    "title": "a task's title", "reason": "a reason", "pickup": "the first pickup place", "dropoff": "the last drop-off place",
    "phone": "a phone number", "label": "a word from the screen", "value": "a value", "age": "a duration, 5 min",
    "duration": "a duration, 1 h 30 min", "percent": "a percentage", "amount": "an amount in LKR", "litres": "litres",
    "question": "the office's question", "detail": "the question's detail", "changes": "what changed, in words",
    "more": "a number", "v": "a version number", "why": "a reason", "role": "a role or permission", "email": "an e-mail address",
}

# ---------------------------------------------------------------------------------------------------------------------
# The server's sentences
# ---------------------------------------------------------------------------------------------------------------------

FN_NAMES = {"colomboTime": "time", "colomboDayTime": "when", "colomboDate": "date", "colomboDay": "day", "phoneDisplay": "phone",
            "taskWindow": "window", "durationText": "duration", "dateLabel": "date", "atText": "time", "plural": "n"}


def placeholder_name(expr: str) -> str:
    e = expr.strip()
    m = re.match(r"^(\w+)\(", e)
    if m:
        return FN_NAMES.get(m.group(1), m.group(1))
    ids = re.findall(r"[A-Za-z_]\w*", e)
    ids = [i for i in ids if i not in ("args", "r", "t", "e", "x", "o", "row", "task", "request", "c", "w", "v", "d", "p", "s",
                                        "undefined", "null", "true", "false", "length", "join", "toFixed", "map", "filter")]
    return ids[-1] if len(ids) <= 2 and ids else (ids[0] if ids else "value")


def js_args_end(src: str, i: int) -> int:
    """From src[i] inside a call's argument list, the index of the first ',' or ')' at depth 0 (strings skipped)."""
    depth = 0
    while i < len(src):
        ch = src[i]
        if ch in "'\"`":
            i = skip_string(src, i)
            continue
        if ch in "([{":
            depth += 1
        elif ch in ")]}":
            if depth == 0:
                return i
            depth -= 1
        elif ch == "," and depth == 0:
            return i
        i += 1
    return i


def skip_string(src: str, i: int) -> int:
    q = src[i]
    i += 1
    while i < len(src):
        if src[i] == "\\":
            i += 2
            continue
        if q == "`" and src.startswith("${", i):
            depth = 1
            i += 2
            while i < len(src) and depth:
                if src[i] in "'\"`":
                    i = skip_string(src, i)
                    continue
                depth += {"{": 1, "}": -1}.get(src[i], 0)
                i += 1
            continue
        if src[i] == q:
            return i + 1
        i += 1
    return i


def template_text(body: str) -> str:
    out, i = [], 0
    while i < len(body):
        if body.startswith("${", i):
            depth, j = 1, i + 2
            while j < len(body) and depth:
                if body[j] in "'\"`":
                    j = skip_string(body, j)
                    continue
                depth += {"{": 1, "}": -1}.get(body[j], 0)
                j += 1
            out.append("{" + placeholder_name(body[i + 2:j - 1]) + "}")
            i = j
            continue
        if body[i] == "\\" and i + 1 < len(body):
            out.append({"n": " ", "t": " "}.get(body[i + 1], body[i + 1]))
            i += 2
            continue
        out.append(body[i])
        i += 1
    return "".join(out)


def js_string_expr(expr: str) -> str | None:
    """A JS expression of string literals and templates joined by +, as text with {placeholders}; None when it has no
    words of its own (a variable alone)."""
    parts, i, has_words = [], 0, False
    while i < len(expr):
        ch = expr[i]
        if ch in "'\"`":
            j = skip_string(expr, i)
            inner = expr[i + 1:j - 1]
            text = template_text(inner) if ch == "`" else re.sub(r"\\(.)", lambda m: {"n": " "}.get(m.group(1), m.group(1)), inner)
            if re.search(r"[A-Za-z]{2}", re.sub(r"\{\w+\}", "", text)):
                has_words = True
            parts.append(text)
            i = j
        elif ch in "+ \n\t()":
            i += 1
        else:
            j = js_args_end(expr + ",", i)
            j2 = expr.find("+", i)
            end = min(x for x in (j, j2 if j2 >= 0 else len(expr), len(expr)))
            parts.append("{" + placeholder_name(expr[i:end]) + "}")
            i = max(end, i + 1)
    text = re.sub(r"\s+", " ", "".join(parts)).strip()
    return text if has_words else None


def ts_server_files():
    for f in sorted((FN / "_shared/fleet").rglob("*.ts")):
        if not f.name.endswith("_test.ts") and f.name != "database.types.ts":
            yield f
    for name in ("driver-api", "office-api"):
        yield FN / name / "index.ts"


def server_sentences():
    """[(id, element, screen, English)] from the TypeScript server."""
    rows = []
    for f in ts_server_files():
        src = f.read_text()
        rel = str(f.relative_to(FN))
        short = rel.replace("_shared/fleet/", "")
        for kind, rx in (("error (the server refused)", r"new ToolError\("), ("warning", r"warnings\.push\(")):
            for m in re.finditer(rx, src):
                start = m.end()
                end = js_args_end(src, start)
                text = js_string_expr(src[start:end])
                if text:
                    line = src.count("\n", 0, m.start()) + 1
                    rows.append((f"server:{short}:{line}", kind, f"Server · {short}", text))
        for m in re.finditer(r"notifyEvent\(\s*\w+\s*,\s*\"([\w.]+)\"\s*,\s*\{", src):
            obj_start = m.end() - 1
            obj_end = obj_start + 1
            depth = 1
            while obj_end < len(src) and depth:
                if src[obj_end] in "'\"`":
                    obj_end = skip_string(src, obj_end)
                    continue
                depth += {"{": 1, "}": -1}.get(src[obj_end], 0)
                obj_end += 1
            body = src[obj_start:obj_end]
            line = src.count("\n", 0, m.start()) + 1
            for field in ("title", "body"):
                fm = re.search(rf"(?<![\w.]){field}:\s*", body)
                if not fm:
                    continue
                vend = js_args_end(body, fm.end())
                text = js_string_expr(body[fm.end():vend])
                if text:
                    rows.append((f"notify:{short}:{line}:{field}", f"notification {field}", f"Office notification · {m.group(1)}", text))
    return rows


def sql_notifications():
    """The office notifications written in SQL: the latest definition of each function that queues one."""
    latest: dict[str, tuple[str, str]] = {}
    for f in sorted((ROOT / "supabase/migrations").glob("*.sql")):
        src = f.read_text()
        for m in re.finditer(r"create (?:or replace )?function public\.(\w+)\s*\(.*?\$\$(.*?)\$\$", src, re.S | re.I):
            latest[m.group(1)] = (f.name, m.group(2))
    rows = []
    for fn, (file, body) in sorted(latest.items()):
        if "queue_notification" not in body:
            continue
        for cm in re.finditer(r"queue_notification\(\s*'([\w.]+)'", body):
            seg_start = cm.end()
            seg = body[seg_start:seg_start + 1500]
            for field in ("title", "body"):
                fm = re.search(rf"'{field}',\s*", seg)
                if not fm:
                    continue
                text = sql_string_expr(seg, fm.end())
                if text:
                    rows.append((f"sql:{fn}:{cm.group(1)}:{field}", f"notification {field}",
                                 f"Office notification · {cm.group(1)} (SQL {fn})", text))
    return rows


def sql_case_end(src: str, i: int) -> int:
    """From a `case` at src[i], the index just after its matching `end` (nested cases and strings skipped)."""
    depth, j = 0, i
    while j < len(src):
        if src[j] == "'":
            j = src.index("'", j + 1) + 1
            while src.startswith("'", j):
                j = src.index("'", j + 1) + 1
            continue
        m = re.match(r"(?i)\b(case|end)\b", src[j:])
        if m and (j == 0 or not (src[j - 1].isalnum() or src[j - 1] == "_")):
            depth += 1 if m.group(1).lower() == "case" else -1
            j += len(m.group(1))
            if depth == 0:
                return j
            continue
        j += 1
    return j


def sql_case_text(case: str) -> str:
    """`case when … then 'A' else 'B' end` → "[A | B]": the words the server picks one of."""
    inner = case[4:-3]
    branches = re.findall(r"(?is)\b(?:then|else)\s+(.+?)(?=\s+\b(?:when|else)\b|$)", inner)
    texts = [sql_string_expr(b + ",", 0) or "{" + sql_placeholder(b) + "}" for b in branches]
    return "[" + " | ".join(t.strip() for t in texts) + "]"


def sql_string_expr(src: str, i: int) -> str | None:
    parts, depth, has_words, buf = [], 0, False, ""
    while i < len(src):
        ch = src[i]
        if depth == 0 and re.match(r"(?i)case\b", src[i:]) and not buf.strip():
            end = sql_case_end(src, i)
            text = sql_case_text(src[i:end])
            parts.append(text)
            if re.search(r"[A-Za-z]{2}", re.sub(r"\{\w+\}", "", text)):
                has_words = True
            i = end
            continue
        if ch == "'":
            j = i + 1
            lit = ""
            while j < len(src):
                if src[j] == "'" and src[j + 1:j + 2] == "'":
                    lit += "'"
                    j += 2
                    continue
                if src[j] == "'":
                    break
                lit += src[j]
                j += 1
            if depth == 0:
                if buf.strip():
                    parts.append("{" + sql_placeholder(buf) + "}")
                buf = ""
                parts.append(lit)
                if re.search(r"[A-Za-z]{2}", lit):
                    has_words = True
            else:
                buf += "'" + lit + "'"
            i = j + 1
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            if depth == 0:
                break
            depth -= 1
        elif ch == "," and depth == 0:
            break
        if depth == 0 and src.startswith("||", i):
            if buf.strip():
                parts.append("{" + sql_placeholder(buf) + "}")
            buf = ""
            i += 2
            continue
        buf += ch
        i += 1
    if buf.strip():
        parts.append("{" + sql_placeholder(buf) + "}")
    text = re.sub(r"\s+", " ", "".join(parts)).strip()
    return text if has_words else None


def sql_placeholder(expr: str) -> str:
    e = expr.strip()
    if re.match(r"(?i)^case\b", e):
        lits = re.findall(r"'([^']*)'", e)
        return "|".join(lits) if lits else "value"
    if re.match(r"(?i)^to_char\(", e):
        return "time" if "HH24" in e and "Dy" not in e else "when"
    ids = re.findall(r"(?:\w+\.)?(\w+)", e)
    ids = [x for x in ids if x.lower() not in ("coalesce", "public", "r", "q", "t", "v", "nullif", "trim", "text", "at", "time",
                                                "zone", "asia", "colombo", "null", "id", "as")]
    if ids:
        return re.sub(r"^v_", "", ids[0])
    return "value"


# ---------------------------------------------------------------------------------------------------------------------
# The driver's pushes, the offline page, the manifests
# ---------------------------------------------------------------------------------------------------------------------

PUSH_KINDS = {
    "new": "a new task is sent to the driver", "changed": "the office changed the driver's task",
    "cancelled": "the driver's task was cancelled", "removed": "the task went to another driver",
    "leave_30": "30 minutes before the leave-by time", "leave_now": "at the leave-by time",
    "accept_reminder": "the driver has not accepted the task yet", "reopened": "the office reopened a finished task",
    "vehicle_taken": "another driver took this driver's vehicle", "vehicle_moved": "the office moved the driver to another vehicle",
    "duty_auto_out": "the day's cut-off clocked the driver out", "duty_office_out": "the office clocked the driver out",
    "ask": "the office asks the driver a question", "free_for_trip": "the office asks: free for a trip?",
    "office_time": "the office asks: when can you be at the office?", "where_now": "the office asks: where are you now?",
}


def push_texts():
    src = (FN / "push-task/index.ts").read_text()
    rows = []
    for name in ("TEXT", "ASK_TEXT", "CHANGE_TEXT", "TYPE_TEXT", "STOP_CHANGE_TEXT", "NO_VEHICLE"):
        m = re.search(rf"const {name}\b[^=]*=\s*\{{", src)
        if not m:
            continue
        i, depth = m.end(), 1
        while i < len(src) and depth:
            if src[i] in "'\"`":
                i = skip_string(src, i)
                continue
            depth += {"{": 1, "}": -1}.get(src[i], 0)
            i += 1
        obj = src[m.end() - 1:i]
        data = json.loads(subprocess.check_output(["node", "-e", f"process.stdout.write(JSON.stringify({obj}))"], text=True))
        en, si = data["en"], data["si"]
        for path, value in flat(en):
            rows.append((f"push-task.{name}.{path}", path, value, dict(flat(si)).get(path, "")))
    return rows


def offline_rows():
    html = (APP / "public/offline.html").read_text()
    title = re.search(r"<title>(.*?)</title>", html).group(1)
    h1 = re.search(r"<h1>(.*?)</h1>", html).group(1)
    p_en = re.search(r"<p>(.*?)</p>", html).group(1)
    p_si = re.search(r'<p class="si"[^>]*>(.*?)</p>', html).group(1)
    button = re.search(r'<button[^>]*>(.*?)</button>', html).group(1)
    b_en, _, b_si = button.partition(" · ")
    return [
        ("m.offline.title", "title (browser tab)", title, ""),
        ("m.offline.heading", "title", h1, ""),
        ("m.offline.text", "text", p_en, p_si),
        ("m.offline.button", "button", b_en, b_si),
    ]


def manifest_rows():
    out = []
    for surface, path in (("office app + /m/", APP / "public/manifest.webmanifest"), ("site", ROOT / "apps/office/public/manifest.webmanifest")):
        data = json.loads(path.read_text())
        for field in ("name", "short_name", "description"):
            if data.get(field):
                out.append((surface, f"{'m' if surface != 'site' else 'site'}.manifest.{field}", field, data[field]))
    return out


# ---------------------------------------------------------------------------------------------------------------------
# The glossary
# ---------------------------------------------------------------------------------------------------------------------

# (term, English regex, case-sensitive?, [(variant shown, Sinhala regex)]). The variants are the words found in the
# current Sinhala for the term (mined from the texts, then read); each is counted in the texts whose English has the term.
GLOSSARY = [
    ("driver", r"\bdrivers?\b", False, [("රියදුරු (රියදුරා, රියදුරෙක්, රියදුරන්…)", r"රියදුර"), ("රියැදුරු", r"රියැදුර"), ("ධාවක", r"ධාවක"),
                                        ("ඩ්‍රයිවර් (English word)", r"ඩ්‍රයිවර්|ඩ්රයිවර්")]),
    ("vehicle", r"\bvehicles?\b", False, [("වාහනය / වාහන…", r"වාහන"), ("රථය", r"රථ")]),
    ("trip", r"\btrips?\b", False, [("ගමන / ගමන්…", r"ගමන"), ("චාරිකාව", r"චාරිකා")]),
    ("task", r"\btasks?\b", False, [("කාර්යය / කාර්ය…", r"කාර්ය(?!ාල|බහුල)"), ("වැඩ", r"වැඩ"), ("රාජකාරිය (duty word)", r"රාජකාරිය(?!ේ|ෙන්|ට)")]),
    ("request", r"\brequests?\b", False, [("ඉල්ලීම…", r"ඉල්ලීම"), ("ඉල්ලන්න (the verb)", r"ඉල්ලන්න"), ("ඉල්ලා", r"ඉල්ලා"), ("ඉල්ලුම්", r"ඉල්ලුම්")]),
    ("approve / approval", r"\bapprov", False, [("අනුමත…", r"අනුමත"), ("අනුමැතිය", r"අනුමැති")]),
    ("decline", r"\bdeclin", False, [("ප්‍රතික්ෂේප", r"ප්‍රතික්ෂේප|ප්රතික්ෂේප"), ("ප්‍රතික්ෂේපයි", r"ප්‍රතික්ෂේපයි")]),
    ("accept", r"\baccept", False, [("පිළිගන්න / පිළිගත්තා…", r"පිළිග"), ("පිලිග (ළ → ල)", r"පිලිග"), ("භාර ගන්න", r"භාර ග")]),
    ("cancel", r"\bcancel", False, [("අවලංගු", r"අවලංගු"), ("අස් කරන්න", r"අස් ?කර")]),
    ("pickup", r"\bpick ?-?ups?\b", False, [("නංවාගැනීම / නංවාගන්නා", r"නංවාග"), ("ගැනීම", r"(?<!නංවා)ගැනීම"), ("රැගෙන", r"රැගෙන")]),
    ("drop-off", r"\bdrop(-| )?offs?\b|\bdrops?\b", False, [("බැස්සවීම", r"බැස්සවීම"), ("බස්සවන", r"බස්සවන"), ("බැහැලීම", r"බැහැල")]),
    ("stop (on a route)", r"\bstops?\b", False, [("නැවතුම…", r"නැවතුම"), ("නවතින / නැවතුණාද", r"නවති|නවත්ව|නැවතුණ"), ("නතර / නවතී (to stop, the verb)", r"නතර|නවතී")]),
    ("on duty", r"\bon duty\b", False, [("රාජකාරියේ", r"රාජකාරියේ"), ("සේවයේ", r"සේවයේ"), ("රාජකාරියට", r"රාජකාරියට")]),
    ("off duty", r"\boff duty\b", False, [("රාජකාරියෙන් පිටත", r"රාජකාරියෙන් පිටත"), ("රාජකාරියෙන් බැහැර", r"රාජකාරියෙන් බැහැර"),
                                         ("සේවයෙන් පිට", r"සේවයෙන් පිට")]),
    ("start work / clock in", r"\bstart work\b|\bclock(ed)? in\b", False, [("වැඩ ආරම්භ", r"වැඩ ආරම්භ"), ("රාජකාරියට", r"රාජකාරියට"),
                                                                         ("වැඩ අරඹ", r"වැඩ අරඹ")]),
    ("finish work / clock out", r"\bfinish work\b|\bclock(ed)? out\b", False, [("වැඩ අවසන්", r"වැඩ අවසන්"),
                                                                              ("රාජකාරියෙන් ඉවත්", r"රාජකාරියෙන් ඉවත්")]),
    ("odometer", r"\bodometer|\bodo\b", False, [("ඔඩෝමීටරය / ඔඩෝමීටර", r"ඔඩෝමීටර"), ("මීටරය / මීටර්", r"(?<!ඔඩෝ)මීටර(?!්)|(?<!ඔඩෝ)මීටර්"),
                                               ("කිලෝමීටර කියවීම", r"කියවීම"), ("ODO (Latin)", r"ODO")]),
    ("fuel", r"\bfuel\b", False, [("ඉන්ධන", r"ඉන්ධන"), ("තෙල්", r"තෙල්")]),
    ("receipt", r"\breceipt", False, [("බිල්පත", r"බිල්පත"), ("රිසිට්පත", r"රිසිට්")]),
    ("issue", r"\bissues?\b", False, [("ගැටලුව / ගැටලු", r"ගැටලු"), ("ප්‍රශ්නය", r"ප්‍රශ්න|ප්රශ්න")]),
    ("coordinator", r"\bcoordinator", False, [("සම්බන්ධීකාරක", r"සම්බන්ධීකාරක"), ("සම්බන්ධීකරණ", r"සම්බන්ධීකරණ")]),
    ("fleet admin", r"\bfleet admin", False, [("වාහන පරිපාලක", r"වාහන පරිපාලක"), ("වාහන කළමනාකරු", r"වාහන කළමනාකරු"), ("පරිපාලක", r"(?<!වාහන )පරිපාලක")]),
    ("admin", r"\badmins?\b", False, [("පරිපාලක…", r"පරිපාලක"), ("කළමනාකරු", r"කළමනාකරු"), ("ඇඩ්මින්", r"ඇඩ්මින්")]),
    ("assign", r"\bassign", False, [("පවරන්න / පැවරීම / පවරා", r"පවර|පැවර"), ("භාර දෙන්න", r"භාර දෙ")]),
    ("self-drive (I'll drive myself)", r"drive (it )?(myself|themselves|yourself)|self-drive", False,
     [("ම පදවයි / පදවමි", r"පදව"), ("ස්වයං", r"ස්වයං"), ("තමන් ම", r"තමන් ?ම")]),
    ("someone else (drives)", r"\bsomeone else\b", False, [("වෙනත් අයෙක්", r"වෙනත් අයෙ"), ("වෙනත් කෙනෙක්", r"වෙනත් කෙනෙ")]),
    ("expired", r"\bexpir", False, [("කල් ඉකුත්", r"කල් ඉකුත්"), ("ඉකුත්", r"(?<!කල් )ඉකුත්"), ("කල් ඉකුත් වූ / විය", r"ඉකුත් (වූ|විය)")]),
    ("leave by (time)", r"\bleave by\b|\bleave-by\b", False, [("පිටත් වන්න / පිටත් වීම", r"පිටත් ?ව"), ("පිටත්වීම (joined)", r"පිටත්වීම"),
                                                              ("යා යුතු", r"යා යුතු")]),
    ("arrived", r"\barriv", False, [("ළඟා විය", r"ළඟා"), ("පැමිණියා / පැමිණිය", r"පැමිණි"), ("පැමිණීම", r"පැමිණීම"), ("ලඟා (ළ → ල)", r"ලඟා"), ("ලැබුණු (a task arrives)", r"ලැබුණ")]),
    ("left (a stop)", r"^Left\b|\bleft at\b|\bLeft\b", True, [("පිටත් වුණා / පිටත් විය", r"පිටත් (වුණා|විය)"), ("පිටව ගියා", r"පිටව")]),
    ("passengers", r"\bpassengers?\b|\bpax\b", False, [("මගීන්", r"මගීන්"), ("මගී", r"මගී(?!න්)"), ("නගී (get in)", r"නගී")]),
    ("km / mileage", r"\bkm\b|\bmileage\b", False, [("කි.මී.", r"කි\.මී"), ("km (Latin)", r"\bkm\b"), ("කිලෝමීටර්", r"කිලෝමීටර"),
                                                  ("ධාවන දුර", r"ධාවන දුර"), ("සැතපුම්", r"සැතපුම්")]),
    ("location", r"\blocation\b", False, [("ස්ථානය…", r"ස්ථාන"), ("පිහිටීම", r"පිහිටීම")]),
    ("sharing (location)", r"\bsharing\b|\bshare\b", False, [("බෙදාගැනීම / බෙදා", r"බෙදා"), ("යවන්න / යැවීම / යවමින්", r"යවන්න|යැවීම|යවමින්")]),
    ("live", r"\blive\b", False, [("සජීවී", r"සජීවී"), ("දැන්", r"දැන්")]),
    ("map", r"\bmaps?\b", False, [("සිතියම…", r"සිතියම")]),
    ("route", r"\broutes?\b", False, [("මාර්ගය", r"මාර්ග"), ("ගමන් මඟ / මග", r"ගමන් ම(ඟ|ග)")]),
    ("timeline", r"\btimeline\b", False, [("කාල රේඛාව (two words)", r"කාල රේඛා"), ("කාලරේඛාව (one word)", r"කාලරේඛා")]),
    ("office", r"\boffice\b", False, [("කාර්යාලය…", r"කාර්යාල"), ("ඔෆිස්", r"ඔෆිස්")]),
    ("custodian", r"\bcustodian", False, [("භාරකරු", r"භාරකරු"), ("භාරකාර", r"භාරකාර")]),
    ("number plate", r"\bplates?\b|number plate", False, [("අංක තහඩුව", r"අංක තහඩු"), ("තහඩුව", r"(?<!අංක )තහඩු"), ("වාහන අංකය / අංකය", r"(?<!ලියාපදිංචි )අංකය"), ("ලියාපදිංචි අංකය", r"ලියාපදිංචි")]),
    ("driving licence", r"\blicen[cs]e\b", False, [("බලපත්‍රය", r"බලපත්‍ර|බලපත්ර"), ("ලයිසන්", r"ලයිසන්")]),
    ("report (a problem)", r"\breport", False, [("වාර්තා කරන්න / වාර්තාව", r"වාර්තා"), ("දන්වන්න", r"දන්වන්න")]),
    ("breakdown", r"\bbreakdown", False, [("කැඩී යාම / කැඩීමක්", r"කැඩී"), ("බිඳ වැටීම", r"බිඳ")]),
    ("accident", r"\baccident", False, [("අනතුර", r"අනතුර(?!ු ඇඟවීම)")]),
    ("garage", r"\bgarage", False, [("ගරාජය", r"ගරාජ"), ("වැඩපොළ", r"වැඩපොළ")]),
    ("service (vehicle)", r"\bservice (due|interval|date)|\bservic(ed|ing)\b|next service", False,
     [("සේවාව / සේවා දිනය / සර්විස්", r"සේවා|සර්විස්"), ("නඩත්තු", r"නඩත්තු")]),
    ("insurance", r"\binsurance", False, [("රක්ෂණය", r"රක්ෂණ")]),
    ("revenue licence", r"\brevenue licen", False, [("ආදායම් බලපත්‍රය", r"ආදායම් බලපත්")]),
    ("emission test", r"\bemission", False, [("දුම් පරීක්ෂණය", r"දුම් පරීක්ෂ")]),
    ("document", r"\bdocuments?\b", False, [("ලේඛනය / ලේඛන", r"ලේඛන"), ("ලියවිලි", r"ලියවිලි")]),
    ("photo", r"\bphotos?\b|\bpicture", False, [("ඡායාරූපය…", r"ඡායාරූප"), ("පින්තූරය", r"පින්තූර"), ("ෆොටෝ", r"ෆොටෝ")]),
    ("notification", r"\bnotification", False, [("දැනුම්දීම්", r"දැනුම්දීම"), ("දැනුම් දීම් (two words)", r"දැනුම් දීම")]),
    ("reminder", r"\breminder", False, [("සිහිකැඳවීම", r"සිහිකැඳවීම"), ("මතක් කිරීම", r"මතක්")]),
    ("waiting", r"\bwaiting\b", False, [("බලා සිටී", r"බලා සිටි|බලා සිටී"), ("බලා නොසිටී", r"බලා නොසිට"), ("බලාපොරොත්තුවෙන්", r"බලාපොරොත්තු"), ("රැඳී", r"රැඳී"), ("යැවීමට ඇත (waiting to send)", r"යැවීමට ඇ")]),
    ("needs a driver", r"\bneeds a driver\b", False, [("රියදුරෙක් අවශ්‍යයි", r"රියදුරෙ(ක්|කු) අවශ්‍ය")]),
    ("missed (task)", r"\bmissed\b", False, [("මඟ හැරුණා (ඟ)", r"මඟ හැර"), ("මග හැරුණා (ග)", r"මග හැර")]),
    ("book / booking", r"\bbook(ing|ed)?\b", False, [("වෙන් කරන්න / වෙන්කිරීම", r"වෙන් ?ක"), ("වෙන් කළ", r"වෙන් කළ")]),
    ("project", r"\bprojects?\b", False, [("ව්‍යාපෘතිය…", r"ව්‍යාපෘති|ව්යාපෘති")]),
    ("place", r"\bplaces?\b", False, [("ස්ථානය…", r"ස්ථාන"), ("තැන", r"තැන")]),
    ("site (operator site)", r"\bsites?\b", False, [("අඩවිය / අඩවි", r"අඩවි"), ("සයිට්", r"සයිට්"), ("ස්ථානය", r"ස්ථාන")]),
    ("start task", r"\bstart task\b|\bstart the task\b|\bstarted\b", False, [("අරඹන්න / ආරම්භ", r"අරඹ|ආරම්භ")]),
    ("complete / finish (a task)", r"\bcomplet|\bfinish", False, [("අවසන්", r"අවසන්"), ("සම්පූර්ණ", r"සම්පූර්ණ")]),
    ("available / free", r"\bavailab|\bfree\b", False, [("නිදහස්", r"නිදහස්"), ("නොමැත (not available)", r"නොමැත"), ("සිටී / සිටින (is there)", r"සිටී|සිටින|සිටිනවා"), ("ලබා ගත හැකි (two words)", r"ලබා ගත"), ("ලබාගත හැකි (one word)", r"ලබාගත"), ("නොහැකි (not able)", r"නොහැකි")]),
    ("busy", r"\bbusy\b", False, [("කාර්යබහුල", r"කාර්යබහුල")]),
    ("late / running late", r"\blate\b", False, [("ප්‍රමාද", r"ප්‍රමාද|ප්රමාද"), ("පමා", r"පමා"), ("පරක්කු", r"පරක්කු")]),
    ("plan / planned", r"\bplann?(ed|ing)?\b", False, [("සැලැස්ම", r"සැලැස්ම"), ("සැලසුම", r"සැලසුම")]),
    ("back by", r"\bback by\b", False, [("ආපසු", r"ආපසු")]),
    ("approver", r"\bapprover", False, [("අනුමත කරන්නා", r"අනුමත කරන්න(ා|ාට)")]),
    ("requester (the person who asked)", r"\brequester|person who asked|the asker", False,
     [("ඉල්ලූ තැනැත්තා / ඉල්ලූ අය", r"ඉල්ලූ"), ("ඉල්ලුම්කරු", r"ඉල්ලුම්කරු")]),
    ("permission", r"\bpermission", False, [("අවසරය / අවසර", r"අවසර")]),
    ("account", r"\baccounts?\b", False, [("ගිණුම", r"ගිණුම")]),
    ("PIN (sign-in code)", r"\bPIN\b", True, [("PIN (Latin)", r"PIN"), ("පින්", r"පින්(?!තූර)")]),
    ("pin (on the map)", r"\bpin(ned|s)?\b", True, [("ලක්ෂ්‍යය", r"ලක්ෂ්‍ය|ලක්ෂ්ය"), ("පින්", r"පින්(?!තූර)"), ("සිතියම් ලකුණ / ලකුණ", r"(?<!ස)ලකුණ"), ("සලකුණ", r"සලකුණ")]),
    ("sign in / sign out", r"\bsign(ed)? (in|out)\b", False, [("ඇතුළු වන්න", r"ඇතුළු"), ("පිවිසෙන්න", r"පිවිස"), ("ඉවත් වන්න / පිටවන්න", r"ඉවත් ව|පිටවන්න")]),
    ("settings", r"\bsettings?\b", False, [("සැකසුම්", r"සැකසුම්"), ("සැකසීම්", r"සැකසීම්")]),
    ("car / van / double cab / lorry", r"\b(cars?|vans?|double cab|lorr(y|ies))\b", False,
     [("කාර්", r"කාර්(?!ය)"), ("වෑන්", r"වෑන්"), ("ඩබල් කැබ්", r"ඩබල් කැබ්"), ("ලොරි", r"ලොරි")]),
]

# ---------------------------------------------------------------------------------------------------------------------
# Building the rows
# ---------------------------------------------------------------------------------------------------------------------


def placeholders_of(text: str) -> list[str]:
    return sorted(set(PLACEHOLDER.findall(text or "")))


def flags(en: str, si: str) -> list[str]:
    out = []
    pe, ps = placeholders_of(en), placeholders_of(si)
    if si:
        missing = [p for p in pe if p not in ps]
        extra = [p for p in ps if p not in pe]
        if missing:
            out.append("⚠ the Sinhala lacks " + ", ".join("{" + p + "}" for p in missing))
        if extra:
            out.append("⚠ the Sinhala has " + ", ".join("{" + p + "}" for p in extra) + " that the English does not")
        if re.search(r"[෦-෯]", si):
            out.append("⚠ Sinhala digits: numbers stay in Latin digits")
        if si.strip() == en.strip() and re.search(r"[A-Za-z]{3}", en) and not re.search(r"[඀-෿]", si):
            out.append("⚠ the Sinhala is the English, untranslated")
    return out


def placeholder_note(text: str) -> str:
    ps = placeholders_of(text)
    if not ps:
        return ""
    return "Placeholders: " + "; ".join("{" + p + "} = " + PLACEHOLDER_MEANING.get(p, "filled in by the app") for p in ps) + "."


def build():
    uses = usages()
    files: dict[str, list[str]] = {}
    pattern_file = "office/statusWords.ts"
    pattern_keys = {k for k, (u, _) in uses.items() if any(rel == pattern_file for rel, _ in u)}
    rows = []

    # 1. The app's keys.
    for key in sorted(KEYS):
        u, by_prefix = uses[key]
        rels = sorted({rel for rel, _ in u})
        office = any(is_office(r) for r in rels)
        driver = any(not is_office(r) for r in rels)
        top = key.split(".")[0]
        # A key the code picks from a group (`office.status.${x}`) takes its element from its own name, not the code around.
        element = element_of(key, [] if by_prefix else u, files)
        if top == "channel" or element.startswith("notification"):
            surface = "notification"
        elif key in pattern_keys:
            surface = "server"
        elif office and driver:
            surface = "driver app + office app + /m/"
        elif office or top == "office":
            surface = "office app + /m/"
        else:
            surface = "driver app"
        screens = sorted({screen_of(r) for r in rels})
        screen = "; ".join(screens[:3]) + (f" (+{len(screens) - 3} more)" if len(screens) > 3 else "")
        notes = [group_note(key)] if group_note(key) else []
        if key in pattern_keys:
            notes.append("A server sentence, said in the person's language by Office mode (the app reads the English the server "
                         "sends and shows this).")
        if top == "channel":
            notes.append("Android's notification settings list this channel under the app.")
        if not rels:
            notes.append("Not found in the code: possibly unused.")
        elif by_prefix:
            notes.append("Chosen by the code from a group of keys (a status, a reason, a kind).")
        en, si = str(EN[key]), str(SI.get(key, ""))
        if top in ("days", "daysShort", "months"):
            notes.append("Day and month names (dates are shown in words: Today, Mon 19 Oct).")
        ph = placeholder_note(en)
        if ph:
            notes.append(ph)
        notes += flags(en, si)
        rows.append({
            "id": key, "surface": surface, "screen": screen or "(not found in the code)", "element": element, "English": en,
            "current Sinhala": si, "placeholders": " ".join("{" + p + "}" for p in placeholders_of(en)),
            "max length": MAX_LEN.get(element, ""), "notes": " ".join(notes),
        })

    # 2. The driver's pushes.
    for pid, path, en, si in push_texts():
        kind = path.split(".")[0]
        field = path.split(".")[-1]
        element = "notification title" if field == "title" else "notification body" if field == "body" else "notification text (part)"
        what = PUSH_KINDS.get(kind)
        note = f"A push to the driver's phone when {what}." if what else "A part of a push to the driver (what changed)."
        rows.append({
            "id": pid, "surface": "notification", "screen": "Driver · phone notification", "element": element, "English": en,
            "current Sinhala": si, "placeholders": " ".join("{" + p + "}" for p in placeholders_of(en)),
            "max length": MAX_LEN.get(element, ""), "notes": " ".join(x for x in [note, placeholder_note(en)] + flags(en, si) if x),
        })

    # 3. The /m/ offline page and the manifests.
    for rid, element, en, si in offline_rows():
        rows.append({
            "id": rid, "surface": "office app + /m/", "screen": "/m/ · No connection page", "element": element, "English": en,
            "current Sinhala": si, "placeholders": "", "max length": MAX_LEN.get(element, ""),
            "notes": "Shown when the mobile website opens with no connection; both languages on one page." +
                     ("" if si else " English only today."),
        })
    for surface, rid, field, en in manifest_rows():
        rows.append({
            "id": rid, "surface": surface, "screen": "Install (home-screen icon, app list)", "element": f"manifest {field}",
            "English": en, "current Sinhala": "", "placeholders": "", "max length": "12 (under the home-screen icon)" if field == "short_name" else "",
            "notes": "The installed web app's " + {"name": "name", "short_name": "name under the icon",
                                                   "description": "description"}[field] + ". One language only (a manifest has no translation); English today.",
        })

    # 4. The server's sentences (English only unless Office mode reads them back).
    server = server_sentences() + sql_notifications()
    seen = set()
    unique = []
    for sid, element, screen, text in server:
        if (screen, text) in seen:
            continue
        seen.add((screen, text))
        unique.append((sid, element, screen, text))
    samples = [fill_samples(text) for _, _, _, text in unique]
    matched = match_patterns(samples)
    for (sid, element, screen, text), keys in zip(unique, matched):
        is_notif = element.startswith("notification")
        if keys:
            si = SI.get(keys[0], "")
            note = f"Office mode says it in Sinhala through the key {keys[0]} (its row above has the same Sinhala)."
        else:
            si = ""
            note = ("An office notification (web push, Office mode, the notification centre): English only today." if is_notif
                    else "Shown as the server says it: English, also on Sinhala screens (no Sinhala yet).")
        rows.append({
            "id": sid, "surface": "notification" if is_notif else "server", "screen": screen, "element": element, "English": text,
            "current Sinhala": si, "placeholders": " ".join("{" + p + "}" for p in placeholders_of(text)),
            "max length": MAX_LEN.get(element, ""), "notes": " ".join(x for x in [note, placeholder_note(text)] if x),
        })
    # One id per row: a function that queues the same event twice gets #2, #3.
    count = collections.Counter()
    for r in rows:
        count[r["id"]] += 1
        if count[r["id"]] > 1:
            r["id"] = f'{r["id"]}#{count[r["id"]]}'
    return rows


SAMPLE = {"time": "08:30", "leave": "08:30", "at": "08:30", "until": "12:00", "from": "08:30", "to": "12:00", "n": "3", "km": "12",
          "min": "15", "count": "2", "reg_no": "WP CAB-4521", "plate": "WP CAB-4521", "vehicle": "WP CAB-4521", "name": "Kamal Perera",
          "driver": "Kamal Perera", "title": "Team drop", "window": "08:30–10:00", "when": "Thu 22 Oct 08:30", "day": "Thu 22 Oct"}


def fill_samples(text: str) -> str:
    return PLACEHOLDER.sub(lambda m: SAMPLE.get(m.group(1), "Kurunegala site"), text)


def match_patterns(sentences: list[str]) -> list[list[str]]:
    tmp = OUT / ".patterns-in.json"
    tmp.write_text(json.dumps(sentences))
    try:
        env = dict(os.environ)
        res = subprocess.run([str(APP / "node_modules/.bin/tsx"), str(ROOT / "scripts/i18n/patterns.ts"), str(tmp)],
                             cwd=APP, capture_output=True, text=True, env=env, check=True)
        return json.loads(res.stdout)
    finally:
        tmp.unlink(missing_ok=True)


SURFACE_ORDER = ["driver app", "driver app + office app + /m/", "office app + /m/", "notification", "server", "site"]


def order_and_group(rows):
    rows.sort(key=lambda r: (SURFACE_ORDER.index(r["surface"]) if r["surface"] in SURFACE_ORDER else 99, r["screen"], r["id"]))
    by_en = collections.defaultdict(list)
    for r in rows:
        by_en[r["English"].strip()].append(r)
    groups = {}
    n = 0
    for r in rows:
        members = by_en[r["English"].strip()]
        if len(members) > 1 and r["English"].strip() not in groups:
            n += 1
            groups[r["English"].strip()] = f"G{n:03d} ({len(members)} rows)"
    out, placed = [], set()
    for r in rows:
        if id(r) in placed:
            continue
        members = by_en[r["English"].strip()] if r["English"].strip() in groups else [r]
        for m in members:
            m["same English (group)"] = groups.get(m["English"].strip(), "")
            out.append(m)
            placed.add(id(m))
    return out


def chunks(rows):
    """At most MAX_ROWS rows a file; a group of identical English never split."""
    files, cur = [], []
    i = 0
    while i < len(rows):
        g = rows[i]["same English (group)"]
        j = i + 1
        while g and j < len(rows) and rows[j]["same English (group)"] == g:
            j += 1
        block = rows[i:j]
        if cur and len(cur) + len(block) > MAX_ROWS:
            files.append(cur)
            cur = []
        cur.extend(block)
        i = j
    if cur:
        files.append(cur)
    return files


def glossary(rows):
    out = []
    # Placeholders ({plate}, {stop}) are not words: left out of both sides.
    strip = lambda s: PLACEHOLDER.sub("", s)
    texts = [(strip(r["English"]), strip(r["current Sinhala"])) for r in rows if r["current Sinhala"]]
    for term, en_rx, case, variants in GLOSSARY:
        rx = re.compile(en_rx, 0 if case else re.I)
        hits = [(en, si) for en, si in texts if rx.search(en)]
        found = []
        covered = 0
        for label, si_rx in variants:
            vr = re.compile(si_rx)
            c = sum(1 for _, si in hits if vr.search(si))
            if c:
                found.append(f"{label}: {c}")
        for _, si in hits:
            if any(re.search(v, si) for _, v in variants):
                covered += 1
        latin_variant = any(re.search(r"[A-Za-z]", label) and not re.search(r"[\u0D80-\u0DFF]", label.split(" (")[0]) for label, _ in variants)
        english_kept = sum(1 for en, si in hits if re.search(en_rx, si, 0 if case else re.I))
        if english_kept and not latin_variant:
            found.append(f"(the English word kept: {english_kept})")
        out.append({
            "term": term, "texts with the term": len(hits),
            "current Sinhala variants (texts using each)": " · ".join(found) if found else "(none found)",
            "texts with none of these": len(hits) - covered,
            "Chosen Sinhala": "", "Note": "",
        })
    return out


# ---------------------------------------------------------------------------------------------------------------------
# Writing: CSV and a plain xlsx (no library needed)
# ---------------------------------------------------------------------------------------------------------------------

BAD_XML = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def col_name(i: int) -> str:
    s = ""
    i += 1
    while i:
        i, r = divmod(i - 1, 26)
        s = chr(65 + r) + s
    return s


def sheet_xml(header, rows, widths, yellow_cols=()):
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
           '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>'
           '</sheetView></sheetViews>', "<cols>"]
    for i, w in enumerate(widths):
        out.append(f'<col min="{i + 1}" max="{i + 1}" width="{w}" customWidth="1"/>')
    out.append("</cols><sheetData>")
    all_rows = [header] + [[r.get(h, "") for h in header] for r in rows]
    for ri, values in enumerate(all_rows):
        out.append(f'<row r="{ri + 1}">')
        for ci, v in enumerate(values):
            style = 1 if ri == 0 else (3 if header[ci] in yellow_cols else 2)
            ref = f"{col_name(ci)}{ri + 1}"
            if isinstance(v, int) and ri > 0:
                out.append(f'<c r="{ref}" s="{style}"><v>{v}</v></c>')
            else:
                text = escape(BAD_XML.sub("", str(v)))
                out.append(f'<c r="{ref}" s="{style}" t="inlineStr"><is><t xml:space="preserve">{text}</t></is></c>')
        out.append("</row>")
    out.append("</sheetData>")
    out.append(f'<autoFilter ref="A1:{col_name(len(header) - 1)}{len(all_rows)}"/>')
    out.append("</worksheet>")
    return "".join(out)


STYLES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD9E2F3"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="4">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs></styleSheet>"""


def write_xlsx(path: pathlib.Path, sheets):
    """sheets: [(name, header, rows, widths, yellow_cols)]"""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
                   '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
                   + "".join(f'<Override PartName="/xl/worksheets/sheet{i + 1}.xml" '
                             f'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
                             for i in range(len(sheets)))
                   + "</Types>")
        z.writestr("_rels/.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                   'Target="xl/workbook.xml"/></Relationships>')
        z.writestr("xl/workbook.xml",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
                   'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>'
                   + "".join(f'<sheet name="{escape(s[0])}" sheetId="{i + 1}" r:id="rId{i + 1}"/>' for i, s in enumerate(sheets))
                   + "</sheets>"
                   + "<definedNames>" + "".join(
                       f'<definedName name="_xlnm._FilterDatabase" localSheetId="{i}" hidden="1">'
                       f"'{escape(s[0])}'!$A$1:${col_name(len(s[1]) - 1)}${len(s[2]) + 1}</definedName>" for i, s in enumerate(sheets))
                   + "</definedNames></workbook>")
        z.writestr("xl/_rels/workbook.xml.rels",
                   '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                   '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   + "".join(f'<Relationship Id="rId{i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
                             f'Target="worksheets/sheet{i + 1}.xml"/>' for i in range(len(sheets)))
                   + f'<Relationship Id="rId{len(sheets) + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" '
                     'Target="styles.xml"/></Relationships>')
        z.writestr("xl/styles.xml", STYLES)
        for i, (name, header, rows, widths, yellow) in enumerate(sheets):
            z.writestr(f"xl/worksheets/sheet{i + 1}.xml", sheet_xml(header, rows, widths, yellow))


def write_csv(path: pathlib.Path, header, rows):
    with path.open("w", encoding="utf-8-sig", newline="") as f:
        w = csv.writer(f)
        w.writerow(header)
        for r in rows:
            w.writerow([r.get(h, "") for h in header])


README = [
    ("What this is", "Every text a person sees in Fame Fleet that has, or should have, Sinhala: the driver app, Office mode (the "
                     "office's app; the same screens are the mobile website /m/), the server's sentences shown to people, the "
                     "notifications and Android's notification channels. The desktop website is English only (it has no Sinhala)."),
    ("How to review", "Read 'English' and 'current Sinhala'. If the Sinhala is wrong, unclear or inconsistent, write the better "
                      "Sinhala in 'Corrected Sinhala' and why in 'Reason'. Leave both empty when the Sinhala is right. An empty "
                      "'current Sinhala' means there is no Sinhala yet (shown in English today): write one if it should have one."),
    ("Keep exactly", "Every {placeholder} in the 'placeholders' column must stay, spelled the same, anywhere in the sentence. "
                     "Numbers, times, number plates and LKR amounts stay in Latin digits (0–9), never Sinhala digits."),
    ("Max length", "For buttons, chips, tabs and notification titles: how many characters fit on one line at phone width "
                   "(the narrowest phone, 360 dp, with the app's margins). Counted as typed: Sinhala vowel signs and the "
                   "hal kirīma (්) count as characters, so a Sinhala text near the limit usually still fits. Empty = it wraps."),
    ("Same English (group)", "Rows with identical English share a group (G001…) and sit together, so they can be checked as one. "
                             "They may need different Sinhala on different screens: say so in 'Reason'."),
    ("[A | B]", "In a server sentence, the server picks one of the choices in brackets (a task or a request, the kind of "
                "question): translate each choice."),
    ("⚠ in notes", "Something to check: a placeholder missing or extra in the Sinhala, Sinhala digits, or a Sinhala that is "
                   "still the English."),
    ("Glossary", "The repeated fleet words with every Sinhala word found for each and how many texts use it. Pick one in "
                 "'Chosen Sinhala'; the corrections will then follow it everywhere."),
    ("Surfaces", "driver app = the drivers' screens; office app + /m/ = Office mode and the mobile website; "
                 "driver app + office app + /m/ = parts both use (dates, lists, the time picker); server = sentences the "
                 "server writes (refusals, warnings, status lines); notification = pushes and Android's channel names; "
                 "site = the desktop website (its install name only)."),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rows = order_and_group(build())
    gl = glossary(rows)
    gl_header = ["term", "texts with the term", "current Sinhala variants (texts using each)", "texts with none of these",
                 "Chosen Sinhala", "Note"]
    readme_rows = [{"topic": k, "text": v} for k, v in README]
    parts = chunks(rows)
    for old in OUT.glob("sinhala-review*"):
        old.unlink()
    widths = [30, 16, 30, 16, 44, 44, 16, 14, 50, 14, 44, 30]
    for n, part in enumerate(parts, 1):
        stem = "sinhala-review" if len(parts) == 1 else f"sinhala-review-{n}"
        write_xlsx(OUT / f"{stem}.xlsx", [
            ("Review", COLUMNS, part, widths, ("Corrected Sinhala", "Reason")),
            ("Glossary", gl_header, gl, [30, 10, 80, 10, 30, 30], ("Chosen Sinhala", "Note")),
            ("Read me", ["topic", "text"], readme_rows, [22, 120], ()),
        ])
        write_csv(OUT / f"{stem}.csv", COLUMNS, part)
    write_csv(OUT / "sinhala-review-glossary.csv", gl_header, gl)
    counts = collections.Counter(r["surface"] for r in rows)
    with_si = collections.Counter(r["surface"] for r in rows if r["current Sinhala"])
    groups = len({r["same English (group)"] for r in rows if r["same English (group)"]})
    print(f"{len(rows)} rows in {len(parts)} file(s) ({', '.join(str(len(p)) for p in parts)}); {groups} groups of identical English")
    for s in SURFACE_ORDER:
        if counts[s]:
            print(f"  {s}: {counts[s]} rows, {with_si[s]} with Sinhala")
    print(f"glossary: {len(gl)} terms")


if __name__ == "__main__":
    sys.exit(main())
