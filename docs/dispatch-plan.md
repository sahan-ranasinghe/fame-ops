# Phase 5: dispatch with stops, leave-by time, permissions per person, issues and notifications, driver accept/decline, vehicle booking by type (plan)

Status: plan, written 13 October 2026 after reading CLAUDE.md, `docs/office-web-plan.md`,
`supabase/functions/_shared/fleet/*`, `office-api`, `office-mcp`, `push-task`, the migrations,
`apps/office/src` and `apps/driver/src`. Nothing is built. Sahan reviews this first.

The rules of the whole phase (from the prompt) stand: one branch per part, commit and
fast-forward merge when the part's tests pass; a checkpoint before any migration push,
function deploy, secret, eas update, web redeploy or build; a change after a go is shown
before it is deployed; everything works with none of the new secrets set; schema changes are
new migrations, everything additive; `scripts/tool-shapes.json` stays additive; every office
write is audited through `run.ts`; the driver app stays simple and gets no new native module.

## 0. Decisions I made while reading, for Sahan to confirm or change

These are the places where the prompt left a choice or where the code differs from what the
prompt assumes. Each has a default; the work follows the default unless Sahan says otherwise.

1. **The office app has no text system.** Every string in `apps/office/src` is inline English
   (the app is English-only by design; the artifact too). Building an i18n layer would touch
   every screen for no user. Default: new office screens keep inline English, as today. The
   driver app's `en.json` + `si.json` carry every new driver string.
