-- =============================================================================
-- Phase 6, Part 3: fuel videos (docs/phase6-plan.md, 3.2 and 7)
--
--   fuel-videos        a private bucket (120 MB, video/mp4): a driver uploads and
--       reads inside <employee_id>/ only (the resumable upload needs insert and
--       update there); the office gets 1-hour signed links through the tools.
--   fuel_logs          video_path, video_status (none | recorded | uploading |
--       uploaded | failed | pruned), video_duration_s, video_bytes,
--       video_uploaded_at, video_checklist (the items the driver ticked). A driver
--       inserts a log with its video fields and later updates the video columns of
--       their own rows (the upload finishes after the entry is saved).
--   fuel_video_checklist   the fleet setting behind the recording screen's list
--       (seeded with the three defaults); get_driver_settings() answers it.
--   driver_heartbeats / driver_latest   video_uploads_waiting, video_bytes_waiting
--       ("1 video waiting (12 MB)" on the office's phone line).
--   fuel-videos-prune  pg_cron, the 1st of the month 21:45 UTC: fleet-jobs removes
--       the files older than 12 months through the storage API (deleting
--       storage.objects rows would leave the files behind) and marks the rows pruned.
-- =============================================================================

-- 1. The bucket and its policies ----------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fuel-videos', 'fuel-videos', false, 125829120, array['video/mp4'])
on conflict (id) do update
  set public             = false,
      file_size_limit    = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create policy fuel_videos_insert_own_folder on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'fuel-videos'
    and (storage.foldername(name))[1] = (select public.current_employee_id())::text
  );

create policy fuel_videos_update_own_folder on storage.objects
  for update to authenticated
  using (
    bucket_id = 'fuel-videos'
    and (storage.foldername(name))[1] = (select public.current_employee_id())::text
  )
  with check (
    bucket_id = 'fuel-videos'
    and (storage.foldername(name))[1] = (select public.current_employee_id())::text
  );

create policy fuel_videos_select_own_folder on storage.objects
  for select to authenticated
  using (
    bucket_id = 'fuel-videos'
    and (storage.foldername(name))[1] = (select public.current_employee_id())::text
  );

-- 2. fuel_logs: the video ---------------------------------------------------------------
alter table public.fuel_logs
  add column video_path        text,
  add column video_status      text not null default 'none'
    constraint fuel_logs_video_status_check check (video_status in ('none', 'recorded', 'uploading', 'uploaded', 'failed', 'pruned')),
  add column video_duration_s  integer,
  add column video_bytes       bigint,
  add column video_uploaded_at timestamptz,
  add column video_checklist   jsonb;

alter table public.fuel_logs add constraint fuel_logs_video_path_in_own_folder
  check (video_path is null or starts_with(video_path, employee_id::text || '/'));

comment on column public.fuel_logs.video_status is
  'none = no video; recorded = on the phone, upload not started; uploading; uploaded; failed = the server refused it; pruned = removed after 12 months (video_path kept for the record).';

-- A driver may update the video columns of their own rows, nothing else.
grant update (video_path, video_status, video_duration_s, video_bytes, video_uploaded_at, video_checklist)
  on public.fuel_logs to authenticated;
create policy fuel_logs_update_own_video on public.fuel_logs
  for update to authenticated
  using (employee_id = (select public.current_employee_id()))
  with check (employee_id = (select public.current_employee_id()));

-- 3. The checklist setting (the three defaults; the office edits it in Settings → Fleet) --------
insert into public.fleet_settings (key, value, updated_by) values
  ('fuel_video_checklist',
   '[{"key": "pump", "en": "Pump display: litres and amount", "si": "පොම්ප තිරය: ලීටර් සහ මුදල"},
     {"key": "odometer", "en": "Odometer", "si": "ඔඩෝමීටරය"},
     {"key": "plate", "en": "Number plate", "si": "අංක තහඩුව"}]'::jsonb,
   'migration')
on conflict (key) do nothing;

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
                            '[1, 2, 3, 4, 5, 6]'::jsonb),
    'fuel_video_checklist',
                   coalesce((select value from public.fleet_settings where key = 'fuel_video_checklist' and jsonb_typeof(value) = 'array'),
                            '[{"key": "pump", "en": "Pump display: litres and amount", "si": "පොම්ප තිරය: ලීටර් සහ මුදල"},
                              {"key": "odometer", "en": "Odometer", "si": "ඔඩෝමීටරය"},
                              {"key": "plate", "en": "Number plate", "si": "අංක තහඩුව"}]'::jsonb)
  )
