-- Round 50 (docs/phase8-plan.md §37): office people who drive themselves get the driver flow, and their privacy is
-- enforced here. can_drive (granted by a self-drive task, never over a false), self_drive_mode, drives_with_app / app_trip,
-- a self task accepted when made, driven_in from the app's own start, a duty session only during their own app trip,
-- points only inside it, the session closed when the trip ends, the no-app close only without app activity, and the
-- driver flow unchanged for drivers.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000050a1', 'self.driver@fame.test'),
  ('00000000-0000-0000-0000-0000000050b1', 'no.drive@fame.test'),
  ('00000000-0000-0000-0000-0000000050c1', 'd.r50@drivers.fame.invalid');
insert into public.employees (id, code, name, email, username, role, permissions, active, auth_user_id, can_drive) values
  ('10000000-0000-0000-0000-0000000050a1', 'O-R50A', 'Self Driver', 'self.driver@fame.test', null, 'office', '{view,request}', true, '00000000-0000-0000-0000-0000000050a1', null),
  ('10000000-0000-0000-0000-0000000050b1', 'O-R50B', 'No Drive', 'no.drive@fame.test', null, 'office', '{view,request}', true, '00000000-0000-0000-0000-0000000050b1', false),
  ('10000000-0000-0000-0000-0000000050c1', 'D-R50', 'Round 50 Driver', null, 'd.r50', 'driver', '{}', true, '00000000-0000-0000-0000-0000000050c1', null);
insert into public.vehicles (id, reg_no, make_model, vehicle_type, seats, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000050a1', 'WP R50-0001', 'Toyota Axio', 'car', 4, 1000, true);

-- 1. A self-drive task grants can_drive (never over a false) and is accepted when made.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, created_by, driven_by) values
  ('50000000-0000-0000-0000-0000000050a1', 'Site visit · Kandy', '10000000-0000-0000-0000-0000000050a1', '20000000-0000-0000-0000-0000000050a1', now() + interval '30 minutes', 'Self Driver', 'self'),
  ('50000000-0000-0000-0000-0000000050b1', 'Bank run', '10000000-0000-0000-0000-0000000050b1', '20000000-0000-0000-0000-0000000050a1', now() + interval '3 hours', 'No Drive', 'self');
select is((select can_drive from public.employees where id = '10000000-0000-0000-0000-0000000050a1'), true, 'a self-drive task grants can_drive to an undecided office person');
select is((select can_drive from public.employees where id = '10000000-0000-0000-0000-0000000050b1'), false, 'never over an admin''s false');
select ok((select accepted_at is not null from public.tasks where id = '50000000-0000-0000-0000-0000000050a1'), 'a self-drive task is accepted when made (the person booked it)');
-- A custodian driving a trip someone else booked (the request says custodian) is not granted it.
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000050e1', 'custodian.r50@fame.test');
insert into public.employees (id, code, name, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000050e1', 'O-R50E', 'Pool Keeper', 'custodian.r50@fame.test', 'office', '{view}', true, '00000000-0000-0000-0000-0000000050e1');
insert into public.vehicle_requests (id, requested_by_name, needed_at, route_from, route_to, need_type, pax, status, driven_by, driver_required)
  values ('70000000-0000-0000-0000-0000000050e1', 'Someone Else', now() + interval '1 day', 'Head office', 'Galle', 'car', 1, 'waiting', 'custodian', false);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, created_by, driven_by, request_id) values
  ('50000000-0000-0000-0000-0000000050e1', 'Custodian trip', '10000000-0000-0000-0000-0000000050e1', '20000000-0000-0000-0000-0000000050a1', now() + interval '1 day', 'Admin', 'self', '70000000-0000-0000-0000-0000000050e1');
select is((select can_drive from public.employees where id = '10000000-0000-0000-0000-0000000050e1'), null::boolean,
  'a custodian driving someone else''s booking is not granted can_drive');

-- 2. The one rule.
select ok(public.drives_with_app('10000000-0000-0000-0000-0000000050a1'), 'can_drive office person: drives with the app');
select ok(not public.drives_with_app('10000000-0000-0000-0000-0000000050b1'), 'can_drive false: does not');
select ok(public.drives_with_app('10000000-0000-0000-0000-0000000050c1'), 'a driver: does');
select ok(public.app_trip('self', '10000000-0000-0000-0000-0000000050a1') and not public.app_trip('other', '10000000-0000-0000-0000-0000000050a1')
  and public.app_trip('driver', '10000000-0000-0000-0000-0000000050c1') and not public.app_trip('driver', '10000000-0000-0000-0000-0000000050a1'),
  'app trips: a self trip of someone who drives with the app, a driver''s; never someone else''s');
insert into public.fleet_settings (key, value) values ('self_drive_mode', 'false') on conflict (key) do update set value = excluded.value;
select ok(not public.drives_with_app('10000000-0000-0000-0000-0000000050a1') and public.drives_with_app('10000000-0000-0000-0000-0000000050c1'),
  'self_drive_mode off: office people drive without the app again; drivers unchanged');
delete from public.fleet_settings where key = 'self_drive_mode';

-- 3. As the office self-driver: no duty session before their trip runs.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000050a1","role":"authenticated"}';
select throws_ok($$ insert into public.duty_sessions (employee_id, vehicle_id, started_at)
                    values ('10000000-0000-0000-0000-0000000050a1', '20000000-0000-0000-0000-0000000050a1', now()) $$,
  '42501', null, 'no duty session for an office person before their trip is in progress (no recording outside a trip)');
-- Start task in the app: driven_in app.
select lives_ok($$ update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 1000
                   where id = '50000000-0000-0000-0000-0000000050a1' $$, 'they start their own self trip in the app');
