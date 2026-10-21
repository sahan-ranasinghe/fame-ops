-- Round 3, Part A 6: a request still waiting when its trip day is over expires (out of waiting), with an event and one
-- notice to the person who asked; today's and approved ones stay as they are; the job runs every 15 minutes.
begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

select has_column('public', 'vehicle_requests', 'expired_at', 'vehicle_requests.expired_at');
select has_function('public', 'expire_requests', 'expire_requests()');

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000c3e01', 'r3.dilini@fame.test');
insert into public.employees (id, code, name, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-0000000c3e01', 'R3E', 'Dilini Asker', 'r3.dilini@fame.test', 'staff', '{view,request}', true, '00000000-0000-0000-0000-0000000c3e01');
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-0000000c3e01', 'https://push.example/r3-dilini', 'p', 'a');

insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, route_to) values
  ('30000000-0000-0000-0000-0000000c3e01', 'Dilini Asker', '10000000-0000-0000-0000-0000000c3e01', now() - interval '2 days', 'waiting', 'Galle'),
  ('30000000-0000-0000-0000-0000000c3e02', 'Dilini Asker', '10000000-0000-0000-0000-0000000c3e01', now() + interval '1 hour', 'waiting', 'Kandy'),
  ('30000000-0000-0000-0000-0000000c3e03', 'Office', null, now() - interval '3 days', 'waiting', 'Matara');
-- Decided ones on a past day are never touched (Checkpoint 3 review): approved, and an approved booking whose change waits.
insert into public.vehicle_requests (id, requested_by_name, needed_at, status, decided_at, decided_by, changed_at, route_to) values
  ('30000000-0000-0000-0000-0000000c3e04', 'Office', now() - interval '2 days', 'approved', now() - interval '3 days', 'Office', null, 'Kurunegala'),
  ('30000000-0000-0000-0000-0000000c3e05', 'Office', now() - interval '2 days', 'changed', now() - interval '3 days', 'Office', now() - interval '3 days', 'Puttalam');

select is(public.expire_requests(), 2, 'two requests past their day expire (today''s stays)');
select results_eq($$ select id::text, status from public.vehicle_requests where id::text in ('30000000-0000-0000-0000-0000000c3e01', '30000000-0000-0000-0000-0000000c3e02', '30000000-0000-0000-0000-0000000c3e03') order by id $$,
  $$ values ('30000000-0000-0000-0000-0000000c3e01', 'expired'), ('30000000-0000-0000-0000-0000000c3e02', 'waiting'),
            ('30000000-0000-0000-0000-0000000c3e03', 'expired') $$,
  'expired, waiting, expired');
select results_eq($$ select status from public.vehicle_requests where id in ('30000000-0000-0000-0000-0000000c3e04', '30000000-0000-0000-0000-0000000c3e05') order by id $$,
  $$ values ('approved'::text), ('changed'::text) $$, 'an approved booking and a changed one on a past day are left as they are');
select is((select count(*) from public.request_events where action = 'expired' and request_id = '30000000-0000-0000-0000-0000000c3e01'), 1::bigint,
  'the request''s history says it expired');
select is((select count(*) from public.notifications where recipient_employee_id = '10000000-0000-0000-0000-0000000c3e01'
            and payload ->> 'title' like 'Your request expired · %'), 1::bigint, 'the person who asked is told once');
select is(public.expire_requests(), 0, 'the next run finds nothing more');
select is((select count(*) from public.notifications where payload ->> 'title' like 'Your request expired%'), 1::bigint,
  '… and tells nobody again (a request typed in by the office has nobody to tell)');
select throws_ok($$ update public.vehicle_requests set status = 'expired' where id = '30000000-0000-0000-0000-0000000c3e02' $$,
  '23514', NULL, 'expired always has its time');
select ok(exists (select 1 from cron.job where jobname = 'expire-requests' and schedule = '*/15 * * * *'), 'the job runs every 15 minutes');

select * from finish();
rollback;
