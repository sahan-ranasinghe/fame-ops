-- Round 52 (docs/phase8-plan.md §40): the bin, checked with pgTAP. A record with history is never deleted; a record without
-- it, and a wrong entry, go into bin_items with what hangs off them and come back as they were with Restore (the links
-- cleared at the delete set back, the vehicle's current reading and a task's reading recalculated, no push for a task
-- coming back); a name taken meanwhile or a link gone refuses the Restore; only the functions write the bin.
-- Run with: npx supabase test db (local database only; everything is rolled back).

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000005b1', 'bin.driver@drivers.fame.invalid'),
  ('00000000-0000-0000-0000-0000000005b2', 'bin.office@fame.test');
insert into public.employees (id, code, name, username, email, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000005b1', 'BIN-D', 'Bin Driver', 'bin.driver', null, 'driver', '{}', '00000000-0000-0000-0000-0000000005b1'),
  ('10000000-0000-0000-0000-0000000005b2', 'BIN-O', 'Bin Office', null, 'bin.office@fame.test', 'office', '{view,request,assign_tasks}', '00000000-0000-0000-0000-0000000005b2');
insert into public.vehicles (id, reg_no) values
  ('20000000-0000-0000-0000-0000000005b1', 'BIN-0001'),
  ('20000000-0000-0000-0000-0000000005b2', 'BIN-0002');

-- A completed task of the driver on BIN-0001, its readings, a fill on it and a stop.
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, started_at, completed_at, start_odometer_km, end_odometer_km, created_by) values
  ('30000000-0000-0000-0000-0000000005b1', 'Bin trip', '10000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005b1',
   now() - interval '3 hours', 'completed', now() - interval '3 hours', now() - interval '1 hour', 1000, 1042, 'test');
insert into public.task_stops (task_id, seq, type, place_name) values ('30000000-0000-0000-0000-0000000005b1', 1, 'drop', 'Kandy');
insert into public.odometer_logs (id, vehicle_id, employee_id, task_id, reading_km, kind, entry, logged_at) values
  ('40000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-0000000005b1', '30000000-0000-0000-0000-0000000005b1', 1000, 'task_start', 'photo', now() - interval '3 hours'),
  ('40000000-0000-0000-0000-0000000005b2', '20000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-0000000005b1', '30000000-0000-0000-0000-0000000005b1', 1042, 'task_end', 'photo', now() - interval '1 hour');
insert into public.photos (id, employee_id, kind, storage_path, fuel_log_id) values
  ('60000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-0000000005b1', 'fuel_receipt', '10000000-0000-0000-0000-0000000005b1/2026-10-31/receipt.jpg', null);
insert into public.fuel_logs (id, vehicle_id, employee_id, task_id, litres, amount_cents, receipt_photo_id, video_path) values
  ('50000000-0000-0000-0000-0000000005b1', '20000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-0000000005b1', '30000000-0000-0000-0000-0000000005b1',
   20, 800000, '60000000-0000-0000-0000-0000000005b1', '10000000-0000-0000-0000-0000000005b1/fill.mp4');
update public.photos set fuel_log_id = '50000000-0000-0000-0000-0000000005b1' where id = '60000000-0000-0000-0000-0000000005b1';
-- The office person's own rows (no history): a pref, a key, an audit entry naming them.
insert into public.office_prefs (employee_id, prefs) values ('10000000-0000-0000-0000-0000000005b2', '{}');
insert into public.office_audit (tool, args_summary, result_summary, actor_employee_id, actor_name, channel)
  values ('fleet_overview', '{}', 'read', '10000000-0000-0000-0000-0000000005b2', 'Bin Office', 'web');

