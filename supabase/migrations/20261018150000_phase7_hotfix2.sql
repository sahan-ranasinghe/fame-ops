-- Phase 7, Hotfix 2 (docs/phase7-plan.md "Hotfix 2"; Sahan, 18 October): the notification centre for everyone told (A),
-- the office's sound settings (B), the accept window counted at work (E), phone numbers and a log of their changes (F),
-- a task's vehicle chosen on the day (J), who approved and who is reviewing (K), and the driver's contacts for their own
-- tasks (F, I). Additive: phones on the previous update keep working (a task with no vehicle is only made once the
-- setting vehicle_on_the_day is switched on, after every phone has the update).

-- A. The notification centre ---------------------------------------------------------------------------------------------
create table public.office_inbox (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees (id),
  event       text not null,
  title       text not null,
  body        text,
  url         text,
  who         text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);
create index office_inbox_person_idx on public.office_inbox (employee_id, created_at desc);
create index office_inbox_unread_idx on public.office_inbox (employee_id) where read_at is null;
comment on table public.office_inbox is
  'One row per office person per thing they are told (queue_notification), read in the office''s notification centre; '
  'marked read through mark_inbox_read; read rows go after 90 days.';
alter table public.office_inbox enable row level security;
-- Each person reads their own (the web's Realtime bell); writes go through the tools (service role).
grant select on public.office_inbox to authenticated;
create policy office_inbox_select_own on public.office_inbox for select to authenticated
  using (employee_id = (select public.current_employee_id()));
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.office_inbox;
  end if;
end;
$$;
select cron.schedule('prune-office-inbox', '50 21 * * *',
  $$delete from public.office_inbox where read_at is not null and created_at < now() - interval '90 days'$$);

create or replace function public.queue_notification(p_event text, p_payload jsonb, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
begin
  if p_event is null or p_payload is null or coalesce(array_length(p_recipients, 1), 0) = 0 then
    return 0;
  end if;
  -- Hotfix 2 (A): everyone told has it in their notification centre, with or without a browser for Web Push.
  insert into public.office_inbox (employee_id, event, title, body, url, who)
  select r.id, p_event, coalesce(nullif(p_payload ->> 'title', ''), p_event), p_payload ->> 'body', p_payload ->> 'url',
         p_payload ->> 'who'
  from (select distinct unnest(p_recipients) as id) r
  join public.employees e on e.id = r.id
  where e.active
    and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
    and not exists (select 1 from public.notification_settings s
                    where s.employee_id = r.id and s.event = p_event and not s.enabled);
  -- The Web Push outbox, as before: only for a browser that has it on.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id)
    select p_event, p_payload, r.id
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.web_push_subscriptions w
                  where w.employee_id = r.id and w.removed_at is null)
    returning 1
  )
  select count(*) into v_count from ins;
  return v_count;
end;
$$;

-- B. The office's sound settings, per person -------------------------------------------------------------------------------
create table public.notification_prefs (
  employee_id uuid primary key references public.employees (id),
  sound_on    boolean not null default true,
  volume      integer not null default 70 check (volume between 0 and 100),
  updated_at  timestamptz not null default now()
);
alter table public.notification_prefs enable row level security;
comment on table public.notification_prefs is 'The office site''s sounds per person (my_notification_settings). Service role only.';

-- E. The accept window counts only at work ------------------------------------------------------------------------------------
-- When the driver's current duty period began (Start work), null when off duty.
create function public.on_duty_since(p_employee uuid)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select max(d.started_at) from public.duty_sessions d where d.employee_id = p_employee and d.ended_at is null
$$;
revoke all on function public.on_duty_since(uuid) from public, anon, authenticated;

create or replace function public.queue_accept_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_remind integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_reminder_min'), 5);
  v_within integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_within_min'), 15);
  v_before integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_before_leave_min'), 30);
  v_task   record;
  v_count  integer := 0;
