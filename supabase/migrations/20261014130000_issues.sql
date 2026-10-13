-- =============================================================================
-- Phase 5, Part 3a: the issues centre (docs/dispatch-plan.md, 3.4 and 8)
--
--   issues          one row per thing that needs attention (documents, service,
--                   km, reports, readings, a task's signal / late start / running
--                   late / not accepted / declined, requests waiting, failed pushes
--                   or routing calls). ref_key is unique while open or in progress,
--                   so a condition never opens twice; a resolved one may reopen as a
--                   new row. syncIssues (the shared module) opens, updates and
--                   auto-resolves them; the office takes, notes, resolves, dismisses.
--   issue_events    who did what to an issue (opened, assigned, note, status,
--                   auto_resolved).
--   call_edge_function   the one pg_net caller (Vault functions_url + server_key);
--                   fleet_sync(scope) asks the Edge Function fleet-jobs to sync,
--                   every 5 minutes (pg_cron fleet-sync) and from the triggers on
--                   vehicle_reports, tasks and vehicle_requests.
--   Office people with the view permission read both tables (RLS); issues is in
--   the Realtime publication for the bell. Drivers read nothing.
-- =============================================================================

-- 1. Tables ---------------------------------------------------------------------
create table public.issues (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,
  severity          text not null check (severity in ('info', 'warning', 'critical')),
  title             text not null,
  detail            text,
  due               text,
  sort_key          integer not null default 0,
  vehicle_id        uuid references public.vehicles (id),
  employee_id       uuid references public.employees (id),
  task_id           uuid references public.tasks (id),
  request_id        uuid references public.vehicle_requests (id),
  vehicle_report_id uuid references public.vehicle_reports (id),
  ref_key           text not null,
  status            text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'dismissed')),
  assigned_to       uuid references public.employees (id),
  opened_at         timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       text,
  resolution_note   text,
  auto              boolean not null default true
);
create unique index issues_open_ref_key on public.issues (ref_key) where status in ('open', 'in_progress');
create index issues_status_opened_idx on public.issues (status, opened_at desc);
create index issues_task_idx on public.issues (task_id) where task_id is not null;
create index issues_vehicle_idx on public.issues (vehicle_id) where vehicle_id is not null;

create table public.issue_events (
  id                bigint generated always as identity primary key,
  issue_id          uuid not null references public.issues (id),
  at                timestamptz not null default now(),
  actor             text,
  actor_employee_id uuid references public.employees (id),
  action            text not null check (action in ('opened', 'assigned', 'note', 'status', 'auto_resolved')),
  note              text,
  from_status       text,
  to_status         text
);
create index issue_events_issue_idx on public.issue_events (issue_id, at);

-- 2. Who reads them ---------------------------------------------------------------
alter table public.issues enable row level security;
alter table public.issue_events enable row level security;
grant select on public.issues, public.issue_events to authenticated;
create policy issues_select_office on public.issues
  for select to authenticated
  using (public.office_can('view'));
create policy issue_events_select_office on public.issue_events
  for select to authenticated
  using (public.office_can('view'));

alter publication supabase_realtime add table public.issues;

-- 3. The one pg_net caller ---------------------------------------------------------
create function public.call_edge_function(p_name text, p_body jsonb)
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
    raise notice 'call_edge_function: Vault secrets functions_url / server_key are not set; % not called', p_name;
    return;
  end if;
  perform net.http_post(
    url := rtrim(v_url, '/') || '/' || p_name,
    body := p_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-server-key', v_key),
    timeout_milliseconds := 10000
  );
end;
$$;
revoke all on function public.call_edge_function(text, jsonb) from public, anon, authenticated;

-- Asks fleet-jobs to recompute the issues (and the ETAs of running tasks). A scope
-- ({"task_id": ...}, {"report_id": ...}, {"request_id": ...}, {"vehicle_id": ...}) limits the work.
create function public.fleet_sync(p_scope jsonb default '{}'::jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.call_edge_function('fleet-jobs', jsonb_build_object('job', 'sync') || coalesce(p_scope, '{}'::jsonb));
$$;
revoke all on function public.fleet_sync(jsonb) from public, anon, authenticated;

select cron.schedule('fleet-sync', '*/5 * * * *', $$select public.fleet_sync()$$);

-- 4. The events that must not wait five minutes ---------------------------------------
create function public.vehicle_reports_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform public.fleet_sync(jsonb_build_object('report_id', new.id));
  end if;
  return null;
end;
$$;
revoke all on function public.vehicle_reports_sync() from public, anon, authenticated;
create trigger vehicle_reports_sync
  after insert or update of status on public.vehicle_reports
  for each row execute function public.vehicle_reports_sync();

create function public.tasks_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.status is distinct from old.status and new.status in ('declined', 'in_progress', 'completed', 'cancelled'))
     or (old.accepted_at is null and new.accepted_at is not null)
     or new.employee_id is distinct from old.employee_id then
    perform public.fleet_sync(jsonb_build_object('task_id', new.id));
  end if;
  return null;
end;
$$;
revoke all on function public.tasks_sync() from public, anon, authenticated;
create trigger tasks_sync
  after update of status, accepted_at, employee_id on public.tasks
  for each row execute function public.tasks_sync();

create function public.vehicle_requests_sync()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform public.fleet_sync(jsonb_build_object('request_id', new.id));
  end if;
  return null;
end;
$$;
revoke all on function public.vehicle_requests_sync() from public, anon, authenticated;
create trigger vehicle_requests_sync
  after insert or update of status on public.vehicle_requests
  for each row execute function public.vehicle_requests_sync();
