-- Round 52 (docs/phase8-plan.md §40): archive, delete and restore everywhere.
--
--   projects / rental_companies   archived_at, archived_by: archive (switch off) for the two records that had none.
--   bin_items                      "Recently deleted": a deleted record or wrong entry moved here as a snapshot (the rows
--                                  and what hangs off them, the links it cleared, its storage files), so nothing else ever
--                                  sees it; Restore puts it back as it was; after 30 days the retention job removes it and
--                                  its files for good (bin_forget, after the job has removed the files and a person's
--                                  sign-in). Service role reads it; every write goes through the functions below.
--   record_history(kind, id)       what a record has that makes it history (tasks, fuel, readings, …): a record with any
--                                  is archived, never deleted.
--   bin_take(kind, id, …)          moves a record or a wrong entry into the bin (refused: history, a running task, the base
--                                  place); recalculates the vehicle's current reading after a deleted odometer reading (a
--                                  task keeps the km it recorded).
--   bin_restore(id)                puts it back (refused: a name, plate or username taken meanwhile; something it points to
--                                  gone), with the triggers paused for the re-insert (no "new task" push for a task coming
--                                  back) and every link it points to checked first.
--   bin_forget(ids)                the purge's last step.
--
-- service_role still deletes nothing itself (the first migration): these run as their owner. Nothing here is on the
-- connector: the tools that call them are web only (office-mcp WEB_ONLY_TOOLS).

-- 1. Archive for projects and rental companies ------------------------------------------------------------------------------
alter table public.projects
  add column archived_at timestamptz,
  add column archived_by text;
alter table public.rental_companies
  add column archived_at timestamptz,
  add column archived_by text;
comment on column public.projects.archived_at is 'Round 52: archived (switched off): left out of find_project and the pickers, kept on old trips and in reports; Restore clears it';
comment on column public.rental_companies.archived_at is 'Round 52: archived: left out of the rental company picker, kept on its vehicles; Restore clears it';

-- 2. The bin -------------------------------------------------------------------------------------------------------------------
create table public.bin_items (
  id                    uuid primary key default gen_random_uuid(),
  kind                  text not null check (kind in ('vehicle', 'driver', 'office_person', 'place', 'project', 'rental_company',
                                                     'fuel', 'odometer', 'check', 'issue', 'request', 'task')),
  record_id             uuid not null,
  label                 text not null,
  detail                text,
  reason                text,
  deleted_at            timestamptz not null default now(),
  deleted_by            text not null,
  -- No foreign key: the person who deleted may be deleted later.
  deleted_by_employee_id uuid,
  purge_after           timestamptz not null default now() + interval '30 days',
  -- A person's sign-in account: banned at the delete, removed at the purge (by the job, through Auth).
  auth_user_id          uuid,
  -- { rows: [{ t: table, r: row }], nulls: [{ t, c, ids, v }] }: what was removed, and the links that were cleared.
  snapshot              jsonb not null,
  -- [{ bucket, path }]: the storage files that go at the purge (kept until then, so Restore brings them back).
  files                 jsonb not null default '[]'::jsonb
);
create index bin_items_deleted_at_idx on public.bin_items (deleted_at desc);
create index bin_items_purge_after_idx on public.bin_items (purge_after);
alter table public.bin_items enable row level security;
revoke all on public.bin_items from anon, authenticated, service_role;
grant select on public.bin_items to service_role;

-- 3. Helpers (no grants: only the functions below call them, as their owner) ---------------------------------------------------

/** The rows of a table that match, appended to the snapshot. */
create function public.bin_snap(p_snap jsonb, p_table regclass, p_where text)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v jsonb;
begin
  execute format('select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from %s x where %s', p_table, p_where) into v;
  return jsonb_set(p_snap, '{rows}', (p_snap -> 'rows')
    || (select coalesce(jsonb_agg(jsonb_build_object('t', p_table::text, 'r', e)), '[]'::jsonb) from jsonb_array_elements(v) e));
end;
$$;