begin
  -- Hotfix 2 (E): the accept window and the reminder run only while the driver is at work: from the later of the sending
  -- and their Start work (an open duty period). 30 minutes before leave-by the task needs a driver in any case.
  for v_task in
    update public.tasks t
    set accept_reminder_sent_at = now()
    where t.status = 'assigned'
      and t.accepted_at is null
      and t.accept_reminder_sent_at is null
      and coalesce(t.leave_by, t.start_at) > now()
      and greatest(t.sent_at, public.on_duty_since(t.employee_id)) + make_interval(mins => v_remind) < now()
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
    returning t.id, t.employee_id
  loop
    perform public.send_push(v_task.id, 'accept_reminder', v_task.employee_id);
    v_count := v_count + 1;
  end loop;

  for v_task in
    update public.tasks t
    set needs_driver_since = now(), needs_driver_reason = 'not_accepted'
    where t.status = 'assigned'
      and t.accepted_at is null
      and t.needs_driver_since is null
      -- Today's and later tasks only (the list the office sees): no burst of pushes for old unaccepted tasks.
      and coalesce(t.leave_by, t.start_at) >= (date_trunc('day', now() at time zone 'Asia/Colombo') at time zone 'Asia/Colombo')
      and (greatest(t.sent_at, public.on_duty_since(t.employee_id)) + make_interval(mins => v_within) < now()
           or coalesce(t.leave_by, t.start_at) - make_interval(mins => v_before) < now())
      and exists (select 1 from public.employees e where e.id = t.employee_id and e.role = 'driver')
    returning t.id, t.employee_id, t.title, coalesce(t.leave_by, t.start_at) as leave_at
  loop
    perform public.notify_needs_driver(
      v_task.id,
      split_part(coalesce((select e.name from public.employees e where e.id = v_task.employee_id), 'The driver'), ' ', 1)
        || ' hasn''t accepted ''' || v_task.title || ''' ' || to_char(v_task.leave_at at time zone 'Asia/Colombo', 'HH24:MI'),
      'needs a driver');
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- F. Phone numbers, stored E.164 (+94…); every change logged ---------------------------------------------------------------
-- The numbers already stored as 07X…, 7X…, 947X… or +947X… (spaces and dashes dropped) become +947X…; anything else
-- stays as it is and is listed at the checkpoint.
update public.employees e set phone = '+94' || right(n.d, 9)
from (select id, regexp_replace(phone, '[^0-9]', '', 'g') as d from public.employees where phone is not null) n
where e.id = n.id and (n.d ~ '^0[1-9][0-9]{8}$' or n.d ~ '^[1-9][0-9]{8}$' or n.d ~ '^94[1-9][0-9]{8}$');

create table public.employee_changes (
  id                     bigint generated always as identity primary key,
  employee_id            uuid not null references public.employees (id),
  field                  text not null,
  old_value              text,
  new_value              text,
  changed_by_name        text not null,
  changed_by_employee_id uuid references public.employees (id),
  channel                text not null check (channel in ('claude', 'web', 'driver')),
  at                     timestamptz not null default now()
);
create index employee_changes_person_idx on public.employee_changes (employee_id, at desc);
alter table public.employee_changes enable row level security;
comment on table public.employee_changes is 'Who changed a person''s phone (and, from Part 3b, their profile) and when. Service role only.';

-- J. A task's vehicle may be chosen on the day ----------------------------------------------------------------------------------
alter table public.tasks alter column vehicle_id drop not null;
alter table public.tasks
  add column vehicle_mode text not null default 'specific',
  add column vehicle_type_wanted text,
  add constraint tasks_vehicle_mode_check check (vehicle_mode in ('specific', 'driver_day', 'any_type')),
  add constraint tasks_vehicle_type_wanted_check check (vehicle_type_wanted is null or vehicle_type_wanted in ('car', 'van', 'double_cab', 'lorry', 'other')),
  add constraint tasks_vehicle_present_check check (
    (vehicle_mode <> 'specific' or vehicle_id is not null)
    and (vehicle_mode <> 'any_type' or vehicle_type_wanted is not null)
    and (status not in ('in_progress', 'completed') or vehicle_id is not null));
comment on column public.tasks.vehicle_mode is
  'specific = the vehicle was chosen when the task was made; driver_day = the vehicle the driver holds on the day; '
  'any_type = any vehicle of vehicle_type_wanted. Until vehicle_id is set the driver confirms one at Start task (confirm_task_vehicle).';
alter table public.vehicle_requests
  add column proposed_vehicle_mode text,
  add column proposed_vehicle_type text,
  add constraint vehicle_requests_proposed_vehicle_mode_check check (proposed_vehicle_mode is null or proposed_vehicle_mode in ('specific', 'driver_day', 'any_type'));

-- The driver confirms the vehicle of a task made without one, before Start task: the one they hold, or one of the type.
create function public.confirm_task_vehicle(p_task uuid, p_vehicle uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_task public.tasks%rowtype;
  v_car  public.vehicles%rowtype;
begin
  select * into v_task from public.tasks where id = p_task for update;
  if not found or v_me is null or v_task.employee_id <> v_me then
    return 'not_yours';
  end if;
  if v_task.status not in ('assigned', 'declined') then
    return 'started';
  end if;
  if v_task.vehicle_mode = 'specific' and v_task.vehicle_id is not null and v_task.vehicle_id <> p_vehicle then
    return 'has_vehicle';
  end if;
  select * into v_car from public.vehicles where id = p_vehicle;
  if not found or not v_car.active then
    return 'inactive';
  end if;
  if v_car.in_garage then
    return 'in_garage';
  end if;
  if v_task.vehicle_mode = 'any_type' and v_car.vehicle_type is distinct from v_task.vehicle_type_wanted then
    return 'wrong_type';
  end if;
  update public.tasks set vehicle_id = p_vehicle where id = p_task;
  return 'ok';
end;
$$;
revoke all on function public.confirm_task_vehicle(uuid, uuid) from public, anon;
grant execute on function public.confirm_task_vehicle(uuid, uuid) to authenticated;

-- K. Who approved, and who is reviewing ---------------------------------------------------------------------------------------
alter table public.tasks
  add column approved_by_employee_id uuid references public.employees (id),
  add column approved_at timestamptz;
alter table public.vehicle_requests add column decided_by_employee_id uuid references public.employees (id);
comment on column public.tasks.approved_by_employee_id is
  'Who sent the task to the driver: the approver who decided its request or proposal, or the person with approve who made it.';

create table public.request_viewers (
  request_id  uuid not null references public.vehicle_requests (id),
  employee_id uuid not null references public.employees (id),
  name        text not null,
  seen_at     timestamptz not null default now(),
  primary key (request_id, employee_id)
);
alter table public.request_viewers enable row level security;
comment on table public.request_viewers is 'Who has a request''s decide page open (reviewing, every 20 s; shown while under 45 s old). Service role only.';

-- J, K. The task is saved with its vehicle mode and who approved it ---------------------------------------------------------
create or replace function public.office_create_task(
  p_task       jsonb,
  p_stops      jsonb,
  p_projects   jsonb default '[]'::jsonb,
  p_request_id uuid default null,
  p_decided_by text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_task_id uuid;
  v_status  text;
begin
  if jsonb_typeof(p_stops) is distinct from 'array' or jsonb_array_length(p_stops) = 0 then
    raise exception 'A task needs at least one stop';
  end if;

  if p_request_id is not null then
    select r.status into v_status
    from public.vehicle_requests r
    where r.id = p_request_id
    for update;

    if not found then
      raise exception 'Vehicle request % was not found', p_request_id;
    end if;
    if v_status <> 'waiting' then
      raise exception 'This vehicle request is already %', v_status;
    end if;
  end if;

  insert into public.tasks
    (title, label, employee_id, vehicle_id, start_at, end_by, passengers,
     contact_name, contact_phone, notes, request_id, created_by,
     start_place_id, start_name, start_lat, start_lng, return_to_base, avoid_expressway,
     leave_by, leave_by_source, buffer_min, plan_json,
     vehicle_choice, warnings, assigned_by_employee_id,
     vehicle_mode, vehicle_type_wanted, approved_by_employee_id, approved_at)
  select t.title, t.label, t.employee_id, t.vehicle_id, t.start_at, t.end_by, t.passengers,
         t.contact_name, t.contact_phone, t.notes, p_request_id, t.created_by,
         t.start_place_id, t.start_name, t.start_lat, t.start_lng,
         coalesce(t.return_to_base, false), coalesce(t.avoid_expressway, false),
         t.leave_by, t.leave_by_source, t.buffer_min, t.plan_json,
         t.vehicle_choice, t.warnings, t.assigned_by_employee_id,
         coalesce(t.vehicle_mode, 'specific'), t.vehicle_type_wanted, t.approved_by_employee_id, t.approved_at
  from jsonb_to_record(p_task) as t(
    title text, label text, employee_id uuid, vehicle_id uuid,
    start_at timestamptz, end_by timestamptz, passengers integer,
    contact_name text, contact_phone text, notes text, created_by text,
    start_place_id uuid, start_name text, start_lat double precision, start_lng double precision,
    return_to_base boolean, avoid_expressway boolean,
    leave_by timestamptz, leave_by_source text, buffer_min integer, plan_json jsonb,
    vehicle_choice jsonb, warnings jsonb, assigned_by_employee_id uuid,
    vehicle_mode text, vehicle_type_wanted text, approved_by_employee_id uuid, approved_at timestamptz)
  returning id into v_task_id;

  insert into public.task_stops
    (task_id, seq, type, place_id, place_name, address, lat, lng, what, note, dwell_min, arrive_by, planned_arrive_at, planned_depart_at,
     is_start, dwell_source)
  select v_task_id, s.seq, s.type, s.place_id, s.place_name, s.address, s.lat, s.lng,
         s.what, s.note, s.dwell_min, s.arrive_by, s.planned_arrive_at, s.planned_depart_at,
         coalesce(s.is_start, false), s.dwell_source
  from jsonb_to_recordset(p_stops) as s(
    seq integer, type text, place_id uuid, place_name text, address text,
    lat double precision, lng double precision, what text, note text, dwell_min integer,
    arrive_by timestamptz, planned_arrive_at timestamptz, planned_depart_at timestamptz,
    is_start boolean, dwell_source text);

  insert into public.task_projects (task_id, project_id, percent)
  select v_task_id, p.project_id, p.percent
  from jsonb_to_recordset(coalesce(p_projects, '[]'::jsonb)) as p(project_id uuid, percent numeric);

  if p_request_id is not null then
    update public.vehicle_requests
    set status     = 'approved',
        decided_at = now(),
        decided_by = p_decided_by,
        task_id    = v_task_id
    where id = p_request_id;
  end if;

  return v_task_id;
end;
$$;

-- F, I, K. The driver's contacts for their own task: who asked, who assigned it, who approved it (else the approvers), the
-- office. Only the task's own driver gets an answer (other drivers' numbers and the office's people stay private).
create function public.my_task_contacts(p_task uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_task public.tasks%rowtype;
  v_req  public.vehicle_requests%rowtype;
  v_ask  jsonb;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found or v_me is null or v_task.employee_id <> v_me then
    return null;
  end if;
  if v_task.request_id is not null then
    select * into v_req from public.vehicle_requests where id = v_task.request_id;
    v_ask := case
      when v_req.requested_by_employee_id is not null then
        (select jsonb_build_object('name', coalesce(v_req.on_behalf_of, e.name), 'phone', coalesce(v_req.requester_phone, e.phone))
         from public.employees e where e.id = v_req.requested_by_employee_id)
      else jsonb_build_object('name', coalesce(v_req.on_behalf_of, v_req.requested_by_name), 'phone', v_req.requester_phone)
    end;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'requester', v_ask,
    'assigner', (select jsonb_build_object('name', e.name, 'phone', e.phone) from public.employees e where e.id = v_task.assigned_by_employee_id),
    'approver', (select jsonb_build_object('name', e.name, 'phone', e.phone, 'at', v_task.approved_at)
                 from public.employees e where e.id = v_task.approved_by_employee_id),
    -- Who to call when the approver has no number (or none is named): the active approvers with a number.
    'approvers', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone) order by e.name)
                  from public.employees e
                  where e.active and e.phone is not null and 'approve' = any (e.permissions)
                    and e.role in ('admin', 'fleet_admin', 'office')),
    'office_phone', (select value #>> '{}' from public.fleet_settings where key = 'office_phone')
  ));
end;
$$;
revoke all on function public.my_task_contacts(uuid) from public, anon;
grant execute on function public.my_task_contacts(uuid) to authenticated;

-- F. Me → Call office and Call fleet admin, with no task at hand: the office's number and the approvers with a number.
-- Drivers only (an office person reads these through the tools).
create function public.my_office_contacts()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver' and e.active) then
    return null;
  end if;
  return jsonb_strip_nulls(jsonb_build_object(
    'office_phone', (select value #>> '{}' from public.fleet_settings where key = 'office_phone'),
    'approvers', (select jsonb_agg(jsonb_build_object('name', e.name, 'phone', e.phone) order by e.name)
                  from public.employees e
                  where e.active and e.phone is not null and 'approve' = any (e.permissions)
                    and e.role in ('admin', 'fleet_admin', 'office'))
  ));
end;
$$;
revoke all on function public.my_office_contacts() from public, anon;
grant execute on function public.my_office_contacts() to authenticated;

-- B. The driver app's notification channels: a phone with the update says it has the "new-tasks" channel when it
-- registers its push token; push-task uses that channel for new, changed and cancelled tasks only on such a phone (an
-- Android notification sent to a channel the phone does not have may not show). The older app's five-argument call still
-- matches (p_channels defaults to null).
alter table public.device_tokens add column channels text[];
drop function public.register_device_token(text, text, text, text, text);
create function public.register_device_token(
  p_token        text,
  p_platform     text default 'android',
  p_device_model text default null,
  p_app_version  text default null,
  p_language     text default null,
  p_channels     text[] default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_employee_id();
begin
  if v_me is null then
    raise exception 'Only a signed-in driver can register a device';
  end if;
  delete from public.device_tokens where token = p_token and employee_id <> v_me;
  insert into public.device_tokens (employee_id, token, platform, device_model, app_version, language, channels)
  values (v_me, p_token, p_platform, p_device_model, p_app_version, p_language, p_channels)
  on conflict (token) do update
    set device_model = excluded.device_model,
        app_version  = excluded.app_version,
        language     = excluded.language,
        channels     = coalesce(excluded.channels, public.device_tokens.channels),
        updated_at   = now();
end;
$$;
revoke all on function public.register_device_token(text, text, text, text, text, text[]) from public, anon;
grant execute on function public.register_device_token(text, text, text, text, text, text[]) to authenticated, service_role;

-- J. The driver hears when the vehicle is now chosen on the day or any vehicle of a type (vehicle_day, vehicle_any in the
-- changed push), not only a new plate. The function as in 20261018090000_phase7_trips.sql with those two lines.
create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  -- A housekeeping write (the 30-day removal of Google's lines) changes nothing the driver sees: no push.
  if coalesce(current_setting('fleet.quiet', true), '') = 'on' then
    return null;
  end if;
  -- The driver's own app (seen, accepted, declined, started, completed) never pushes.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    return null;
  end if;

  -- Phase 7 (§13): a trip the driver started is theirs: no "new" push for it, and none when they cancel it themselves
  -- before it starts (driver-api writes as the service role, so the check above does not see it). The office changing,
  -- reassigning or cancelling it still tells them (below); a stop the driver adds on the way writes no task row.
  if new.kind = 'self' and tg_op = 'INSERT' then
    return null;
  end if;
  if new.kind = 'self' and tg_op = 'UPDATE' and new.status = 'cancelled' and old.status <> 'cancelled'
     and new.cancelled_reason = 'Cancelled by the driver before starting' then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
    return null;
  end if;

  if new.employee_id <> old.employee_id then
    -- The previous driver hears that the task is gone only if he had accepted it
    -- (a task he never accepted simply leaves his list) and did not decline it himself.
    if old.status <> 'declined' and old.accepted_at is not null then
      perform public.send_push(new.id, 'removed', old.employee_id);
    end if;
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    if old.status <> 'declined' then
      perform public.send_push(new.id, 'cancelled', new.employee_id);
    end if;
  elsif old.status = 'declined' and new.status = 'assigned' then
    -- The same driver gets a declined task back (the office talked to him): as a new task.
    perform public.send_push(new.id, 'new', new.employee_id);
  elsif new.status in ('assigned', 'in_progress')
    and (new.start_at, new.end_by, new.vehicle_id, new.vehicle_mode, new.vehicle_type_wanted, new.title, new.plan_version, new.notes,
         new.passengers, new.contact_name, new.contact_phone)
        is distinct from
        (old.start_at, old.end_by, old.vehicle_id, old.vehicle_mode, old.vehicle_type_wanted, old.title, old.plan_version, old.notes,
         old.passengers, old.contact_name, old.contact_phone) then
    -- What changed, in the words the push shows ("Task changed: new time 09:30 · vehicle WP KL-1234").
    if new.start_at is distinct from old.start_at then
      v_changes := v_changes || jsonb_build_object('time', public.colombo_when(new.start_at));
    end if;
    if new.end_by is distinct from old.end_by then
      v_changes := v_changes || jsonb_build_object('end_by',
        case when new.end_by is null then 'none' else to_char(new.end_by at time zone 'Asia/Colombo', 'HH24:MI') end);
    end if;
    if (new.vehicle_id, new.vehicle_mode, new.vehicle_type_wanted) is distinct from (old.vehicle_id, old.vehicle_mode, old.vehicle_type_wanted) then
      -- Hotfix 2 (J): a plate, or the vehicle chosen on the day (vehicle_day), or any vehicle of a type (vehicle_any).
      v_changes := v_changes || case
        when new.vehicle_id is not null then
          jsonb_build_object('vehicle', (select v.reg_no from public.vehicles v where v.id = new.vehicle_id))
        when new.vehicle_mode = 'any_type' then jsonb_build_object('vehicle_any', coalesce(new.vehicle_type_wanted, 'other'))
        else jsonb_build_object('vehicle_day', true)
      end;
    end if;
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', new.title);
    end if;
    if new.plan_json is distinct from old.plan_json then
      -- Phase 7 (§11): which stops changed, by their place in the order, when update_task_stops said so.
      v_changes := v_changes || jsonb_build_object('stops', coalesce(new.plan_json -> 'stop_changes', 'true'::jsonb));
    end if;
    if new.passengers is distinct from old.passengers then
      v_changes := v_changes || jsonb_build_object('passengers', new.passengers);
    end if;
    if (new.notes, new.contact_name, new.contact_phone) is distinct from (old.notes, old.contact_name, old.contact_phone) then
      v_changes := v_changes || jsonb_build_object('notes', true);
    end if;
    perform public.send_push(new.id, 'changed', new.employee_id, jsonb_build_object('changes', v_changes));
  end if;
  return null;
end;
$$;
