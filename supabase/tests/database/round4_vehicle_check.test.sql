-- Round 4–7, feature 4a (22 October 2026): the vehicle check before work. A driver writes and reads only their own checks;
-- a pre-trip report is the same driver's check of the same vehicle; Damage is a category; the four side photos link to the
-- driver's own check; ONE notification per check with a problem (urgent for breakdown and accident), none for all good.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_table('public', 'vehicle_checks', 'vehicle_checks');
select has_column('public', 'vehicle_reports', 'check_id', 'vehicle_reports.check_id');
select has_column('public', 'photos', 'vehicle_check_id', 'photos.vehicle_check_id');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000c4a01', 'r4.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000c4a02', 'r4.nuwan@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c4a01', 'R4K', 'Kamal Driver', 'r4.kamal', 'driver', '{}', true, '00000000-0000-0000-0000-0000000c4a01'),
  ('10000000-0000-0000-0000-0000000c4a02', 'R4N', 'Nuwan Driver', 'r4.nuwan', 'driver', '{}', true, '00000000-0000-0000-0000-0000000c4a02');
insert into public.employees (id, code, name, email, role, permissions, active) values
  ('10000000-0000-0000-0000-0000000c4a03', 'R4I', 'Ishara Issues', 'r4.ishara@fame.test', 'office', '{view,issues}', true),
  ('10000000-0000-0000-0000-0000000c4a04', 'R4V', 'Viewer Only', 'r4.viewer@fame.test', 'viewer', '{view}', true);
insert into public.vehicles (id, reg_no, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000c4a01', 'WP R4-0001', 5000, true),
  ('20000000-0000-0000-0000-0000000c4a02', 'WP R4-0002', 9000, true);

-- As Kamal (the driver app).
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c4a01","role":"authenticated"}';
select lives_ok($$ insert into public.vehicle_checks (id, vehicle_id, employee_id, checked_at, result, odometer_km, how)
  values ('30000000-0000-0000-0000-0000000c4a01', '20000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a01',
          now(), 'ok', 5010, 'clock_in') $$, 'the driver records an all-good check');
select throws_ok($$ insert into public.vehicle_checks (id, vehicle_id, employee_id, checked_at, result, how)
  values (gen_random_uuid(), '20000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a02', now(), 'ok', 'change') $$,
  '42501', NULL, 'never another driver''s check');
select throws_ok($$ insert into public.vehicle_checks (id, vehicle_id, employee_id, checked_at, result, how, channel)
  values (gen_random_uuid(), '20000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a01', now(), 'ok', 'change', 'office') $$,
  '42501', NULL, 'the channel is not the driver''s to set');
select throws_ok($$ insert into public.vehicle_checks (id, vehicle_id, employee_id, checked_at, result, how)
  values (gen_random_uuid(), '20000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a01', now() + interval '1 day', 'ok', 'change') $$,
  '23514', NULL, 'never a check from the future');
select lives_ok($$ insert into public.vehicle_checks (id, vehicle_id, employee_id, checked_at, result, how)
  values ('30000000-0000-0000-0000-0000000c4a02', '20000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a01', now(), 'problem', 'task_start') $$,
  'and a check with a problem');
select lives_ok($$ insert into public.vehicle_reports (id, vehicle_id, employee_id, category, note, check_id)
  values ('40000000-0000-0000-0000-0000000c4a01', '20000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a01',
          'damage', 'Dent on the rear door', '30000000-0000-0000-0000-0000000c4a02') $$,
  'its pre-trip report: Damage, with the check');
select throws_ok($$ insert into public.vehicle_reports (id, vehicle_id, employee_id, category, check_id)
  values (gen_random_uuid(), '20000000-0000-0000-0000-0000000c4a02', '10000000-0000-0000-0000-0000000c4a01',
          'tyre', '30000000-0000-0000-0000-0000000c4a02') $$,
  '23514', NULL, 'a pre-trip report is of the check''s own vehicle');
select lives_ok($$ insert into public.photos (id, employee_id, kind, storage_path, vehicle_check_id, side)
  values ('50000000-0000-0000-0000-0000000c4a01', '10000000-0000-0000-0000-0000000c4a01', 'vehicle_check',
          '10000000-0000-0000-0000-0000000c4a01/2026-10-22/front.jpg', '30000000-0000-0000-0000-0000000c4a01', 'front') $$,
  'a side photo of the driver''s own check');
select results_eq($$ select count(*)::int from public.vehicle_checks $$, $$ values (2) $$, 'the driver reads their own checks');
reset role;

-- As Nuwan: he sees none of Kamal's checks, and cannot link a photo to them.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000c4a02","role":"authenticated"}';
select results_eq($$ select count(*)::int from public.vehicle_checks $$, $$ values (0) $$, 'another driver reads none of them');
select throws_ok($$ insert into public.photos (id, employee_id, kind, storage_path, vehicle_check_id, side)
  values (gen_random_uuid(), '10000000-0000-0000-0000-0000000c4a02', 'vehicle_check',
          '10000000-0000-0000-0000-0000000c4a02/2026-10-22/x.jpg', '30000000-0000-0000-0000-0000000c4a01', 'back') $$,
  '42501', NULL, 'never a photo on another driver''s check');
reset role;

-- One notification per problem check, normal for damage, to the issues people only; none for all good.
select results_eq($$ select count(*)::int from public.office_inbox where event in ('vehicle.check_problem', 'vehicle.check_urgent') $$,
  $$ values (1) $$, 'one notification for the one problem check');
select results_eq($$ select event, employee_id from public.office_inbox where event like 'vehicle.check%' $$,
  $$ values ('vehicle.check_problem'::text, '10000000-0000-0000-0000-0000000c4a03'::uuid) $$,
  'damage is normal, and only the issues permission hears it');
select ok((select title from public.office_inbox where event = 'vehicle.check_problem') like 'Pre-trip check: Damage%',
  'the notice says Pre-trip check: Damage');

-- A breakdown is urgent.
insert into public.vehicle_checks (id, vehicle_id, employee_id, checked_at, result, how)
  values ('30000000-0000-0000-0000-0000000c4a03', '20000000-0000-0000-0000-0000000c4a02', '10000000-0000-0000-0000-0000000c4a02', now(), 'problem', 'change');
insert into public.vehicle_reports (vehicle_id, employee_id, category, check_id)
  values ('20000000-0000-0000-0000-0000000c4a02', '10000000-0000-0000-0000-0000000c4a02', 'breakdown', '30000000-0000-0000-0000-0000000c4a03');
select results_eq($$ select count(*)::int from public.office_inbox where event = 'vehicle.check_urgent' $$, $$ values (1) $$,
  'a breakdown found before work is urgent');

-- A report not from a check tells nobody this way (the issue's own rules do).
insert into public.vehicle_reports (vehicle_id, employee_id, category) values
  ('20000000-0000-0000-0000-0000000c4a02', '10000000-0000-0000-0000-0000000c4a02', 'tyre');
select results_eq($$ select count(*)::int from public.office_inbox where event like 'vehicle.check%' $$, $$ values (2) $$,
  'an ordinary report sends no check notice');

select * from finish();
rollback;
