-- Custodians and one-step booking (Phase 5, part 6), checked with pgTAP.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'd.book@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000000e2', 'custodian.book@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000e1', 'D-BOOK', 'Book Driver', 'd.book', null, 'driver', '{}', '00000000-0000-0000-0000-0000000000e1'),
  ('10000000-0000-0000-0000-0000000000e2', 'C-BOOK', 'Book Custodian', null, 'custodian.book@fame.test', 'office', '{view,request}', '00000000-0000-0000-0000-0000000000e2');
insert into public.vehicles (id, reg_no, custodian_employee_id, custodian_note) values
  ('20000000-0000-0000-0000-0000000000e1', 'WP BOOK-0001', '10000000-0000-0000-0000-0000000000e2', 'Keeps it at Rajagiriya');

-- Columns and the status rule.
select has_column('public', 'vehicles', 'custodian_employee_id', 'vehicles.custodian_employee_id exists');
select has_column('public', 'vehicles', 'custodian_note', 'vehicles.custodian_note exists');
select has_column('public', 'vehicle_requests', 'driver_required', 'vehicle_requests.driver_required exists');
select has_column('public', 'vehicle_requests', 'one_step', 'vehicle_requests.one_step exists');
select has_column('public', 'vehicle_requests', 'seen_at', 'vehicle_requests.seen_at exists');
select has_column('public', 'vehicle_requests', 'requested_by_user_id', 'vehicle_requests.requested_by_user_id exists');
select lives_ok($$
  insert into public.vehicle_requests (id, requested_by_name, needed_at, status, decided_at, decided_by, cancelled_at, cancelled_by, cancel_reason)
  values ('70000000-0000-0000-0000-0000000000e1', 'Someone', now() + interval '1 day', 'cancelled', now(), 'Office', now(), 'Office', 'Not needed')
$$, 'a request can be cancelled (decided_at kept, cancelled_at set)');
select throws_ok($$
  insert into public.vehicle_requests (requested_by_name, needed_at, status, decided_at) values ('Someone', now() + interval '1 day', 'cancelled', now())
$$, '23514', null, 'cancelled needs cancelled_at');
select throws_ok($$
  insert into public.vehicle_requests (requested_by_name, needed_at, status, cancelled_at) values ('Someone', now() + interval '1 day', 'waiting', now())
$$, '23514', null, 'a waiting request has no cancelled_at');
select is((select count(*) from pg_attribute a join pg_class c on c.oid = a.attrelid
           where c.relname = 'vehicles' and a.attname = 'custodian_employee_id'
             and has_column_privilege('authenticated', c.oid, a.attnum, 'SELECT')), 0::bigint,
  'drivers (authenticated) have no privilege on the custodian column');

-- One-step booking: the request and its task in one transaction.
select is((select count(*) from public.vehicle_requests where requested_by_name = 'Book Custodian'), 0::bigint, 'no request yet');
select is(
  (public.office_book_vehicle(
    jsonb_build_object('requested_by_name', 'Book Custodian', 'requested_by_employee_id', '10000000-0000-0000-0000-0000000000e2',
                       'needed_at', (now() + interval '1 day')::text, 'route_to', 'Kandy', 'need_type', 'car', 'pax', 2, 'driver_required', false),
    jsonb_build_object('title', 'Trip · Kandy', 'employee_id', '10000000-0000-0000-0000-0000000000e2', 'vehicle_id', '20000000-0000-0000-0000-0000000000e1',
                       'start_at', (now() + interval '1 day')::text, 'leave_by', (now() + interval '1 day')::text, 'leave_by_source', 'manual', 'created_by', 'Office'),
    '[{"seq": 1, "type": "pickup", "place_name": "Head office"}, {"seq": 2, "type": "drop", "place_name": "Kandy"}]'::jsonb,
    '[]'::jsonb, 'Office') ->> 'request_id') is not null,
  true, 'office_book_vehicle answers the request id and the task id');
select is(
  (select r.status || '|' || r.one_step || '|' || r.driver_required || '|' || (r.seen_by = 'Office') || '|' || (r.decided_by = 'Office') || '|' || (t.request_id = r.id)
   from public.vehicle_requests r join public.tasks t on t.id = r.task_id where r.requested_by_name = 'Book Custodian'),
  'approved|true|false|true|true|true', 'the request is approved, one_step, seen and decided by the booker, linked to its task both ways');
select is((select count(*) from public.task_stops s join public.tasks t on t.id = s.task_id where t.title = 'Trip · Kandy'), 2::bigint, 'with its stops');
select throws_ok($$
  select public.office_book_vehicle(
    jsonb_build_object('requested_by_name', 'Refused Booking', 'needed_at', (now() + interval '1 day')::text),
    jsonb_build_object('title', 'No stops', 'employee_id', '10000000-0000-0000-0000-0000000000e1', 'vehicle_id', '20000000-0000-0000-0000-0000000000e1',
                       'start_at', (now() + interval '1 day')::text, 'created_by', 'Office'),
    '[]'::jsonb, '[]'::jsonb, 'Office')
$$, 'A task needs at least one stop', 'a task that is refused refuses the booking');
select is((select count(*) from public.vehicle_requests where requested_by_name = 'Refused Booking'), 0::bigint, 'and leaves no request behind (one transaction)');

-- A custodian-driven task gets no reminders: no app, no driver.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, leave_by, sent_at, created_by) values
  ('50000000-0000-0000-0000-0000000000e1', 'Custodian drives', '10000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-0000000000e1',
   now() + interval '20 minutes', now() + interval '20 minutes', now() - interval '2 hours', 'test'),
  ('50000000-0000-0000-0000-0000000000e2', 'Driver drives', '10000000-0000-0000-0000-0000000000e1', '20000000-0000-0000-0000-0000000000e1',
   now() + interval '20 minutes', now() + interval '20 minutes', now() - interval '2 hours', 'test');
select is(public.queue_task_reminders(), 1, 'the leave-in-30-minutes reminder goes to the driver only');
select is((select reminder_30_sent_at is null from public.tasks where id = '50000000-0000-0000-0000-0000000000e1'), true, 'the custodian task is left alone');
select is(public.queue_accept_reminders(), 2, 'the accept reminder and, past its window, "needs a driver" go to the driver''s task only');
select ok((select accept_reminder_sent_at is null and needs_driver_since is null from public.tasks where id = '50000000-0000-0000-0000-0000000000e1'),
  'the custodian task gets neither');
select is((select accept_reminder_sent_at is null from public.tasks where id = '50000000-0000-0000-0000-0000000000e1'), true, 'the custodian task is never asked to accept');

select * from finish();
rollback;
