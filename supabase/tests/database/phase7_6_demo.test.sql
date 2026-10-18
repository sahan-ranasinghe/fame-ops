-- Phase 7, Part 6 (store readiness), checked with pgTAP: the stores' reviewers' demo driver. seed_demo_driver marks a fresh
-- driver and seeds the tasks (never a driver with real history), the demo flag follows the employee whatever is sent, the
-- demo driver and vehicle never mix with real ones, a real driver never sees the demo vehicle, and the office is told
-- nothing about a demo task.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select vault.create_secret('http://127.0.0.1:54321/functions/v1', 'functions_url');
select vault.create_secret('local-test-server-key-0123456789', 'server_key');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000006d1', 'p6d.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000006d2', 'p6d.review@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000006d3', 'p6d.dispatch@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000006d1', 'P6DK', 'Kamal Perera', 'p6d.kamal', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000006d1'),
  ('10000000-0000-0000-0000-0000000006d2', 'P6DR', 'Store Reviewer', 'p6d.review', null, 'driver', '{}', true, '00000000-0000-0000-0000-0000000006d2'),
  ('10000000-0000-0000-0000-0000000006d3', 'P6DD', 'Dilini Dispatch', null, 'p6d.dispatch@fame.test', 'office', '{view,request,assign_tasks}', true,
   '00000000-0000-0000-0000-0000000006d3');
insert into public.vehicles (id, reg_no, vehicle_type, current_odometer_km, active) values
  ('20000000-0000-0000-0000-0000000006d1', 'WP P6D-0001', 'van', 1000, true);
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, status, sent_at, created_by) values
  ('30000000-0000-0000-0000-0000000006d1', 'P6D real task', '10000000-0000-0000-0000-0000000006d1', '20000000-0000-0000-0000-0000000006d1',
   now() + interval '1 hour', now() + interval '1 hour', 'assigned', now(), 'test');
delete from net.http_request_queue;

-- 1. The seed -------------------------------------------------------------------------------------------------------------
select throws_ok($$ select public.seed_demo_driver('nobody.here', 7) $$, 'P0001', null, 'an unknown username is refused');
select throws_like($$ select public.seed_demo_driver('p6d.kamal', 7) $$, '%a live driver is never made the demo%',
  'a driver with real tasks is never made the demo');
select throws_ok($$ select public.seed_demo_driver('p6d.review', 0) $$, 'P0001', 'p_days: 1 to 60', 'the number of days is checked');
select ok((public.seed_demo_driver('p6d.review', 3) ->> 'tasks_added')::int > 0, 'a fresh driver is made the demo, with tasks');
select is((select count(*) from net.http_request_queue q where q.url like '%push-task%'), 0::bigint,
  'seeding is quiet: no new-task push for the seeded tasks');
select is((select count(*) from public.tasks where employee_id = '10000000-0000-0000-0000-0000000006d2' and accept_reminder_sent_at is null), 0::bigint,
  'and no accept reminder burst at Start work');
select is((select demo from public.employees where username = 'p6d.review'), true, 'the reviewer is marked demo');
select is((select count(*) from public.vehicles where demo and reg_no = 'DEMO-0001'), 1::bigint, 'one demo vehicle');
select is((select count(*) from public.tasks where employee_id = '10000000-0000-0000-0000-0000000006d2' and not demo), 0::bigint,
  'every task of the reviewer is a demo task');
select ok((select bool_and(n = 2) from (select count(*) n from public.task_stops s join public.tasks t on t.id = s.task_id
           where t.employee_id = '10000000-0000-0000-0000-0000000006d2' group by s.task_id) x), 'each with its pickup and drop');
select ok((select min(start_at) from public.tasks where employee_id = '10000000-0000-0000-0000-0000000006d2') > now(),
  'none in the past');
select is((public.seed_demo_driver('p6d.review', 3) ->> 'tasks_added')::int, 0, 'run again: nothing added twice');
select is(public.top_up_demo_tasks(), 0, 'the nightly top-up adds nothing for days that have their tasks');
select is((select count(*) from public.recent_places('Galle Face', now() - interval '1 day')), 0::bigint,
  'the office''s "Used before" search leaves the demo''s stops out');
