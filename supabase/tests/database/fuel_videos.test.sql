-- Fuel videos (Phase 6, Part 3), checked with pgTAP: the bucket, the video
-- columns a driver may update on their own rows only, the office cannot write
-- them from the app, the storage policies (own folder only), the checklist
-- setting through get_driver_settings, the heartbeat's video counts.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000f5', 'd.fuel@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000f6', 'd.other.fuel@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000f7', 'office.fuel@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000f5', 'D-FUEL', 'Fuel Driver', 'd.fuel', null, 'driver', '{}', '00000000-0000-0000-0000-0000000000f5'),
  ('10000000-0000-0000-0000-0000000000f6', 'D-OFUEL', 'Other Driver', 'd.other.fuel', null, 'driver', '{}', '00000000-0000-0000-0000-0000000000f6'),
  ('10000000-0000-0000-0000-0000000000f7', 'O-FUEL', 'Fuel Office', null, 'office.fuel@fame.test', 'fleet_admin', '{view,vehicles}', '00000000-0000-0000-0000-0000000000f7');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000f5', 'WP FUEL-0001');

-- 1. The bucket and the columns.
select is((select public || '|' || file_size_limit || '|' || allowed_mime_types[1] from storage.buckets where id = 'fuel-videos'),
  'false|262144000|video/mp4', 'the fuel-videos bucket is private, 250 MB, mp4 only');
select has_column('public', 'fuel_logs', 'video_segments', 'fuel_logs.video_segments exists (an interrupted fill in pieces)');
select has_column('public', 'fuel_logs', 'video_interrupted', 'fuel_logs.video_interrupted exists');
select has_column('public', 'fuel_logs', 'video_path', 'fuel_logs.video_path exists');
select has_column('public', 'fuel_logs', 'video_status', 'fuel_logs.video_status exists');
select has_column('public', 'fuel_logs', 'video_checklist', 'fuel_logs.video_checklist exists');
select has_column('public', 'driver_heartbeats', 'video_uploads_waiting', 'driver_heartbeats.video_uploads_waiting exists');
select has_column('public', 'driver_latest', 'hb_video_bytes_waiting', 'driver_latest.hb_video_bytes_waiting exists');

-- 2. The driver inserts a log with its video, then finishes the upload on their own row only.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select lives_ok($$
  insert into public.fuel_logs (id, vehicle_id, employee_id, litres, amount_cents, video_path, video_status, video_duration_s, video_bytes, video_checklist)
  values ('60000000-0000-0000-0000-0000000000f5', '20000000-0000-0000-0000-0000000000f5', '10000000-0000-0000-0000-0000000000f5', 30, 1100000,
          '10000000-0000-0000-0000-0000000000f5/2026-10-14/60000000-0000-0000-0000-0000000000f5.mp4', 'recorded', 47, 16000000, '["pump", "odometer"]'::jsonb)
$$, 'a driver saves a fuel log with its recorded video');
select throws_ok($$
  insert into public.fuel_logs (vehicle_id, employee_id, litres, video_path, video_status)
  values ('20000000-0000-0000-0000-0000000000f5', '10000000-0000-0000-0000-0000000000f5', 30, '10000000-0000-0000-0000-0000000000f6/x.mp4', 'recorded')
$$, '23514', null, 'a video path outside the driver''s own folder is refused');
select throws_ok($$
  update public.fuel_logs set video_status = 'done' where id = '60000000-0000-0000-0000-0000000000f5'
$$, '23514', null, 'an unknown video status is refused');
select lives_ok($$
  update public.fuel_logs set video_status = 'uploaded', video_uploaded_at = now(), video_interrupted = true,
    video_segments = '[{"path": "10000000-0000-0000-0000-0000000000f5/2026-10-14/60000000-0000-0000-0000-0000000000f5.mp4", "duration_s": 30, "bytes": 9000000},
                       {"path": "10000000-0000-0000-0000-0000000000f5/2026-10-14/60000000-0000-0000-0000-0000000000f5-2.mp4", "duration_s": 17, "bytes": 7000000}]'::jsonb
  where id = '60000000-0000-0000-0000-0000000000f5'
$$, 'the driver marks their own video uploaded, in two pieces after an interruption');
select is((select video_status from public.fuel_logs where id = '60000000-0000-0000-0000-0000000000f5'), 'uploaded', 'and the row says so');
select throws_ok($$
  update public.fuel_logs set litres = 99 where id = '60000000-0000-0000-0000-0000000000f5'
$$, '42501', null, 'a driver cannot change the litres after saving (video columns only)');

set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f6","role":"authenticated"}';
select is((select count(*) from public.fuel_logs where id = '60000000-0000-0000-0000-0000000000f5'), 0::bigint, 'another driver does not see the row');
update public.fuel_logs set video_status = 'failed' where id = '60000000-0000-0000-0000-0000000000f5';
reset role;
select is((select video_status from public.fuel_logs where id = '60000000-0000-0000-0000-0000000000f5'), 'uploaded', 'and another driver''s update touches nothing');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f7","role":"authenticated"}';
update public.fuel_logs set video_status = 'pruned' where id = '60000000-0000-0000-0000-0000000000f5';
reset role;
select is((select video_status from public.fuel_logs where id = '60000000-0000-0000-0000-0000000000f5'), 'uploaded',
  'an office person''s update from the app touches no row (the tools write as service role)');

