-- Phase 6, Part 4b, checked with pgTAP: places switched off and on, the import
-- record and its undo (a place changed since is left as it is), attaching under
-- any preset key, address and kind, the arrival nudge's column, the map search's
-- calls a minute, the new defaults, and who may do what.
-- Run with: npx supabase test db   (local database only; everything is rolled back)

begin;

create extension if not exists pgtap with schema extensions;

select * from no_plan();

insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000b4', 'd.p4b@drivers.fame.invalid');
insert into public.employees (id, code, name, username, role, permissions, auth_user_id) values
  ('10000000-0000-0000-0000-0000000000b4', 'D-P4B', 'Part 4b Driver', 'd.p4b', 'driver', '{}', '00000000-0000-0000-0000-0000000000b4');
insert into public.place_imports (id, by_name, file_name, preset_key) values
  ('40000000-0000-0000-0000-0000000000b1', 'Test Admin', 'hutch.xlsx', 'custom'),
  ('40000000-0000-0000-0000-0000000000b2', 'Test Admin', 'hutch-again.xlsx', 'custom');

-- 1. An import recorded: the counts add up on the import, every change is kept.
select is((select public.import_place_rows('[
    {"operator": "other", "site_id": "HT0001", "name": "Hutch One", "lat": 7.29, "lng": 80.63, "address": "Kandy", "kind": "store"},
    {"operator": "other", "site_id": "HT0002", "name": "Hutch Two"},
    {"operator": "other", "site_id": "HT0003", "name": "Odd", "kind": "tower"}
  ]'::jsonb, 'custom', '40000000-0000-0000-0000-0000000000b1') - 'skipped'),
  '{"added": 2, "updated": 0, "attached": 0, "unchanged": 0, "no_pin": 1}'::jsonb,
  'a custom import: two added (one without a pin), an unknown kind skipped');
select is((select added || '|' || no_pin || '|' || skipped || '|' || rows from public.place_imports where id = '40000000-0000-0000-0000-0000000000b1'), '2|1|1|3',
  'the counts are added to the import''s record');
select is((select kind || '|' || address from public.places where site_id = 'HT0001'), 'store|Kandy', 'a row''s address and kind are kept');

-- 2. A second import updates one; the first place is then changed by hand.
select is((select public.import_place_rows('[{"operator": "other", "site_id": "HT0002", "name": "Hutch Two (renamed)", "lat": 7.3, "lng": 80.6}]'::jsonb,
  'custom', '40000000-0000-0000-0000-0000000000b2') ->> 'updated'), '1', 'the second import updates Hutch Two');
-- A hand edit later on (one test is one transaction, where now() stands still: the edit's time is moved on by hand).
alter table public.places disable trigger places_ids_text;
update public.places set depot = 'set by hand', updated_at = now() + interval '5 minutes' where site_id = 'HT0001';
alter table public.places enable trigger places_ids_text;

-- 3. Undo the second import: Hutch Two is put back as it was (no pin, the old name); nothing is deleted.
select is((select public.undo_place_import('40000000-0000-0000-0000-0000000000b2', 'Test Admin') - 'left_names'),
  '{"switched_off": 0, "restored": 1, "left_as_is": 0}'::jsonb, 'undo the second import: one place put back');
select is((select name || '|' || coalesce(lat::text, 'no pin') from public.places where site_id = 'HT0002'), 'Hutch Two|no pin', 'Hutch Two is as before the second import');
select throws_ok($$ select public.undo_place_import('40000000-0000-0000-0000-0000000000b2', 'Test Admin') $$, 'P0001', 'This import was already undone', 'an import is undone once');

-- 4. Undo the first import: Hutch Two (as the first import left it again) is switched off; Hutch One, edited by hand since, is left.
select is((select public.undo_place_import('40000000-0000-0000-0000-0000000000b1', 'Test Admin') - 'left_names'),
  '{"switched_off": 1, "restored": 0, "left_as_is": 1}'::jsonb, 'undo the first import: its untouched place switched off, the one edited by hand since left as it is');
select is((select undo_result -> 'left_names' from public.place_imports where id = '40000000-0000-0000-0000-0000000000b1'), '["Hutch One"]'::jsonb,
  'the place left as it is is named');
select is((select active || '|' || depot from public.places where site_id = 'HT0001'), 'true|set by hand', 'Hutch One keeps the hand edit and stays on');

-- 5. An untouched import is undone in full: its added places switched off, left out of the search, back on with a new import.
insert into public.place_imports (id, by_name, preset_key) values ('40000000-0000-0000-0000-0000000000b3', 'Test Admin', 'custom');
select public.import_place_rows('[{"operator": "other", "site_id": "HT0009", "name": "Hutch Nine", "lat": 7.1, "lng": 80.1}]'::jsonb, 'custom', '40000000-0000-0000-0000-0000000000b3');
select is((select public.undo_place_import('40000000-0000-0000-0000-0000000000b3', 'Test Admin') ->> 'switched_off'), '1', 'an untouched import: its added place is switched off');
select is((select active from public.places where site_id = 'HT0009'), false, 'switched off, not deleted');
select is((select count(*) from public.search_places_ranked('HT0009', 5) where site_id = 'HT0009'), 0::bigint, 'a switched-off place is not found (similar ids still are)');
select public.import_place_rows('[{"operator": "other", "site_id": "HT0009", "name": "Hutch Nine"}]'::jsonb, 'custom');
select is((select active from public.places where site_id = 'HT0009'), true, 'importing it again switches it on');

-- 6. Attaching under any key (a custom mapping that asks for it).
insert into public.places (name, kind, operator, site_id, lat, lng, source) values ('Galle Fort', 'site', 'mobitel', 'GAFOR1', 6.0269, 80.2170, 'mobitel_4g');
select is((select public.import_place_rows('[{"operator": "mobitel", "site_id": "GAL777", "name": "GAL777", "lat": 6.02695, "lng": 80.21705}]'::jsonb, 'custom', null, 50) ->> 'attached'), '1',
  'a custom import with attach 50 m attaches the id to the site 7 m away');
select throws_ok($$ select public.import_place_rows('[]'::jsonb, 'custom', null, 5000) $$, 'P0001', 'attach_m: 1 to 1000 metres', 'attach is 1 to 1000 m');

-- 7. The map search's calls a minute.
select is(public.bump_minute_calls('ors_autocomplete'), 1, 'the first call this minute is number 1');
select is(public.bump_minute_calls('ors_autocomplete'), 2, 'the second is number 2');
select is(public.bump_minute_calls('other_provider'), 1, 'each provider counts on its own');

-- 8. Settings.
select is((select value from public.fleet_settings where key = 'ors_autocomplete_per_minute'), '90'::jsonb, 'the map search''s calls a minute: 90');
select is((select value from public.fleet_settings where key = 'ors_autocomplete_daily_cap'), '2500'::jsonb, 'the daily cap: 2500');
select is(public.get_driver_settings() -> 'shift_days', '[1, 2, 3, 4, 5]'::jsonb, 'the shift nudge: Monday to Friday by default');

-- 9. The arrival nudge's column: the driver writes it on a stop of their task in progress, not on another's.
insert into public.vehicles (id, reg_no) values ('20000000-0000-0000-0000-0000000000b4', 'WP P4B-0001');
insert into public.tasks (id, title, employee_id, vehicle_id, start_at, status, started_at, start_odometer_km, created_by) values
  ('30000000-0000-0000-0000-0000000000b4', 'Running', '10000000-0000-0000-0000-0000000000b4', '20000000-0000-0000-0000-0000000000b4', now(), 'in_progress', now(), 1000, 'test');
insert into public.task_stops (id, task_id, seq, type, place_name, lat, lng) values
  ('50000000-0000-0000-0000-0000000000b4', '30000000-0000-0000-0000-0000000000b4', 1, 'drop', 'Kandy', 7.29, 80.63);
set local role authenticated;
set local request.jwt.claims to '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}';
select lives_ok($$ update public.task_stops set auto_detected_at = now() where id = '50000000-0000-0000-0000-0000000000b4' $$, 'the driver records the arrival nudge''s time on their stop');
select throws_ok($$ select * from public.place_imports $$, '42501', null, 'a driver cannot read the imports');
select throws_ok($$ select public.bump_minute_calls('x') $$, '42501', null, 'nor count calls');
select throws_ok($$ select public.undo_place_import('40000000-0000-0000-0000-0000000000b1', 'me') $$, '42501', null, 'nor undo an import');
reset role;
select ok((select auto_detected_at is not null from public.task_stops where id = '50000000-0000-0000-0000-0000000000b4'), 'the time is on the stop');

select * from finish();
rollback;
