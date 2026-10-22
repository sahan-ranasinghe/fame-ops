-- Round 4–7, feature 4b (Sahan, 22 October 2026): closing a trip nobody drives with the app (driven_by self or other),
-- Zipcar's and Turo's return. The self-driver, or the person a someone-else trip is booked on, answers in Office mode, /m/
-- or the site (office-api's my_trip_check and finish_my_trip):
--   - The vehicle check on the trip's day, from 2 h before its planned start, starts it (On the way) with the odometer
--     typed then; an earlier check only records the check.
--   - "Trip finished? Enter the odometer" (fuel and a photo optional) completes it: the readings go into odometer_logs
--     with the trip's id, so the vehicle's odometer, the month's km and the allowance follow, and no km gap opens.
--   - At the back-by time (end_by), or at the duty cut-off of the trip's day when it has none, the person is asked once
--     (event trip.finish_ask).
--   - No answer by 09:00 Colombo the day after: "Completed · not confirmed" (finish_flag kind not_confirmed) and the issue
--     trip_not_confirmed in Needs attention. The odometer entered later still confirms it.
-- The switch trip_close_prompt (Settings → Dispatch) stops the question and the 09:00 close; finishing by hand stays.

alter table public.tasks add column finish_ask_sent_at timestamptz;
comment on column public.tasks.finish_ask_sent_at is
  'Round 4–7 (4b): when the person a no-app trip is on was asked "Trip finished? Enter the odometer".';

-- A trip closed without its readings: the only completed task allowed without them.
alter table public.tasks drop constraint tasks_started_fields;
alter table public.tasks add constraint tasks_started_fields check (
  status not in ('in_progress', 'completed')
  or (started_at is not null and start_odometer_km is not null)
  -- coalesce: a CHECK passes on NULL, and a task with no flag must still have its readings.
  or (status = 'completed' and coalesce(finish_flag ->> 'kind', '') = 'not_confirmed')
);
alter table public.tasks drop constraint tasks_completed_fields;
alter table public.tasks add constraint tasks_completed_fields check (
  status <> 'completed'
  or (completed_at is not null and (end_odometer_km is not null or coalesce(finish_flag ->> 'kind', '') = 'not_confirmed'))
);

-- The finish check (completed early) is the driver app's: a no-app trip's readings are typed by the person who drove,
-- and its flag (not_confirmed) is set by the close below, never cleared here.
create or replace function public.tasks_finish_check()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  -- The plan up to the last stop: a driver completes there, before any drive back to base (to_seq -1).
  v_plan_km  numeric := (select sum((l ->> 'km')::numeric) from jsonb_array_elements(coalesce(new.plan_json -> 'legs', '[]'::jsonb)) l
                         where coalesce((l ->> 'to_seq')::integer, 0) <> -1);
  v_plan_min numeric := (select sum((l ->> 'minutes')::numeric) from jsonb_array_elements(coalesce(new.plan_json -> 'legs', '[]'::jsonb)) l
                         where coalesce((l ->> 'to_seq')::integer, 0) <> -1);
  v_km       numeric;
  v_min      numeric;
  -- After a swap: a stretch whose start (or, before the last, end) reading is still owed leaves the km unknown.
  v_owed     boolean := exists (
    select 1 from public.task_vehicle_segments s
    where s.task_id = new.id
      and (s.start_odometer_km is null
           or (s.end_odometer_km is null and s.seq < (select max(x.seq) from public.task_vehicle_segments x where x.task_id = new.id))));
begin
  if new.driven_by is distinct from 'driver' then
    return new;
  end if;
  if new.status = 'completed' and old.status = 'in_progress' then
    new.finish_flag := null;
    if v_plan_km >= 3 and new.start_odometer_km is not null and new.end_odometer_km is not null and not v_owed
       and new.started_at is not null and new.completed_at is not null then
      v_km := coalesce(
        (select sum(coalesce(case when s.seq = (select max(x.seq) from public.task_vehicle_segments x where x.task_id = new.id)
                                  then new.end_odometer_km else s.end_odometer_km end, s.start_odometer_km) - s.start_odometer_km)
         from public.task_vehicle_segments s where s.task_id = new.id),
        new.end_odometer_km - new.start_odometer_km);
      v_min := extract(epoch from (new.completed_at - new.started_at)) / 60;
      if v_km < 0.7 * v_plan_km or (coalesce(v_plan_min, 0) > 0 and v_min < 0.5 * v_plan_min) then
        new.finish_flag := jsonb_build_object(
          'kind', 'completed_early',
          'odometer_km', v_km,
          'planned_km', round(v_plan_km, 1),
          'minutes', round(v_min),
          'planned_minutes', round(coalesce(v_plan_min, 0)));
      end if;
    end if;
  elsif new.status = 'in_progress' and old.status = 'completed' then
    new.finish_flag := null;
  end if;
  return new;
end;
$$;

-- "On the way" goes to the requester when a driver sets off; on a no-app trip the requester is the one driving (self) or
-- booked it for someone else (other): nobody to tell.
create or replace function public.tasks_notify_requester()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_driver text;
  v_plate  text;
begin
  if new.request_id is null or current_setting('fleet.quiet', true) = 'on' or new.driven_by is distinct from 'driver' then
    return null;
  end if;
  if new.status = 'in_progress' and old.status in ('assigned', 'declined') then
    select name into v_driver from public.employees where id = new.employee_id;
    select reg_no into v_plate from public.vehicles where id = new.vehicle_id;
    perform public.notify_requester(new.id, 'request.on_the_way',
      'On the way · ' || split_part(v_driver, ' ', 1) || ' · ' || coalesce(v_plate, ''),
      'Left at ' || to_char(coalesce(new.started_at, now()) at time zone 'Asia/Colombo', 'HH24:MI') || ' · ' || new.title);
  end if;
  return null;
end;
$$;

-- When a no-app trip is over: its back-by time, else the duty cut-off of its day (21:00 by default), else the end of its
-- day. The question goes then; the close at 09:00 the day after that.
create function public.no_app_trip_end(p_start timestamptz, p_end_by timestamptz)
returns timestamptz
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    p_end_by,
    public.duty_cutoff_after(p_start,
      coalesce((select s.value #>> '{}' from public.fleet_settings s where s.key = 'duty_cutoff'), '21:00')),
    (((p_start at time zone 'Asia/Colombo')::date + 1)::timestamp at time zone 'Asia/Colombo'))
$$;
revoke all on function public.no_app_trip_end(timestamptz, timestamptz) from public, anon, authenticated;

-- Every 15 minutes: ask once at the trip's end, close the unanswered at 09:00 the next day. Answers the counts.
create function public.no_app_trips()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r       record;
  v_asked integer := 0;
  v_closed integer := 0;
  v_end   timestamptz;
  v_plate text;
begin
  if not public.fleet_switch('trip_close_prompt') then
    return jsonb_build_object('asked', 0, 'closed', 0, 'off', true);
  end if;

  for r in
    select t.* from public.tasks t
    where t.driven_by in ('self', 'other')
      and t.status in ('assigned', 'in_progress')
      and not t.demo
      and t.start_at is not null
      and t.start_at > now() - interval '14 days'
  loop
    v_end := public.no_app_trip_end(r.start_at, r.end_by);
    -- Closed: 09:00 Colombo on the day after the trip's end.
    if now() >= ((((v_end at time zone 'Asia/Colombo')::date + 1)::timestamp + time '09:00') at time zone 'Asia/Colombo') then
      update public.tasks
         set status = 'completed',
             started_at = coalesce(started_at, start_at),
             completed_at = greatest(v_end, coalesce(started_at, start_at)),
             finish_flag = jsonb_build_object('kind', 'not_confirmed', 'closed_at', now(), 'checked', r.started_at is not null)
       where id = r.id and status in ('assigned', 'in_progress');
      v_closed := v_closed + 1;
    elsif now() >= v_end and r.finish_ask_sent_at is null then
      select v.reg_no into v_plate from public.vehicles v where v.id = r.vehicle_id;
      perform public.queue_notification(
        'trip.finish_ask',
        jsonb_build_object(
          'title', 'Trip finished? Enter the odometer',
          'body', concat_ws(' · ', r.title, v_plate),
          'url', '/my-trips/' || r.id,
          'tag', 'finish:' || r.id,
          'task_id', r.id),
        array[r.employee_id]);
      update public.tasks set finish_ask_sent_at = now() where id = r.id;
      v_asked := v_asked + 1;
    end if;
  end loop;
  return jsonb_build_object('asked', v_asked, 'closed', v_closed);
end;
$$;
revoke all on function public.no_app_trips() from public, anon, authenticated;

select cron.schedule('no-app-trips', '*/15 * * * *', $$select public.no_app_trips()$$);
