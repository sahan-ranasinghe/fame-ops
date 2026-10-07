-- =============================================================================
-- office_create_task: one all-or-nothing write for the office connector
--
-- Creating a task writes three tables (tasks, task_stops, task_projects), and
-- approving a vehicle request also updates the request. Through the REST API
-- those would be separate calls that could half-finish. This function does
-- them in one transaction: either everything is saved or nothing is.
--
-- Called only by the Edge Function office-mcp (service_role). It runs with the
-- caller's own privileges; it is not security definer.
-- =============================================================================

create function public.office_create_task(
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

  -- Approving a request: lock it first, so two people approving at the same
  -- moment cannot both create a task.
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
     contact_name, contact_phone, notes, request_id, created_by)
  select t.title, t.label, t.employee_id, t.vehicle_id, t.start_at, t.end_by, t.passengers,
         t.contact_name, t.contact_phone, t.notes, p_request_id, t.created_by
  from jsonb_to_record(p_task) as t(
    title text, label text, employee_id uuid, vehicle_id uuid,
    start_at timestamptz, end_by timestamptz, passengers integer,
    contact_name text, contact_phone text, notes text, created_by text)
  returning id into v_task_id;

  insert into public.task_stops (task_id, seq, type, place_id, place_name, address, lat, lng)
  select v_task_id, s.seq, s.type, s.place_id, s.place_name, s.address, s.lat, s.lng
  from jsonb_to_recordset(p_stops) as s(
    seq integer, type text, place_id uuid, place_name text, address text,
    lat double precision, lng double precision);

  -- The trigger task_projects_total_100 checks the total at commit.
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

revoke all on function public.office_create_task(jsonb, jsonb, jsonb, uuid, text)
  from public, anon, authenticated;
grant execute on function public.office_create_task(jsonb, jsonb, jsonb, uuid, text)
  to service_role;
