-- =============================================================================
-- Phase 5, Part 3b (2 of 2): office notifications (docs/dispatch-plan.md, 3.5 and 9)
-- and the sync guard.
--
--   web_push_subscriptions  one row per browser a person turned notifications on in
--                           (endpoint unique; removed_at when the person turned it off or
--                           the push service said it is gone: nothing is deleted).
--   notification_settings   per person and event: enabled or not (no row = enabled).
--   notifications           the outbox: one row per recipient and event, with the message
--                           (title, body, url, tag) and the delivery state; notify-office
--                           delivers it (queued → sent | failed with a retry time | dead).
--   job_runs                when a background job last ran (the issue sync: fleet_overview
--                           skips its own sync when one finished under 60 s ago).
--   queue_notification      one row per recipient who is active, has not switched the
--                           event off, and has a device; the tools call it through the
--                           client, decline_task and the accept reminder call it in SQL.
--   notifications_deliver   after insert → notify-office {id} (pg_net, Vault secrets).
--   notify_retry            every 5 minutes: failed or forgotten rows → notify-office {retry}.
--   Service role only on every table; a person's own rows come through the tools.
-- =============================================================================

-- 1. Tables -----------------------------------------------------------------------
create table public.web_push_subscriptions (
  id             uuid primary key default gen_random_uuid(),
  employee_id    uuid not null references public.employees (id),
  endpoint       text not null unique,
  p256dh         text not null,
  auth           text not null,
  user_agent     text,
  created_at     timestamptz not null default now(),
  last_ok_at     timestamptz,
  removed_at     timestamptz,
  removed_reason text check (removed_reason in ('user', 'gone'))
);
create index web_push_subscriptions_employee_idx on public.web_push_subscriptions (employee_id) where removed_at is null;

create table public.notification_settings (
  employee_id uuid not null references public.employees (id),
  event       text not null,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  primary key (employee_id, event)
);

create table public.notifications (
  id                    bigint generated always as identity primary key,
  event                 text not null,
  payload               jsonb not null,
  recipient_employee_id uuid not null references public.employees (id),
  channel               text not null default 'web_push' check (channel in ('web_push', 'email')),
  status                text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'dead')),
  attempts              integer not null default 0,
  next_try_at           timestamptz not null default now(),
  sent_at               timestamptz,
  error                 text,
  created_at            timestamptz not null default now()
);
create index notifications_queue_idx on public.notifications (status, next_try_at) where status in ('queued', 'failed');
create index notifications_recipient_idx on public.notifications (recipient_employee_id, created_at desc);

create table public.job_runs (
  job         text primary key,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  result      jsonb
);

alter table public.web_push_subscriptions enable row level security;
alter table public.notification_settings  enable row level security;
alter table public.notifications          enable row level security;
alter table public.job_runs               enable row level security;
revoke all on public.web_push_subscriptions, public.notification_settings, public.notifications, public.job_runs
  from public, anon, authenticated;

-- 2. The outbox writer --------------------------------------------------------------
-- One row per recipient who is an active office person, has not switched this event
-- off, and has a device with notifications on. Answers how many rows it wrote.
create function public.queue_notification(p_event text, p_payload jsonb, p_recipients uuid[])
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
revoke all on function public.queue_notification(text, jsonb, uuid[]) from public, anon, authenticated;

-- "HH:MM" today, "Tue 14 Oct HH:MM" on another day (Colombo), for the SQL-built messages.
create function public.colombo_when(p_at timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select case
    when (p_at at time zone 'Asia/Colombo')::date = (now() at time zone 'Asia/Colombo')::date
      then to_char(p_at at time zone 'Asia/Colombo', 'HH24:MI')
    else to_char(p_at at time zone 'Asia/Colombo', 'Dy FMDD Mon HH24:MI')
  end
$$;
revoke all on function public.colombo_when(timestamptz) from public, anon, authenticated;

-- The office people a task event goes to: everyone who approves requests or assigns tasks.
create function public.dispatch_recipients()
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.employees
  where active
    and role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
    and permissions && array['approve', 'assign_tasks']::text[]
$$;
revoke all on function public.dispatch_recipients() from public, anon, authenticated;

-- 3. Delivery -------------------------------------------------------------------------
create function public.notifications_deliver()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.call_edge_function('notify-office', jsonb_build_object('id', new.id));
  return null;
end;
$$;
revoke all on function public.notifications_deliver() from public, anon, authenticated;
create trigger notifications_deliver
  after insert on public.notifications
  for each row execute function public.notifications_deliver();

-- Rows that failed (their retry time has come) or were never picked up: one call, the
-- function takes every due row.
create function public.notify_retry()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.notifications
             where status in ('queued', 'failed') and attempts < 5 and next_try_at <= now()) then
    perform public.call_edge_function('notify-office', '{"retry": true}'::jsonb);
  end if;