select is((select demo from public.tasks where id = '30000000-0000-0000-0000-0000000006d1'), false, 'the live driver''s task stays real');

-- 2. Never mixed ----------------------------------------------------------------------------------------------------------
select throws_ok($$ insert into public.tasks (title, employee_id, vehicle_id, start_at, created_by)
                    values ('mix', '10000000-0000-0000-0000-0000000006d1', (select id from public.vehicles where reg_no = 'DEMO-0001'), now(), 'test') $$,
  '23514', null, 'a real driver''s task never takes the demo vehicle');
select throws_ok($$ insert into public.tasks (title, employee_id, vehicle_id, start_at, created_by)
                    values ('mix', '10000000-0000-0000-0000-0000000006d2', '20000000-0000-0000-0000-0000000006d1', now(), 'test') $$,
  '23514', null, 'nor the demo driver a real vehicle');
select throws_ok($$ update public.tasks set employee_id = '10000000-0000-0000-0000-0000000006d2' where id = '30000000-0000-0000-0000-0000000006d1' $$,
  '23514', null, 'a real task is never given to the demo driver');
select throws_ok($$ insert into public.vehicle_assignments (employee_id, vehicle_id, from_at, how)
                    values ('10000000-0000-0000-0000-0000000006d1', (select id from public.vehicles where reg_no = 'DEMO-0001'), now(), 'office') $$,
  '23514', null, 'nobody real holds the demo vehicle');

-- 3. What the phones see and send --------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006d1","role":"authenticated"}';
select lives_ok($$ update public.employees set current_vehicle_id = '20000000-0000-0000-0000-0000000006d1'
                   where id = '10000000-0000-0000-0000-0000000006d1' $$,
  'a real driver still takes a vehicle (the vehicles policy reads the demo flag without looping through employees)');
select is((select count(*) from public.vehicles where reg_no = 'DEMO-0001'), 0::bigint, 'a real driver never sees the demo vehicle');
select ok(not (public.my_vehicle_choices() @> '[{"reg_no": "DEMO-0001"}]'), 'nor is it offered to them');
select ok(public.my_vehicle_choices() @> '[{"reg_no": "WP P6D-0001"}]', 'their own vehicles still are');
reset role;
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006d2","role":"authenticated"}';
select is((select array_agg(reg_no) from public.vehicles), array['DEMO-0001'], 'the reviewer sees only the demo vehicle');
select is((select array_agg(x ->> 'reg_no') from jsonb_array_elements(public.my_vehicle_choices()) x), array['DEMO-0001'],
  'and chooses only it');
insert into public.fuel_logs (vehicle_id, employee_id, litres, amount_cents, demo)
values ((select id from public.vehicles where reg_no = 'DEMO-0001'), '10000000-0000-0000-0000-0000000006d2', 10, 400000, false);
reset role;
select is((select demo from public.fuel_logs where employee_id = '10000000-0000-0000-0000-0000000006d2'), true,
  'the demo flag follows the driver, whatever the phone sends');

-- 4. The office is told nothing about a demo task ------------------------------------------------------------------------------
select is(public.queue_notification('task.declined',
  jsonb_build_object('title', 'x', 'task_id', (select id from public.tasks where employee_id = '10000000-0000-0000-0000-0000000006d2' limit 1)),
  array['10000000-0000-0000-0000-0000000006d3'::uuid]), 0, 'a demo task''s notification is dropped');
select is((select count(*) from public.office_inbox where employee_id = '10000000-0000-0000-0000-0000000006d3'), 0::bigint,
  'and nothing reaches the notification centre');
select is(public.queue_notification('task.declined',
  jsonb_build_object('title', 'x', 'task_id', '30000000-0000-0000-0000-0000000006d1'),
  array['10000000-0000-0000-0000-0000000006d3'::uuid]), 0, 'a real task''s notification still goes (no browser, so no push row)');
select is((select count(*) from public.office_inbox where employee_id = '10000000-0000-0000-0000-0000000006d3'), 1::bigint,
  'it is in the notification centre');

-- 5. Only the server seeds ------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000006d3","role":"authenticated"}';
select throws_ok($$ select public.seed_demo_driver('p6d.review', 1) $$, '42501', null, 'a signed-in person cannot seed');
reset role;

select * from finish();
rollback;
