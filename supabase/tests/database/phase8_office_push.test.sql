-- Phase 8, O1 item 9 (19 October 2026), checked with pgTAP: an office person's notifications also go to their phone.
-- queue_notification writes an 'expo_push' outbox row for an office recipient whose phone registered a token (and the
-- Web Push row as before for a browser), none for a person without a token, none for a driver's token, none for an event
-- the person switched off; the notification centre row is unchanged.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000080a', 'p8.approver@fame.test'),
  ('00000000-0000-0000-0000-00000000080b', 'p8.laptop@fame.test'),
  ('00000000-0000-0000-0000-00000000080c', 'p8.driver@drivers.fame.invalid');
insert into public.employees (id, code, name, email, username, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-00000000080a', 'P8A', 'Palitha Phone', 'p8.approver@fame.test', null, 'fleet_admin', '{view,approve}', true, '00000000-0000-0000-0000-00000000080a'),
  ('10000000-0000-0000-0000-00000000080b', 'P8B', 'Lakshmi Laptop', 'p8.laptop@fame.test', null, 'fleet_admin', '{view,approve}', true, '00000000-0000-0000-0000-00000000080b'),
  ('10000000-0000-0000-0000-00000000080c', 'P8C', 'Kamal Driver', null, 'p8.driver', 'driver', '{}', true, '00000000-0000-0000-0000-00000000080c');

-- The phone's token (the office app registers at sign-in), the laptop's browser, the driver's phone.
insert into public.device_tokens (employee_id, token, platform) values
  ('10000000-0000-0000-0000-00000000080a', 'ExponentPushToken[p8-approver-phone]', 'android'),
  ('10000000-0000-0000-0000-00000000080c', 'ExponentPushToken[p8-driver-phone]', 'android');
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-00000000080b', 'https://push.test/p8-laptop', 'k', 'a');

-- 1. The constraint takes the new channel -------------------------------------------------------------------------------
select lives_ok($$ insert into public.notifications (event, payload, recipient_employee_id, channel)
                   values ('request.created', '{"title":"x"}', '10000000-0000-0000-0000-00000000080a', 'expo_push') $$,
  'an expo_push row is allowed');
select throws_ok($$ insert into public.notifications (event, payload, recipient_employee_id, channel)
                    values ('request.created', '{"title":"x"}', '10000000-0000-0000-0000-00000000080a', 'sms') $$,
  '23514', null, 'an unknown channel is refused');
delete from public.notifications where recipient_employee_id = '10000000-0000-0000-0000-00000000080a';

-- 2. One request comes in: the phone gets an expo_push row, the laptop a web_push row, the driver nothing -----------------
select is(public.queue_notification('request.created', '{"title":"Site visit · Kurunegala","body":"Nimali asks","url":"/requests/x/decide"}',
  array['10000000-0000-0000-0000-00000000080a', '10000000-0000-0000-0000-00000000080b', '10000000-0000-0000-0000-00000000080c']::uuid[]), 2,
  'two outbox rows: the phone and the browser');
select results_eq($$ select recipient_employee_id::text, channel, status from public.notifications order by channel $$,
  $$ values ('10000000-0000-0000-0000-00000000080a', 'expo_push', 'queued'), ('10000000-0000-0000-0000-00000000080b', 'web_push', 'queued') $$,
  'the phone''s row is expo_push, the browser''s web_push, both queued');
select is((select count(*) from public.notifications where recipient_employee_id = '10000000-0000-0000-0000-00000000080c'), 0::bigint,
  'a driver''s token gets no office notification');
select is((select count(*) from public.office_inbox where event = 'request.created'
           and employee_id in ('10000000-0000-0000-0000-00000000080a', '10000000-0000-0000-0000-00000000080b')), 2::bigint,
  'the notification centre rows as before (both office people)');
select is((select payload ->> 'url' from public.notifications where channel = 'expo_push'), '/requests/x/decide',
  'the phone''s row carries the link the app opens');

-- 3. The event switched off: nothing on either channel -----------------------------------------------------------------
insert into public.notification_settings (employee_id, event, enabled) values ('10000000-0000-0000-0000-00000000080a', 'task.declined', false);
delete from public.notifications;
select is(public.queue_notification('task.declined', '{"title":"Kamal declined"}', array['10000000-0000-0000-0000-00000000080a']::uuid[]), 0,
  'an event the person switched off goes nowhere');
select is((select count(*) from public.notifications), 0::bigint, 'no outbox row');

-- 4. The token removed (sign-out): no more phone rows ----------------------------------------------------------------
delete from public.device_tokens where employee_id = '10000000-0000-0000-0000-00000000080a';
select is(public.queue_notification('request.created', '{"title":"Another"}', array['10000000-0000-0000-0000-00000000080a']::uuid[]), 0,
  'without a token (and no browser) the person has only the notification centre');
select is((select count(*) from public.office_inbox where employee_id = '10000000-0000-0000-0000-00000000080a' and title = 'Another'), 1::bigint,
  'and that row is there');

select * from finish();
rollback;