-- 1. What makes history -----------------------------------------------------------------------------------------------------
select is(public.record_history('vehicle', '20000000-0000-0000-0000-0000000005b1') ->> 'tasks', '1', 'a vehicle with a task has history');
select is(public.record_history('vehicle', '20000000-0000-0000-0000-0000000005b2'), '{}'::jsonb, 'a vehicle never used has none');
select ok(public.record_history('driver', '10000000-0000-0000-0000-0000000005b1') ? 'fuel', 'a driver with a fill has history');
select is(public.record_history('office_person', '10000000-0000-0000-0000-0000000005b2'), '{}'::jsonb, 'an office person who only read has none');
select throws_like($$ select public.bin_take('vehicle', '20000000-0000-0000-0000-0000000005b1', null, 'Admin', null) $$,
  'has_history:%', 'a record with history is never deleted (archive instead)');

-- 2. A record without history: out and back ------------------------------------------------------------------------------
select lives_ok($$ select public.bin_take('vehicle', '20000000-0000-0000-0000-0000000005b2', 'registered by mistake', 'Admin', null) $$,
  'a vehicle never used goes into the bin');
select is((select count(*)::int from public.vehicles where reg_no = 'BIN-0002'), 0, 'it is gone from the vehicles');
select is((select label from public.bin_items where record_id = '20000000-0000-0000-0000-0000000005b2'), 'Vehicle · BIN-0002', 'the bin names it');
select ok((select purge_after > now() + interval '29 days' from public.bin_items where record_id = '20000000-0000-0000-0000-0000000005b2'), 'kept 30 days');
-- Its plate taken meanwhile: Restore refuses, nothing changes.
insert into public.vehicles (reg_no) values ('BIN-0002');
select throws_like($$ select public.bin_restore((select id from public.bin_items where record_id = '20000000-0000-0000-0000-0000000005b2')) $$,
  'taken:%', 'a plate taken meanwhile refuses the Restore');
delete from public.vehicles where reg_no = 'BIN-0002';
select lives_ok($$ select public.bin_restore((select id from public.bin_items where record_id = '20000000-0000-0000-0000-0000000005b2')) $$,
  'with the plate free again it comes back');
select is((select count(*)::int from public.vehicles where id = '20000000-0000-0000-0000-0000000005b2'), 1, 'the same vehicle, the same id');
select is((select count(*)::int from public.bin_items where record_id = '20000000-0000-0000-0000-0000000005b2'), 0, 'and it leaves the bin');

-- The office person: their own rows go with them; the audit entry is unlinked, then linked again.
select lives_ok($$ select public.bin_take('office_person', '10000000-0000-0000-0000-0000000005b2', null, 'Admin', null) $$, 'an office person without history');
select is((select count(*)::int from public.office_prefs where employee_id = '10000000-0000-0000-0000-0000000005b2'), 0, 'their prefs go with them');
select is((select actor_name from public.office_audit where actor_name = 'Bin Office' and actor_employee_id is null limit 1), 'Bin Office', 'the activity log keeps the name, unlinked');
select is((select auth_user_id from public.bin_items where record_id = '10000000-0000-0000-0000-0000000005b2'), '00000000-0000-0000-0000-0000000005b2'::uuid, 'the sign-in is noted for the purge');
select lives_ok($$ select public.bin_restore((select id from public.bin_items where record_id = '10000000-0000-0000-0000-0000000005b2')) $$, 'restored');
select is((select count(*)::int from public.office_prefs where employee_id = '10000000-0000-0000-0000-0000000005b2'), 1, 'their prefs are back');
select is((select count(*)::int from public.office_audit where actor_name = 'Bin Office' and actor_employee_id = '10000000-0000-0000-0000-0000000005b2'), 1, 'the activity log entry is theirs again');
select throws_like($$ select public.bin_take('driver', '10000000-0000-0000-0000-0000000005b2', null, 'Admin', null) $$, 'not_found', 'an office person is not a driver');

