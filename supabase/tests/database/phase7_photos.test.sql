-- Phase 7, Part 3, checked with pgTAP (docs/phase7-plan.md §4, §5, §6, §28): the driver's profile photo, a vehicle's
-- photo added by a driver only when it has none, the vehicle documents a driver may read (the three roadside kinds of
-- the vehicle they hold, rows and files), one expiry date both ways, and the person who asked told about their trip.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000ab1', 'p7p.nimal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000000ab2', 'p7p.kamal@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-000000000ab3', 'p7p.asker@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, active, auth_user_id) values
  ('10000000-0000-0000-0000-000000000ab1', 'P7PN', 'Nimal Perera', 'p7p.nimal', null, 'driver', '{}', true, '00000000-0000-0000-0000-000000000ab1'),
  ('10000000-0000-0000-0000-000000000ab2', 'P7PK', 'Kamal Silva', 'p7p.kamal', null, 'driver', '{}', true, '00000000-0000-0000-0000-000000000ab2'),
  ('10000000-0000-0000-0000-000000000ab3', 'P7PA', 'Asha Asker', null, 'p7p.asker@fame.test', 'staff', '{view,request}', true, '00000000-0000-0000-0000-000000000ab3');
insert into public.vehicles (id, reg_no, current_odometer_km, active) values
  ('20000000-0000-0000-0000-000000000ab1', 'WP P7P-0001', 5000, true),
  ('20000000-0000-0000-0000-000000000ab2', 'WP P7P-0002', 7000, true);
insert into public.web_push_subscriptions (employee_id, endpoint, p256dh, auth) values
  ('10000000-0000-0000-0000-000000000ab3', 'https://push.example/p7p-asker', 'p', 'a');

-- 1. The profile photo -------------------------------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';
select lives_ok($$ insert into public.photos (id, employee_id, kind, storage_path) values
  ('50000000-0000-0000-0000-000000000ab1', '10000000-0000-0000-0000-000000000ab1', 'profile', '10000000-0000-0000-0000-000000000ab1/profile/a.jpg') $$,
  'a driver adds a profile photo row in their own profile folder');
select is(public.set_my_photo('50000000-0000-0000-0000-000000000ab1'), 'ok', 'and sets it as their photo');
select is((select photo_id from public.employees where id = '10000000-0000-0000-0000-000000000ab1'), '50000000-0000-0000-0000-000000000ab1'::uuid,
  'they read their own photo id back');
select lives_ok($$ insert into public.photos (id, employee_id, kind, storage_path) values
  ('50000000-0000-0000-0000-000000000ab2', '10000000-0000-0000-0000-000000000ab1', 'odometer', '10000000-0000-0000-0000-000000000ab1/2026-10-17/b.jpg') $$,
  'an odometer photo row');
select is(public.set_my_photo('50000000-0000-0000-0000-000000000ab2'), 'not_yours', 'is not a profile photo');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ab2","role":"authenticated"}';
select is(public.set_my_photo('50000000-0000-0000-0000-000000000ab1'), 'not_yours', 'another driver cannot take Nimal''s photo');
select throws_ok($$ update public.employees set photo_id = '50000000-0000-0000-0000-000000000ab1' where id = '10000000-0000-0000-0000-000000000ab2' $$,
  '42501', null, 'nor write photo_id directly');
reset role;

-- 2. A vehicle's photo: a driver adds one only when it has none ------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('vehicle-photos', '20000000-0000-0000-0000-000000000ab1/full.jpg') $$,
  'a driver uploads a photo of a vehicle that has none');
select is(public.set_vehicle_photo_from_driver('20000000-0000-0000-0000-000000000ab1', '20000000-0000-0000-0000-000000000ab1/full.jpg',
  '20000000-0000-0000-0000-000000000ab1/thumb.jpg'), 'ok', 'and sets it');
select is((select photo_thumb_path from public.vehicles where id = '20000000-0000-0000-0000-000000000ab1'),
  '20000000-0000-0000-0000-000000000ab1/thumb.jpg', 'drivers read the photo columns');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('vehicle-photos', '20000000-0000-0000-0000-000000000ab1/again.jpg') $$,
  '42501', null, 'no second upload once it has one');