end;
$$;
revoke all on function public.notify_retry() from public, anon, authenticated;
select cron.schedule('notify-retry', '*/5 * * * *', $$select public.notify_retry()$$);

-- 4. The events written in SQL ------------------------------------------------------------
-- task.declined: the driver's decline (Part 5) tells everyone who approves or assigns.
create or replace function public.decline_task(p_task_id uuid, p_reason text, p_note text default null, p_at timestamptz default now())
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_task public.tasks%rowtype;
  v_at   timestamptz := least(coalesce(p_at, now()), now());
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
  v_reason_text text;
begin
  if v_me is null then
    raise exception 'Not signed in as a driver' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('vehicle_problem', 'not_available', 'unwell', 'other') then
    raise exception 'reason must be vehicle_problem, not_available, unwell or other' using errcode = '22023';
  end if;
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found or v_task.employee_id <> v_me then
    return 'already_reassigned';
  end if;
  if v_task.status in ('in_progress', 'completed') then return 'already_started'; end if;
  if v_task.status = 'declined' then return 'already_declined'; end if;
  if v_task.status = 'cancelled' then return 'cancelled'; end if;

  update public.tasks
  set status = 'declined',
      declined_at = v_at,
      declined_by = v_me,
      declined_reason = p_reason,
      declined_note = v_note,
      declined_after_accept = (v_task.accepted_at is not null)
  where id = p_task_id;
  select e.name into v_name from public.employees e where e.id = v_me;
  insert into public.task_assignment_events (task_id, at, action, employee_id, vehicle_id, actor, note)
  values (p_task_id, v_at, 'declined', v_me, v_task.vehicle_id, v_name,
          p_reason || case when v_note is null then '' else ': ' || v_note end);

  v_reason_text := case p_reason
    when 'vehicle_problem' then 'Vehicle problem'
    when 'not_available' then 'Not available'
    when 'unwell' then 'Unwell'
    else 'Other' end || case when v_note is null then '' else ': ' || v_note end;
  perform public.queue_notification(
    'task.declined',
    jsonb_build_object(
      'title', coalesce(v_name, 'The driver') || ' can''t do ' || v_task.title,
      'body', v_reason_text || ' · leave by ' || public.colombo_when(coalesce(v_task.leave_by, v_task.start_at)),
      'url', '/tasks?task=' || p_task_id::text,
      'tag', 'task:' || p_task_id::text,
      'task_id', p_task_id),
    public.dispatch_recipients());
  return 'declined';
end;
$$;

-- task.not_accepted: the accept reminder to the driver (Part 5) also tells the office.
create or replace function public.queue_accept_reminders()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_within integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_within_min'), 30);
  v_before integer := coalesce((select (value #>> '{}')::integer from public.fleet_settings where key = 'accept_before_leave_min'), 60);
  v_task   record;
  v_count  integer := 0;
begin
  for v_task in
    update public.tasks t
    set accept_reminder_sent_at = now()
    where t.status = 'assigned'
      and t.accepted_at is null
      and t.accept_reminder_sent_at is null
      and coalesce(t.leave_by, t.start_at) > now()
      and (t.sent_at + make_interval(mins => v_within) < now()
           or coalesce(t.leave_by, t.start_at) - make_interval(mins => v_before) < now())
    returning t.id, t.employee_id, t.title, coalesce(t.leave_by, t.start_at) as leave_at
  loop
    perform public.send_push(v_task.id, 'accept_reminder', v_task.employee_id);
    perform public.queue_notification(
      'task.not_accepted',
      jsonb_build_object(
        'title', 'Not accepted yet · ' || v_task.title,
        'body', coalesce((select e.name from public.employees e where e.id = v_task.employee_id), 'The driver')
                || ' · leave by ' || public.colombo_when(v_task.leave_at),
        'url', '/tasks?task=' || v_task.id::text,
        'tag', 'task:' || v_task.id::text,
        'task_id', v_task.id),
      public.dispatch_recipients());
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
