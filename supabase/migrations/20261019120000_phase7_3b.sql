-- Phase 7, Part 3b (docs/phase7-plan.md "Part 3b"; Sahan's items G and H): the driver's profile, availability for
-- dispatch, asking drivers with one-tap answers, and Running late. No in-app chat; HR leave stays a separate project.

-- G. The driver's profile ----------------------------------------------------------------------------------------------------
-- The numbers are stored +94… (driver-api /profile and update_driver write them through the same rule as the office's).
alter table public.employees
  add column whatsapp text check (whatsapp is null or whatsapp ~ '^\+[0-9]{8,15}$'),
  add column emergency_name text check (emergency_name is null or length(btrim(emergency_name)) between 1 and 120),
  add column emergency_relation text check (emergency_relation is null or length(btrim(emergency_relation)) between 1 and 60),
  add column emergency_phone text check (emergency_phone is null or emergency_phone ~ '^\+[0-9]{8,15}$'),
  add column licence_no text check (licence_no is null or length(btrim(licence_no)) between 1 and 40),
  add column licence_front_photo_id uuid references public.photos (id),
  add column licence_back_photo_id uuid references public.photos (id);
comment on column public.employees.whatsapp is 'Part 3b (G): the WhatsApp number when it is not the phone (+94…).';
comment on column public.employees.emergency_name is
  'Part 3b (G): the emergency contact. It and the licence reach only people with users or vehicles (never a requester).';

alter table public.photos drop constraint photos_kind_check;
alter table public.photos add constraint photos_kind_check
  check (kind in ('odometer', 'fuel_receipt', 'vehicle_report', 'bill', 'profile', 'licence'));

-- The driver sets a photo of their licence (front or back): a photos row of kind licence, theirs, in <id>/licence/. Every
-- change is in employee_changes as the driver's.
create function public.set_my_licence_photo(p_side text, p_photo_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := public.current_employee_id();
  v_photo public.photos%rowtype;
  v_old   uuid;
  v_name  text;
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  if p_side is null or p_side not in ('front', 'back') then
    raise exception 'side must be front or back' using errcode = '22023';
  end if;
  select * into v_photo from public.photos where id = p_photo_id;
  if not found or v_photo.employee_id <> v_me or v_photo.kind <> 'licence'
     or not starts_with(v_photo.storage_path, v_me::text || '/licence/') then
    return 'not_yours';
  end if;
  select case when p_side = 'front' then licence_front_photo_id else licence_back_photo_id end, name
    into v_old, v_name from public.employees where id = v_me;
  if v_old is not distinct from p_photo_id then
    return 'ok';
  end if;
  if p_side = 'front' then
    update public.employees set licence_front_photo_id = p_photo_id where id = v_me;
  else
    update public.employees set licence_back_photo_id = p_photo_id where id = v_me;
  end if;
  insert into public.employee_changes (employee_id, field, old_value, new_value, changed_by_name, changed_by_employee_id, channel)
  values (v_me, 'licence_' || p_side || '_photo', v_old::text, p_photo_id::text, coalesce(v_name, 'The driver'), v_me, 'driver');
  return 'ok';
end;
$$;
revoke all on function public.set_my_licence_photo(text, uuid) from public, anon;
grant execute on function public.set_my_licence_photo(text, uuid) to authenticated;

-- H1. Availability for dispatch -------------------------------------------------------------------------------------------
-- A driver is not available from starts_at to ends_at: a full day (or several), the morning (until the half-day split,
-- 13:00 by default), the afternoon (from it) or two times of one day. Not HR leave: it only tells dispatch.
create table public.driver_unavailability (
  id                     uuid primary key default gen_random_uuid(),
  employee_id            uuid not null references public.employees (id),
  starts_at              timestamptz not null,
  ends_at                timestamptz not null,
  part                   text not null check (part in ('full_day', 'morning', 'afternoon', 'hours')),
  reason                 text not null check (reason in ('leave', 'half_day', 'personal', 'other')),
  note                   text check (note is null or length(note) <= 300),
  created_by_name        text not null,
  created_by_employee_id uuid references public.employees (id),
  channel                text not null check (channel in ('claude', 'web', 'driver')),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  updated_by_name        text,
  removed_at             timestamptz,
  removed_by_name        text,
  constraint driver_unavailability_order check (ends_at > starts_at),
  constraint driver_unavailability_span check (ends_at <= starts_at + interval '31 days')
);
create index driver_unavailability_when_idx on public.driver_unavailability (employee_id, starts_at) where removed_at is null;
alter table public.driver_unavailability enable row level security;
comment on table public.driver_unavailability is
  'Part 3b (H1): when a driver is not available for dispatch (who added it, removed entries kept). Drivers read their own; '
  'the office reads and writes through the tools (unavailability, set_unavailability, remove_unavailability).';
create policy driver_unavailability_select_own on public.driver_unavailability
  for select to authenticated
  using (employee_id = (select public.current_employee_id()));
grant select on public.driver_unavailability to authenticated;

-- The window of an entry in Colombo time. Pure: the driver's RPC and the office's tool use the same rule.
create function public.unavailability_window(p_from date, p_to date, p_part text, p_start time, p_end time, p_split time)
returns table (starts_at timestamptz, ends_at timestamptz)
language sql
immutable
set search_path = ''
as $$
  select
    case p_part
      when 'afternoon' then (p_from + p_split) at time zone 'Asia/Colombo'
      when 'hours' then (p_from + p_start) at time zone 'Asia/Colombo'
      else p_from::timestamp at time zone 'Asia/Colombo'
    end,
    case p_part
      when 'full_day' then (coalesce(p_to, p_from) + 1)::timestamp at time zone 'Asia/Colombo'
      when 'morning' then (p_from + p_split) at time zone 'Asia/Colombo'
      when 'afternoon' then (p_from + 1)::timestamp at time zone 'Asia/Colombo'
      else (p_from + p_end) at time zone 'Asia/Colombo'
    end
$$;
revoke all on function public.unavailability_window(date, date, text, time, time, time) from public, anon, authenticated;

-- Saves an entry (a new one, or a change of one not removed): the driver's RPC and the office's tool. Answers
-- {result: ok, id} or {result: refused, reason}. Service role only (the RPC below checks the driver).
create function public.save_unavailability(
  p_employee uuid, p_id uuid, p_from date, p_to date, p_part text, p_start time, p_end time, p_reason text, p_note text,
  p_by_name text, p_by_employee uuid, p_channel text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_split time := coalesce((select (value #>> '{}')::time from public.fleet_settings where key = 'half_day_split'), time '13:00');
  v_win   record;
  v_row   public.driver_unavailability%rowtype;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
  v_today date := (now() at time zone 'Asia/Colombo')::date;
begin
  if p_part is null or p_part not in ('full_day', 'morning', 'afternoon', 'hours') then
    return jsonb_build_object('result', 'refused', 'reason', 'part must be full_day, morning, afternoon or hours');
  end if;
  if p_reason is null or p_reason not in ('leave', 'half_day', 'personal', 'other') then
    return jsonb_build_object('result', 'refused', 'reason', 'reason must be leave, half_day, personal or other');
  end if;
  if p_from is null then
    return jsonb_build_object('result', 'refused', 'reason', 'Choose a day.');
  end if;
  if p_to is not null and (p_part <> 'full_day' or p_to < p_from) then
    return jsonb_build_object('result', 'refused', 'reason', 'Only full days can run to a later day, and the last day comes after the first.');
  end if;
  if coalesce(p_to, p_from) < v_today then
    return jsonb_build_object('result', 'refused', 'reason', 'That day has passed.');
  end if;
  if p_to is not null and p_to > p_from + 30 then
    return jsonb_build_object('result', 'refused', 'reason', 'At most 31 days at a time.');
  end if;
  if p_part = 'hours' and (p_start is null or p_end is null or p_end <= p_start) then
    return jsonb_build_object('result', 'refused', 'reason', 'Give the time from and the time to, the second after the first.');
  end if;
  select * into v_win from public.unavailability_window(p_from, p_to, p_part, p_start, p_end, v_split);

  if p_id is not null then
    select * into v_row from public.driver_unavailability where id = p_id for update;
    if not found or v_row.employee_id <> p_employee or v_row.removed_at is not null then
      return jsonb_build_object('result', 'refused', 'reason', 'This entry is not there any more.');
    end if;
    update public.driver_unavailability
    set starts_at = v_win.starts_at, ends_at = v_win.ends_at, part = p_part, reason = p_reason, note = v_note,
        updated_at = now(), updated_by_name = p_by_name
    where id = p_id;
    return jsonb_build_object('result', 'ok', 'id', p_id);
  end if;

  insert into public.driver_unavailability
    (employee_id, starts_at, ends_at, part, reason, note, created_by_name, created_by_employee_id, channel)
  values (p_employee, v_win.starts_at, v_win.ends_at, p_part, p_reason, v_note, p_by_name, p_by_employee, p_channel)
  returning * into v_row;
  return jsonb_build_object('result', 'ok', 'id', v_row.id);
end;
$$;
revoke all on function public.save_unavailability(uuid, uuid, date, date, text, time, time, text, text, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.save_unavailability(uuid, uuid, date, date, text, time, time, text, text, text, uuid, text)
  to service_role;

-- The driver's own entries (Me → Availability).
create function public.set_my_unavailability(
  p_id uuid, p_from date, p_to date, p_part text, p_start time, p_end time, p_reason text, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_name text;
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  select name into v_name from public.employees where id = v_me;
  return public.save_unavailability(v_me, p_id, p_from, p_to, p_part, p_start, p_end, p_reason, p_note,
                                    coalesce(v_name, 'The driver'), v_me, 'driver');
end;
$$;
revoke all on function public.set_my_unavailability(uuid, date, date, text, time, time, text, text) from public, anon;
grant execute on function public.set_my_unavailability(uuid, date, date, text, time, time, text, text) to authenticated;

create function public.remove_my_unavailability(p_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_name text;
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  select name into v_name from public.employees where id = v_me;
  update public.driver_unavailability set removed_at = now(), removed_by_name = coalesce(v_name, 'The driver')
  where id = p_id and employee_id = v_me and removed_at is null;
  return case when found then 'ok' else 'not_found' end;
end;
$$;
revoke all on function public.remove_my_unavailability(uuid) from public, anon;
grant execute on function public.remove_my_unavailability(uuid) to authenticated;

-- H3. Asking drivers ------------------------------------------------------------------------------------------------------
-- One question to some drivers, one row per driver asked with their answer. The trip question expires at the trip's
-- start, the others two hours after they are asked (the tool sets expires_at).
create table public.driver_asks (
  id                   uuid primary key default gen_random_uuid(),
  kind                 text not null check (kind in ('free_for_trip', 'office_time', 'where_now')),
  trip_from            timestamptz,
  trip_to              timestamptz,
  note                 text check (note is null or length(note) <= 300),
  task_id              uuid references public.tasks (id),
  request_id           uuid references public.vehicle_requests (id),
  asked_by_employee_id uuid references public.employees (id),
  asked_by_name        text not null,
  channel              text not null check (channel in ('claude', 'web')),
  created_at           timestamptz not null default now(),
  expires_at           timestamptz not null,
  constraint driver_asks_trip check (kind <> 'free_for_trip' or trip_from is not null),
  constraint driver_asks_trip_order check (trip_to is null or trip_to > trip_from)
);
create index driver_asks_created_idx on public.driver_asks (created_at desc);
alter table public.driver_asks enable row level security;
comment on table public.driver_asks is
  'Part 3b (H3): a question the office sent to drivers (ask_drivers). Drivers read the ones they were asked.';

create table public.driver_ask_answers (
  id           uuid primary key default gen_random_uuid(),
  ask_id       uuid not null references public.driver_asks (id) on delete cascade,
  employee_id  uuid not null references public.employees (id),
  sent_at      timestamptz not null default now(),
  seen_at      timestamptz,
  answer       text check (answer in ('yes', 'no', 'call_me', 'time', 'location')),
  answer_at    timestamptz,
  lat          double precision check (lat is null or lat between -90 and 90),
  lng          double precision check (lng is null or lng between -180 and 180),
  accuracy_m   real,
  answered_at  timestamptz,
  constraint driver_ask_answers_one unique (ask_id, employee_id),
  constraint driver_ask_answers_time check (answer is distinct from 'time' or answer_at is not null),
  constraint driver_ask_answers_where check (answer is distinct from 'location' or (lat is not null and lng is not null))
);
create index driver_ask_answers_driver_idx on public.driver_ask_answers (employee_id, sent_at desc);
alter table public.driver_ask_answers enable row level security;
comment on table public.driver_ask_answers is
  'Part 3b (H3): one row per driver asked: when it was sent and seen, the answer (a "where now" answer is one point the '
  'driver chose to share; it is not a location point). Drivers read their own; office people with approve or '
  'assign_tasks read all (Realtime: the answers arrive live).';

create policy driver_asks_select_asked on public.driver_asks
  for select to authenticated
  using (
    exists (select 1 from public.driver_ask_answers a
            where a.ask_id = driver_asks.id and a.employee_id = (select public.current_employee_id()))
    or (select public.office_can('approve')) or (select public.office_can('assign_tasks'))
  );
create policy driver_ask_answers_select on public.driver_ask_answers
  for select to authenticated
  using (
    employee_id = (select public.current_employee_id())
    or (select public.office_can('approve')) or (select public.office_can('assign_tasks'))
  );
grant select on public.driver_asks, public.driver_ask_answers to authenticated;
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.driver_ask_answers;
  end if;
end;
$$;

-- The driver answers (or opens) a question: only their own row, only before it expires (an answer queued offline counts by
-- the time it was given). Answers 'ok' | 'expired' | 'not_yours' | 'bad'.
create function public.answer_ask(
  p_ask_id uuid, p_answer text, p_answer_at timestamptz default null, p_lat double precision default null,
  p_lng double precision default null, p_accuracy real default null, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := public.current_employee_id();
  v_ask public.driver_asks%rowtype;
  v_row public.driver_ask_answers%rowtype;
  v_at  timestamptz := least(coalesce(p_at, now()), now());
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  select * into v_row from public.driver_ask_answers where ask_id = p_ask_id and employee_id = v_me for update;
  if not found then
    return 'not_yours';
  end if;
  select * into v_ask from public.driver_asks where id = p_ask_id;
  if p_answer = 'seen' then
    update public.driver_ask_answers set seen_at = coalesce(seen_at, v_at) where id = v_row.id;
    return 'ok';
  end if;
  if v_at > v_ask.expires_at then
    return 'expired';
  end if;
  if p_answer is null
     or (v_ask.kind = 'free_for_trip' and p_answer not in ('yes', 'no', 'call_me'))
     or (v_ask.kind = 'office_time' and (p_answer not in ('time', 'call_me') or (p_answer = 'time' and p_answer_at is null)))
     or (v_ask.kind = 'where_now' and (p_answer not in ('location', 'call_me')
                                       or (p_answer = 'location' and (p_lat is null or p_lng is null)))) then
    return 'bad';
  end if;
  -- The last answer given wins (a driver who changes their mind); a replay of an older one changes nothing.
  if v_row.answered_at is not null and v_row.answered_at >= v_at then
    return 'ok';
  end if;
  update public.driver_ask_answers
  set answer = p_answer,
      answer_at = case when p_answer = 'time' then p_answer_at end,
      lat = case when p_answer = 'location' then p_lat end,
      lng = case when p_answer = 'location' then p_lng end,
      accuracy_m = case when p_answer = 'location' then p_accuracy end,
      answered_at = v_at,
      seen_at = coalesce(seen_at, v_at)
  where id = v_row.id;
  return 'ok';
end;
$$;
revoke all on function public.answer_ask(uuid, text, timestamptz, double precision, double precision, real, timestamptz)
  from public, anon;
grant execute on function public.answer_ask(uuid, text, timestamptz, double precision, double precision, real, timestamptz)
  to authenticated;

-- A driver asked gets a push (push-task, kind ask: the question in their language, the "driver-asks" channel).
create function public.driver_ask_answers_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.send_push(null, 'ask', new.employee_id, jsonb_build_object('ask_id', new.ask_id));
  return null;
end;
$$;
revoke all on function public.driver_ask_answers_push() from public, anon, authenticated;
create trigger driver_ask_answers_push
  after insert on public.driver_ask_answers
  for each row execute function public.driver_ask_answers_push();

-- The person who asked hears each answer (their notification centre, and Web Push when they have it on).
create function public.driver_ask_answers_notify()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ask    public.driver_asks%rowtype;
  v_name   text;
  v_text   text;
begin
  if new.answered_at is null or new.answered_at is not distinct from old.answered_at then
    return null;
  end if;
  select * into v_ask from public.driver_asks where id = new.ask_id;
  if v_ask.asked_by_employee_id is null then
    return null;
  end if;
  select split_part(name, ' ', 1) into v_name from public.employees where id = new.employee_id;
  v_text := case new.answer
    when 'yes' then 'Yes, free'
    when 'no' then 'No, not free'
    when 'call_me' then 'Call me'
    when 'time' then 'At the office at ' || to_char(new.answer_at at time zone 'Asia/Colombo', 'HH24:MI')
    when 'location' then 'Shared where they are'
    else new.answer end;
  perform public.queue_notification('ask.answered',
    jsonb_build_object(
      'title', coalesce(v_name, 'A driver') || ': ' || v_text,
      'body', case v_ask.kind
        when 'free_for_trip' then 'Free for a trip ' || to_char(v_ask.trip_from at time zone 'Asia/Colombo', 'Dy DD Mon HH24:MI')
          || coalesce('–' || to_char(v_ask.trip_to at time zone 'Asia/Colombo', 'HH24:MI'), '') || '?'
        when 'office_time' then 'When can you be at the office?'
        else 'Where are you now?' end,
      'url', '/drivers/asks/' || v_ask.id::text,
      'tag', 'ask:' || v_ask.id::text,
      'who', coalesce(v_name, 'A driver')),
    array[v_ask.asked_by_employee_id]);
  return null;
end;
$$;
revoke all on function public.driver_ask_answers_notify() from public, anon, authenticated;
create trigger driver_ask_answers_notify
  after update of answered_at on public.driver_ask_answers
  for each row execute function public.driver_ask_answers_notify();

-- Asks and their answers go after 30 days (a "where now" point with them: the answers cascade).
select cron.schedule('prune-driver-asks', '55 21 * * *',
  $$delete from public.driver_asks where created_at < now() - interval '30 days'$$);

-- push-task's new kind (the driver's question).
alter table public.push_log drop constraint push_log_kind_check;
alter table public.push_log add constraint push_log_kind_check
  check (kind in ('new', 'changed', 'cancelled', 'removed', 'leave_30', 'leave_now', 'accept_reminder',
                  'vehicle_taken', 'vehicle_moved', 'duty_auto_out', 'duty_office_out', 'reopened', 'ask'));

-- H4. Running late ----------------------------------------------------------------------------------------------------------
alter table public.tasks
  add column late_report_min integer check (late_report_min is null or late_report_min between 1 and 600),
  add column late_report_at timestamptz;
comment on column public.tasks.late_report_min is
  'Part 3b (H4): the driver''s last "Running late" (minutes) and when they said it (report_running_late).';

alter table public.task_assignment_events drop constraint task_assignment_events_action_check;
alter table public.task_assignment_events add constraint task_assignment_events_action_check
  check (action in ('assigned', 'accepted', 'declined', 'reassigned', 'cancelled', 'changed', 'reopened', 'stop_skipped',
                    'running_late'));

-- The driver says they are running late (before or during the task; queued offline, the latest report wins). Tells the
-- people who run the trips and the one who assigned it, and the person who asked. Answers 'ok' | 'not_yours' | 'closed'.
create function public.report_running_late(p_task_id uuid, p_minutes integer, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := public.current_employee_id();
  v_task     public.tasks%rowtype;
  v_at       timestamptz := least(coalesce(p_at, now()), now());
  v_name     text;
  v_dispatch uuid[];
  v_title    text;
  v_body     text;
begin
  if v_me is null then
    raise exception 'Not signed in as a driver' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes < 1 or p_minutes > 600 then
    raise exception 'minutes must be between 1 and 600' using errcode = '22023';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.employee_id <> v_me then
    return 'not_yours';
  end if;
  if v_task.status not in ('assigned', 'in_progress') then
    return 'closed';
  end if;
  if v_task.late_report_at is not null and v_task.late_report_at >= v_at then
    return 'ok';
  end if;
  update public.tasks set late_report_min = p_minutes, late_report_at = v_at where id = p_task_id;
  select name into v_name from public.employees where id = v_me;
  insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor, note)
  values (p_task_id, v_at, 'running_late', v_me, v_task.vehicle_id, v_name, p_minutes || ' min');

  v_title := split_part(coalesce(v_name, 'The driver'), ' ', 1) || ' is running late · ' || p_minutes || ' min';
  v_body := v_task.title || ' · leave by '
    || to_char(coalesce(v_task.leave_by, v_task.start_at) at time zone 'Asia/Colombo', 'HH24:MI');
  v_dispatch := public.dispatch_recipients();
  if v_task.assigned_by_employee_id is not null and not (v_task.assigned_by_employee_id = any(v_dispatch)) then
    v_dispatch := v_dispatch || v_task.assigned_by_employee_id;
  end if;
  perform public.queue_notification('task.running_late',
    jsonb_build_object('title', v_title, 'body', v_body, 'url', '/tasks/' || p_task_id::text,
                       'tag', 'late:' || p_task_id::text, 'task_id', p_task_id),
    v_dispatch);
  perform public.notify_requester(p_task_id, 'request.running_late', v_title, v_body);
  return 'ok';
end;
$$;
revoke all on function public.report_running_late(uuid, integer, timestamptz) from public, anon;
grant execute on function public.report_running_late(uuid, integer, timestamptz) to authenticated;

-- H1. The phone reads where a half day splits (the setting half_day_split, 13:00 by default), with its other settings. As in
-- 20261018090000_phase7_trips.sql, with half_day_split.
create or replace function public.get_driver_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shift_start', coalesce((select value #>> '{}' from public.fleet_settings where key = 'shift_start'), '08:00'),
    'shift_days',  coalesce((select value from public.fleet_settings where key = 'shift_days' and jsonb_typeof(value) = 'array'),
                            '[1, 2, 3, 4, 5]'::jsonb),
    'fuel_video_checklist',
                   coalesce((select value from public.fleet_settings where key = 'fuel_video_checklist' and jsonb_typeof(value) = 'array'),
                            '[{"key": "plate", "short": "Plate", "en": "Number plate", "si": "අංක තහඩුව"},
                              {"key": "zero", "short": "Zero", "en": "Pump display at zero before pumping", "si": "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ"},
                              {"key": "pumping", "short": "Pumping", "en": "Pumping", "si": "පොම්ප කරමින්"},
                              {"key": "final", "short": "Final", "en": "Final pump display: litres and amount", "si": "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල"}]'::jsonb),
    'fuel_video_quality',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'fuel_video_quality'), '480p'),
    -- Phase 7 (§13): Start a trip offers Personal per this setting (allowed, default, off; ask_first behaves as allowed).
    'driver_personal_trips',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'driver_personal_trips'), 'allowed'),
    -- Part 3b (H1): a morning ends and an afternoon starts here.
    'half_day_split',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'half_day_split'), '13:00')
  )
$$;