2. **What `view` gives `staff`.** Decided by Sahan (13 October 2026, the boss's instruction):
   every office user sees drivers, live locations and the fleet. Every existing row, staff
   included, and every new user gets `view`; the tick-box lets an admin remove it per person.
   Request-only is possible, never the default.
3. **Requester-only accounts.** A person with `request` and no `view` must still see their own
   requests, the task that came from one, places and projects. So four read tools accept
   `view` **or** `request`, and with `request` alone they answer the person's own rows only
   (the same "own rows" code that `staff` has today, now keyed on the permission).
4. **Places.** The prompt puts `add_place` under `vehicles`. A dispatcher planning stops needs
   to save a place with a pin. Default: `add_place` needs `vehicles` **or** `assign_tasks`.
5. **`import_projects`** is not named in the prompt. Default: `vehicles` (reference data, like
   places and drivers). `suggest_vehicles` and `plan_task`: `approve` or `assign_tasks`.
6. **Order of work** is not the numbering: Part 3's issue rules read `leave_by`, `accepted_at`
   and `declined`, and Part 6's booking sends Part 3's notifications. Order: 1, 2, 4, 5, 3a
   (issues), 3b (web push), 6, 7. Section 2 has the table.
7. **Four deploy checkpoints** (decided by Sahan, 13 October 2026): after Part 2
   (permissions), after Part 5 (stops + accept/decline, with an eas update for the phones),
   after Part 3b (issues + push) and after Part 7. Every other part ends with a local
   checkpoint (code + test results). Each deploy waits for a go; the Teams artifact file is
   rebuilt only at Part 7.
8. **Stops not done at "Complete task".** Today the app silently marks every open stop `done`
   when the task is finished. Default: after the confirm ("2 stops are not done. Finish
   anyway?") they become `skipped` with the reason `not_visited`, so the office sees the truth.
9. **Skip reasons** are four fixed choices (Closed / Nobody there / Not needed / Other) with an
   optional note, stored in two new columns `task_stops.skip_reason` and `skip_note`
   (additive; the prompt's column list did not name a place for the reason).
10. **Editing stops never deletes** (decided by Sahan, 13 October 2026). The pending stops of
    the old plan get the status `removed` (an additive enum value) and stay in the table for
    history and audit; the new stops are inserted after them (`seq` continues). Removed stops
    are kept out of every list, the planner, the driver app and the pushes. The replacement and
    the `plan_version` check run in one ordinary RPC (`office_update_task_stops`, the caller's
    own privileges, like `office_create_task`); no SECURITY DEFINER delete anywhere.
11. **Cancelling an approved request** needs a tool that does not exist: `cancel_request`
    (`approve`), plus one more notification event, `vehicle.booking_cancelled` → custodian
    (the prompt lists the events but says the custodian is pushed on cancel).
12. **`vehicle_requests.requested_by_user_id`**: `requested_by_employee_id` already links the
    person. Default: the new column holds the Auth user id of the account that submitted the
    request (web or personal key), `requested_by_employee_id` stays the link to `employees`.
    "Seen" in the requester's timeline needs `seen_at` + `seen_by` on the request (set the first
    time someone with `approve` opens it: `suggest_vehicles` or `decide_request`).
13. **`removed` push on reassign.** Today a driver change always pushes "Task reassigned" to
    the previous driver. The prompt: only when he had accepted it. Default: follow the prompt
    (never for a declined task, never for an unaccepted one).
14. **Accounts page.** The prompt puts Users under Settings. Default: Settings becomes a
    section (`/settings`: sign-in; `/settings/users`; `/settings/notifications`;
    `/settings/fleet`), the old `/accounts` route redirects to `/settings/users`, the nav item
    "Accounts" becomes "Settings". Users and Fleet settings work in the artifact too;
    Sign-in and Notifications are web-only (they talk to Supabase Auth / the browser).
15. **Web Push library.** Deno has no built-in Web Push. Default: `jsr:@negrel/webpush`
    (Deno-native VAPID + RFC 8291 encryption). If it fails `deno check`, I write the two
    pieces by hand with WebCrypto (ES256 JWT, aes128gcm); about 150 lines, tested.
16. **PWA icons** are made by a script that renders the FF logo with the Playwright Chromium
    already used for the e2e (no image library, no download) into `public/icons/*.png`.
17. **Reminders and the `fleet-jobs` function.** Leave-by reminders and the accept reminder are
    pure SQL on a pg_cron minute job calling the existing `push-task` through pg_net (new
    kinds). Issue sync and ETAs need TypeScript (they reuse `fleet.ts`): one new Edge Function
    `fleet-jobs` (x-server-key, like `push-task`) run by pg_cron every 5 minutes and by the
    triggers of the events that cause issues. `notify-office` is the second new function.
18. **`fleet_overview` keeps itself fresh**: it runs the issue sync in-process when the last
    sync is older than 2 minutes, so needs-attention is right even if cron is late.
19. **Routing provider limits** are applied per isolate for the per-minute throttle (Edge
    Functions run in a few isolates; the daily count is in the database and exact).
20. **`list_vehicles.status`** keeps its three old values (the Teams artifact and the Vehicles
    filters read them). The new wording Free / On a task (back ~HH:MM) / Booked later today /
    In garage goes in a new field `availability`, plus `assigned_to`.

## 1. What changes, in one picture

```
 Fame Driver ───── accept / decline (RPC) · stops Arrived/Done/Skip · "On duty" wording
                   leave-by reminders (push-task, kinds leave_30 / leave_now / accept_reminder)
        │
 Supabase ──────── employees.permissions · issues + issue_events · notifications (outbox)
                   web_push_subscriptions · notification_settings · fleet_settings
                   task_stops (+what, dwell, arrive_by, planned times, skip) · tasks (+start,
                   leave_by, plan_json, accept/decline, reminders) · task_assignment_events
                   route_legs (cache) · routing_calls · task_eta · vehicles.custodian
                   pg_cron: fleet-sync (5 min) · task-reminders (1 min) · notify-retry (5 min)
        │
 _shared/fleet ─── permissions.ts (tool → permission) · plan.ts (pure planner) · routing.ts
                   (ors | google | estimate + cache) · eta.ts · issues.ts (syncIssues)
                   notifications.ts (outbox writer) · tools: plan_task, update_task_stops,
                   list_issues, update_issue, issue_history, book_vehicle, cancel_request,
                   update_office_user, get/update_settings, notification + web push tools
        │
 Edge Functions ── office-api (/me + permissions) · office-mcp (actor permissions)
                   push-task (new kinds) · fleet-jobs (new) · notify-office (new)
        │
 Office web app ── menu from permissions (locked items, No access page) · Settings section
 + artifact        (Users, Notifications, Fleet) · Issues page + bell · Assign with stops editor
                   and plan panel · Tasks "Needs a driver" column · Reassign with suggestions
                   · one-step booking · Vehicles "Assigned to" + availability · PWA + web push
```

## 2. Order of work, branches, checkpoints

| # | branch | builds | migration | checkpoint shows | days |
|---|---|---|---|---|---|
| 1 | `driver-on-duty-wording` | driver app strings only (en + si), channel name | none | the diff of `en.json`, the grep results, typecheck + `test:track` + `test:data` | 0.5 |
| 2 | `permissions-per-person` | `employees.permissions`, `permissions.ts`, office-api `/me`, office-mcp actor, `create_office_user` / `update_office_user` / `list_office_users`, web menu with locks, No access page, Settings → Users | `permissions` | Deno permission tests, pgTAP, connector suite both channels, Vitest, e2e (locked menu) | 2 |
| 4 | `stops-and-leave-by` | migration (stops, tasks plan columns, `fleet_settings`, `route_legs`, `routing_calls`, `task_eta`), `routing.ts`, `plan.ts`, `eta.ts`, tools (`create_task` stops, `plan_task`, `update_task_stops`, `task_detail`, `task_board`, settings tools), reminders cron + `push-task` kinds, web stops editor + plan panel + ETA, driver app stops and leave-by | `task_plan` | Deno planner + routing tests, connector suite, Vitest, e2e, driver tests; a plan of a real-looking day printed | 5 |
| 5 | `driver-accept-decline` | migration (accept/decline columns, `task_assignment_events`, RPCs, trigger changes), tools (`reassign_task`, `cancel_task`, `task_board` declined column, `list_drivers` counts), web status lines + Needs a driver + Reassign with suggestions, driver app Accept / Can't do this task | `task_accept_decline` | pgTAP for the RPCs, connector suite, driver `test:data` (offline replay), e2e (accept/decline/reassign) | 2.5 |
| 3a | `issues-centre` | migration (`issues`, `issue_events`, Realtime, RLS), `issues.ts` + `syncIssues`, `fleet-jobs`, `fleet_overview` from issues, tools (`list_issues`, `update_issue`, `issue_history`), web bell + Issues page + item page, `update_vehicle_report` mirror | `issues` | Deno dedupe tests, connector suite, Vitest, e2e (issue flow) | 2.5 |
| 3b | `office-web-push` | migration (`notifications`, `web_push_subscriptions`, `notification_settings`, triggers, cron retry), `notifications.ts`, `notify-office`, events wired into tools and RPCs, PWA (manifest, icons, `sw.js`), Settings → Notifications, tools for subscriptions and per-event toggles | `notifications` | Deno tests of the outbox writer, connector suite (rows in the outbox), a local `notify-office` run with throwaway VAPID keys, e2e (Settings → Notifications renders) | 2.5 |
| 6 | `custodians-and-booking` | migration (`vehicles.custodian_*`, requests columns + `cancelled`), tools (`list_vehicles` availability, `update_vehicle` custodian, `create_request`, `list_requests` timeline, `suggest_vehicles` groups, `book_vehicle`, `cancel_request`), web Request form by type, My requests timeline, Assign now section, Vehicles "Assigned to" | `custodians_booking` | connector suite (one-step booking in one transaction), Vitest, e2e (one-step booking) | 2.5 |
| 7 | `phase5-finish` | CLAUDE.md, docs, README, artifact build, message for the Teams chat, test plan, Sinhala list; then the deploy on Sahan's go | none | everything green: pgTAP, Deno, both connector channels + shapes, office checks, driver checks; the artifact file path and `capabilities.json` | 1.5 |

About 19 working days. Each checkpoint names the commit; a go covers exactly the commit
shown. Four deploy rounds, each on its own go:

| after | pushes | deploys | phones | web | artifact |
|---|---|---|---|---|---|
| Part 2 | `permissions` | office-mcp, office-api | no | yes | test artifact only |
| Part 5 | `task_plan`, `task_accept_decline` | office-mcp, office-api, push-task | `eas update` (preview) | yes | test artifact only |
| Part 3b | `issues`, `notifications` | office-mcp, office-api, fleet-jobs, notify-office | no | yes (PWA) | test artifact only |
| Part 7 | `custodians_booking` | office-mcp, office-api | `eas update` if the app changed | yes | test artifact + the Teams file and message |

Order inside a round: `db push` → `functions deploy` → `eas update` → web build + wrangler →
republish. Secrets are set by Sahan before the round that needs them (section 9).

## 3. Data model: the six migrations

Everything is additive: no column, tool, argument or result field is removed or renamed.
Check constraints that list values are dropped and re-created with more values (the only
way to add an enum value to a `check`). Every new function gets `revoke all ... from public,
anon, authenticated` as the schema's convention; every new table gets RLS with no driver
policy unless stated.

### 3.1 `permissions` (Part 2)

```sql
alter table employees add column permissions text[] not null default '{view}';
alter table employees add constraint employees_permissions_check
  check (permissions <@ array['view','request','approve','assign_tasks','vehicles','issues','users']);
update employees set permissions = case role
  when 'admin'       then '{view,request,approve,assign_tasks,vehicles,issues,users}'
  when 'fleet_admin' then '{view,request,approve,assign_tasks,vehicles,issues}'
  when 'office'      then '{view,request,assign_tasks}'
  when 'staff'       then '{view,request}'      -- the boss: every office user sees the fleet
  when 'viewer'      then '{view}'
  else '{}' end;                                 -- drivers
-- The permission check for RLS (replaces current_office_role() in the three office policies).
create function office_can(p text) returns boolean  -- security definer, stable
  -- exists (employee of auth.uid(), active, role in the five office roles, p = any(permissions))
-- driver_latest_select_office, tasks_select_office, task_stops_select_office:
--   drop + create with using (public.office_can('view'))
```

`current_office_role()` stays (other code may call it). `create_driver` inserts
`permissions '{}'`. `role` stays a label shown in lists and used by nothing on the server
except the "is this an office account" check (`OFFICE_ROLES`).

### 3.2 `task_plan` (Part 4)

```sql
alter table task_stops
  add column what text check (what in ('people','goods','documents','other')),
  add column note text,
  add column dwell_min integer check (dwell_min between 0 and 1440),
  add column arrive_by timestamptz,
  add column planned_arrive_at timestamptz,
  add column planned_depart_at timestamptz,
  add column skip_reason text check (skip_reason in ('closed','nobody_there','not_needed','not_visited','other')),
  add column skip_note text,
  add column removed_at timestamptz;
alter table task_stops drop constraint task_stops_status_check;
alter table task_stops add constraint task_stops_status_check
  check (status in ('pending','arrived','done','skipped','removed'));   -- removed = edited out by the office, kept for history
grant update (status, arrived_at, done_at, skip_reason, skip_note) on task_stops to authenticated;
-- task_stops_update_own_in_progress (drivers) additionally refuses the value 'removed' (with check).
create function office_update_task_stops(p_task_id uuid, p_version integer, p_stops jsonb, p_task jsonb) returns integer;
--   the caller's privileges (service_role): update tasks ... where plan_version = p_version (else raise 'version changed');
--   pending stops -> status 'removed', removed_at = now(); the new stops inserted with seq after the kept ones;
--   plan columns from p_task; returns the new plan_version.

alter table tasks
  add column start_place_id uuid references places(id),
  add column start_name text,
  add column start_lat double precision, add column start_lng double precision,
  add column return_to_base boolean not null default false,
  add column avoid_expressway boolean not null default false,
  add column leave_by timestamptz,
  add column leave_by_source text check (leave_by_source in ('plan','manual')),
  add column buffer_min integer,
  add column plan_json jsonb,
  add column reminder_30_sent_at timestamptz,
  add column reminder_0_sent_at timestamptz,
  add column plan_version integer not null default 0;
-- tasks_notify_push: also push 'changed' when plan_version changes (stops edited).

create table fleet_settings (key text primary key, value jsonb not null,
  updated_at timestamptz not null default now(), updated_by text);
-- seeded with the defaults of section 6; base_place_id null until an admin picks a real
-- place in Settings (sample names from the design are never seeded).

create table route_legs (                      -- the 30-day cache, one row per leg and provider
  id bigint generated always as identity primary key,
  from_lat numeric(7,3) not null, from_lng numeric(7,3) not null,
  to_lat numeric(7,3) not null, to_lng numeric(7,3) not null,
  avoid_expressway boolean not null, provider text not null check (provider in ('ors','google','estimate')),
  km real not null, minutes real not null, via_expressway boolean,
  computed_at timestamptz not null default now(),
  unique (from_lat, from_lng, to_lat, to_lng, avoid_expressway, provider));

create table routing_calls (day date not null, provider text not null, calls integer not null default 0,
  errors integer not null default 0, primary key (day, provider));
create function bump_routing_calls(p_provider text, p_ok boolean) returns void;  -- upsert +1

create table task_eta (task_id uuid primary key references tasks(id), computed_at timestamptz not null,
  next_seq integer, next_eta_at timestamptz, final_eta_at timestamptz, late_min integer, source text);

-- Reminders: a pg_cron minute job. Idempotent through the reminder columns (set in the same statement).
create function queue_task_reminders() returns integer;   -- security definer
--   leave_by in (now, now + 30 min], reminder_30_sent_at null, status = 'assigned' -> send_push(id,'leave_30',driver)
--   leave_by <= now, reminder_0_sent_at null, status = 'assigned'                  -> send_push(id,'leave_now',driver)
select cron.schedule('task-reminders', '* * * * *', $$select public.queue_task_reminders()$$);

alter table push_log drop constraint push_log_kind_check;   -- re-created with the new kinds
--   ('new','changed','cancelled','removed','leave_30','leave_now','accept_reminder')
```

Row Level Security: drivers read `task_stops` of their own tasks already (`select` grant is
whole-table), so the new stop columns reach the app; `fleet_settings`, `route_legs`,
`routing_calls`, `task_eta` are service-role only.

**As built (13 October 2026, migration `20261014110000_task_plan`).** Everything above,
plus: `task_stops.status` gains `removed` (the office's edits never delete a stop) and
`skip_reason` includes `not_visited` (the driver's unfinished stops at Save & finish);
`tasks.plan_version` (integer, default 0) guards `update_task_stops`; `office_create_task`
accepts the new task and stop fields and `office_update_task_stops(p_task_id, p_version,
p_task, p_stops)` marks the pending stops removed and appends the new ones with the
sequence continuing (so history keeps every stop a task ever had); `fleet_settings` is
seeded with the eight keys and `base_place_id` = null (no sample place); `route_legs`,
`routing_calls` (+ `bump_routing_calls`) and `task_eta` are service-role only;
`queue_task_reminders()` runs every minute (pg_cron `task-reminders`) and sends leave_30 /
leave_now once each through `send_push`; `tasks_notify_push` also fires on a
`plan_version` change (kind `changed`). pgTAP: `supabase/tests/database/task_plan.test.sql`.

### 3.3 `task_accept_decline` (Part 5)

```sql
alter table tasks drop constraint tasks_status_check;
alter table tasks add constraint tasks_status_check
  check (status in ('assigned','in_progress','completed','cancelled','declined'));
alter table tasks
  add column accepted_at timestamptz,
  add column declined_at timestamptz,
  add column declined_by uuid references employees(id),
  add column declined_reason text check (declined_reason in ('vehicle_problem','not_available','unwell','other')),
  add column declined_note text,
  add column declined_after_accept boolean not null default false,
  add column accept_reminder_sent_at timestamptz;

create table task_assignment_events (
  id bigint generated always as identity primary key,
  task_id uuid not null references tasks(id), at timestamptz not null default now(),
  action text not null check (action in ('assigned','accepted','declined','reassigned','cancelled')),
  employee_id uuid references employees(id), vehicle_id uuid references vehicles(id),
  actor text, note text);
-- Drivers read the events of their own tasks (RLS); office reads through the tools.

create function accept_task(p_task_id uuid, p_at timestamptz default now()) returns text;
--   security definer. Only the task's driver; only while status = 'assigned'.
--   accepted_at = least(coalesce(accepted_at, p_at), now()) (an offline replay keeps the earliest).
--   Writes an 'accepted' event once. Returns 'accepted' | 'already_started' | 'already_reassigned' | 'already_declined'.
create function decline_task(p_task_id uuid, p_reason text, p_note text default null, p_at timestamptz default now()) returns text;
--   security definer. Only the task's driver; only while status = 'assigned'.
--   status = 'declined', declined_at/by/reason/note, declined_after_accept = accepted_at is not null;
--   an event; queue_notification('task.declined', ...) (Part 3b adds the function; until then no-op);
--   a pg_net call to fleet-jobs sync (the issue). Returns 'declined' | 'already_started' | 'already_reassigned' | 'already_declined'.
-- tasks_driver_guard: assigned -> in_progress also sets new.accepted_at = coalesce(old.accepted_at, now()).
-- tasks_notify_push: 'removed' to the previous driver only when old.accepted_at is not null
--   and old.status <> 'declined'; a declined -> assigned change with a new driver pushes 'new' to him.
-- audit_driver_task already writes 'driver_task_declined' (status change by the driver).
create function queue_accept_reminders() returns integer;   -- added to the task-reminders minute job
--   status = 'assigned', accepted_at null, accept_reminder_sent_at null and
--   (sent_at + accept_within_min < now() or leave_by - accept_before_leave_min < now())
--   -> send_push(id, 'accept_reminder', driver), accept_reminder_sent_at = now()
--   (the two minutes come from fleet_settings).
```

**As built (13 October 2026, migration `20261014120000_task_accept_decline`).** As above, with:
an insert trigger writes the `assigned` event (actor = `created_by`) and starting a task writes
`accepted` ("by starting the task"); `accept_task` keeps the earliest time even when a replay
arrives later (the plan's `least(coalesce(...))` kept the first write); both RPCs answer
`cancelled` for a cancelled task; `decline_task` trims the note and refuses an unknown reason
(22023); the `removed` push goes to the previous driver only when `old.accepted_at` is set and
he did not decline (the plan's rule; a task never accepted just leaves his list), and a
declined task given back to the same driver is pushed as `new`; `queue_accept_reminders()` is
the second call of the `task-reminders` minute job (`cron.unschedule` + `cron.schedule`), skips
tasks whose leave-by has passed, and reads the two minutes from `fleet_settings`. The office
writes `reassigned` and `cancelled` events from the tools with the person's name. pgTAP:
`supabase/tests/database/dispatch.test.sql`. No `queue_notification` call yet (Part 3b adds
it) and no fleet-jobs call (Part 3a).

### 3.4 `issues` (Part 3a)

```sql
create table issues (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  severity text not null check (severity in ('info','warning','critical')),
  title text not null, detail text,
  vehicle_id uuid references vehicles(id), employee_id uuid references employees(id),
  task_id uuid references tasks(id), request_id uuid references vehicle_requests(id),
  vehicle_report_id uuid references vehicle_reports(id),
  ref_key text not null,
  status text not null default 'open' check (status in ('open','in_progress','resolved','dismissed')),
  assigned_to uuid references employees(id),
  opened_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  resolved_at timestamptz, resolved_by text, resolution_note text,
  auto boolean not null default true);
create unique index issues_open_ref_key on issues (ref_key) where status in ('open','in_progress');
create index issues_status_opened_idx on issues (status, opened_at desc);
create table issue_events (
  id bigint generated always as identity primary key,
  issue_id uuid not null references issues(id), at timestamptz not null default now(),
  actor text, actor_employee_id uuid references employees(id),
  action text not null check (action in ('opened','assigned','note','status','auto_resolved')),
  note text, from_status text, to_status text);
-- RLS: select for office_can('view') on both (the bell's Realtime channel); drivers nothing.
alter publication supabase_realtime add table issues;
-- The one pg_net caller (generalises send_push's Vault lookup):
create function call_edge_function(p_name text, p_body jsonb) returns void;  -- functions_url + server_key from Vault
create function fleet_sync(p_scope jsonb default '{}') returns void;        -- call_edge_function('fleet-jobs', {job:'sync', ...})
select cron.schedule('fleet-sync', '*/5 * * * *', $$select public.fleet_sync()$$);
-- Triggers that call fleet_sync with a scope: vehicle_reports (insert, status change),
-- tasks (status change to declined / in_progress / completed / cancelled, accepted_at set),
-- vehicle_requests (insert, decision).
```

**As built (14 October 2026, migration `20261014130000_issues`).** As above, plus the columns
`due` (the overview's due text) and `sort_key` (its order) on `issues`, and indexes on task_id
and vehicle_id for the scoped syncs. `call_edge_function` and `fleet_sync` are security
definer and revoked from anon / authenticated; the triggers: `vehicle_reports` (insert, status
change), `tasks` (status → declined / in_progress / completed / cancelled, accepted_at set, a
new driver), `vehicle_requests` (insert, status change). `send_push` is unchanged. pgTAP:
`supabase/tests/database/issues.test.sql` (RLS, the publication, the key rule, the triggers'
pg_net calls with their scope, the cron job).

### 3.5 `notifications` (Part 3b)

```sql
create table web_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  employee_id uuid not null references employees(id),
  endpoint text not null unique, p256dh text not null, auth text not null,
  user_agent text, created_at timestamptz not null default now(), last_ok_at timestamptz);
create table notification_settings (
  employee_id uuid not null references employees(id), event text not null,
  enabled boolean not null default true, updated_at timestamptz not null default now(),
  primary key (employee_id, event));                     -- no row = enabled
create table notifications (                             -- the outbox
  id bigint generated always as identity primary key,
  event text not null, payload jsonb not null,
  recipient_employee_id uuid not null references employees(id),
  channel text not null default 'web_push' check (channel in ('web_push','email')),
  status text not null default 'queued' check (status in ('queued','sent','failed','dead')),
  attempts integer not null default 0, next_try_at timestamptz not null default now(),
  sent_at timestamptz, error text, created_at timestamptz not null default now());
create index notifications_queue_idx on notifications (status, next_try_at) where status in ('queued','failed');
create function queue_notification(p_event text, p_payload jsonb, p_recipients uuid[]) returns integer;
--   security definer; one row per recipient whose notification_settings allow the event
--   (no row = allowed); used by the tools (through the client) and by decline_task.
-- after insert on notifications -> call_edge_function('notify-office', {id})
select cron.schedule('notify-retry', '*/5 * * * *', $$select public.notify_retry()$$);
--   notify_retry(): rows failed/queued with next_try_at <= now() and attempts < 5 -> notify-office {retry: true}
-- Service role only on all three tables; the person's own rows come through the tools.
```

**As built (14 October 2026, migrations `20261014140000_issues_access` and
`20261014150000_notifications`).** As above, with: `web_push_subscriptions.removed_at` and
`removed_reason` ('user' | 'gone') instead of a delete (nothing is deleted; the same endpoint
registered again comes back); `queue_notification` also skips an inactive person and a person
with no browser on, and dedupes the recipients; `job_runs` (job, started_at, finished_at,
result) for the sync guard; `colombo_when(timestamptz)` ("HH:MM" today, "Tue 14 Oct HH:MM"
otherwise) and `dispatch_recipients()` for the two SQL-written events; `decline_task` and
`queue_accept_reminders` replaced to queue `task.declined` / `task.not_accepted`. The issues
policies now follow the permission table through `issue_visible(kind)` (issues: everything;
assign_tasks: the task kinds; nobody else; `issue_events` follow their issue).

### 3.6 `custodians_booking` (Part 6)

```sql
alter table vehicles add column custodian_employee_id uuid references employees(id), add column custodian_note text;
alter table vehicle_requests
  add column requested_by_user_id uuid,                  -- auth.users id of the submitting account (decision 12)
  add column driver_required boolean not null default true,
  add column one_step boolean not null default false,
  add column seen_at timestamptz, add column seen_by text,
  add column cancelled_at timestamptz, add column cancelled_by text, add column cancel_reason text;
alter table vehicle_requests drop constraint vehicle_requests_status_check;
alter table vehicle_requests add constraint vehicle_requests_status_check
  check (status in ('waiting','approved','declined','cancelled'));
-- vehicle_requests_decided_at_check ((status='waiting') = (decided_at is null)) still holds: cancel keeps decided_at.
create function office_book_vehicle(p_request jsonb, p_task jsonb, p_stops jsonb, p_projects jsonb, p_decided_by text) returns jsonb;
--   one transaction: insert the request (one_step true), then office_create_task(..., p_request_id) which approves it;
--   returns {request_id, task_id}.
```

Driver-side column privileges on `vehicles` are unchanged (the custodian is office data).

## 4. Server: the shared module and the functions

### 4.1 `permissions.ts` replaces the role table (Part 2)

```ts
export type Permission = "view" | "request" | "approve" | "assign_tasks" | "vehicles" | "issues" | "users";
export const PERMISSIONS: readonly Permission[];
export interface Actor { employeeId; name; role; permissions: Permission[]; authUserId?: string; channel }
export const TOOL_PERMISSION: Record<string, Permission[]>;        // any one of the listed permissions allows the call
export const PRESETS = { fleet_admin: [...all but users], dispatcher: ["view","request","assign_tasks"], requester: ["request"], viewer: ["view"] };
export function permissionsForRole(role): Permission[];           // the backfill map (used by create_office_user when no list is given)
export function roleForPermissions(p): Role;                      // the label: admin / fleet_admin / office / staff / viewer
export function canCall(actor, tool): boolean;
export function toolsFor(permissions): string[];
```

`roles.ts` keeps `Role`, `Channel`, `OFFICE_ROLES`, `isRole`, `mfaRequiredRoles`,
`STRONG_ROLES`; `TOOL_ROLES` stays exported, now derived from `TOOL_PERMISSION` +
`permissionsForRole` (so `roles_test.ts` and anything reading it still work). `run.ts`
calls the new `canCall(actor, tool)`. The shared `OFFICE_MCP_KEY` actor has every permission;
a personal key loads the owner's row and its live `permissions`; office-api loads the row the
same way and answers `permissions` in `/me`.

The table (section 0 decisions 3–5 included):

Narrowed on 13 October 2026 (Part 2b): `view` is the small one. What each permission opens:

| permission | screens | tools |
|---|---|---|
| `view` (everyone) | Overview reduced to the counts (on the road / free / in garage, tasks today) and the on-the-road list, no needs-attention list; Live locations; the Drivers list (name, phone, vehicle, status; no route history, no accept/decline counts); the Vehicles board read-only (status, back ~HH:MM, assigned to); My requests | fleet_overview (`needs_attention` empty), live_drivers, list_drivers, list_vehicles, list_requests (own rows), list_places, find_project, get_settings |
| `request` | Request a vehicle; My requests | create_request, list_requests (own), task_detail (the task of an own request), list_places, find_project |
| `approve` | the Requests queue, decide, book directly (Part 6) | decide_request, book_vehicle, cancel_request, suggest_vehicles, plan_task, list_requests (every row), task_detail (any request's task) |
| `assign_tasks` (dispatcher) | the Tasks board, Assign a task, the stops editor, reassign, cancel, task detail with odometer and fuel photos, the driver page (route history) and the per-task route, the task attention items (declined, not accepted, late start, running late, location off during a task) on Overview and in the bell | task_board, task_detail (any task), create_task, reassign_task, cancel_task, update_task_stops, plan_task, suggest_vehicles, driver_route, add_place, list_issues (task kinds), fleet_overview (`needs_attention`: task items) |
| `vehicles` | Vehicles edit and register, rental companies, places, driver accounts, Mileage, Maintenance (reports only with `issues`; the service and document reminders read off the vehicles list otherwise), odometer flags, the driver page | register_vehicle, update_vehicle, add_rental_company, add_place, create_driver, reset_pin, set_driver_active, update_driver, import_projects, mileage_summary, driver_route |
| `issues` | the Issues centre, vehicle problem reports, every attention item on Overview and in the bell | list_vehicle_reports, update_vehicle_report, list_issues (all kinds), update_issue, issue_history, fleet_overview (`needs_attention`: everything) |
| `users` | Settings: office users, connector keys, fleet settings | list_office_users, create_office_user, update_office_user, reset_office_password, set_office_user_active, create_office_key, revoke_office_key, update_settings, routing_usage |
| any office permission | Settings → Notifications (own) | my_notification_settings, set_my_notification_settings, register_web_push, remove_web_push |

The shared Teams key holds every permission. A screen the person lacks stays in the menu,
greyed with a lock; a direct URL shows "No access"; the server refuses the tools either way.

### 4.2 New modules (Part 4, 3a, 3b)

- `settings.ts`: `loadSettings(db)` → typed object with the defaults of section 6 filled in
  for missing keys; `SETTINGS_DEFAULTS`; validation per key for `update_settings`.
- `routing.ts`: `legMinutes(db, from, to, departAt, opts)` → `{ km, minutes, source:
  "ors"|"google"|"estimate", via_expressway: boolean|null, factor, cached }`. Pure pieces,
  exported for tests: `orsRequest(from, to, opts)` (body with `coordinates: [[lng,lat],[lng,lat]]`,
  `preference: "fastest"`, `options.avoid_features: ["highways"]` when avoiding, `extra_info:
  ["waycategory"]`), `orsResponse(json)` (metres → km, seconds → minutes, `via_expressway` when
  any `extras.waycategory.values` row has the highway bit set), `googleRequest` /
  `googleResponse` (`computeRoutes`, `TRAFFIC_AWARE`, `departureTime` only when in the future,
  `routeModifiers.avoidHighways`, duration "123s" → minutes, `via_expressway: null`),
  `estimate(from, to, settings)` (haversine × road_factor ÷ avg_speed_kmh), `rushHourFactor(from,
  to, departAt, settings)` (either end within `radius_km` of the centre and the departure inside a
  band on a weekday), `cacheKey` (3 decimals). Provider from `ROUTING_PROVIDER` (`ors` |
  `google` | `estimate`; unset → estimate); 5 s timeout (`AbortSignal.timeout`); on any error:
  the cache for that key (any provider) → estimate, `source` says which; daily count through
  `bump_routing_calls`; ors stops at 1,900 calls a day and 40 a minute (token bucket per
  isolate) and falls back to estimate; the rush-hour factor is applied after the cache, to ors
  and estimate only.
- `plan.ts` (pure, no imports): `planTask(input, settings, legMinutes)`; see section 7.
- `eta.ts`: `taskEta(db, task, latest, settings)` with the 2-minute cache in `task_eta`: the leg
  from the driver's last position to the current stop (`legMinutes`), then the remaining planned
  legs and dwells; `late_min` = final ETA minus the earliest `arrive_by` it passes.
- `issues.ts`: `syncIssues(db, now, scope?)` (section 8) and the helpers `openIssue`,
  `resolveIssue`, `severityOf`.
- `notifications.ts`: `notify(db, event, payload, recipients)` → `queue_notification`;
  `recipientsFor(db, event, ctx)` (the table in section 9).
- Tools: `tools/issues.ts`, `tools/settings.ts`, `tools/notifications.ts`; `plan_task` and
  `update_task_stops` in `tools/tasks.ts`; `book_vehicle`, `cancel_request` in
  `tools/requests.ts`; `update_office_user` in `tools/accounts.ts`.

### 4.3 Edge Functions

- `office-api`: `/me` adds `permissions`; `tools` from `toolsFor`; unchanged otherwise.
- `office-mcp`: actor from the key's owner row with permissions; the shared key gets all.
- `push-task`: kinds `leave_30` ("Leave by {time}" / "{title} · leave in 30 minutes", channel
  tasks-changed), `leave_now` ("Time to leave" / "{title} · leave by {time}", tasks-new),
  `accept_reminder` ("Please accept your task" / "{when} · {title}", tasks-new), in en + si.
- `fleet-jobs` (new, x-server-key): `POST { job: "sync", scope? }` → ETAs of running tasks, then
  `syncIssues`; returns counts. Called by pg_cron every 5 min and by the event triggers.
- `notify-office` (new, x-server-key): `POST { id }` or `{ retry: true }` → Web Push to the
  recipient's subscriptions; 404/410 deletes the subscription; sent/failed/dead with backoff
  1, 5, 15, 60 minutes, dead after 5 attempts; no VAPID keys → `dead`, error `no_vapid_keys`;
  channel `email` → `dead`, error `email_not_implemented` (the TODO for Resend).

## 5. Tools: new and changed (inputs → result fields)

Every change below is additive. New tools go to the end of `TOOLS` and `ALL_TOOLS`.

**Accounts (Part 2)**
- `create_office_user(name, email, role?, permissions?[], phone?, code?)`: `role` becomes
  optional; `permissions` default `permissionsForRole(role ?? "viewer")`; result adds
  `permissions`.
- `update_office_user(email, name?, phone?, permissions?[], role?)` (new): result `{ updated:
  { name, email, role, permissions } }`. Changing permissions takes effect on the next call.
- `list_office_users`: users get `permissions`.

**Tasks (Part 4, 5)**
- `create_task`: + `stops[] { type: pickup|drop|visit, what?: people|goods|documents|other,
  place?: text, address?: text, lat?, lng?, dwell_min?, arrive_by?: "HH:MM" (same day) or ISO,
  note? }` (1–12), `start?: { place? | address? | lat, lng }` (default: base), `return_to_base?`,
  `avoid_expressway?`, `leave_by?: "HH:MM"` (manual), `buffer_min?`. `pickup` / `dropoff` keep
  working and become two stops. Without `leave_by`: when any stop has `arrive_by` the plan sets
  `leave_by` (source `plan`) and `start_at = leave_by`; otherwise `start_at` is the given time
  and `leave_by = start_at`, source `manual`. Result adds `leave_by`, `leave_by_source`,
  `plan` (section 7's shape), `stops[]` with planned times; plan warnings join `warnings`.
- `plan_task(date, stops[], start?, return_to_base?, avoid_expressway?, leave_by?, buffer_min?,
  driver?, vehicle?)` (new, readOnly): the plan without creating; with driver and vehicle the
  existing assign warnings too; `settings_used`.
- `update_task_stops(task_id, plan_version, stops[], start?, return_to_base?, avoid_expressway?,
  leave_by?)` (new): refuses when `plan_version` differs ("This task changed since you loaded
  it (version N). Reload it."); re-plans, bumps `plan_version`, keeps arrived / done / skipped
  stops, marks the pending ones `removed` and inserts the new list; the trigger pushes "Task
  changed". Removed stops appear nowhere except `task_detail.removed_stops[]`.
- `task_detail`: task adds `leave_by`, `leave_by_source`, `buffer_min`, `plan_version`,
  `plan { source, computed_at, total_drive_min, total_km, legs[] { from, to, km, minutes,
  source, via_expressway } }`, `eta { next_stop, next, final, late_min, as_of }`, `accepted`,
  `declined { at, reason, note, after_accept }`, `assignment_history[] { at, action, driver,
  vehicle, actor, note }`; stops add `what`, `note`, `dwell_min`, `arrive_by`, `planned_arrive`,
  `planned_depart`, `skip_reason`, `skip_note`, `lat`, `lng`.
- `task_board`: cards add `leave_by` ("HH:MM"), `accepted` ("HH:MM"), `eta_final`, `late_min`,
  `stops_count`; a new column `declined[]` and `counts.declined`; status lines: "Sent · not
  opened yet" → "Seen HH:MM" → "Accepted HH:MM" → "Started …"; "Declined (reason)";
  "Declined after accepting"; "Leave by HH:MM · late by N min".
- `reassign_task`: also for `declined` tasks; sets status `assigned`, clears `accepted_at`
  and the declined fields, writes a `reassigned` event, result adds `was: "declined"` and
  `suggestions` (free drivers and vehicles at that time, as `suggest_vehicles` groups them).
- `cancel_task`: also for `declined`.

**Issues (Part 3a)**
- `list_issues(status?: open|in_progress|resolved|dismissed|active|all = active, kind?,
  vehicle?, assigned_to?: email|me, limit?)` → `{ count, open, in_progress, issues[] { id, kind,
  severity, title, detail, status, opened, updated, assigned_to, vehicle, driver, task_id,
  request_id, vehicle_report_id, links { task, vehicle, driver } } }`.
- `update_issue(id, status?, note?, assign_to?: email|me|none)` → the issue + the event written.
- `issue_history(id)` → the issue with `events[] { at, actor, action, note, from, to }` and the
  linked task / report / request summaries.
- `fleet_overview.needs_attention[]`: same four fields, plus `issue_id`, `kind`, `severity`.

**Settings (Part 4)**
- `get_settings()` → every key with its value and default; `update_settings(key, value)`
  (`users`) validates per key; `routing_usage(days?)` → calls and errors per day and provider,
  the provider in use.

**Notifications (Part 3b)**
- `my_notification_settings()` → the events with enabled/disabled and this person's
  subscriptions (device, since, last ok); `set_my_notification_settings(events: { event:
  enabled })`; `register_web_push(endpoint, p256dh, auth, user_agent?)`;
  `remove_web_push(endpoint)`.

**Vehicles and requests (Part 6)**
- `list_vehicles`: cards add `assigned_to` (custodian name), `assigned_to_links { call,
  whatsapp }`, `custodian_note`, `availability` ("Free" | "On a task · back ~HH:MM (planned)" |
  "On a task · back ~HH:MM (live)" | "On a task · end time not set" | "Booked later today ·
  HH:MM" | "In garage"), `back_at`, `back_source` (planned | live).
- `update_vehicle(..., custodian?: username|code|name|null, custodian_note?)`.
- `create_request(..., driver_required?)`: `need_type` stays the type argument (`any` = omit);
  result `next` reads "Sent to the fleet admin · you'll be notified"; the submitting account's
  Auth id is stored.
- `list_requests`: cards add `timeline { sent, seen, decided, decided_by, cancelled }`,
  `driver_required`, `one_step`; status `cancelled` possible.
- `suggest_vehicles`: adds `groups { free_pool[], free_assigned[] (with custodian, call,
  whatsapp, note "ask first"), busy[] (back ~HH:MM), in_garage[] }`, `drivers_free[]`; sets
  `seen_at` the first time; old `vehicles[]` and `drivers[]` stay.
- `book_vehicle(requested_by?, project?, date, time, back_by?, route_from?, route_to?,
  need_type?, pax?, tools?, note?, vehicle, driver?, title?, stops?[], return_to_base?,
  avoid_expressway?)` (new, `approve`): one transaction; `driver` optional when
  `driver_required` is false (the custodian drives); audited "requested and approved by X";
  returns the request, the task (with the plan) and every warning (overlap, allowance, garage,
  expired document, pax > seats).
- `cancel_request(request_id, reason)` (new, `approve`): an approved request → `cancelled`,
  its task cancelled with "Request cancelled: {reason}" (the driver's push comes from the
  existing trigger), `vehicle.booking_cancelled` to the custodian.
- `decide_request`: approving sets `seen_at`; `request.decided` to the requester.
- `list_drivers`: drivers add `last_30_days { accepted, declined }`.

The connector's `INSTRUCTIONS` text gains two lines (leave-by and stops; issues).

## 6. `fleet_settings` keys and defaults

| key | default | used by |
|---|---|---|
| `dwell_min` | `{"pickup.people":10,"pickup.goods":15,"drop.people":5,"drop.goods":15,"visit":60,"documents":10,"default":10}` | planner (stop type + what; `documents` for either type) |
| `buffer_min` | `15` | planner (arrive this early) |
| `base_place_id` | `null` (an admin picks the real head office in Settings; never seeded) | start and return legs; empty = the plan starts from the first stop and warns |
| `avg_speed_kmh` | `35` | estimate provider |
| `road_factor` | `1.3` | estimate provider |
| `accept_within_min` | `30` | accept reminder |
| `accept_before_leave_min` | `60` | accept reminder |
| `rush_hour` | `{"factor":1.3,"centre":{"lat":6.9344,"lng":79.8428},"radius_km":25,"bands":[{"days":[1,2,3,4,5],"from":"07:00","to":"09:30"},{"days":[1,2,3,4,5],"from":"16:30","to":"19:00"}]}` | ors and estimate legs |

Constants in code, not settings: late start 10 min after leave_by, request waiting 30 min,
long day 12 h, ETA cache 2 min, issue sync 5 min, routing cache 30 days, ors budget 1,900/day
and 40/min. The Settings → Fleet page (`users`) edits the eight keys with validation and shows
`routing_usage`; everyone with `view`, `assign_tasks` or `approve` can read them (the stops
editor shows the dwell defaults).

## 7. The planner (`plan.ts`) and the ORS mapping

```ts
interface PlanStop { seq; type; what?; name; lat?; lng?; dwell_min?; arrive_by?: ISO }
interface PlanInput { date; now: ISO; start: { name; lat?; lng? }; stops: PlanStop[];
  return_to_base: boolean; base?: { lat; lng }; avoid_expressway: boolean; leave_at?: ISO; buffer_min?: number }
type LegFn = (from, to, departAt: ISO, opts: { avoid_expressway }) => Promise<{ km; minutes; source; via_expressway; factor }>
interface Plan { leave_by: ISO; leave_by_source: "plan"|"manual"; ends_at: ISO; total_drive_min; total_km;
  legs[] { from_seq; to_seq; depart_at; arrive_at; km; minutes; source; via_expressway; factor };
  stops[] { seq; dwell_min; arrive_by?; planned_arrive_at; planned_depart_at; slack_min? };
  warnings[] { code: "not_reachable"|"no_coordinates"|"long_day"|"no_base"; text; seq?; earliest_arrival?: ISO };
  computed_at; settings_used }
planTask(input, settings, legMinutes): Promise<Plan>
```

- Dwell per stop: `stop.dwell_min ?? dwell_min[type.what] ?? dwell_min[what] ?? dwell_min.default`.
- Forward pass from a leave time: for each stop, the leg from the previous point (departure
  time known, so the hour band is right), `planned_arrive_at`, dwell, `planned_depart_at`;
  then the return leg when `return_to_base`.
- Leave-by (no `leave_at`, at least one `arrive_by`): pass 1 forward from `now`, pass 2 from
  `min over deadline stops of (arrive_by − buffer − time from leave to that stop)`, pass 3
  the same with the legs of pass 2; the result is the latest leave time that meets every
  deadline minus the buffer. `slack_min` per deadline stop. With `leave_at` (manual) or no
  deadline: one forward pass, source `manual`.
- Warnings: `not_reachable` when leave_by < now (text with the earliest possible arrival from
  a forward pass starting now); `no_coordinates` for a stop with no pin after the server tried
  `places` by name and `towns` by name (the leg is counted as 0 km and the text says so);
  `long_day` when `ends_at − leave_by > 12 h`; `no_base` ("No base place set — add it in Settings") whenever `base_place_id` is empty: the plan then starts from the first stop (no first leg) and a return leg cannot be planned.
- Across midnight: every time is absolute, nothing special; the test proves it.

Deno tests (`plan_test.ts`), all with fixed `legMinutes`: Kalutara → Galle → Matara by 10:00;
the same with the Galle–Matara leg flagged `via_expressway`; a deadline on a middle stop that
binds; a stop without coordinates; a trip across midnight; a second task of the same driver
after the first (start = the first task's `ends_at`); the rush-hour factor applied to a Colombo
leg at 08:00 and not to a Galle leg at 08:00 or a Colombo leg at 11:00.

Routing tests (`routing_test.ts`): `orsRequest` puts `[lng, lat]` in both coordinates and the
avoid option only when asked; `orsResponse` reads metres and seconds and sets `via_expressway`
from the waycategory bit; `googleRequest` uses `latitude`/`longitude` objects and
`TRAFFIC_AWARE`; `googleResponse` parses `"842s"`; `estimate` gives 1.3 × haversine ÷ 35;
`rushHourFactor` on the bands; `cacheKey` rounds to 3 decimals; the fallback order on a
provider error.

## 8. Issues: rules, keys, auto-resolve

`syncIssues(db, now, scope?)` computes the wanted set of active issues from the data, opens
the missing ones (`insert ... on conflict (ref_key) where active do nothing`, so a key never
opens twice while open or in progress), updates severity/title/detail of existing ones in
place, and auto-resolves (status `resolved`, `resolved_by 'system'`, an `auto_resolved` event)
the active ones whose condition has cleared. After a resolution the same key may open again:
a new row. A scope (task id, vehicle id, report id) limits the work when a trigger calls it.

| kind | ref_key | severity | opens when | resolves when |
|---|---|---|---|---|
| `vehicle_report` | `report:<id>` | critical (breakdown, accident), warning (others) | the report exists and is not closed; status mirrors: open ↔ open, in_garage ↔ in_progress | the report is closed (and `update_issue` resolve/dismiss closes the report; in_progress sets in_garage) |
| `odometer_flag` | `odometer:<log_id>` | warning | a log flagged in the last 7 days | the office resolves it, or 14 days after the log |
| `km_gap` | `gap:<vehicle_id>:<to_log_id>` | warning | a gap over 30 km in the last 7 days | resolved by the office, or 14 days |
| `service_due` | `service:<vehicle_id>` | warning (due in 14 d / 500 km), critical (overdue) | `service()` says due soon or overdue | it says ok |
| `document` | `doc:<vehicle_id>:<lic\|ins\|emi>` | warning (30 d), critical (7 d or expired) | `docChip` orange or red | renewed (ok) |
| `licence` | `licence:<employee_id>` | as documents | a driver's licence within 30 days | renewed |
| `allowance` | `allowance:<vehicle_id>:<YYYY-MM>` | warning | over the monthly km allowance | the month ends |
| `rental` | `rent:<vehicle_id>` | warning (14 d), critical (ended) | rent_until within 14 days | rent_until moved |
| `garage_booked` | `garage:<vehicle_id>` | info | a garage date within 14 days | the date passed or cleared |
| `signal` | `signal:<task_id>` | critical (location off), warning (no signal) | a running task 10+ min location_off / no_signal (`needsAttention`) | live again, or the task ends |
| `late_start` | `late_start:<task_id>` | warning | assigned, `leave_by + 10 min < now`, not started | started, cancelled, reassigned |
| `running_late` | `late:<task_id>` | warning | the final ETA passes an `arrive_by` | on time again, or the task ends |
| `not_accepted` | `accept:<task_id>` | warning | `accept_reminder_sent_at` set, still not accepted at the next sync | accepted or started (or cancelled / reassigned) |
| `declined` | `declined:<task_id>` | critical when leave_by within 2 h, else warning | status declined | reassigned or cancelled |
| `request_waiting` | `request:<id>` | warning | waiting over 30 min | decided or cancelled |
| `push_failed` | `push:<day>` | info | push_log failures today | the day ends |
| `routing_failed` | `routing:<provider>:<day>` | info | routing errors today | the day ends |

`fleet_overview.needs_attention` is built from the active issues: `what` = title, `subject` =
detail, `due` as today, `level` red for critical, amber otherwise, plus `issue_id`, `kind`,
`severity`; sorted as today. The web Maintenance page keeps reading it.

Dedupe tests (`issues_test.ts`, pure on an in-memory set): the same key is not opened twice
while active; a resolved key reopens as a new row on recurrence; severity changes update in
place; auto-resolve writes the event; the mirror with vehicle reports in both directions.

**As built (14 October 2026).** `issues.ts`: `computeWanted(db, now, scope)` builds the wanted
set (the rules above; a scope computes only its family: task kinds for a task, the report for
a report, the request for a request, the fleet kinds for a vehicle), the pure `reconcile(active,
wanted, muted)` plans open / update / resolve, `syncIssues` writes it (an insert hitting the
unique key is skipped: a parallel sync won; mirror status changes and auto-resolutions write
events with actor `system`). Two deliberate departures: `fleet_overview` runs `syncIssues`
before reading the active issues, so the overview is always current and never waits for the
5-minute job; and a key a person resolved or dismissed is not reopened for 30 days unless it
comes back at a higher severity (otherwise a dismissed "licence expires in 20 days" would
return five minutes later). Documents open at 30 days as in the table (the overview used 14
before). Odometer flags and km gaps are opened for 7 days and kept for 14 (`keep_only`).
`fleet-jobs` runs `syncIssues` (which recomputes the running tasks' ETAs through the
2-minute cache) and answers the counts; `update_vehicle_report` syncs its report after the
change (the mirror), `update_issue` syncs the report after mirroring onto it.

## 9. Notifications and the PWA

Events and recipients (`recipientsFor`), the sender never receives their own event:

| event | recipients | title / body / URL |
|---|---|---|
| `request.created` | everyone with `approve` | "Vehicle request · {by}" / "{when} · {need} · {route}" / `/requests` |
| `request.decided` | the requester | "Request approved · {vehicle} · {driver}" or "Request declined" / reason / `/requests` |
| `task.declined` | `approve` + `assign_tasks` | "{driver} can't do {title}" / "{reason} · leave by {time}" / `/tasks?task=<id>` |
| `task.not_accepted` | `approve` + `assign_tasks` | "Not accepted yet · {title}" / "{driver} · leave by {time}" / task |
| `issue.opened` (critical only) | `issues` | "{title}" / "{detail}" / `/issues/<id>` |
| `issue.assigned` | the assignee | "Issue for you · {title}" / "{assigned by}" / `/issues/<id>` |
| `vehicle.booked` | the custodian (when not the booker) | "{plate} booked · {when}" / "{by} · {route}" / task |
| `vehicle.booking_cancelled` | the custodian | "{plate} booking cancelled" / reason / `/requests` |

Written by the tools through `notify()`, by `decline_task` through `queue_notification`, and by
the issue sync for `issue.opened` / the accept rule for `task.not_accepted`. Per-user toggles
are honoured at queue time (no row = on). Each web-push row is delivered by `notify-office`
with VAPID (`VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`); the payload is
`{ title, body, url, tag }`; `url` is `OFFICE_WEB_URL` + path.

PWA (web build only): `public/manifest.webmanifest` (name "Fame Fleet", standalone,
background `#f3f2ee`, theme `#15181c`, icons 192 and 512, any + maskable), `public/sw.js`
(plain JavaScript: `push` → `showNotification`, `notificationclick` → focus the open Fame Fleet
window on the URL or open one; no caching of the app, so a redeploy is never stale),
registered from `WebApp` after sign-in; `index.html` gets the manifest link, `theme-color`
and the apple touch icon. Settings → Notifications: a toggle per event; "Enable on this
device" (permission → `pushManager.subscribe` with `VITE_VAPID_PUBLIC_KEY` →
`register_web_push`); "Turn off on this device"; the state line (not supported / blocked in the
browser / iPhone needs Add to Home Screen first); the note that Android Chrome works best with
the site installed from the browser menu, a laptop needs the browser running, iPhone needs Add
to Home Screen. The artifact has none of this (no service worker in an artifact) and polls.

Secrets Sahan sets (names only; the functions work without them: estimate routing, no push):

| name | where | when needed |
|---|---|---|
| `ROUTING_PROVIDER` | Edge Function secret | before the deploy of Part 4's functions (`ors`); unset = estimate |
| `ORS_KEY` | Edge Function secret | with `ROUTING_PROVIDER=ors` (an openrouteservice account, free plan) |
| `GOOGLE_ROUTES_KEY` | Edge Function secret | only with `ROUTING_PROVIDER=google` (not planned) |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | Edge Function secrets | before the deploy of `notify-office`; `VAPID_SUBJECT` is `mailto:<an office address>` or `https://fame-fleet.pages.dev` |
| `VITE_VAPID_PUBLIC_KEY` | `apps/office/.env.local` (dev) and `.env.production.local` (the web build reads it at build time; the Cloudflare deploy is a direct upload, so there is no Cloudflare setting) | before the web redeploy |
| `SERVER_KEY`, `OFFICE_WEB_URL` | already set | `fleet-jobs` and `notify-office` reuse them; Vault `functions_url` / `server_key` unchanged |

The key pair: `source ~/.nvm/nvm.sh && nvm use >/dev/null && npx --yes web-push generate-vapid-keys`
prints a public and a private key (base64url). Sahan sets the three secrets and the Vite
variable himself; nothing is printed or committed by me. The local tests use a throwaway pair
made the same way into the `functions serve` env file.

**As built (14 October 2026).** Two departures. (1) No `VITE_VAPID_PUBLIC_KEY`: the browser
gets the public key from `my_notification_settings` (`push.public_key`, with `push.configured`),
so the key lives in one place (the Edge Function secrets), the web app needs no rebuild when
it changes, and the page can say "not switched on for the office yet" instead of failing.
(2) The pair is printed by `scripts/make-vapid-keys.mjs` (Node's WebCrypto, nothing
downloaded) in the same base64url form `web-push` prints; either works. Also: `issue.opened`
fires when an issue opens critical *or is raised* to critical; the message `url` is a path and
`notify-office` makes it absolute with `OFFICE_WEB_URL`; the service worker posts
`{type: "navigate", url}` to the open window (the router follows it) and `/tasks?task=<id>`
opens the task drawer; a device is removed with `remove_web_push(id)` from the page, with
`remove_web_push(endpoint)` by the browser itself; the library is `jsr:@negrel/webpush@0.5.0`
(it passed `deno check`; the by-hand fallback was not needed). The Settings page lists only the
events the person's permissions can bring (`relevantEvents`); the vehicle.* events join the
list with Part 6.

## 10. Office web app and artifact, per part

- **Part 2b** (13 October 2026). One shared dialog component (`ui/Drawer.tsx`): a click
  outside never closes a form dialog; Close, Cancel and Esc ask "Discard changes?" when a
  form in the panel has unsaved input (`useDraft` / `useDirty`); leaving the page warns
  (`beforeunload`) while any form is dirty, the Assign-a-task card included. Forms on it:
  new and edit office user, new request, decide request, task drawer (reassign, cancel),
  register and update vehicle (with the inline rental company), add driver, manage driver;
  Part 4's stops editor and add-place dialog use it too. The narrower `view` of the table
  above, in the menu, the routes and the screens.
- **Part 2.** `Me.permissions`; `nav.ts` items carry `permission` instead of `tool`; locked
  items render greyed with a lock icon and the tooltip "Ask an admin for access" (rail and More
  list; the phone tab bar hides locked tabs); a direct URL to a locked screen shows a "No
  access" page (the server refuses too). Settings → Users (`users`): the Accounts table with a
  permissions column, create with tick boxes and the four preset buttons, edit (name, phone,
  permissions), deactivate, new set-password link; `/accounts` redirects. Artifact: the same,
  with every permission (the connector's key decides).
- **Part 4.** Assign a task: the stops editor (add, remove, ↑↓, place picker from places +
  towns + a typed address with an optional pin from a lat,lng field or a map click on the web,
  what, dwell, arrive-by on any stop, note), start place (default base), Return to office and No
  expressway toggles, the plan panel (leave by, timeline per stop with planned times, "via
  expressway" on those legs, total drive time, the source label "road time · OpenRouteService" /
  "estimate — no routing key", warnings), the existing driver/vehicle warnings; the plan
  refreshes (debounced) on every change through `plan_task`; "Leave by" may be typed (manual)
  with the plan shown as advice. Task drawer: stops with planned and actual times, Edit stops
  (the same editor, `update_task_stops` with the version check; on refusal: "reload" and the
  fresh task), "ETA next HH:MM · final HH:MM (live)" and "Running late by N min". Task board
  cards: "Leave by HH:MM", lateness. Live map card: the ETA line. Settings → Fleet (`users`).
  Artifact: the same on the drawn map (pin by lat,lng only).
  *As built (13 October 2026).* The Assign-a-task card holds the stops inline (Pickup /
  Drop-off rows, "Add stop", ↑↓, a place or town or free text, what, minutes there,
  arrive-by, a note), "Stops in detail" opens the same rows in the shared dialog
  (`StopsEditor.tsx`, Save stops / Cancel with the discard rule), Date + "Leave by"
  (typed = manual, empty = planned from the deadlines), "Start from", Return to office,
  No expressway; the plan preview (`PlanPanel.tsx`, `plan_task` 700 ms after the last
  change) shows leave-by, every leg with km / minutes / source, the planned times and the
  warnings. The task drawer shows Leave by, the ETA line, planned and actual times per
  stop with skip reasons, "Edit stops" (→ `update_task_stops` with the loaded
  `plan_version`; a stale one shows the server's "changed since you loaded it" message),
  the removed stops, and a "Leave by" field in Reassign. Task cards: "Leave by HH:MM ·
  ETA HH:MM · late by N min". Live locations: next stop and ETA on the card. Settings →
  Fleet (`settings/FleetSettings.tsx`, users permission): base place (saved places with a
  pin), minutes at a stop, the numbers, rush-hour bands, the routing provider and its
  usage table. `plan_task` takes `leave_by` (HH:MM), not `start_time`. Tool answers never
  carry null fields (run.ts prunes them), so a null setting is simply absent.
- **Part 5.** Status lines; the "Needs a driver" column (declined) on the board; the task
  drawer shows the reason and "Reassign" with suggestions (free drivers, free vehicles);
  the driver page and Drivers table show accepts/declines in 30 days.
  *As built (13 October 2026).* Tasks board: a fourth column "Needs a driver" appears when
  the day has a declined task; cards show "Accepted HH:MM" / "Declined (reason) · note".
  Task drawer: an Accepted row, a red notice with the decline (reason, note, after accepting),
  "Free at that time" chips (drivers and vehicles from `task_detail.suggestions`; a click
  fills the Reassign form), "Give it to a driver" with a Reassign button, Cancel task also
  for a declined task, and a History card (`assignment_history`). Drivers table: a "Last 30
  days" column (accepted · declined); the driver page shows the same line. Overview's
  needs-attention (scope task) lists "Task declined: reason" and "Not accepted yet" from
  `fleet_overview` (no issues table yet: Part 3a turns them into issues). Playwright: a
  driver accepts one task and declines another through the RPCs, the board, the drawer's
  suggestions → Reassign, the history, the drivers' counts.
- **Part 3a.** The bell in the header (both layouts): open count from `list_issues` watched
  every 60 s and patched by Realtime on `issues` (web); the newest 10 in a dropdown; Issues
  page (`/issues`, `view`) with tabs Open / In progress / Resolved, filters by kind and vehicle;
  item page (`/issues/:id`) with details, links to vehicle, driver, task, photos (through
  `task_detail` / `list_vehicle_reports`), the event timeline, Take (assign to me), Add note,
  Resolve with note, Dismiss (`issues`); the Maintenance report card keeps working through the
  mirror. Artifact: polling, no Realtime.
  *As built (14 October 2026).* The bell (`Shell.tsx`): in the rail on a desktop and in the
  phone header, shown with issues or assign_tasks; the count from `list_issues` (active, 10)
  watched every 60 s and reloaded at once by a Realtime channel on `issues` (web only, one
  reload a second at most); the dropdown lists the ten newest with a severity dot and "All
  issues". Issues page (`/issues`, `screens/Issues.tsx`): one `list_issues(all, 200)` watched
  every 60 s (plus Realtime), tabs Open / In progress / Resolved (resolved and dismissed
  together) with counts, selects by kind and vehicle (`issuesLogic.ts`, Vitest). Item page
  (`/issues/:id`, `screens/IssuePage.tsx`): `issue_history`; the task (drawer), the driver
  (page, with routes), Call / WhatsApp, the report with its photos, the timeline in words,
  and with the issues permission Take (assign to me + in progress), Add note, Resolve (the
  note becomes the resolution), Dismiss, Reopen. Overview's attention items link to the
  issue. Playwright: a breakdown report → fleet-jobs sync → the bell → the issue page → Take →
  note → Resolve → the report is closed with the note → the Resolved tab.
- **Part 3b.** Settings → Notifications; PWA files; the service worker.
  *As built (14 October 2026).* Settings → Notifications (`screens/settings/Notifications.tsx`,
  web only, lazy; the artifact's Settings home does not list it and the route points to the
  web app): "This browser" with the state in words (not supported / needs https / iPhone needs
  Add to Home Screen / blocked / on / off / on but not for you yet) and one button (Turn on in
  this browser → permission → `pushManager.subscribe` → `register_web_push`; Turn off →
  unsubscribe → `remove_web_push`), the note about Android / laptop / iPhone; "Tell me when"
  with a checkbox per event (saved at once); "Browsers with notifications on" with the device
  name, since, last delivered, "this one", Remove. `src/push.ts` (the browser side),
  `notificationsLogic.ts` (pure, Vitest). `WebApp` registers `public/sw.js` after sign-in and
  routes a notification tap; `public/manifest.webmanifest` and `public/icons/*` (from
  `scripts/make-icons.mjs`); the head tags (manifest, theme-color, icon, apple-touch-icon) are
  injected by `vite.config.ts` for the web build only. Playwright: the admin's six events, one
  switched off and kept after a reload; a requester sees the one event their permission brings.
  Sahan's two Part 3a changes landed here: the issues RLS follows the permission table (pgTAP:
  view alone 0 rows, requester 0, assign_tasks the task kinds only, issues everything; the
  bell and the Issues page were already hidden for a person with neither permission), and
  `fleet_overview` skips its own sync when one finished under 60 s ago (`job_runs`).
- **Part 6.** Request form (`request`): vehicle type (car, van, double cab, lorry, any), pax,
  tools, when, back by, from, to, project, note; "Sent to the fleet admin · you'll be
  notified"; My requests with the timeline sent → seen → approved / declined with who decided
  (and cancelled). The same form for `approve`: the "Assign now" section with the four groups
  and the free drivers, custodian call/WhatsApp links and "ask first", one call `book_vehicle`,
  all warnings shown. Request drawer: Cancel (approved → `cancel_request`). Vehicles page:
  "Assigned to" column, the availability text, custodian fields in the vehicle drawer.

Style: unchanged tokens (`styles.css`), desktop rail + phone tab bar as today; new CSS for the
stops editor, plan timeline, lock state, bell, issue severities.

## 11. Driver app, per part

- **Part 1.** `en.json` / `si.json` changes (section 13), `notifications.ts` channel name
  "Location sharing" → "On duty" (a channel's name may change; its sound may not). Behaviour
  unchanged; `location.ts`, `duty_sessions`, rule 9 unchanged. The grep of `office|see|sharing|
  track` in `src/i18n/*.json` and `app.config.ts` / `app.json`: every hit is either changed or
  listed in the checkpoint as kept on purpose ("Call the office", "Send to office": the office
  exists; nothing says it watches the driver).
- **Part 4.** Today card: "Leave by 06:40" (from `leave_by`; falls back to the start time),
  the first two stops and "+N more". Task in progress: the stop list with the current stop
  highlighted, "Arrived" then "Done" per stop (`arrived_at` / `done_at`, queued offline as
  today's `stop_patch`), "Skip" with the four reasons and a note (`skip_reason`, `skip_note`),
  "Navigate" to the current stop (Google Maps link; the driver's own route choice changes
  nothing), the map on the current stop; "Complete task" asks to confirm when stops are open
  (they become `skipped · not_visited`). Push kinds `leave_30`, `leave_now`, `accept_reminder`
  open the task on tap (as today). `database.types.ts` regenerated in both copies (driver and
  shared).
  *As built (13 October 2026).* Today card and "Later today": the time shown is
  `leave_by` (falls back to `start_at`) with "Leave by HH:MM" under it; the first two
  stops and "+N more"; a stop with a deadline shows "Arrive by HH:MM". Task screen:
  every stop in a row (type, place, arrive-by, minutes there, the office's note), the
  current stop outlined in blue with "Now", Arrived (pending → arrived) then Done
  (dark), Skip → a bottom sheet (`components/SkipSheet.tsx`: Closed / Nobody there / Not
  needed / Other, an optional note, Skip stop / Cancel; the back button closes it); the
  map and Navigate follow the current stop; Complete task with open stops asks "N stops
  are not done · Finish the task anyway? They will be marked as not visited." → Finish
  anyway, and Save & finish marks them skipped · not_visited. The stop patches go through
  the offline queue (`stop_patch` with skip_reason / skip_note); `fetchTasks` hides
  removed stops. Data-layer test: a skipped stop keeps its reason and note, a removed
  stop is not shown, the stop fields (what, minutes, note) arrive.
- **Part 5.** NEXT TASK card and Later today items: a big "Accept" button while `accepted_at`
  is null (then "Accepted ✓ HH:MM"), the link "Can't do this task" under it; the sheet with the
  four reasons (Vehicle problem / Not available / Unwell / Other), an optional note, confirm;
  both hidden once started (Report a problem instead); offline-safe through two new queue ops
  `task_accept { id, at }` and `task_decline { id, reason, note, at }` sent as the RPCs (the
  engine treats `already_*` answers as done, not as errors, and records the answer for the
  screen); on `already_reassigned` the app shows "This task was already reassigned" once and
  refreshes. "Start task" works whether or not Accept was tapped (the trigger sets
  `accepted_at`). The local notification for a new task (phones without a push token) is
  unchanged.
  *As built (13 October 2026).* NEXT TASK card: Accept (amber) + Start task (outline) while
  not accepted, "Accepted ✓ HH:MM" + Start task after; "Can't do this task" under it; the
  task screen has the same. One `ReasonSheet` component serves Skip a stop and Can't do this
  task (`DeclineSheet`: Vehicle problem / Not available / Unwell / Other, a note, "Can't do
  it"). Later-today rows say Accepted / Not accepted yet. Queue ops `task_accept` and
  `task_decline` call the RPCs; the engine hands every answer to `onAnswer`; the app shows
  "This task was already given to another driver." / "…already started." once on Today
  (tap to dismiss) and refreshes. A declined task shows "Declined" with "The office will
  give this task to another driver." and Back to Today; it is listed nowhere. No local
  accept reminder on the phone: the server's push does it (`accept_reminder`).

Tests: `scripts/test-data-layer.ts` gains accept (earliest time kept on replay), decline
(outcome), already_reassigned, stop skip with reason; `test-track` unchanged; typecheck.

## 12. Tests and checks, per part (all must pass before a part is merged)

- pgTAP (`supabase/tests/database/access_rules.test.sql` + a new `dispatch.test.sql`): drivers
  cannot read `issues`, `notifications`, `fleet_settings`, `route_legs`; `office_can` per
  permission; `accept_task` / `decline_task` only by the task's driver and only while assigned;
  the earliest accepted_at wins; `decline_task` answers `already_started` / `already_reassigned`;
  starting sets `accepted_at`; `office_update_task_stops` marks pending stops `removed`, keeps
  the others and refuses a stale version; a driver cannot set a stop to `removed`; the status
  checks accept `declined`, `cancelled` and `removed`.
- Deno (`_shared/fleet`): `permissions_test.ts` (every tool has an entry, presets, backfill map,
  `canCall`, request-only rows), `plan_test.ts`, `routing_test.ts`, `issues_test.ts`,
  `eta_test.ts` (the arithmetic with fixed legs), `notifications_test.ts` (recipients per
  event, the sender excluded, toggles); the existing 31 keep passing. `deno check`, `lint`,
  `fmt --check` on the two new functions as well.
- Connector suite (`scripts/test-mcp-local.py`, both channels): a requester-only office user
  (`update_office_user`) sees only own requests and is refused `task_board`; `plan_task` on a
  three-stop day (leave_by before the first deadline minus the buffer, the via-expressway flag
  with the estimate provider absent, the warnings); `create_task` with stops and the old
  pickup/dropoff; `update_task_stops` with a stale version refused; the driver accepts, another
  task is declined → the board's `declined` column, `reassign_task` → `assigned`, `cancel_task`
  of a declined task; a vehicle report opens an issue, `update_issue` closes the report;
  `list_issues` / `issue_history`; `fleet-jobs` called directly with the local `SERVER_KEY`
  opens `request_waiting` and `not_accepted`; outbox rows for `request.created`,
  `request.decided`, `task.declined`, `vehicle.booked`; `book_vehicle` in one transaction
  (a refused driver leaves no request behind); `suggest_vehicles` groups with a custodian;
  `cancel_request`; audit rows for every call. `SHAPES=write` once per part, additive only
  (the checker prints new fields; none missing).
- Office (`scripts/test-office-local.sh`): typecheck, Vitest (menu lock from permissions,
  presets, the stops editor's reorder and validation, the plan panel rendering a plan, the
  issue list and item, notification settings, request timeline, booking form), both builds,
  the Realtime gate, Playwright: the locked menu and No access page as a requester-only user;
  one-step booking as an approver (Free pool group → Book → the task is on the board with
  "Leave by"); accept / decline / reassign (the driver's RPCs through REST, the status line,
  Needs a driver, Reassign with a suggestion); the issue flow (a report → the bell count → Take
  → note → Resolve → the report is closed). The existing two tests keep passing.
- Driver: `npm run typecheck`, `test:track`, `test:data` (with the new ops), `npx expo export
  --platform android --no-minify`.

## 13. Driver strings (Part 1 now; Parts 4 and 5 add theirs)

Changed keys in `en.json` (Sinhala at the end of the phase):

| key | new English text |
|---|---|
| `today.sharing` | On duty |
| `today.sharingOn` | Trips and mileage are recorded while on duty · works in background |
| `today.sharingOff` | Off duty · trips are not recorded |
| `today.needLocation` | Allow location first, then go on duty. |
| `task.sharingLocation` / `task.notSharing` | On duty / Off duty |
| `permissions.locationWhy` | Fame Driver needs Location all the time to record trips and mileage. (The amber hint under it, `permissions.locationAlways`, still says: On the next screen choose "Allow all the time".) |
| `permissions.batteryWhy` | So the phone does not stop recording to save battery. |
| `permissions.backgroundWhy` | Some phones stop apps that work in the background. Without this, recording stops when the screen is off. |
| `tracking.locationOff` | Location is switched off on this phone. Trips are not recorded. |
| `tracking.battery` | Battery saving may stop recording when the screen is off. |
| `tracking.restarted` | Recording had stopped. It is running again. |
| `tracking.taskNotSharing` | A task is in progress but you are off duty. |
| `tracking.shareNow` | Go on duty |
| `tracking.stoppedTitle` / `tracking.stoppedBody` | Fame Driver · recording stopped / Tap to go on duty again. |
| `service.title` / `service.body` | Fame Driver · On duty / Recording trips |
| `gate.sharingBody` | Turn on Location to go on duty. |

Kept: `login.*` ("Call the office", "The office gives you your username and PIN"),
`report.*` ("Send to office"), `today.noTasksHint`, `today.notSentYet`, `log.*` ("The office
will see the photo reading…": the odometer rule, not surveillance), `gate.callOffice`.

New keys, Part 4: `today.leaveBy` ("Leave by {time}"), `today.moreStops` ("+{n} more"),
`task.arrived`, `task.skip`, `task.skipTitle`, `task.skipReason.closed` / `nobodyThere` /
`notNeeded` / `other`, `task.skipNote`, `task.currentStop`, `task.stopsLeftTitle` ("{n} stops
are not done"), `task.stopsLeftBody` ("Finish the task anyway? They will be marked as not
visited."), `task.finishAnyway`, `push.leave30`, `push.leaveNow` (in `push-task`, en + si).
Part 5: `task.accept`, `task.accepted` ("Accepted ✓ {time}"), `task.cantDo` ("Can't do this
task"), `task.declineTitle`, `task.declineReason.vehicleProblem` / `notAvailable` / `unwell` /
`other`, `task.declineNote`, `task.declineConfirm`, `task.declined`, `task.alreadyReassigned`
("This task was already reassigned"), `task.alreadyStarted`, `push.acceptReminder`. The full
list with Sinhala comes with Part 7 for Sahan to check.

### Part 4 strings (as built, 13 October 2026)

| key | English |
|---|---|
| `today.leaveBy` | Leave by {time} |
| `today.moreStops` | +{n} more |
| `task.leaveBy` | Leave by {time} |
| `task.arriveBy` | Arrive by {time} |
| `task.arrived` | Arrived |
| `task.skip` | Skip |
| `task.skipTitle` | Skip this stop? |
| `task.skipWhy` | Why? |
| `task.skipReason.closed` / `nobodyThere` / `notNeeded` / `other` | Closed / Nobody there / Not needed / Other |
| `task.skipNote` | A word for the office (optional) |
| `task.skipConfirm` | Skip stop |
| `task.skipped` | Skipped |
| `task.currentStop` | Now |
| `task.stopsLeftTitle` | {n} stops are not done |
| `task.stopsLeftBody` | Finish the task anyway? They will be marked as not visited. |
| `task.finishAnyway` | Finish anyway |
| `task.minutesThere` | {n} min there |

The Sinhala texts for all of these are in `si.json`; the full Sinhala list for the boss's
check comes with Part 7.

### Part 5 strings (as built, 13 October 2026)

| key | English |
|---|---|
| `task.accept` | Accept |
| `task.accepted` | Accepted ✓ {time} |
| `task.cantDo` | Can't do this task |
| `task.declineTitle` | Can't do this task? |
| `task.declineReason.vehicleProblem` / `notAvailable` / `unwell` / `other` | Vehicle problem / Not available / Unwell / Other |
| `task.declineNote` | A word for the office (optional) |
| `task.declineConfirm` | Can't do it |
| `task.declined` | Declined |
| `task.declinedBody` | The office will give this task to another driver. |
| `task.alreadyReassigned` | This task was already given to another driver. |
| `task.alreadyStarted` | This task was already started. |
| `today.accepted` / `today.notAccepted` | Accepted / Not accepted yet |

`push.acceptReminder` is not a phone string: the reminder is the server's push (push-task, kind
`accept_reminder`, en + si).

## 14. Documents at the end (Part 7)

- CLAUDE.md: data model (every table and column of section 3), permissions (the table of 4.1
  replaces the role table), issues (section 8), routing provider and the secret names, "On
  duty" wording, accept/declined fields, rule 9: "Location is recorded only while On duty is
  on. Starting a task turns it on automatically; the driver can turn it off when not working."
- `docs/dispatch-plan.md` (this file): "as built" notes; `docs/office-web-plan.md`: phases
  updated (Audit page still waits for a tool).
- README: the new checks, secrets, the VAPID command, the `fleet-jobs` / `notify-office` deploys.
- `apps/office/dist-artifact/index.html` + `capabilities.json` (server exactly "Fame Fleet",
  the tools the page calls, additive), the file path and the message for the Teams chat.
- The test plan: web as a Fleet admin (approve + assign, no users), as a requester-only user,
  as admin; the driver phone (wording, Accept, stops, Arrived/Done/Skip, leave-by reminders,
  decline, the already-reassigned case); the connector (`plan_task`, `book_vehicle`,
  `list_issues`); notifications on Windows Chrome and on Android Chrome with the site installed
  (Palitha's phone); the OPPO settings unchanged.
- The list of new Sinhala strings.

## 15. Not in this phase

Road snapping of GPS lines; the e-mail channel (designed, `dead: email_not_implemented`);
push to iOS; Google routing (code path present, no key); a Claude Teams OAuth connector;
an audit page; project costs.

## 16. Questions for Sahan and the answers (13 October 2026)

1. Staff and `view`: every office user, staff included, gets `view` (the boss's instruction); an admin can untick it per person. Decided.
2. Office app strings stay inline English; i18n is the driver app's. Decided.
3. The order 1, 2, 4, 5, 3a, 3b, 6, 7: default kept. Deploys: four rounds (after Parts 2, 5, 3b, 7), not one. Decided.
4. Unfinished stops become `skipped · not_visited` after the confirm; the four skip reasons: default kept.
5. Editing stops marks pending stops `removed`; no delete RPC. Decided.
6. `cancel_request` and `vehicle.booking_cancelled`: yes. Decided.
7. "Task reassigned" push only to a driver who had accepted: default kept.
8. Accounts under Settings → Users with the redirect: yes. Decided.
9. `VAPID_SUBJECT`: default `mailto:` (Sahan runs the key command himself at Part 3b).
10. No base place is seeded ("Head office, Colombo 05" is a sample name from the design): `base_place_id` stays empty until an admin picks the real head office in Settings; meanwhile the planner starts from the first stop and warns "No base place set — add it in Settings". An openrouteservice free account: default kept.

The defaults in 3, 4, 7, 9 and 10 can still change before Part 2 starts; the Part 1
checkpoint repeats them.
