-- =============================================================================
-- Phase 7 Part 6, after the checkpoint (Sahan, 19 October 2026): both maps on every phone.
--
--   driver_map_state     one row per driver: whether Google's map loaded on their phone. The phone reports a failure
--                        (Google's map did not finish loading within phone_map_wait_s while the phone was online, or it
--                        reported an error) and the next good load. Service role only; the phone writes through
--                        report_map_state(). The issues sync opens "Google map failed on <driver>'s phone; using the free
--                        map" while google_ok is false and the map package is google, and resolves it by itself when the
--                        phone reports Google's map loaded again.
--   report_map_state     the phone's report (security definer; the caller's own row only; an older report than the one
--                        stored is ignored, a phone time after now() is stored as now()).
--   get_driver_settings  also answers map_package (google | open: the phones follow the office's map package within a
--                        minute) and phone_map_wait_s (how long a phone waits for Google's map, 30 s by default).
-- =============================================================================

create table public.driver_map_state (
  employee_id      uuid primary key references public.employees (id) on delete cascade,
  google_ok        boolean not null,
  reason           text constraint driver_map_state_reason_check check (reason in ('timeout', 'error')),
  google_failed_at timestamptz,
  google_ok_at     timestamptz,
  app_version      text,
  updated_at       timestamptz not null default now(),
  constraint driver_map_state_failed_has_reason check (google_ok or reason is not null)
);

comment on table public.driver_map_state is
  'Part 6: whether Google''s map loads on a driver''s phone (report_map_state). google_ok false = the phone uses the free map (OpenFreeMap) until Google''s map loads again; the issues sync turns it into a map_fallback issue.';

alter table public.driver_map_state enable row level security;
revoke all on public.driver_map_state from anon, authenticated;

create function public.report_map_state(p_google_ok boolean, p_reason text, p_at timestamptz, p_app_version text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := public.current_employee_id();
  v_at   timestamptz := least(coalesce(p_at, now()), now());
  v_last timestamptz;
begin
  if v_me is null then
    raise exception 'Not signed in as an employee' using errcode = '42501';
  end if;
  if p_google_ok is null then
    raise exception 'google_ok is needed' using errcode = '22023';
  end if;
  if not p_google_ok and (p_reason is null or p_reason not in ('timeout', 'error')) then
    raise exception 'A failure needs its reason: timeout or error' using errcode = '22023';
  end if;
  select greatest(google_failed_at, google_ok_at) into v_last from public.driver_map_state where employee_id = v_me;
  if v_last is not null and v_at < v_last then
    return 'older';
  end if;
  insert into public.driver_map_state as s (employee_id, google_ok, reason, google_failed_at, google_ok_at, app_version, updated_at)
  values (
    v_me, p_google_ok, case when p_google_ok then null else p_reason end,
    case when p_google_ok then null else v_at end,
    case when p_google_ok then v_at else null end,
    left(p_app_version, 80), now()
  )
  on conflict (employee_id) do update set
    google_ok        = excluded.google_ok,
    reason           = excluded.reason,
    google_failed_at = case when excluded.google_ok then s.google_failed_at else excluded.google_failed_at end,
    google_ok_at     = case when excluded.google_ok then excluded.google_ok_at else s.google_ok_at end,
    app_version      = coalesce(excluded.app_version, s.app_version),
    updated_at       = now();
  return 'ok';
end;
$$;
revoke all on function public.report_map_state(boolean, text, timestamptz, text) from public, anon;
grant execute on function public.report_map_state(boolean, text, timestamptz, text) to authenticated;

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
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'driver_personal_trips'), 'allowed'),
    -- Part 3b (H1): a morning ends and an afternoon starts here.
    'half_day_split',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'half_day_split'), '13:00'),
    -- Part 6: the phones' map follows the office's map package (google | open).
    'map_package',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'map_package'), 'google'),
    -- Part 6: how long a phone waits for Google's map to finish loading while online before it uses the free map.
    'phone_map_wait_s',
                   coalesce((select value from public.fleet_settings where key = 'phone_map_wait_s' and jsonb_typeof(value) = 'number'),
                            '30'::jsonb)
  )
$$;
