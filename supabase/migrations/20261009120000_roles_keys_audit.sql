-- =============================================================================
-- Office roles, personal connector keys, and an audit log with names.
--
-- Roles (employees.role): driver (the app), staff (vehicle requests only),
-- viewer (read only), office (sees everything, assigns tasks and requests),
-- fleet_admin (runs the fleet), admin (everything plus accounts). Which
-- tool each role may call is decided in the functions
-- (supabase/functions/_shared/fleet/roles.ts); the policies for what a
-- browser may read directly come with the web app.
--
-- office_keys: one row per personal connector key for Claude (the key is
-- stored as a SHA-256 hash). office_audit gains who did it and through what
-- (claude, web, driver); the driver app's task changes and problem reports
-- are added to it by triggers, so one query shows a task's whole timeline.
-- =============================================================================

alter table public.employees drop constraint employees_role_check;
alter table public.employees
  add constraint employees_role_check
  check (role in ('driver', 'staff', 'viewer', 'office', 'fleet_admin', 'admin'));

-- Office people sign in with an e-mail (drivers keep their username).
alter table public.employees add column email text;
create unique index employees_email_key on public.employees (lower(email)) where email is not null;

create table public.office_keys (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (id),
  key_hash     text not null,
  label        text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz,
  constraint office_keys_key_hash_key unique (key_hash)
);

create index office_keys_employee_idx on public.office_keys (employee_id);

alter table public.office_keys enable row level security;
revoke all on public.office_keys from public, anon, authenticated;

alter table public.office_audit
  add column actor_employee_id uuid references public.employees (id),
  add column actor_name        text,
  add column channel           text not null default 'claude',
  add constraint office_audit_channel_check check (channel in ('claude', 'web', 'driver'));

create index office_audit_actor_idx on public.office_audit (actor_employee_id, at desc);

-- The driver app's own changes, in the same log: a task started or
-- completed, a problem reported. Only changes made as a driver (role
-- authenticated) are written here; the office's changes are logged by the
-- functions themselves.
create function public.audit_driver_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'authenticated' then
    return null;
  end if;
  if new.status is distinct from old.status then
    insert into public.office_audit (tool, args_summary, result_summary, actor_employee_id, actor_name, channel)
    select 'driver_task_' || new.status,
           jsonb_build_object('task_id', new.id, 'title', new.title)::text,
           'by the driver app',
           new.employee_id, e.name, 'driver'
    from public.employees e
    where e.id = new.employee_id;
  end if;
  return null;
end;
$$;

create trigger tasks_audit_driver after update on public.tasks
  for each row execute function public.audit_driver_task();

create function public.audit_driver_report()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'authenticated' then
    return null;
  end if;
  insert into public.office_audit (tool, args_summary, result_summary, actor_employee_id, actor_name, channel)
  select 'driver_report',
         jsonb_build_object('report_id', new.id, 'category', new.category, 'vehicle_id', new.vehicle_id)::text,
         'by the driver app',
         new.employee_id, e.name, 'driver'
  from public.employees e
  where e.id = new.employee_id;
  return null;
end;
$$;

create trigger vehicle_reports_audit_driver after insert on public.vehicle_reports
  for each row execute function public.audit_driver_report();

revoke all on function public.audit_driver_task()   from public, anon, authenticated;
revoke all on function public.audit_driver_report() from public, anon, authenticated;
