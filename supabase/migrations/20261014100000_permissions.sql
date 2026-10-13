-- =============================================================================
-- Permissions per person (Phase 5, part 2; docs/dispatch-plan.md, section 3.1).
--
-- An office account carries a list of permissions instead of a fixed role:
--   view          see the fleet: overview, live locations, tasks, vehicles,
--                 drivers, mileage, problem reports, issues
--   request       ask for a vehicle and follow one's own requests
--   approve       decide requests, book a vehicle in one step
--   assign_tasks  create, change and cancel tasks and their stops
--   vehicles      vehicles, rental companies, places, drivers, projects
--   issues        update issues and vehicle problem reports
--   users         office users, connector keys and settings
-- The role column stays as a label. Which tool needs which permission is one
-- table, supabase/functions/_shared/fleet/permissions.ts, applied by
-- office-mcp and office-api before a tool runs; the web app's menu mirrors it.
-- The three office read policies (driver_latest, tasks, task_stops) now check
-- the view permission through office_can() instead of the role.
-- =============================================================================

alter table public.employees
  add column permissions text[] not null default '{view}',
  add constraint employees_permissions_check
    check (permissions <@ array['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']::text[]);

comment on column public.employees.permissions is
  'Office permissions: view, request, approve, assign_tasks, vehicles, issues, users. Drivers have none. The role is a label.';

-- Backfill from the roles. Every office user sees the fleet, staff included
-- (the boss's instruction, 13 October 2026); an admin can untick view per person.
update public.employees set permissions = case role
  when 'admin'       then array['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users']
  when 'fleet_admin' then array['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues']
  when 'office'      then array['view', 'request', 'assign_tasks']
  when 'staff'       then array['view', 'request']
  when 'viewer'      then array['view']
  else '{}'::text[]
end;

-- True when the signed-in person is an active office account holding the
-- permission. Drivers, switched-off people and strangers get false, which
-- closes every office policy for them at once.
create function public.office_can(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.employees e
    where e.auth_user_id = (select auth.uid())
      and e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
      and p_permission = any (e.permissions)
  )
$$;

revoke all on function public.office_can(text) from public, anon, authenticated;
grant execute on function public.office_can(text) to authenticated, service_role;

-- The office read policies follow the view permission now.
drop policy driver_latest_select_office on public.driver_latest;
create policy driver_latest_select_office on public.driver_latest
  for select to authenticated
  using ((select public.office_can('view')));

drop policy tasks_select_office on public.tasks;
create policy tasks_select_office on public.tasks
  for select to authenticated
  using ((select public.office_can('view')));

drop policy task_stops_select_office on public.task_stops;
create policy task_stops_select_office on public.task_stops
  for select to authenticated
  using ((select public.office_can('view')));