reset role;
select is((select driven_in from public.tasks where id = '50000000-0000-0000-0000-0000000050a1'), 'app', 'the app''s own start says driven_in app');
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000050a1","role":"authenticated"}';
select lives_ok($$ insert into public.duty_sessions (id, employee_id, vehicle_id, started_at)
                   values ('60000000-0000-0000-0000-0000000050a1', '10000000-0000-0000-0000-0000000050a1', '20000000-0000-0000-0000-0000000050a1', now()) $$,
  'with their app trip in progress: the session opens');
select lives_ok($$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m)
                   values ('10000000-0000-0000-0000-0000000050a1', '60000000-0000-0000-0000-0000000050a1', now(), 7.29, 80.63, 8) $$,
  'a point inside the session: stored');
select throws_ok($$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m)
                    values ('10000000-0000-0000-0000-0000000050a1', '60000000-0000-0000-0000-0000000050a1', now() - interval '1 hour', 7.0, 80.0, 8) $$,
  '42501', null, 'a point from before the trip: refused');
select ok((public.send_heartbeat(now(), true, true, 'always') ->> 'on_duty') is not null, 'their phone''s heartbeat is accepted');
select ok(public.my_office_contacts() is not null, 'the task screen''s Call office works for them');
-- Finish: the session closes by itself.
select lives_ok($$ update public.tasks set status = 'completed', completed_at = now(), end_odometer_km = 1042
                   where id = '50000000-0000-0000-0000-0000000050a1' $$, 'they finish the trip');
reset role;
select ok((select ended_at is not null and end_reason = 'auto' from public.duty_sessions where id = '60000000-0000-0000-0000-0000000050a1'),
  'their last running trip ended: the session closed (sharing stops on the server too)');
select ok((select to_at is not null from public.vehicle_assignments where employee_id = '10000000-0000-0000-0000-0000000050a1' order by from_at desc limit 1),
  'and the vehicle is released with it');

-- 4. Without can_drive: never a session, even with a self trip in progress (started by the office path).
update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 1042, driven_in = 'office'
 where id = '50000000-0000-0000-0000-0000000050b1';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000050b1","role":"authenticated"}';
select throws_ok($$ insert into public.duty_sessions (employee_id, vehicle_id, started_at)
                    values ('10000000-0000-0000-0000-0000000050b1', '20000000-0000-0000-0000-0000000050a1', now()) $$,
  '42501', null, 'an office person without the capability: no session');
select throws_ok($$ select public.send_heartbeat(now(), true, true, 'always') $$, 'P0001', null, 'and no heartbeat');
reset role;

-- 5. A driver is unchanged: a session any time, points as before.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000050c1","role":"authenticated"}';
select lives_ok($$ insert into public.duty_sessions (id, employee_id, vehicle_id, started_at)
                   values ('60000000-0000-0000-0000-0000000050c1', '10000000-0000-0000-0000-0000000050c1', null, now() - interval '3 hours') $$,
  'a driver clocks in with no task, as before');
select lives_ok($$ insert into public.location_points (employee_id, session_id, recorded_at, lat, lng, accuracy_m)
                   values ('10000000-0000-0000-0000-0000000050c1', '60000000-0000-0000-0000-0000000050c1', now() - interval '5 hours', 6.9, 79.86, 8) $$,
  'and a driver''s points are not held to the session''s time (an old phone''s late upload)');
reset role;

-- 6. The no-app close runs only without app or web activity.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, created_by, driven_by, status, started_at, start_odometer_km, driven_in) values
  ('50000000-0000-0000-0000-0000000050d1', 'Old app trip', '10000000-0000-0000-0000-0000000050a1', '20000000-0000-0000-0000-0000000050a1', now() - interval '3 days', 'Self Driver', 'self', 'in_progress', now() - interval '3 days', 1100, 'app'),
  ('50000000-0000-0000-0000-0000000050d2', 'Old no-app trip', '10000000-0000-0000-0000-0000000050a1', '20000000-0000-0000-0000-0000000050a1', now() - interval '3 days', 'Self Driver', 'self', 'assigned', null, null, null);
select lives_ok($$ select public.no_app_trips() $$, 'the no-app job runs');
select is((select status from public.tasks where id = '50000000-0000-0000-0000-0000000050d1'), 'in_progress', 'a trip started in the app is left to the app');
select is((select status from public.tasks where id = '50000000-0000-0000-0000-0000000050d2'), 'completed', 'a trip with no app activity closes as before ("not confirmed")');

-- 7. A /m/ trip's actions are their own table (never location points), service role only; the web entries.
select ok(not has_table_privilege('authenticated', 'public.web_trip_actions', 'select')
  and not has_table_privilege('anon', 'public.web_trip_actions', 'select'), 'web_trip_actions: nobody but the service role');
select throws_ok($$ insert into public.web_trip_actions (client_id, task_id, employee_id, action, at, lat, answer)
                    values (gen_random_uuid(), '50000000-0000-0000-0000-0000000050a1', '10000000-0000-0000-0000-0000000050a1', 'arrive', now(), 7.0, '{}') $$,
  '23514', null, 'a position is both coordinates or none');
select ok((select pg_get_constraintdef(oid) from pg_constraint where conname = 'odometer_logs_entry_check') like '%web%'
  and (select pg_get_constraintdef(oid) from pg_constraint where conname = 'vehicle_checks_channel_check') like '%web%',
  'odometer logs and vehicle checks know the web');
select is((select pg_get_constraintdef(oid) from pg_constraint where conname = 'location_points_source_check'), 'CHECK ((source = ''app''::text))',
  'location points stay the app''s alone');

select * from finish();
rollback;