$$;

-- 4. The heartbeat says how many videos wait on the phone -------------------------------------
alter table public.driver_heartbeats
  add column video_uploads_waiting integer,
  add column video_bytes_waiting   bigint;
alter table public.driver_latest
  add column hb_video_uploads_waiting integer,
  add column hb_video_bytes_waiting   bigint;

drop function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer);
create function public.send_heartbeat(
  p_at                    timestamptz,
  p_sharing               boolean,
  p_location_on           boolean,
  p_permission            text,
  p_battery_pct           integer default null,
  p_app_version           text    default null,
  p_queued_points         integer default null,
  p_rejected_points       integer default null,
  p_data_available        boolean default null,
  p_app_state             text    default null,
  p_fix_age_s             integer default null,
  p_video_uploads_waiting integer default null,
  p_video_bytes_waiting   bigint  default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me  uuid := public.current_employee_id();
  v_at  timestamptz := least(coalesce(p_at, now()), now());
  v_ok  boolean := coalesce(p_location_on, false) and coalesce(p_permission, 'unknown') = 'always';
begin
  -- Drivers only: office people have employee rows too, but no phone to report.
  if v_me is null or not exists (select 1 from public.employees e where e.id = v_me and e.role = 'driver') then
    raise exception 'Only a signed-in driver can send a heartbeat';
  end if;
  if p_permission is not null and p_permission not in ('always', 'foreground', 'denied', 'unknown') then
    raise exception 'Unknown permission value %', p_permission;
  end if;
  if p_app_state is not null and p_app_state not in ('foreground', 'background') then
    raise exception 'Unknown app state %', p_app_state;
  end if;

  insert into public.driver_latest as dl
    (employee_id, sharing, hb_at, hb_sharing, hb_location_on, hb_permission, hb_battery_pct, hb_app_version, hb_queued_points,
     hb_location_off_since, hb_rejected_points, hb_data_available, hb_app_state, hb_fix_age_s,
     hb_video_uploads_waiting, hb_video_bytes_waiting)
  values
    (v_me,
     exists (select 1 from public.duty_sessions s where s.employee_id = v_me and s.ended_at is null),
     v_at, p_sharing, p_location_on, p_permission, p_battery_pct, p_app_version, p_queued_points,
     case when v_ok then null else v_at end,
     p_rejected_points, p_data_available, p_app_state, p_fix_age_s,
     p_video_uploads_waiting, p_video_bytes_waiting)
  on conflict (employee_id) do update
    set hb_at                    = excluded.hb_at,
        hb_sharing               = excluded.hb_sharing,
        hb_location_on           = excluded.hb_location_on,
        hb_permission            = excluded.hb_permission,
        hb_battery_pct           = excluded.hb_battery_pct,
        hb_app_version           = excluded.hb_app_version,
        hb_queued_points         = excluded.hb_queued_points,
        hb_location_off_since    = case when v_ok then null else coalesce(dl.hb_location_off_since, excluded.hb_at) end,
        hb_rejected_points       = excluded.hb_rejected_points,
        hb_data_available        = excluded.hb_data_available,
        hb_app_state             = excluded.hb_app_state,
        hb_fix_age_s             = excluded.hb_fix_age_s,
        hb_video_uploads_waiting = excluded.hb_video_uploads_waiting,
        hb_video_bytes_waiting   = excluded.hb_video_bytes_waiting
    where dl.hb_at is null or excluded.hb_at > dl.hb_at;
end;
$$;

revoke all on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer, integer, bigint)
  from public, anon;
grant execute on function public.send_heartbeat(timestamptz, boolean, boolean, text, integer, text, integer, integer, boolean, text, integer, integer, bigint)
  to authenticated, service_role;

-- 5. The monthly prune, through fleet-jobs (the files must go too) ------------------------------
select cron.schedule('fuel-videos-prune', '45 21 1 * *', $$select public.call_edge_function('fleet-jobs', '{"job": "prune_fuel_videos"}'::jsonb)$$);
