-- Round 2b (21 October 2026, Sahan's decision): one new office role for the interns who keep the site running, the
-- Coordinator: view + request + assign_tasks + vehicles + issues + office_users (never approve, never users).
--
-- 1. The new permission office_users: manage office accounts that are not admins, granting only what the granter
--    holds (the guards are in the shared tools, _shared/fleet/accountGuards.ts, for office-api and office-mcp alike).
-- 2. The role label coordinator: allowed by the role check, an office role for current_office_role() (so Realtime and
--    the live data work for them through RLS), and in every SQL list of office roles (the notification recipients, the
--    skipped-stop notice, office_can, the policies on location_points and driver_heartbeats). Each function below is
--    its latest definition, unchanged but for the one word added.
-- Nobody's account changes: no row is updated here.

alter table public.employees drop constraint employees_permissions_check;
alter table public.employees add constraint employees_permissions_check
  check (permissions <@ array['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users', 'office_users']::text[]);
comment on column public.employees.permissions is
  'Office permissions: view, request, approve, assign_tasks, vehicles, issues, users, office_users. Drivers have none. The role is a label.';

alter table public.employees drop constraint employees_role_check;
alter table public.employees add constraint employees_role_check
  check (role in ('driver', 'staff', 'viewer', 'office', 'coordinator', 'fleet_admin', 'admin'));

-- current_office_role (as in 20261012110000_office_read_access.sql; only coordinator added to its 1 role list)
create or replace function public.current_office_role()
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
    and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
$$;

-- office_can (as in 20261014100000_permissions.sql; only coordinator added to its 1 role list)
create or replace function public.office_can(p_permission text)
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
      and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
      and p_permission = any (e.permissions)
  )
$$;

-- dispatch_recipients (as in 20261014150000_notifications.sql; only coordinator added to its 1 role list)
create or replace function public.dispatch_recipients()
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.employees
  where active
    and role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
    and permissions && array['approve', 'assign_tasks']::text[]
$$;

-- task_stops_skipped (as in 20261015190000_phase7_duty.sql; only coordinator added to its 1 role list)
create or replace function public.task_stops_skipped()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task   record;
  v_n      integer;
  v_reason text := case new.skip_reason when 'closed' then 'Closed' when 'nobody_there' then 'Nobody there'
                                        when 'not_needed' then 'Not needed' else 'Other' end;
  v_line   text;
begin
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'authenticated'
     or new.status <> 'skipped' or old.status = 'skipped' or coalesce(new.skip_reason, '') = 'not_visited' then
    return null;
  end if;
  select t.id, t.title, t.employee_id, t.vehicle_id into v_task from public.tasks t where t.id = new.task_id;
  select count(*) into v_n from public.task_stops s where s.task_id = new.task_id and s.status <> 'removed' and s.seq <= new.seq;
  v_line := 'Stop ' || v_n || ' · ' || new.place_name || ': ' || v_reason || coalesce(' · ' || nullif(new.skip_note, ''), '');
  insert into public.task_assignment_events (task_id, action, employee_id, vehicle_id, actor, note)
  values (v_task.id, 'stop_skipped', v_task.employee_id, v_task.vehicle_id,
          (select e.name from public.employees e where e.id = v_task.employee_id), v_line);
  perform public.queue_notification(
    'task.stop_skipped',
    jsonb_build_object(
      'title', 'Stop skipped · ' || v_task.title,
      'body', coalesce((select e.name from public.employees e where e.id = v_task.employee_id), 'The driver') || ' · ' || v_line,
      'url', '/tasks?task=' || v_task.id::text,
      'tag', 'task:' || v_task.id::text || ':skip:' || new.id::text,
      'task_id', v_task.id),
    (select coalesce(array_agg(e.id), '{}'::uuid[]) from public.employees e
     where e.active and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
       and 'assign_tasks' = any(e.permissions)));
  return null;
end;
$$;

-- approve_recipients (as in 20261017140000_phase7_approval.sql; only coordinator added to its 1 role list)
create or replace function public.approve_recipients()
returns uuid[]
language sql
stable
set search_path = ''
as $$
  select coalesce(array_agg(id), '{}'::uuid[])
  from public.employees
  where active
    and role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
    and 'approve' = any(permissions)
$$;

-- queue_notification (as in 20261020010000_phase8_office_push.sql; only coordinator added to its 3 role lists)
create or replace function public.queue_notification(p_event text, p_payload jsonb, p_recipients uuid[])
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer := 0;
  v_phones integer := 0;
begin
  if p_event is null or p_payload is null or coalesce(array_length(p_recipients, 1), 0) = 0 then
    return 0;
  end if;
  -- Part 6: the reviewers' demo stays out of the office's notifications.
  if (p_payload ->> 'task_id') ~ '^[0-9a-f-]{36}$'
     and exists (select 1 from public.tasks t where t.id = (p_payload ->> 'task_id')::uuid and t.demo) then
    return 0;
  end if;
  if (p_payload ->> 'tag') ~ '^vehicle-needed:[0-9a-f-]{36}$'
     and exists (select 1 from public.vehicle_reports r
                 where r.id = split_part(p_payload ->> 'tag', ':', 2)::uuid and r.demo) then
    return 0;
  end if;
  -- Hotfix 2 (A): everyone told has it in their notification centre, with or without a browser for Web Push.
  insert into public.office_inbox (employee_id, event, title, body, url, who)
  select r.id, p_event, coalesce(nullif(p_payload ->> 'title', ''), p_event), p_payload ->> 'body', p_payload ->> 'url',
         p_payload ->> 'who'
  from (select distinct unnest(p_recipients) as id) r
  join public.employees e on e.id = r.id
  where e.active
    and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
    and not exists (select 1 from public.notification_settings s
                    where s.employee_id = r.id and s.event = p_event and not s.enabled);
  -- The Web Push outbox, as before: only for a browser that has it on.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id)
    select p_event, p_payload, r.id
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.web_push_subscriptions w
                  where w.employee_id = r.id and w.removed_at is null)
    returning 1
  )
  select count(*) into v_count from ins;
  -- Phase 8 (O1 item 9): the phone, for an office person whose app registered a token.
  with ins as (
    insert into public.notifications (event, payload, recipient_employee_id, channel)
    select p_event, p_payload, r.id, 'expo_push'
    from (select distinct unnest(p_recipients) as id) r
    join public.employees e on e.id = r.id
    where e.active
      and e.role in ('admin', 'fleet_admin', 'office', 'coordinator', 'staff', 'viewer')
      and not exists (select 1 from public.notification_settings s
                      where s.employee_id = r.id and s.event = p_event and not s.enabled)
      and exists (select 1 from public.device_tokens d where d.employee_id = r.id)
    returning 1
  )
  select count(*) into v_phones from ins;
  return v_count + v_phones;
end;
$$;

-- The live data's policies (route_quality): the office roles that read positions and heartbeats, now with coordinator.
alter policy driver_heartbeats_select_office on public.driver_heartbeats
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'coordinator', 'viewer'));
alter policy location_points_select_office on public.location_points
  using ((select public.current_office_role()) in ('admin', 'fleet_admin', 'office', 'coordinator', 'viewer'));