select is(public.set_vehicle_photo_from_driver('20000000-0000-0000-0000-000000000ab1', '20000000-0000-0000-0000-000000000ab1/again.jpg',
  '20000000-0000-0000-0000-000000000ab1/again-t.jpg'), 'has_photo', 'nor a replacement through the RPC');
select is(public.set_vehicle_photo_from_driver('20000000-0000-0000-0000-000000000ab2', '20000000-0000-0000-0000-000000000ab1/x.jpg',
  '20000000-0000-0000-0000-000000000ab1/y.jpg'), 'not_this_vehicle', 'the paths must be in the vehicle''s own folder');
select throws_ok($$ update public.vehicles set photo_path = 'x' where id = '20000000-0000-0000-0000-000000000ab2' $$, '42501', null,
  'drivers write no vehicle column');
reset role;

-- 3. Vehicle documents: the three roadside kinds of the vehicle the driver holds ---------------------------------------------
insert into public.duty_sessions (id, employee_id, vehicle_id) values
  ('80000000-0000-0000-0000-000000000ab1', '10000000-0000-0000-0000-000000000ab1', '20000000-0000-0000-0000-000000000ab1');
insert into public.vehicle_documents (id, vehicle_id, kind, path, content_type, expiry, uploaded_at) values
  ('60000000-0000-0000-0000-000000000ab1', '20000000-0000-0000-0000-000000000ab1', 'insurance',
   '20000000-0000-0000-0000-000000000ab1/insurance/a.pdf', 'application/pdf', '2027-03-12', now() - interval '1 day'),
  ('60000000-0000-0000-0000-000000000ab2', '20000000-0000-0000-0000-000000000ab1', 'registration',
   '20000000-0000-0000-0000-000000000ab1/registration/b.jpg', 'image/jpeg', null, now()),
  ('60000000-0000-0000-0000-000000000ab3', '20000000-0000-0000-0000-000000000ab2', 'insurance',
   '20000000-0000-0000-0000-000000000ab2/insurance/c.pdf', 'application/pdf', '2027-01-01', now());
insert into storage.objects (bucket_id, name) values
  ('vehicle-docs', '20000000-0000-0000-0000-000000000ab1/insurance/a.pdf'),
  ('vehicle-docs', '20000000-0000-0000-0000-000000000ab1/registration/b.jpg'),
  ('vehicle-docs', '20000000-0000-0000-0000-000000000ab2/insurance/c.pdf');
select is((select insurance_expiry from public.vehicles where id = '20000000-0000-0000-0000-000000000ab1'), '2027-03-12'::date,
  'the current insurance''s expiry is the vehicle''s insurance date');
update public.vehicles set insurance_expiry = '2027-04-30' where id = '20000000-0000-0000-0000-000000000ab1';
select is((select expiry from public.vehicle_documents where id = '60000000-0000-0000-0000-000000000ab1'), '2027-04-30'::date,
  'and a date set on the vehicle is the current document''s');
select throws_ok($$ insert into public.vehicle_documents (vehicle_id, kind, path, content_type) values
  ('20000000-0000-0000-0000-000000000ab1', 'insurance', '20000000-0000-0000-0000-000000000ab2/insurance/z.pdf', 'application/pdf') $$,
  '23514', null, 'a document''s file is in its own vehicle''s folder for its kind');

set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';
select is(public.my_held_vehicle(), '20000000-0000-0000-0000-000000000ab1'::uuid, 'Nimal holds WP P7P-0001');
select is((select string_agg(kind, ',') from public.vehicle_documents), 'insurance',
  'he reads its insurance: not the registration, not another vehicle''s');
