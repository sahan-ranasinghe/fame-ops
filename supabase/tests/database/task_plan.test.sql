-- Stops and the leave-by time (Phase 5, part 4), checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d4', 't.plan@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000d4', 'T-PLAN', 'Plan Driver', 't.plan', 'driver', '{}', '00000000-0000-0000-0000-0000000000d4');
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000d4', 'WP PLAN-0001');
insert into public.places (id, name, lat, lng, kind) values ('30000000-0000-0000-0000-0000000000d4', 'Plan office', 6.93, 79.84, 'office');

-- The settings are seeded, with no base place.
select is((select count(*) from public.fleet_settings), 11::bigint, 'eleven settings are seeded (eight dispatch defaults, the fuel video checklist, quality and keep months)');
select is((select value from public.fleet_settings where key = 'base_place_id'), 'null'::jsonb, 'no base place is seeded');
select is((select value -> 'bands' -> 0 ->> 'from' from public.fleet_settings where key = 'rush_hour'), '07:00', 'the rush-hour bands are seeded');

-- A task with its plan and three stops.
select lives_ok($$
  select public.office_create_task(
    '{"title":"South run","employee_id":"10000000-0000-0000-0000-0000000000d4","vehicle_id":"20000000-0000-0000-0000-0000000000d4",
      "start_at":"2026-10-20T01:25:00Z","leave_by":"2026-10-20T01:25:00Z","leave_by_source":"plan","buffer_min":15,
      "start_place_id":"30000000-0000-0000-0000-0000000000d4","start_name":"Plan office","start_lat":6.93,"start_lng":79.84,
      "return_to_base":true,"avoid_expressway":false,"plan_json":{"legs":[],"warnings":[]},"created_by":"test"}'::jsonb,
    '[{"seq":1,"type":"pickup","place_name":"Kalutara","lat":6.5854,"lng":79.9607,"what":"people","dwell_min":10,"planned_arrive_at":"2026-10-20T02:15:00Z","planned_depart_at":"2026-10-20T02:25:00Z"},
      {"seq":2,"type":"drop","place_name":"Galle","lat":6.0329,"lng":80.2168,"what":"people","note":"Gate 2"},
      {"seq":3,"type":"drop","place_name":"Matara","lat":5.9549,"lng":80.555,"what":"people","arrive_by":"2026-10-20T04:30:00Z"}]'::jsonb)
$$, 'office_create_task takes the plan columns and the stop fields');
create temporary table plan_task as select id from public.tasks where title = 'South run';
grant select on plan_task to authenticated;  -- the driver's checks below read it
select is((select leave_by_source || '|' || return_to_base::text || '|' || buffer_min::text || '|' || start_name from public.tasks where id = (select id from plan_task)),
  'plan|true|15|Plan office', 'the plan columns are stored');
select is((select string_agg(seq::text || ':' || coalesce(what, '-') || ':' || coalesce(dwell_min::text, '-'), ',' order by seq) from public.task_stops where task_id = (select id from plan_task)),
  '1:people:10,2:people:-,3:people:-', 'the stops carry what and dwell');
select is((select planned_depart_at from public.task_stops where task_id = (select id from plan_task) and seq = 1), '2026-10-20T02:25:00Z'::timestamptz, 'planned times are stored');
select is((select plan_version from public.tasks where id = (select id from plan_task)), 0, 'a new task is plan version 0');

