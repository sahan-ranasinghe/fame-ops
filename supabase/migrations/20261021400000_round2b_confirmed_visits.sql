-- Round 2b (Sahan, 21 October 2026): a stop driven past without Arrived. At the next stop the app asks "Did you stop at
-- …?". "Yes, I was there" no longer marks Arrived and Left with the time of that answer: that is not when the driver was
-- there. Instead:
--
-- 1. The stop is marked visited (done) with confirmed_later_at = the moment the driver confirmed it. Any arrived_at /
--    done_at sent in the same write is ignored.
-- 2. Its times come from the driver's own location points that passed within 150 m of the stop's pin: Arrived = the
--    first point inside, Left = the last. Only points after the stop before it was reached (so a place visited twice in
--    one trip takes the right visit) and before the confirmation (or the next stop's Arrived, whichever is first).
-- 3. With no such points (no pin, no GPS, nothing uploaded yet) the stop stays visited with NO times: "time not
--    recorded". The deltas need both times, so it is never late or early; stopProgress.ts never anchors the re-estimate
--    on it.
-- 4. The points are looked for at once (the driver's own write) and again every 5 minutes for 2 days: a point may reach
--    the server later from the phone's offline queue.
-- 5. The people following the trip are not told (request.arrived, request.stop_arrived): the stop was reached in the
--    past, a notice now would be wrong.
-- 6. Undo (the snackbar) clears confirmed_later_at with the times: the stop is to do again.

alter table public.task_stops add column confirmed_later_at timestamptz;
comment on column public.task_stops.confirmed_later_at is
  'The driver confirmed this stop later ("Yes, I was there" at the next stop). arrived_at / done_at then come only from the driver''s location points within 150 m of the pin (first and last); null = time not recorded.';

grant select (confirmed_later_at) on public.task_stops to authenticated;
grant update (confirmed_later_at) on public.task_stops to authenticated;

-- The first and the last of the driver's points within 150 m of a stop between the stop before it and the confirmation.
-- The driver's write rules call it as the driver: a signed-in person gets their own task's answer only (the jobs run
-- with no one signed in).
create function public.confirmed_visit_times(p_task uuid, p_seq integer, p_lat double precision, p_lng double precision, p_at timestamptz)
returns table (arrived_at timestamptz, left_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select tk.employee_id,
           greatest(
             tk.started_at,
             (select max(coalesce(s.done_at, s.arrived_at)) from public.task_stops s
               where s.task_id = p_task and s.seq < p_seq and s.status in ('arrived', 'done'))
           ) as from_at,
           least(
             p_at,
             (select min(s.arrived_at) from public.task_stops s
               where s.task_id = p_task and s.seq > p_seq and s.status in ('arrived', 'done') and s.arrived_at is not null)
           ) as to_at
      from public.tasks tk
     where tk.id = p_task
       and (public.current_employee_id() is null or tk.employee_id = public.current_employee_id())
  )
  select min(lp.recorded_at), max(lp.recorded_at)
    from t
    join public.location_points lp on lp.employee_id = t.employee_id
   where p_lat is not null and p_lng is not null
     and lp.recorded_at >= coalesce(t.from_at, p_at - interval '12 hours')
     and lp.recorded_at <= t.to_at
     and coalesce(lp.accuracy_m, 0) <= 150
     -- A box first (about 170 m), then the distance on the sphere.
     and lp.lat between p_lat - 0.0016 and p_lat + 0.0016
     and lp.lng between p_lng - 0.0016 / greatest(cos(radians(p_lat)), 0.2) and p_lng + 0.0016 / greatest(cos(radians(p_lat)), 0.2)
     and 2 * 6371000 * asin(sqrt(
           power(sin(radians(lp.lat - p_lat) / 2), 2)
           + cos(radians(p_lat)) * cos(radians(lp.lat)) * power(sin(radians(lp.lng - p_lng) / 2), 2))) <= 150
  having count(*) > 0;
$$;
revoke all on function public.confirmed_visit_times(uuid, integer, double precision, double precision, timestamptz) from public, anon, authenticated;
grant execute on function public.confirmed_visit_times(uuid, integer, double precision, double precision, timestamptz) to authenticated;

-- The driver's write rules (phase7_duty.sql) with the confirmed visit first: done without Arrived, the times only from
-- the points (never the phone's own times in that write), no arrival flag.
create or replace function public.task_stops_driver_rules()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_times record;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  -- How Arrived was marked stands once recorded (an override cannot be turned into ok later).
  if old.arrival_flag is not null then
    new.arrival_flag := old.arrival_flag;
    new.arrival_distance_m := old.arrival_distance_m;
  end if;
  -- Round 2b: "Yes, I was there" (a stop driven past without Arrived): visited, the times from the location points.
  if new.confirmed_later_at is not null and old.confirmed_later_at is null then
    new.confirmed_later_at := least(new.confirmed_later_at, now());
    new.status := 'done';
    new.arrived_at := null;
    new.done_at := null;
    select c.arrived_at, c.left_at into v_times
      from public.confirmed_visit_times(new.task_id, new.seq, new.lat, new.lng, new.confirmed_later_at) c;
    if found then
      new.arrived_at := v_times.arrived_at;
      new.done_at := v_times.left_at;
    end if;
    return new;
  end if;
  -- A confirmed visit keeps its times from the points (an Undo clears confirmed_later_at with them; a write sent again
  -- from the phone's queue changes nothing).
  if old.confirmed_later_at is not null and new.confirmed_later_at is not null then
    new.confirmed_later_at := old.confirmed_later_at;
    new.status := old.status;
    new.arrived_at := old.arrived_at;
    new.done_at := old.done_at;
  end if;
  if new.status = 'done' and old.status is distinct from 'done' and old.arrived_at is null and new.confirmed_later_at is null then
    if new.arrived_at is null then
      raise exception 'Mark Arrived first: a stop is Done only after Arrived';
    end if;
    new.arrival_flag := coalesce(new.arrival_flag, 'not_arrived');
  end if;
  return new;
end;
$$;
revoke all on function public.task_stops_driver_rules() from public, anon, authenticated;

-- Points that reach the server later: every 5 minutes, for 2 days after the confirmation.
create function public.fill_confirmed_visits()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  with found as (
    select s.id, c.arrived_at, c.left_at
      from public.task_stops s
      cross join lateral public.confirmed_visit_times(s.task_id, s.seq, s.lat, s.lng, s.confirmed_later_at) c
     where s.confirmed_later_at is not null
       and s.status = 'done'
       and s.arrived_at is null
       and s.lat is not null
       and s.confirmed_later_at > now() - interval '2 days'
  ),
  done as (
    update public.task_stops s set arrived_at = f.arrived_at, done_at = f.left_at
      from found f
     where s.id = f.id
    returning 1
  )
  select count(*) into v_count from done;
  return v_count;
end;
$$;
revoke all on function public.fill_confirmed_visits() from public, anon, authenticated;
grant execute on function public.fill_confirmed_visits() to service_role;

select cron.schedule('confirmed-visits', '*/5 * * * *', $$select public.fill_confirmed_visits()$$);

-- 5. No "arrived" notice for a stop confirmed later (phase7_photos.sql and round2_stop_progress.sql, with that one test
--    added at the top).
create or replace function public.task_stops_notify_requester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task    public.tasks%rowtype;
  v_first   uuid;
  v_driver  text;
  v_claimed uuid;
begin
  if new.confirmed_later_at is not null then
    return null;
  end if;
  if (new.arrived_at is null or old.arrived_at is not null) and (new.auto_detected_at is null or old.auto_detected_at is not null) then
    return null;
  end if;
  select * into v_task from public.tasks where id = new.task_id;
  if v_task.request_id is null then
    return null;
  end if;
  select s.id into v_first from public.task_stops s
   where s.task_id = new.task_id and s.type = 'pickup' and s.status <> 'removed' order by s.seq limit 1;
  if v_first is distinct from new.id then
    return null;
  end if;
  update public.vehicle_requests set arrived_push_sent_at = now()
   where id = v_task.request_id and arrived_push_sent_at is null
  returning id into v_claimed;
  if v_claimed is null then
    return null;
  end if;
  select name into v_driver from public.employees where id = v_task.employee_id;
  perform public.notify_requester(v_task.id, 'request.arrived',
    'Arrived at ' || new.place_name || ' · ' || split_part(v_driver, ' ', 1),
    to_char(coalesce(new.arrived_at, new.auto_detected_at) at time zone 'Asia/Colombo', 'HH24:MI') || ' · ' || v_task.title);
  return null;
end;
$$;
revoke all on function public.task_stops_notify_requester() from public, anon, authenticated;

create or replace function public.task_stops_notify_stop_arrived()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task      public.tasks%rowtype;
  v_first_seq integer;
  v_claimed   uuid;
  v_driver    text;
  v_when      text;
begin
  if new.confirmed_later_at is not null then
    return null;
  end if;
  if new.arrived_at is null or old.arrived_at is not null then
    return null;
  end if;
  select * into v_task from public.tasks where id = new.task_id;
  if v_task.request_id is null then
    return null;
  end if;
  -- Only the stops after the first pickup: the first pickup is request.arrived's (task_stops_notify_requester), and a
  -- stop before it is not part of the trip the person asked for.
  select s.seq into v_first_seq from public.task_stops s
   where s.task_id = new.task_id and s.type = 'pickup' and s.status <> 'removed' order by s.seq limit 1;
  if v_first_seq is not null and new.seq <= v_first_seq then
    return null;
  end if;
  -- Once per stop (claimed here): an Undo and a second Arrived send nothing more.
  update public.task_stops set arrived_push_sent_at = now()
   where id = new.id and arrived_push_sent_at is null
  returning id into v_claimed;
  if v_claimed is null then
    return null;
  end if;
  select name into v_driver from public.employees where id = v_task.employee_id;
  v_when := case
    when new.arrive_delta_min is null or abs(new.arrive_delta_min) <= 2 then 'on time'
    when new.arrive_delta_min > 0 then new.arrive_delta_min || ' min late'
    else (-new.arrive_delta_min) || ' min early'
  end;
  perform public.notify_requester(v_task.id, 'request.stop_arrived',
    split_part(coalesce(v_driver, 'The driver'), ' ', 1) || ' arrived at ' || coalesce(new.place_name, 'a stop'),
    to_char(new.arrived_at at time zone 'Asia/Colombo', 'HH24:MI') || ', ' || v_when || ' · ' || v_task.title);
  return null;
end;
$$;
revoke all on function public.task_stops_notify_stop_arrived() from public, anon, authenticated;
