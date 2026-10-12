-- Office read access, phase 3 (docs/office-web-plan.md, section 10, item 2).
--
-- Office roles read, through Row Level Security, the tables the web app
-- watches live: driver_latest (the map's markers, over Realtime) and
-- tasks / task_stops (the board, already in the Realtime publication).
-- Everything else still comes through office-api. Staff get nothing here
-- (their own requests come through the tools). No policy checks aal2:
-- 2-step sign-in is optional for every role (decided 12 October 2026).

-- The office role of the signed-in person: admin, fleet_admin, office, staff
-- or viewer. Null for drivers, switched-off people and strangers, which
-- closes every office policy for them at once.
create function public.current_office_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select e.role
  from public.employees e
  where e.auth_user_id = (select auth.uid())
    and e.active
    and e.role in ('admin', 'fleet_admin', 'office', 'staff', 'viewer')
$$;

revoke all on function public.current_office_role() from public, anon, authenticated;
grant execute on function public.current_office_role() to authenticated, service_role;

-- driver_latest: until now only triggers wrote it and nobody read it through
-- RLS. Drivers still see nothing (no policy for them).
alter table public.driver_latest enable row level security;
grant select on public.driver_latest to authenticated;

create policy driver_latest_select_office on public.driver_latest
  for select to authenticated
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'viewer'));

-- tasks and task_stops: the office sees every task (drivers keep their own
-- policies: their tasks only).
create policy tasks_select_office on public.tasks
  for select to authenticated
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'viewer'));

create policy task_stops_select_office on public.task_stops
  for select to authenticated
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'viewer'));

-- Realtime: the map subscribes to driver_latest; the policies above decide
-- who receives a row.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.driver_latest;
  end if;
end;
$$;
