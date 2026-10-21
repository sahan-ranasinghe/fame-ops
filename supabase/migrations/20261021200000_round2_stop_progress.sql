-- Round 2 (21 October 2026): live stop progress. The driver slides "Arrived" and "Left" at each stop (the phone's own
-- time, queued offline: arrived_at and done_at, already granted to the driver); the planned times stay as planned.
--
-- 1. The deltas are stored with the stop: minutes against the plan (+ late, − early), computed by Postgres from the
--    times, so every reader (task_detail, Realtime on task_stops, the apps) sees the same number.
-- 2. The people who follow a trip hear each stop reached after the first pickup, once per stop ("Kanishka arrived at Wariyapola 10:52,
--    22 min late"): the event request.stop_arrived through the existing notify_requester (the requester today; the
--    passengers of Round 6 join it there). The first pickup keeps request.arrived (once per request), as before. Only the
--    driver's own Arrived counts here, not the 150 m nudge (auto_detected_at), which is a suggestion.
-- The re-estimate of the stops still to come is not stored: it follows from these times and the plan's leg times
-- (_shared/fleet/stopProgress.ts, the same rule in task_detail, the site and the app), so it can never go stale.

alter table public.task_stops
  add column if not exists arrive_delta_min integer
    generated always as (case when arrived_at is not null and planned_arrive_at is not null
                              then round(extract(epoch from (arrived_at - planned_arrive_at)) / 60)::integer end) stored,
  -- A skipped stop's done_at is when it was skipped, not a time the driver left: no delta for it.
  add column if not exists leave_delta_min integer
    generated always as (case when done_at is not null and planned_depart_at is not null and status <> 'skipped'
                              then round(extract(epoch from (done_at - planned_depart_at)) / 60)::integer end) stored,
  -- Each stop's "arrived" notice goes once: an Undo and a second Arrived never send it again (Checkpoint 2 review).
  add column if not exists arrived_push_sent_at timestamptz;
comment on column public.task_stops.arrive_delta_min is 'Minutes the driver arrived after (+) or before (−) the planned arrival';
comment on column public.task_stops.leave_delta_min is 'Minutes the driver left (done_at) after (+) or before (−) the planned departure; null for a skipped stop';
comment on column public.task_stops.arrived_push_sent_at is 'When the people following the trip were told this stop was reached (request.stop_arrived), once';

-- Drivers read their own stops: the two new columns with them.
grant select (arrive_delta_min, leave_delta_min) on public.task_stops to authenticated;

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
drop trigger if exists task_stops_notify_stop_arrived on public.task_stops;
create trigger task_stops_notify_stop_arrived
  after update of arrived_at on public.task_stops
  for each row execute function public.task_stops_notify_stop_arrived();
