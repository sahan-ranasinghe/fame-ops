-- Phase 7, Part 4 (item 13, docs/phase7-plan.md §13): trips a driver starts. A task of kind self is made by the driver
-- through driver-api (service role), with one stop, no request and no plan deadline; its leave-by is its start. Its
-- purpose is company (the default) or personal: personal km are counted apart and never charged to a job (Phase C).

alter table public.tasks
  add column kind text not null default 'dispatch',
  add column purpose text not null default 'company';

alter table public.tasks
  add constraint tasks_kind_check check (kind in ('dispatch', 'self')),
  add constraint tasks_purpose_check check (purpose in ('company', 'personal'));

comment on column public.tasks.kind is
  'dispatch = made by the office (create_task, a request, a booking); self = started by the driver in the app (driver-api).';
comment on column public.tasks.purpose is
  'company (the default) or personal (a self trip the driver marked personal, or the office switched: set_trip_purpose); '
  'personal km are counted apart and left out of job costs.';

create index tasks_self_start on public.tasks (start_at) where kind = 'self';

-- Drivers update only the listed task columns (grant of 7 October): kind and purpose stay the office's.

create or replace function public.tasks_notify_push()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_changes jsonb := '{}'::jsonb;
begin
  -- A housekeeping write (the 30-day removal of Google's lines) changes nothing the driver sees: no push.
  if coalesce(current_setting('fleet.quiet', true), '') = 'on' then
    return null;
  end if;
  -- The driver's own app (seen, accepted, declined, started, completed) never pushes.
  if coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') = 'authenticated' then
    return null;
  end if;

  -- Phase 7 (§13): a trip the driver started is theirs: no "new" or "Task changed" push for it. The office cancelling it
  -- or giving it to someone else still tells them (below).
  if new.kind = 'self' and (tg_op = 'INSERT' or (new.employee_id = old.employee_id and new.status <> 'cancelled')) then
    return null;
  end if;

  if tg_op = 'INSERT' then
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
    return null;
  end if;

  if new.employee_id <> old.employee_id then
    -- The previous driver hears that the task is gone only if he had accepted it
    -- (a task he never accepted simply leaves his list) and did not decline it himself.
    if old.status <> 'declined' and old.accepted_at is not null then
      perform public.send_push(new.id, 'removed', old.employee_id);
    end if;
    if new.status in ('assigned', 'in_progress') then
      perform public.send_push(new.id, 'new', new.employee_id);
    end if;
  elsif new.status = 'cancelled' and old.status <> 'cancelled' then
    if old.status <> 'declined' then
      perform public.send_push(new.id, 'cancelled', new.employee_id);
    end if;
  elsif old.status = 'declined' and new.status = 'assigned' then
    -- The same driver gets a declined task back (the office talked to him): as a new task.
    perform public.send_push(new.id, 'new', new.employee_id);
  elsif new.status in ('assigned', 'in_progress')
    and (new.start_at, new.end_by, new.vehicle_id, new.title, new.plan_version, new.notes, new.passengers, new.contact_name, new.contact_phone)
        is distinct from
        (old.start_at, old.end_by, old.vehicle_id, old.title, old.plan_version, old.notes, old.passengers, old.contact_name, old.contact_phone) then
    -- What changed, in the words the push shows ("Task changed: new time 09:30 · vehicle WP KL-1234").
    if new.start_at is distinct from old.start_at then
      v_changes := v_changes || jsonb_build_object('time', public.colombo_when(new.start_at));
    end if;
    if new.end_by is distinct from old.end_by then
      v_changes := v_changes || jsonb_build_object('end_by',
        case when new.end_by is null then 'none' else to_char(new.end_by at time zone 'Asia/Colombo', 'HH24:MI') end);
    end if;
    if new.vehicle_id is distinct from old.vehicle_id then
      v_changes := v_changes || jsonb_build_object('vehicle', (select v.reg_no from public.vehicles v where v.id = new.vehicle_id));
    end if;
    if new.title is distinct from old.title then
      v_changes := v_changes || jsonb_build_object('title', new.title);
    end if;
    if new.plan_json is distinct from old.plan_json then
      -- Phase 7 (§11): which stops changed, by their place in the order, when update_task_stops said so.
      v_changes := v_changes || jsonb_build_object('stops', coalesce(new.plan_json -> 'stop_changes', 'true'::jsonb));
    end if;
    if new.passengers is distinct from old.passengers then
      v_changes := v_changes || jsonb_build_object('passengers', new.passengers);
    end if;
    if (new.notes, new.contact_name, new.contact_phone) is distinct from (old.notes, old.contact_name, old.contact_phone) then
      v_changes := v_changes || jsonb_build_object('notes', true);
    end if;
    perform public.send_push(new.id, 'changed', new.employee_id, jsonb_build_object('changes', v_changes));
  end if;
  return null;
end;
$$;

-- The driver app reads whether Start a trip offers Personal.
create or replace function public.get_driver_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shift_start', coalesce((select value #>> '{}' from public.fleet_settings where key = 'shift_start'), '08:00'),
    'shift_days',  coalesce((select value from public.fleet_settings where key = 'shift_days' and jsonb_typeof(value) = 'array'),
                            '[1, 2, 3, 4, 5]'::jsonb),
    'fuel_video_checklist',
                   coalesce((select value from public.fleet_settings where key = 'fuel_video_checklist' and jsonb_typeof(value) = 'array'),
                            '[{"key": "plate", "short": "Plate", "en": "Number plate", "si": "අංක තහඩුව"},
                              {"key": "zero", "short": "Zero", "en": "Pump display at zero before pumping", "si": "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ"},
                              {"key": "pumping", "short": "Pumping", "en": "Pumping", "si": "පොම්ප කරමින්"},
                              {"key": "final", "short": "Final", "en": "Final pump display: litres and amount", "si": "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල"}]'::jsonb),
    'fuel_video_quality',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'fuel_video_quality'), '480p'),
    -- Phase 7 (§13): Start a trip offers Personal per this setting (allowed, default, off; ask_first behaves as allowed).
    'driver_personal_trips',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'driver_personal_trips'), 'allowed')
  )
$$;