select is((select count(*) from storage.objects where bucket_id = 'vehicle-docs'), 1::bigint, 'and only that file');
select throws_ok($$ select uploaded_by from public.vehicle_documents $$, '42501', null, 'not who uploaded it');
select throws_ok($$ insert into public.vehicle_documents (vehicle_id, kind, path, content_type) values
  ('20000000-0000-0000-0000-000000000ab1', 'insurance', '20000000-0000-0000-0000-000000000ab1/insurance/d.pdf', 'application/pdf') $$,
  '42501', null, 'drivers write no document');
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ab2","role":"authenticated"}';
select is((select count(*) from public.vehicle_documents), 0::bigint, 'Kamal holds no vehicle: no documents');
select is((select count(*) from storage.objects where bucket_id = 'vehicle-docs'), 0::bigint, 'and no files');
reset role;
update public.vehicle_documents set removed_at = now(), removed_by = 'Office', removed_reason = 'removed'
 where id = '60000000-0000-0000-0000-000000000ab1';
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-000000000ab1","role":"authenticated"}';
select is((select count(*) from public.vehicle_documents), 0::bigint, 'a removed document is hidden from the driver');
reset role;
select is((select count(*) from public.vehicle_documents where id = '60000000-0000-0000-0000-000000000ab1'), 1::bigint, 'and kept');

-- 4. The person who asked hears about the trip ----------------------------------------------------------------------------
insert into public.vehicle_requests (id, requested_by_name, requested_by_employee_id, needed_at, status, route_from, route_to) values
  ('30000000-0000-0000-0000-000000000ab1', 'Asha Asker', '10000000-0000-0000-0000-000000000ab3', now() + interval '1 hour', 'waiting', 'Office', 'Galle');
select public.office_create_task(
  jsonb_build_object('title', 'Trip · Galle', 'employee_id', '10000000-0000-0000-0000-000000000ab2', 'vehicle_id', '20000000-0000-0000-0000-000000000ab2',
                     'start_at', now() + interval '1 hour', 'created_by', 'Office'),
  jsonb_build_array(jsonb_build_object('seq', 1, 'type', 'pickup', 'place_name', 'Office'), jsonb_build_object('seq', 2, 'type', 'drop', 'place_name', 'Galle')),
  '[]'::jsonb, '30000000-0000-0000-0000-000000000ab1', 'Office');
create temp table p7p_task as select id from public.tasks where request_id = '30000000-0000-0000-0000-000000000ab1';
update public.tasks set employee_id = '10000000-0000-0000-0000-000000000ab1' where id = (select id from p7p_task);
select is((select payload ->> 'title' from public.notifications where event = 'request.driver_changed'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000ab3'), 'Driver changed: Nimal Perera instead of Kamal Silva',
  'a new driver: "Driver changed: Nimal Perera instead of Kamal Silva"');
update public.tasks set status = 'in_progress', started_at = now(), start_odometer_km = 7000 where id = (select id from p7p_task);
select ok((select payload ->> 'title' from public.notifications where event = 'request.on_the_way'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000ab3') like 'On the way · Nimal · WP P7P-0002',
  'started: "On the way · Nimal · WP P7P-0002"');
select ok((select payload -> 'icon_path' ->> 'path' from public.notifications where event = 'request.on_the_way'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000ab3') = '10000000-0000-0000-0000-000000000ab1/profile/a.jpg',
  'with the driver''s photo for notify-office to sign');
update public.task_stops set arrived_at = now() where task_id = (select id from p7p_task) and seq = 1;
update public.task_stops set auto_detected_at = now() where task_id = (select id from p7p_task) and seq = 1;
select is((select count(*) from public.notifications where event = 'request.arrived'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000ab3'), 1::bigint, 'the first pickup reached: told once');
update public.task_stops set arrived_at = now() where task_id = (select id from p7p_task) and seq = 2;
select is((select count(*) from public.notifications where event = 'request.arrived'), 1::bigint, 'the drop is not the first pickup');
update public.tasks set status = 'cancelled', cancelled_reason = 'Client postponed' where id = (select id from p7p_task);
select is((select payload ->> 'body' from public.notifications where event = 'request.cancelled'
             and recipient_employee_id = '10000000-0000-0000-0000-000000000ab3'), 'Client postponed', 'cancelled: with the reason');

select * from finish();
rollback;