-- The first stop is done; the office then replaces the pending stops.
update public.task_stops set status = 'done', done_at = now() where task_id = (select id from plan_task) and seq = 1;
select throws_ok($$
  select public.office_update_task_stops((select id from plan_task), 7, '{}'::jsonb, '[]'::jsonb)
$$, 'P0001', null, 'a stale plan version is refused');
select is((select public.office_update_task_stops((select id from plan_task), 0,
  '{"avoid_expressway":true,"leave_by":"2026-10-20T01:40:00Z","leave_by_source":"manual","start_at":"2026-10-20T01:40:00Z","plan_json":{"legs":[1]}}'::jsonb,
  '[{"type":"drop","place_name":"Hikkaduwa","lat":6.14,"lng":80.10,"what":"goods","arrive_by":"2026-10-20T03:30:00Z"},
    {"type":"drop","place_name":"Matara","lat":5.9549,"lng":80.555,"what":"people"}]'::jsonb)), 1, 'the stops are replaced: plan version 1');
select is((select string_agg(seq::text || ':' || place_name || ':' || status, ',' order by seq) from public.task_stops where task_id = (select id from plan_task)),
  '1:Kalutara:done,2:Galle:removed,3:Matara:removed,4:Hikkaduwa:pending,5:Matara:pending',
  'the done stop stays, the pending ones are removed (never deleted), the new ones follow in sequence');
select is((select count(*) from public.task_stops where task_id = (select id from plan_task) and status = 'removed' and removed_at is not null), 2::bigint,
  'removed stops carry removed_at');
select is((select avoid_expressway::text || '|' || leave_by_source || '|' || (start_at = leave_by)::text from public.tasks where id = (select id from plan_task)),
  'true|manual|true', 'the task''s plan columns are updated with the stops');

-- The driver: skips a stop with a reason, cannot set 'removed'.
update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 1000 where id = (select id from plan_task);
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}';
select lives_ok($$
  update public.task_stops set status = 'skipped', skip_reason = 'closed', skip_note = 'Shut on Mondays'
  where task_id = (select id from plan_task) and seq = 4
$$, 'the driver skips a stop with a reason');
select is((select skip_reason from public.task_stops where task_id = (select id from plan_task) and seq = 4), 'closed', 'the reason is stored');
select throws_ok($$
  update public.task_stops set status = 'removed' where task_id = (select id from plan_task) and seq = 5
$$, '42501', null, 'the driver cannot mark a stop removed');
select throws_ok($$
  update public.task_stops set status = 'skipped', skip_reason = 'lost' where task_id = (select id from plan_task) and seq = 5
$$, '23514', null, 'an unknown skip reason is refused');
reset role;

-- Reminders: once each, from the leave-by time.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, created_by) values
  ('50000000-0000-0000-0000-0000000000d4', 'Soon', '10000000-0000-0000-0000-0000000000d4', '20000000-0000-0000-0000-0000000000d4',
   now() + interval '20 minutes', now() + interval '20 minutes', 'test'),
  ('50000000-0000-0000-0000-0000000000d5', 'Long gone', '10000000-0000-0000-0000-0000000000d4', '20000000-0000-0000-0000-0000000000d4',
   now() - interval '3 hours', now() - interval '3 hours', 'test'),
  ('50000000-0000-0000-0000-0000000000d6', 'Tomorrow', '10000000-0000-0000-0000-0000000000d4', '20000000-0000-0000-0000-0000000000d4',
   now() + interval '1 day', now() + interval '1 day', 'test');
select is(public.queue_task_reminders(), 1, 'one reminder: the task leaving in 20 minutes (the old one is only marked, tomorrow waits)');
select is((select reminder_30_sent_at is not null and reminder_0_sent_at is null from public.tasks where id = '50000000-0000-0000-0000-0000000000d4'), true,
  'the 30-minute reminder is marked, the leave-now one is not yet');
select is((select reminder_0_sent_at is not null from public.tasks where id = '50000000-0000-0000-0000-0000000000d5'), true,
  'a leave-by that passed hours ago is marked without a push');
select is((select reminder_30_sent_at from public.tasks where id = '50000000-0000-0000-0000-0000000000d6'), null, 'tomorrow''s task is untouched');
select is(public.queue_task_reminders(), 0, 'running again sends nothing');
update public.tasks set leave_by = now() - interval '1 minute' where id = '50000000-0000-0000-0000-0000000000d4';
select is(public.queue_task_reminders(), 1, 'at the leave-by time the leave-now reminder goes once');
select is(public.queue_task_reminders(), 0, 'and not again');
select lives_ok($$ insert into public.push_log (task_id, employee_id, kind) values ('50000000-0000-0000-0000-0000000000d4', '10000000-0000-0000-0000-0000000000d4', 'leave_30') $$,
  'push_log accepts the leave_30 kind');

-- Service-role-only tables.
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000d4","role":"authenticated"}';
select throws_ok('select count(*) from public.fleet_settings', '42501', null, 'a driver cannot read the fleet settings');
select throws_ok('select count(*) from public.route_legs', '42501', null, 'a driver cannot read the routing cache');
select throws_ok('select count(*) from public.task_eta', '42501', null, 'a driver cannot read the ETAs');
select throws_ok('select public.office_update_task_stops(''50000000-0000-0000-0000-0000000000d4'', 0, ''{}'', ''[]'')', '42501', null,
  'a driver cannot call office_update_task_stops');
reset role;

select * from finish();

rollback;
