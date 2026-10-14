-- =============================================================================
-- Phase 6, Part 2: availability, approvals, edits and redo, presence
-- (docs/phase6-plan.md, 3.1)
--
--   vehicle_requests   status 'changed' (an approved booking the requester edited:
--       it needs re-approval); version (bumped on every edit and decision:
--       update_request / redecide_request send the one they loaded, like
--       plan_version); changed_at / changed_by / change_note and previous (the
--       values before the last edit); on_behalf_of (a request made for someone
--       else: the asker stays the one notified).
--   request_events     the requester's timeline: created, seen, edited, approved,
--       declined, changed, redecided, postponed, cancelled, with who and what
--       changed. Written by the tools; read through RLS by approvers and by the
--       requester for their own requests. Backfilled from the columns.
--   task_assignment_events   action 'changed' with a changes jsonb ({field: {from, to}}).
--   tasks              leave_by backfilled (= start_at, manual) for the tasks made
--       before the planner existed (decision 1 of the plan).
--   get_driver_settings()   the only fleet settings a driver may read: the shift
--       nudge's time and days.
--   send_push(…, p_extra)   the 'changed' push names what changed ("new time 09:30 ·
--       vehicle WP KL-1234"): the trigger works the fields out from old and new.
-- =============================================================================

-- 1. vehicle_requests ------------------------------------------------------------
alter table public.vehicle_requests
  add column version      integer not null default 0,
  add column changed_at   timestamptz,
  add column changed_by   text,
  add column change_note  text,
  add column previous     jsonb,
  add column on_behalf_of text;

alter table public.vehicle_requests drop constraint vehicle_requests_status_check;
alter table public.vehicle_requests add constraint vehicle_requests_status_check
  check (status in ('waiting', 'approved', 'changed', 'declined', 'cancelled'));
-- A changed request was approved first, so decided_at stays set (the decided_at rule
-- still holds); changed_at marks the state and is cleared when it is decided again.
alter table public.vehicle_requests add constraint vehicle_requests_changed_check
  check ((status = 'changed') = (changed_at is not null));

comment on column public.vehicle_requests.version is
  'Bumped on every edit and decision; update_request and redecide_request must send the version they loaded.';
comment on column public.vehicle_requests.previous is
  'The request fields as they were before the last edit (needed_at, back_by, route_from, route_to, need_type, pax, tools, note, driver_required).';

-- The one-step booking records who the vehicle is for.
create or replace function public.office_book_vehicle(
  p_request    jsonb,
  p_task       jsonb,
  p_stops      jsonb,
  p_projects   jsonb default '[]'::jsonb,
  p_decided_by text default null
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_request_id uuid;
  v_task_id    uuid;
begin
  insert into public.vehicle_requests
    (requested_by_name, requested_by_employee_id, requested_by_user_id, project_id, project_label,
     needed_at, back_by, route_from, route_to, need_type, pax, tools, note,
     driver_required, one_step, seen_at, seen_by, on_behalf_of)
  select r.requested_by_name, r.requested_by_employee_id, r.requested_by_user_id, r.project_id, r.project_label,
         r.needed_at, r.back_by, r.route_from, r.route_to, r.need_type, r.pax, coalesce(r.tools, false), r.note,
         coalesce(r.driver_required, true), true, now(), p_decided_by, r.on_behalf_of
  from jsonb_to_record(p_request) as r(
    requested_by_name text, requested_by_employee_id uuid, requested_by_user_id uuid, project_id uuid, project_label text,
    needed_at timestamptz, back_by timestamptz, route_from text, route_to text, need_type text, pax integer, tools boolean,
    note text, driver_required boolean, on_behalf_of text)
  returning id into v_request_id;

  v_task_id := public.office_create_task(p_task, p_stops, p_projects, v_request_id, p_decided_by);
  return jsonb_build_object('request_id', v_request_id, 'task_id', v_task_id);
end;
$$;

-- 2. request_events --------------------------------------------------------------
create table public.request_events (
  id         bigint generated always as identity primary key,
  request_id uuid not null references public.vehicle_requests (id),
  at         timestamptz not null default now(),
  action     text not null
    check (action in ('created', 'seen', 'edited', 'approved', 'declined', 'changed', 'redecided', 'postponed', 'cancelled')),
  actor      text,
  note       text,
  changes    jsonb
);
create index request_events_request_idx on public.request_events (request_id, at, id);

alter table public.request_events enable row level security;
grant select on public.request_events to authenticated;

-- Who may read a request's events: anyone who approves, and the person who asked.
create function public.request_event_visible(p_request_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select public.office_can('approve'))
      or exists (
        select 1 from public.vehicle_requests r
        where r.id = p_request_id
          and r.requested_by_employee_id = (select public.current_employee_id())
          and (select public.office_can('request'))
      )
$$;
revoke all on function public.request_event_visible(uuid) from public, anon;
grant execute on function public.request_event_visible(uuid) to authenticated, service_role;

create policy request_events_select on public.request_events
  for select to authenticated
  using ((select public.request_event_visible(request_id)));

-- The timeline of every request made so far, from the columns that fed it until now.
insert into public.request_events (request_id, at, action, actor)
select id, created_at, 'created', requested_by_name from public.vehicle_requests;
insert into public.request_events (request_id, at, action, actor)
select id, seen_at, 'seen', seen_by from public.vehicle_requests where seen_at is not null;
insert into public.request_events (request_id, at, action, actor, note)
select id, decided_at, case when status = 'declined' then 'declined' else 'approved' end, decided_by, decline_reason
from public.vehicle_requests
where decided_at is not null and (status in ('approved', 'declined') or task_id is not null);
insert into public.request_events (request_id, at, action, actor, note)
select id, cancelled_at, 'cancelled', cancelled_by, cancel_reason from public.vehicle_requests where cancelled_at is not null;

-- 3. task_assignment_events: a change with its diff -------------------------------------
alter table public.task_assignment_events drop constraint task_assignment_events_action_check;
alter table public.task_assignment_events add constraint task_assignment_events_action_check
  check (action in ('assigned', 'accepted', 'declined', 'reassigned', 'cancelled', 'changed'));
alter table public.task_assignment_events add column changes jsonb;
comment on column public.task_assignment_events.changes is
  'What a changed or reassigned event altered: {field: {from, to}} in the office''s words (time, vehicle, driver, title, …).';

-- 4. Tasks made before the planner: their start time is their leave-by time -----------------
update public.tasks
set leave_by = start_at, leave_by_source = 'manual'
where leave_by is null and status in ('assigned', 'declined');

-- 5. The driver's settings: the shift nudge ---------------------------------------------------
-- shift_start "08:00" and shift_days [1..6] (0 = Sunday, as in rush_hour) live in
-- fleet_settings with these defaults; a driver may read nothing else of it.
create function public.get_driver_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shift_start', coalesce((select value #>> '{}' from public.fleet_settings where key = 'shift_start'), '08:00'),
    'shift_days',  coalesce((select value from public.fleet_settings where key = 'shift_days' and jsonb_typeof(value) = 'array'),
                            '[1, 2, 3, 4, 5, 6]'::jsonb)
  )
$$;
revoke all on function public.get_driver_settings() from public, anon;
grant execute on function public.get_driver_settings() to authenticated, service_role;

-- 6. The push that names what changed ------------------------------------------------------
drop function public.send_push(uuid, text, uuid);
create function public.send_push(p_task_id uuid, p_kind text, p_employee_id uuid, p_extra jsonb default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url text;
  v_key text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'functions_url';
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'server_key';
  if v_url is null or v_key is null then
    raise notice 'send_push: Vault secrets functions_url / server_key are not set; no push for task %', p_task_id;
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/push-task',
    body := jsonb_build_object('task_id', p_task_id, 'kind', p_kind, 'employee_id', p_employee_id) || coalesce(p_extra, '{}'::jsonb),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-server-key', v_key),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function public.send_push(uuid, text, uuid, jsonb) from public, anon, authenticated;

create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  -- The driver's own app (seen, accepted, declined, started, completed) never pushes.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
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
    and (new.start_at, new.end_by, new.vehicle_id, new.title, new.plan_version, new.notes, new.passengers, new.contact_name, new.contact_phone)
        is distinct from
        (old.start_at, old.end_by, old.vehicle_id, old.title, old.plan_version, old.notes, old.passengers, old.contact_name, old.contact_phone) then
    -- What changed, in the words the push shows ("Task changed: new time 09:30 · vehicle WP KL-1234").
    if new.start_at is distinct from old.start_at then
      v_changes := v_changes || jsonb_build_object('time', public.colombo_when(new.start_at));
    end if;
    if new.end_by is distinct from old.end_by then
      v_changes := v_changes || jsonb_build_object('end_by',
        case when new.end_by is null then 'none' else to_char(new.end_by at time zone 'Asia/Colombo', 'HH24:MI') end);
    end if;
    if new.vehicle_id is distinct from old.vehicle_id then
      v_changes := v_changes || jsonb_build_object('vehicle', (select v.reg_no from public.vehicles v where v.id = new.vehicle_id));
    end if;
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', new.title);
    end if;
    if new.plan_json is distinct from old.plan_json then
      v_changes := v_changes || jsonb_build_object('stops', true);
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