/** A link to the record cleared (set null) in another table, the rows it touched recorded, so Restore sets it back. */
create function public.bin_null(p_snap jsonb, p_table regclass, p_col text, p_value uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  ids jsonb;
begin
  execute format('with u as (update %s set %I = null where %I = $1 returning id) select coalesce(jsonb_agg(id), ''[]''::jsonb) from u',
    p_table, p_col, p_col) using p_value into ids;
  if jsonb_array_length(ids) > 0 then
    p_snap := jsonb_set(p_snap, '{nulls}', (p_snap -> 'nulls')
      || jsonb_build_array(jsonb_build_object('t', p_table::text, 'c', p_col, 'ids', ids, 'v', to_jsonb(p_value))));
  end if;
  return p_snap;
end;
$$;

/** A storage file to remove at the purge. */
create function public.bin_file(p_files jsonb, p_bucket text, p_path text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p_path is null or btrim(p_path) = '' then p_files
              else p_files || jsonb_build_array(jsonb_build_object('bucket', p_bucket, 'path', p_path)) end;
$$;

/** Puts one snapshot row back (generated columns left out, identity ids kept). Called with the triggers paused. */
create function public.bin_insert(p_table regclass, p_row jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  cols text;
  ident boolean;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum), coalesce(bool_or(attidentity = 'a'), false)
    into cols, ident
  from pg_attribute
  where attrelid = p_table and attnum > 0 and not attisdropped and attgenerated = '';
  execute format('insert into %s (%s) %s select %s from jsonb_populate_record(null::%s, $1)',
    p_table, cols, case when ident then 'overriding system value' else '' end, cols, p_table) using p_row;
end;
$$;

/** Every single-column link of a restored row points at a row that exists (the foreign keys, checked by hand: the triggers,
 *  which hold them, are paused for the re-insert). Raises 'gone: <table>' when one does not. */
create function public.bin_check_links(p_table regclass, p_row jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  fk record;
  ok boolean;
begin
  for fk in
    select a.attname as col, c.confrelid::regclass as ref, ra.attname as refcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute ra on ra.attrelid = c.confrelid and ra.attnum = c.confkey[1]
    where c.conrelid = p_table and c.contype = 'f' and array_length(c.conkey, 1) = 1
  loop
    if p_row ->> fk.col is null then continue; end if;
    execute format('select exists (select 1 from %s where %I::text = $1)', fk.ref, fk.refcol) using p_row ->> fk.col into ok;
    if not ok then
      raise exception 'gone: %', fk.ref::text using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

/**
 * After a deleted reading: only when the vehicle's current reading came from it (the same km), it becomes the newest
 * reading left that is not in the future (the insert trigger's rule); none left: empty. A reading typed on the vehicle by
 * the office (update_vehicle) after it is kept.
 */
create function public.bin_vehicle_reading(p_vehicle uuid, p_deleted_km numeric)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.vehicles v
  set current_odometer_km = (select o.reading_km from public.odometer_logs o where o.vehicle_id = p_vehicle and o.logged_at <= now()
                             order by o.logged_at desc, o.id desc limit 1)
  where v.id = p_vehicle and v.current_odometer_km is not distinct from p_deleted_km;
end;
$$;

/** After a reading comes back: it is the vehicle's current reading again if it is the newest one not in the future. */
create function public.bin_vehicle_reading_back(p_log uuid)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.vehicles v set current_odometer_km = o.reading_km
  from public.odometer_logs o
  where o.id = p_log and v.id = o.vehicle_id and o.logged_at <= now()
    and not exists (select 1 from public.odometer_logs n where n.vehicle_id = o.vehicle_id and n.logged_at <= now()
                    and (n.logged_at, n.id) > (o.logged_at, o.id));
end;
$$;

-- 4. What makes a record history ------------------------------------------------------------------------------------------------

create function public.record_history(p_kind text, p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  h jsonb := '{}'::jsonb;
  n bigint;
  q record;
begin
  for q in
    select * from (values
      -- a vehicle
      ('vehicle', 'tasks', 'select count(*) from public.tasks where vehicle_id = $1'),
      ('vehicle', 'fuel', 'select count(*) from public.fuel_logs where vehicle_id = $1'),
      ('vehicle', 'odometer', 'select count(*) from public.odometer_logs where vehicle_id = $1'),
      ('vehicle', 'odometer_photos', 'select count(*) from public.odometer_reads where vehicle_id = $1'),
      ('vehicle', 'checks', 'select count(*) from public.vehicle_checks where vehicle_id = $1'),
      ('vehicle', 'reports', 'select count(*) from public.vehicle_reports where vehicle_id = $1'),
      ('vehicle', 'documents', 'select count(*) from public.vehicle_documents where vehicle_id = $1'),
      ('vehicle', 'duty', 'select count(*) from public.duty_sessions where vehicle_id = $1'),
      ('vehicle', 'held', 'select count(*) from public.vehicle_assignments where vehicle_id = $1'),
      ('vehicle', 'requests', 'select count(*) from public.vehicle_requests where proposed_vehicle_id = $1 and status <> ''cancelled'''),
      ('vehicle', 'assignments', 'select (select count(*) from public.task_assignment_events where vehicle_id = $1) + (select count(*) from public.task_vehicle_segments where vehicle_id = $1)'),
      ('vehicle', 'held_now', 'select count(*) from public.employees where current_vehicle_id = $1'),
      -- a driver or an office person (the same table)
      ('person', 'tasks', 'select count(*) from public.tasks where $1 in (employee_id, assigned_by_employee_id, approved_by_employee_id, declined_by)'),
      ('person', 'requests', 'select count(*) from public.vehicle_requests where $1 in (requested_by_employee_id, decided_by_employee_id, proposed_employee_id)'),
      ('person', 'fuel', 'select count(*) from public.fuel_logs where employee_id = $1'),
      ('person', 'odometer', 'select count(*) from public.odometer_logs where employee_id = $1'),
      ('person', 'odometer_photos', 'select count(*) from public.odometer_reads where employee_id = $1'),
      ('person', 'duty', 'select count(*) from public.duty_sessions where employee_id = $1'),
      ('person', 'locations', 'select count(*) from public.location_points where employee_id = $1'),
      ('person', 'days', 'select count(*) from public.driver_day_summaries where employee_id = $1'),
      ('person', 'heartbeats', 'select count(*) from public.driver_heartbeats where employee_id = $1'),
      ('person', 'held', 'select count(*) from public.vehicle_assignments where employee_id = $1'),
      ('person', 'checks', 'select count(*) from public.vehicle_checks where employee_id = $1'),
      ('person', 'reports', 'select count(*) from public.vehicle_reports where employee_id = $1'),
      ('person', 'asks', 'select (select count(*) from public.driver_ask_answers where employee_id = $1) + (select count(*) from public.driver_asks where asked_by_employee_id = $1) + (select count(*) from public.holder_asks where $1 in (asked_by, holder_id, answered_by))'),
      ('person', 'passenger', 'select (select count(*) from public.request_passengers where employee_id = $1) + (select count(*) from public.task_passengers where employee_id = $1)'),
      ('person', 'assignments', 'select count(*) from public.task_assignment_events where employee_id = $1'),
      ('person', 'issue_work', 'select count(*) from public.issue_events where actor_employee_id = $1'),
      ('person', 'claims', 'select count(*) from public.claims where employee_id = $1'),
      ('person', 'trips_web', 'select (select count(*) from public.web_trip_actions where employee_id = $1) + (select count(*) from public.route_matched where employee_id = $1)'),
      -- a place
      ('place', 'stops', 'select count(*) from public.task_stops where $1 in (place_id, saved_place_id)'),
      ('place', 'request_stops', 'select count(*) from public.request_stops where place_id = $1'),
      ('place', 'starts', 'select (select count(*) from public.tasks where start_place_id = $1) + (select count(*) from public.vehicle_requests where start_place_id = $1)'),
      -- a project
      ('project', 'tasks', 'select count(*) from public.task_projects where project_id = $1'),
      ('project', 'requests', 'select count(*) from public.vehicle_requests where project_id = $1'),
      ('project', 'claims', 'select count(*) from public.claim_sites where project_id = $1'),
      -- a rental company
      ('rental_company', 'vehicles', 'select count(*) from public.vehicles where rental_company_id = $1')
    ) as t(kind, what, sql)
    where t.kind = case when p_kind in ('driver', 'office_person') then 'person' else p_kind end
  loop
    execute q.sql using p_id into n;
    if n > 0 then h := h || jsonb_build_object(q.what, n); end if;
  end loop;
  return h;
end;
$$;
revoke all on function public.record_history(text, uuid) from public, anon, authenticated;
grant execute on function public.record_history(text, uuid) to service_role;

-- 5. Into the bin -----------------------------------------------------------------------------------------------------------------

create function public.bin_take(p_kind text, p_id uuid, p_reason text, p_actor text, p_actor_employee uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  snap jsonb := '{"rows": [], "nulls": []}'::jsonb;
  files jsonb := '[]'::jsonb;
  label text;
  detail text;
  auth_id uuid;
  bin_id uuid;
  w text := format('id = %L', p_id);
  r record;
  x record;
  history jsonb;
  sub jsonb;
begin
  if p_kind in ('vehicle', 'driver', 'office_person', 'place', 'project', 'rental_company') then
    history := public.record_history(p_kind, p_id);
    if history <> '{}'::jsonb then
      raise exception 'has_history: %', history using errcode = 'P0001';
    end if;
  end if;

  case p_kind
  when 'fuel' then
    select f.*, v.reg_no into r from public.fuel_logs f left join public.vehicles v on v.id = f.vehicle_id where f.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Fuel', r.reg_no, case when r.litres is not null then trim(to_char(r.litres, 'FM9990.0')) || ' L' end);
    detail := to_char(r.logged_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
    snap := public.bin_snap(snap, 'public.fuel_logs', w);
    snap := public.bin_snap(snap, 'public.photos', format('fuel_log_id = %L or id = %L', p_id, r.receipt_photo_id));
    for x in select storage_path from public.photos where fuel_log_id = p_id or id = r.receipt_photo_id loop
      files := public.bin_file(files, 'driver-photos', x.storage_path);
    end loop;
    files := public.bin_file(files, 'fuel-videos', r.video_path);
    for x in select e ->> 'path' as path from jsonb_array_elements(coalesce(r.video_segments, '[]'::jsonb)) e loop
      if x.path is distinct from r.video_path then files := public.bin_file(files, 'fuel-videos', x.path); end if;
    end loop;
    update public.fuel_logs set receipt_photo_id = null where id = p_id;
    delete from public.photos where fuel_log_id = p_id or id = r.receipt_photo_id;
    delete from public.fuel_logs where id = p_id;

  when 'odometer' then
    select o.*, v.reg_no into r from public.odometer_logs o left join public.vehicles v on v.id = o.vehicle_id where o.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Odometer', r.reg_no, r.reading_km::text || ' km');
    detail := to_char(r.logged_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
    snap := public.bin_snap(snap, 'public.odometer_logs', w);
    snap := public.bin_snap(snap, 'public.photos', format('odometer_log_id = %L or id = %L', p_id, r.photo_id));
    for x in select storage_path from public.photos where odometer_log_id = p_id or id = r.photo_id loop
      files := public.bin_file(files, 'driver-photos', x.storage_path);
    end loop;
    snap := public.bin_null(snap, 'public.odometer_reads', 'log_id', p_id);
    -- A task's start or end reading: the task keeps the km it recorded (a completed task keeps both readings, the
    -- constraint tasks_completed_fields); the vehicle's current reading and the mileage, derived from the readings, change.
    update public.odometer_logs set photo_id = null where id = p_id;
    delete from public.photos where odometer_log_id = p_id or id = r.photo_id;
    delete from public.odometer_logs where id = p_id;
    perform public.bin_vehicle_reading(r.vehicle_id, r.reading_km);

  when 'check' then
    select c.*, v.reg_no into r from public.vehicle_checks c left join public.vehicles v on v.id = c.vehicle_id where c.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Vehicle check', r.reg_no);
    detail := to_char(r.created_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
    snap := public.bin_snap(snap, 'public.vehicle_checks', w);
    snap := public.bin_snap(snap, 'public.photos', format('vehicle_check_id = %L', p_id));
    for x in select storage_path from public.photos where vehicle_check_id = p_id loop
      files := public.bin_file(files, 'driver-photos', x.storage_path);
    end loop;
    snap := public.bin_null(snap, 'public.vehicle_reports', 'check_id', p_id);
    delete from public.photos where vehicle_check_id = p_id;
    delete from public.vehicle_checks where id = p_id;

  when 'issue' then
    select i.* into r from public.issues i where i.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Issue', r.title);
    detail := to_char(r.opened_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
    snap := public.bin_snap(snap, 'public.issues', w);
    snap := public.bin_snap(snap, 'public.issue_events', format('issue_id = %L', p_id));
    delete from public.issue_events where issue_id = p_id;
    delete from public.issues where id = p_id;

  when 'task' then
    select t.* into r from public.tasks t where t.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    if r.status = 'in_progress' then raise exception 'task_running' using errcode = 'P0001'; end if;
    -- A task its driver still has (not started): cancel it first, so the driver is told; then delete it.
    if r.status = 'assigned' then raise exception 'task_assigned' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Task', r.title);
    detail := to_char(r.start_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
    sub := public.bin_take_task(p_id);
    snap := sub -> 'snap';

  when 'request' then
    select q.* into r from public.vehicle_requests q where q.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Request', coalesce(r.title, r.requested_by_name));
    detail := to_char(r.needed_at at time zone 'Asia/Colombo', 'YYYY-MM-DD HH24:MI');
    snap := public.bin_snap(snap, 'public.vehicle_requests', w);
    -- Its task goes with it (the confirm says so), unless it is under way.
    if r.task_id is not null then
      if exists (select 1 from public.tasks where id = r.task_id and status = 'in_progress') then
        raise exception 'task_running' using errcode = 'P0001';
      end if;
      if exists (select 1 from public.tasks where id = r.task_id and status = 'assigned') then
        raise exception 'task_assigned' using errcode = 'P0001';
      end if;
      sub := public.bin_take_task(r.task_id);
      snap := jsonb_set(snap, '{rows}', (snap -> 'rows') || (sub -> 'snap' -> 'rows'));
      snap := jsonb_set(snap, '{nulls}', (snap -> 'nulls') || (sub -> 'snap' -> 'nulls'));
    end if;
    snap := public.bin_snap(snap, 'public.request_events', format('request_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.request_passengers', format('request_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.request_viewers', format('request_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.request_stops', format('request_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.issues', format('request_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.issue_events', format('issue_id in (select id from public.issues where request_id = %L)', p_id));
    snap := public.bin_null(snap, 'public.driver_asks', 'request_id', p_id);
    snap := public.bin_null(snap, 'public.holder_asks', 'for_request_id', p_id);
    snap := public.bin_null(snap, 'public.tasks', 'request_id', p_id);
    delete from public.issue_events where issue_id in (select id from public.issues where request_id = p_id);
    delete from public.issues where request_id = p_id;
    delete from public.request_events where request_id = p_id;
    delete from public.request_passengers where request_id = p_id;
    delete from public.request_viewers where request_id = p_id;
    delete from public.vehicle_requests where id = p_id;  -- request_stops go with it

  when 'vehicle' then
    select v.* into r from public.vehicles v where v.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Vehicle', r.reg_no);
    detail := r.make_model;
    snap := public.bin_snap(snap, 'public.vehicles', w);
    snap := public.bin_snap(snap, 'public.issues', format('vehicle_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.issue_events', format('issue_id in (select id from public.issues where vehicle_id = %L)', p_id));
    files := public.bin_file(files, 'vehicle-photos', r.photo_path);
    files := public.bin_file(files, 'vehicle-photos', r.photo_thumb_path);
    snap := public.bin_null(snap, 'public.vehicle_requests', 'proposed_vehicle_id', p_id);
    delete from public.issue_events where issue_id in (select id from public.issues where vehicle_id = p_id);
    delete from public.issues where vehicle_id = p_id;
    delete from public.vehicles where id = p_id;

  when 'driver', 'office_person' then
    select e.* into r from public.employees e where e.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    if p_kind = 'driver' and r.role <> 'driver' or p_kind = 'office_person' and r.role = 'driver' then
      raise exception 'not_found' using errcode = 'P0001';
    end if;
    label := concat_ws(' · ', case when p_kind = 'driver' then 'Driver' else 'Office person' end, r.name);
    detail := concat_ws(' · ', r.code, r.username, r.email);
    auth_id := r.auth_user_id;
    snap := public.bin_snap(snap, 'public.employees', w);
    for x in select t.tbl from (values ('public.device_tokens'), ('public.driver_latest'), ('public.driver_map_state'), ('public.office_prefs'),
        ('public.notification_settings'), ('public.notification_prefs'), ('public.password_links'), ('public.web_push_subscriptions'),
        ('public.office_keys'), ('public.office_inbox'), ('public.roads_day_calls'), ('public.push_log')) as t(tbl) loop
      snap := public.bin_snap(snap, x.tbl::regclass, format('employee_id = %L', p_id));
    end loop;
    snap := public.bin_snap(snap, 'public.notifications', format('recipient_employee_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.employee_changes', format('employee_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.driver_unavailability', format('employee_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.request_viewers', format('employee_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.photos', format('employee_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.issues', format('employee_id = %L', p_id));
    snap := public.bin_snap(snap, 'public.issue_events', format('issue_id in (select id from public.issues where employee_id = %L)', p_id));
    for x in select storage_path from public.photos where employee_id = p_id loop
      files := public.bin_file(files, 'driver-photos', x.storage_path);
    end loop;
    snap := public.bin_null(snap, 'public.vehicles', 'regular_driver_id', p_id);
    snap := public.bin_null(snap, 'public.vehicles', 'custodian_employee_id', p_id);
    snap := public.bin_null(snap, 'public.office_audit', 'actor_employee_id', p_id);
    snap := public.bin_null(snap, 'public.issues', 'assigned_to', p_id);
    snap := public.bin_null(snap, 'public.employee_changes', 'changed_by_employee_id', p_id);
    snap := public.bin_null(snap, 'public.driver_unavailability', 'created_by_employee_id', p_id);
    snap := public.bin_null(snap, 'public.vehicle_documents', 'uploaded_by', p_id);
    snap := public.bin_null(snap, 'public.place_imports', 'by_employee_id', p_id);
    snap := public.bin_null(snap, 'public.app_errors', 'employee_id', p_id);
    update public.employees set photo_id = null, licence_front_photo_id = null, licence_back_photo_id = null where id = p_id;
    delete from public.issue_events where issue_id in (select id from public.issues where employee_id = p_id);
    delete from public.issues where employee_id = p_id;
    for x in select t.tbl from (values ('public.device_tokens'), ('public.driver_latest'), ('public.driver_map_state'), ('public.office_prefs'),
        ('public.notification_settings'), ('public.notification_prefs'), ('public.password_links'), ('public.web_push_subscriptions'),
        ('public.office_keys'), ('public.office_inbox'), ('public.roads_day_calls'), ('public.employee_changes'),
        ('public.driver_unavailability'), ('public.request_viewers'), ('public.photos'), ('public.push_log')) as t(tbl) loop
      execute format('delete from %s where employee_id = %L', x.tbl::regclass, p_id);
    end loop;
    delete from public.notifications where recipient_employee_id = p_id;
    delete from public.employees where id = p_id;

  when 'place' then
    select p.* into r from public.places p where p.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    if exists (select 1 from public.fleet_settings where key = 'base_place_id' and value = to_jsonb(p_id::text)) then
      raise exception 'base_place' using errcode = 'P0001';
    end if;
    label := concat_ws(' · ', 'Place', r.name);
    detail := r.address;
    snap := public.bin_snap(snap, 'public.places', w);
    snap := public.bin_snap(snap, 'public.place_import_changes', format('place_id = %L', p_id));
    delete from public.place_import_changes where place_id = p_id;
    delete from public.places where id = p_id;

  when 'project' then
    select p.* into r from public.projects p where p.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Project', r.job_no, r.name);
    detail := r.customer_name;
    snap := public.bin_snap(snap, 'public.projects', w);
    delete from public.projects where id = p_id;

  when 'rental_company' then
    select c.* into r from public.rental_companies c where c.id = p_id;
    if not found then raise exception 'not_found' using errcode = 'P0001'; end if;
    label := concat_ws(' · ', 'Rental company', r.name);
    detail := r.phone;
    snap := public.bin_snap(snap, 'public.rental_companies', w);
    delete from public.rental_companies where id = p_id;

  else
    raise exception 'bad_kind' using errcode = 'P0001';
  end case;

  insert into public.bin_items (kind, record_id, label, detail, reason, deleted_by, deleted_by_employee_id, auth_user_id, snapshot, files)
  values (p_kind, p_id, coalesce(label, p_kind), detail, nullif(btrim(coalesce(p_reason, '')), ''), p_actor, p_actor_employee, auth_id, snap, files)
  returning id into bin_id;
  return jsonb_build_object('bin_id', bin_id, 'kind', p_kind, 'label', label, 'auth_user_id', auth_id, 'files', jsonb_array_length(files));
end;
$$;

/** A task and what hangs off it, out of the tables (its stops and projects go with it); the snapshot back. */
create function public.bin_take_task(p_id uuid)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  snap jsonb := '{"rows": [], "nulls": []}'::jsonb;
  w text := format('task_id = %L', p_id);
  x record;
begin
  snap := public.bin_snap(snap, 'public.tasks', format('id = %L', p_id));
  for x in select t.tbl from (values ('public.task_stops'), ('public.task_projects'), ('public.task_assignment_events'), ('public.task_eta'),
      ('public.task_passengers'), ('public.task_vehicle_segments'), ('public.push_log'), ('public.web_trip_actions')) as t(tbl) loop
    snap := public.bin_snap(snap, x.tbl::regclass, w);
  end loop;
  -- The task's own issues go with it; a problem report's issue stays (the report is still open), unlinked.
  snap := public.bin_snap(snap, 'public.issues', format('task_id = %L and vehicle_report_id is null', p_id));
  snap := public.bin_snap(snap, 'public.issue_events', format('issue_id in (select id from public.issues where task_id = %L and vehicle_report_id is null)', p_id));
  -- The task's readings stay the vehicle's (the odometer moved): unlinked as "manual" readings (a start or end reading needs
  -- its task, odometer_logs_task_kind_check), each row's kind and task recorded so Restore links it back.
  for x in select o.id, o.kind from public.odometer_logs o where o.task_id = p_id loop
    snap := jsonb_set(snap, '{sets}', coalesce(snap -> 'sets', '[]'::jsonb)
      || jsonb_build_array(jsonb_build_object('t', 'public.odometer_logs', 'id', x.id, 'v', jsonb_build_object('kind', x.kind, 'task_id', p_id))));
  end loop;
  update public.odometer_logs set kind = 'manual', task_id = null where task_id = p_id;
  for x in select t.tbl, t.col from (values ('public.fuel_logs', 'task_id'), ('public.vehicle_assignments', 'task_id'),
      ('public.vehicle_checks', 'task_id'), ('public.vehicle_reports', 'task_id'), ('public.driver_asks', 'task_id'), ('public.holder_asks', 'task_id'),
      ('public.holder_asks', 'for_task_id'), ('public.vehicle_requests', 'task_id'), ('public.vehicle_requests', 'change_task_id')) as t(tbl, col) loop
    snap := public.bin_null(snap, x.tbl::regclass, x.col, p_id);
  end loop;
  delete from public.web_trip_actions where task_id = p_id;
  delete from public.push_log where task_id = p_id;
  delete from public.task_eta where task_id = p_id;
  delete from public.task_passengers where task_id = p_id;
  delete from public.task_vehicle_segments where task_id = p_id;
  delete from public.task_assignment_events where task_id = p_id;
  delete from public.issue_events where issue_id in (select id from public.issues where task_id = p_id and vehicle_report_id is null);
  delete from public.issues where task_id = p_id and vehicle_report_id is null;
  snap := public.bin_null(snap, 'public.issues', 'task_id', p_id);
  -- The projects' 100 % rule is for a task that stays: its rows go with the task (cascade), the rule skips a task that is gone.
  delete from public.tasks where id = p_id;
  return jsonb_build_object('snap', snap);
end;
$$;

revoke all on function public.bin_take(text, uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.bin_take(text, uuid, text, text, uuid) to service_role;
revoke all on function public.bin_take_task(uuid) from public, anon, authenticated, service_role;

-- 6. Out of the bin -------------------------------------------------------------------------------------------------------------

create function public.bin_restore(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  e jsonb;
  n jsonb;
  ids text[];
  reading jsonb;
  veh uuid;
begin
  select * into item from public.bin_items where id = p_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0001'; end if;

  -- Every link a row points at must still be there (not counting the rows coming back together).
  set local session_replication_role = replica;
  begin
    for e in select * from jsonb_array_elements(item.snapshot -> 'rows') loop
      perform public.bin_insert((e ->> 't')::regclass, e -> 'r');
    end loop;
  exception when unique_violation then
    raise exception 'taken: %', sqlerrm using errcode = 'P0001';
  end;
  for e in select * from jsonb_array_elements(item.snapshot -> 'rows') loop
    perform public.bin_check_links((e ->> 't')::regclass, e -> 'r');
  end loop;
  -- The links cleared at the delete, set back on the rows still there.
  for n in select * from jsonb_array_elements(item.snapshot -> 'nulls') loop
    select array_agg(v) into ids from jsonb_array_elements_text(n -> 'ids') v;
    execute format('update %s x set %I = (jsonb_populate_record(null::%s, jsonb_build_object(%L, $1))).%I where x.id::text = any($2)',
      (n ->> 't')::regclass, n ->> 'c', (n ->> 't')::regclass, n ->> 'c', n ->> 'c') using n -> 'v', ids;
  end loop;
  -- Rows changed in place at the delete (a task's readings): their columns as they were, all at once (their checks hold).
  for n in select * from jsonb_array_elements(coalesce(item.snapshot -> 'sets', '[]'::jsonb)) loop
    execute format('update %s x set (%s) = (select %s from jsonb_populate_record(x, $1)) where x.id::text = $2',
      (n ->> 't')::regclass,
      (select string_agg(quote_ident(k), ', ') from jsonb_object_keys(n -> 'v') k),
      (select string_agg(quote_ident(k), ', ') from jsonb_object_keys(n -> 'v') k))
      using n -> 'v', n ->> 'id';
  end loop;
  set local session_replication_role = origin;

  -- An odometer reading back: the vehicle's current reading again if it is the newest.
  if item.kind = 'odometer' then perform public.bin_vehicle_reading_back(item.record_id); end if;

  delete from public.bin_items where id = p_id;
  return jsonb_build_object('kind', item.kind, 'record_id', item.record_id, 'label', item.label, 'auth_user_id', item.auth_user_id);
end;
$$;
revoke all on function public.bin_restore(uuid) from public, anon, authenticated;
grant execute on function public.bin_restore(uuid) to service_role;

/** The purge's last step: the bin rows whose files and sign-ins the job has removed. */
create function public.bin_forget(p_ids uuid[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with d as (delete from public.bin_items where id = any(p_ids) and purge_after <= now() returning 1) select count(*)::integer from d;
$$;
revoke all on function public.bin_forget(uuid[]) from public, anon, authenticated;
grant execute on function public.bin_forget(uuid[]) to service_role;

revoke all on function public.bin_snap(jsonb, regclass, text) from public, anon, authenticated, service_role;
revoke all on function public.bin_file(jsonb, text, text) from public, anon, authenticated, service_role;
revoke all on function public.bin_null(jsonb, regclass, text, uuid) from public, anon, authenticated, service_role;
revoke all on function public.bin_insert(regclass, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.bin_check_links(regclass, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.bin_vehicle_reading(uuid, numeric) from public, anon, authenticated, service_role;
revoke all on function public.bin_vehicle_reading_back(uuid) from public, anon, authenticated, service_role;