-- 3. Wrong entries: a fill --------------------------------------------------------------------------------------------------
select lives_ok($$ select public.bin_take('fuel', '50000000-0000-0000-0000-0000000005b1', 'typed twice', 'Admin', null) $$, 'a wrong fill goes');
select is((select count(*)::int from public.fuel_logs where id = '50000000-0000-0000-0000-0000000005b1'), 0, 'the fill is gone');
select is((select count(*)::int from public.photos where id = '60000000-0000-0000-0000-0000000005b1'), 0, 'its receipt photo with it');
select is((select jsonb_array_length(files) from public.bin_items where record_id = '50000000-0000-0000-0000-0000000005b1'), 2, 'its photo and video are noted for the purge');
select is((select reason from public.bin_items where record_id = '50000000-0000-0000-0000-0000000005b1'), 'typed twice', 'with its reason');
select lives_ok($$ select public.bin_restore((select id from public.bin_items where record_id = '50000000-0000-0000-0000-0000000005b1')) $$, 'the fill comes back');
select is((select receipt_photo_id from public.fuel_logs where id = '50000000-0000-0000-0000-0000000005b1'), '60000000-0000-0000-0000-0000000005b1'::uuid, 'with its receipt photo');

-- 4. A task's end reading: the vehicle's reading goes back to the one before; the task keeps the km it recorded ----------
select is((select current_odometer_km from public.vehicles where id = '20000000-0000-0000-0000-0000000005b1'), 1042, 'before: 1,042');
select lives_ok($$ select public.bin_take('odometer', '40000000-0000-0000-0000-0000000005b2', 'wrong photo', 'Admin', null) $$, 'a wrong reading goes');
select is((select current_odometer_km from public.vehicles where id = '20000000-0000-0000-0000-0000000005b1'), 1000, 'the vehicle''s reading is its newest left');
select is((select row(end_odometer_km, km)::text from public.tasks where id = '30000000-0000-0000-0000-0000000005b1'), '(1042,42)', 'the task keeps the km it recorded');
select lives_ok($$ select public.bin_restore((select id from public.bin_items where record_id = '40000000-0000-0000-0000-0000000005b2')) $$, 'the reading comes back');
select is((select count(*)::int from public.odometer_logs where id = '40000000-0000-0000-0000-0000000005b2' and task_id = '30000000-0000-0000-0000-0000000005b1'), 1, 'the reading is the task''s end again');
select is((select current_odometer_km from public.vehicles where id = '20000000-0000-0000-0000-0000000005b1'), 1042, 'and the vehicle''s');

-- 5. A task: its stops go with it, the fill and readings are unlinked; back without a push --------------------------------
select lives_ok($$ select public.bin_take('task', '30000000-0000-0000-0000-0000000005b1', 'test trip', 'Admin', null) $$, 'a wrong task goes');
select is((select count(*)::int from public.task_stops where task_id = '30000000-0000-0000-0000-0000000005b1'), 0, 'its stops with it');
select is((select task_id from public.fuel_logs where id = '50000000-0000-0000-0000-0000000005b1'), null, 'the fill stays, unlinked');
select is((select string_agg(kind || ':' || coalesce(task_id::text, '-'), ',' order by reading_km) from public.odometer_logs where vehicle_id = '20000000-0000-0000-0000-0000000005b1'),
  'manual:-,manual:-', 'its readings stay the vehicle''s, as manual readings');
create temp table push_before as select count(*) n from public.push_log;
select lives_ok($$ select public.bin_restore((select id from public.bin_items where record_id = '30000000-0000-0000-0000-0000000005b1')) $$, 'the task comes back');
select is((select count(*)::int from public.task_stops where task_id = '30000000-0000-0000-0000-0000000005b1'), 1, 'with its stop');
select is((select task_id from public.fuel_logs where id = '50000000-0000-0000-0000-0000000005b1'), '30000000-0000-0000-0000-0000000005b1'::uuid, 'the fill is linked again');
select is((select status from public.tasks where id = '30000000-0000-0000-0000-0000000005b1'), 'completed', 'as it was');
select is((select string_agg(kind, ',' order by reading_km) from public.odometer_logs where task_id = '30000000-0000-0000-0000-0000000005b1'), 'task_start,task_end', 'its readings are its start and end again');
select is((select count(*) from public.push_log), (select n from push_before), 'no push for a task coming back');