-- 3. Storage: own folder only (the policies exist and name the bucket).
select is((select count(*) from pg_policies where schemaname = 'storage' and tablename = 'objects'
           and policyname in ('fuel_videos_insert_own_folder', 'fuel_videos_update_own_folder', 'fuel_videos_select_own_folder')),
  3::bigint, 'the three fuel-videos storage policies exist');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select lives_ok($$
  insert into storage.objects (bucket_id, name, owner) values ('fuel-videos', '10000000-0000-0000-0000-0000000000f5/2026-10-14/a.mp4', '00000000-0000-0000-0000-0000000000f5')
$$, 'a driver may add a file inside their own folder');
select throws_ok($$
  insert into storage.objects (bucket_id, name, owner) values ('fuel-videos', '10000000-0000-0000-0000-0000000000f6/2026-10-14/b.mp4', '00000000-0000-0000-0000-0000000000f5')
$$, '42501', null, 'but not in another driver''s folder');
reset role;

-- 4. The steps reach the driver, with the four defaults in order; the office's list replaces them.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select is((select jsonb_array_length(public.get_driver_settings() -> 'fuel_video_checklist')), 4, 'get_driver_settings: the four default steps');
select is((select public.get_driver_settings() -> 'fuel_video_checklist' -> 0 ->> 'key'), 'plate', 'the first step is the number plate');
select is((select public.get_driver_settings() -> 'fuel_video_checklist' -> 3 ->> 'short'), 'Final', 'the last step is the final pump display, with its short word for the office timeline');
select is((select public.get_driver_settings() ->> 'fuel_video_quality'), '480p', 'get_driver_settings: the recording quality, 480p by default');
reset role;
select is((select value -> 1 ->> 'key' from public.fleet_settings where key = 'fuel_video_checklist'), 'zero', 'the seeded setting was replaced by the ordered steps (never edited)');
update public.fleet_settings set value = '[{"key": "pump", "en": "Pump", "si": "පොම්පය"}, {"key": "custom", "en": "The cap closed", "si": "මූඩිය වසා ඇත"}]'::jsonb
where key = 'fuel_video_checklist';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select is((select public.get_driver_settings() -> 'fuel_video_checklist' -> 1 ->> 'si'), 'මූඩිය වසා ඇත', 'the office''s own item reaches the phone in Sinhala too');

-- 5. The heartbeat carries the waiting videos.
select lives_ok($$
  select public.send_heartbeat(now(), true, true, 'always', 80, '1.1.0', 0, 0, true, 'foreground', 5, 1, 12000000)
$$, 'a heartbeat with one video waiting');
select lives_ok($$ select public.send_heartbeat(now(), true, true, 'always', 80, '1.1.0', 0) $$, 'the older call shape still works');
-- Watched mode: the heartbeat answers whether the office is watching this driver (watch_drivers sets driver_latest.watched_until).
select is((select public.send_heartbeat(now(), true, true, 'always', 80, '1.1.0', 0)) ->> 'watched', 'false', 'a heartbeat answers watched: false while nobody watches');
reset role;
update public.driver_latest set watched_until = now() + interval '90 seconds' where employee_id = '10000000-0000-0000-0000-0000000000f5';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000f5","role":"authenticated"}';
select is((select public.send_heartbeat(now(), true, true, 'always', 80, '1.1.0', 0)) ->> 'watched', 'true', 'and watched: true once the office set watched_until');
select throws_ok($$ update public.driver_latest set watched_until = null where employee_id = '10000000-0000-0000-0000-0000000000f5' $$,
  '42501', 'permission denied for table driver_latest', 'a driver cannot change watched_until');
-- The history: a driver writes a row with every column the app sends, the way the app sends it: an upsert that ignores
-- a repeat (ON CONFLICT DO NOTHING). On 14 October the two video columns had no insert grant; on 15 October the upsert
-- form still failed because it checks the new row against the SELECT policies and drivers had none on this table.
select lives_ok($$
  insert into public.driver_heartbeats (employee_id, at, session_id, sharing, location_on, permission, battery_pct, app_state, data_available,
    fixes_seen, fixes_stored, dropped_accuracy, dropped_jump, dropped_jitter, dropped_duplicate, last_gps_fix_age_s, queued_points,
    rejected_points, app_version, video_uploads_waiting, video_bytes_waiting, location_restarts)
  values ('10000000-0000-0000-0000-0000000000f5', '2026-10-15 06:12:46+05:30', null, true, true, 'always', 80, 'background', true,
    12, 12, 0, 0, 0, 0, 5, 0, 0, '1.1.0', 1, 12000000, 1)
  on conflict (employee_id, at) do nothing
$$, 'a driver writes a heartbeat history row with every column the app sends, as the app sends it (upsert, repeats ignored)');
select lives_ok($$
  insert into public.driver_heartbeats (employee_id, at, sharing, location_on, permission, queued_points)
  values ('10000000-0000-0000-0000-0000000000f5', '2026-10-15 06:12:46+05:30', true, true, 'always', 0)
  on conflict (employee_id, at) do nothing
$$, 'the same row again (the answer to the first upload was lost) is ignored, not refused');
select is((select count(*) from public.driver_heartbeats), 1::bigint, 'the driver reads their own history row, and only their own');
reset role;
select is((select count(*) from public.driver_heartbeats where employee_id = '10000000-0000-0000-0000-0000000000f5' and video_uploads_waiting = 1), 1::bigint,
  'the history row is there with its video count');
select is((select hb_video_uploads_waiting || '|' || hb_video_bytes_waiting from public.driver_latest where employee_id = '10000000-0000-0000-0000-0000000000f5'),
  '1|12000000', 'driver_latest keeps the counts of the newest heartbeat');

-- 6. The prune job is scheduled.
select is((select count(*) from cron.job where jobname = 'fuel-videos-prune'), 1::bigint, 'the monthly prune is scheduled');

select * from finish();
rollback;