-- 6. A running task, the base place, a place in use: refused --------------------------------------------------------------
update public.tasks set status = 'in_progress' where id = '30000000-0000-0000-0000-0000000005b1';
select throws_like($$ select public.bin_take('task', '30000000-0000-0000-0000-0000000005b1', null, 'Admin', null) $$, 'task_running', 'a task under way is not deleted');
insert into public.places (id, name, kind) values ('70000000-0000-0000-0000-0000000005b1', 'Bin Base', 'office'), ('70000000-0000-0000-0000-0000000005b2', 'Bin Spare', 'other');
insert into public.fleet_settings (key, value) values ('base_place_id', to_jsonb('70000000-0000-0000-0000-0000000005b1'::text))
  on conflict (key) do update set value = excluded.value;
select throws_like($$ select public.bin_take('place', '70000000-0000-0000-0000-0000000005b1', null, 'Admin', null) $$, 'base_place', 'the base place is not deleted');
select lives_ok($$ select public.bin_take('place', '70000000-0000-0000-0000-0000000005b2', null, 'Admin', null) $$, 'a place nothing uses is');

-- 7. A link gone: the Restore refuses ------------------------------------------------------------------------------------------
insert into public.rental_companies (id, name) values ('80000000-0000-0000-0000-0000000005b1', 'Bin Rentals');
insert into public.vehicles (id, reg_no, rental_company_id) values ('20000000-0000-0000-0000-0000000005b3', 'BIN-0003', '80000000-0000-0000-0000-0000000005b1');
select lives_ok($$ select public.bin_take('vehicle', '20000000-0000-0000-0000-0000000005b3', null, 'Admin', null) $$, 'a rented vehicle never used');
delete from public.rental_companies where id = '80000000-0000-0000-0000-0000000005b1';
select throws_like($$ select public.bin_restore((select id from public.bin_items where record_id = '20000000-0000-0000-0000-0000000005b3')) $$,
  'gone: public.rental_companies', 'its rental company gone: the Restore says so');

-- 8. The purge's last step and who may call what --------------------------------------------------------------------------
select is(public.bin_forget(array(select id from public.bin_items)), 0, 'nothing is forgotten before its 30 days');
update public.bin_items set purge_after = now() - interval '1 minute' where record_id = '70000000-0000-0000-0000-0000000005b2';
select is(public.bin_forget(array(select id from public.bin_items)), 1, 'after them, it is');
select ok(has_function_privilege('service_role', 'public.bin_take(text, uuid, text, text, uuid)', 'execute')
  and has_function_privilege('service_role', 'public.bin_restore(uuid)', 'execute')
  and has_function_privilege('service_role', 'public.record_history(text, uuid)', 'execute'), 'the tools'' role calls the bin');
select ok(not has_function_privilege('authenticated', 'public.bin_take(text, uuid, text, text, uuid)', 'execute')
  and not has_function_privilege('anon', 'public.bin_restore(uuid)', 'execute'), 'nobody signed in calls it directly');
select ok(not has_function_privilege('service_role', 'public.bin_insert(regclass, jsonb)', 'execute')
  and not has_function_privilege('service_role', 'public.bin_snap(jsonb, regclass, text)', 'execute'), 'the helpers are the functions'' own');
select ok(has_table_privilege('service_role', 'public.bin_items', 'select') and not has_table_privilege('service_role', 'public.bin_items', 'delete')
  and not has_table_privilege('service_role', 'public.bin_items', 'insert'), 'the bin is read, never written, directly');

select * from finish();
rollback;
