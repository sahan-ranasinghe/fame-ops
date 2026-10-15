-- =============================================================================
-- Phone health (15 October 2026, docs/phase6-plan.md 7.5)
--
-- 1. driver_heartbeats had never held a row on the live project. The app uploads
--    the history as an upsert that ignores duplicates (INSERT ... ON CONFLICT DO
--    NOTHING through PostgREST), so a second upload of the same batch after a
--    lost answer is harmless. In Postgres that form also checks the new row
--    against the table's SELECT policies, and drivers had none on this table
--    (only an INSERT policy): every batch was refused with "new row violates
--    row-level security policy". location_points, photos and the logs work
--    because drivers may read their own rows there. The same rule here: a driver
--    reads their own heartbeat history. The phones (1.1.0+01a13a6e) kept every
--    refused batch as rejected and put it back in line on pull to refresh, after
--    an app update and once a day, so the rows since 14 October 18:05 arrive.
-- 2. location_restarts: how often the phone's watchdog restarted the location
--    service since the previous heartbeat (no position for 90 s while moving).
-- =============================================================================

create policy driver_heartbeats_select_own on public.driver_heartbeats
  for select to authenticated
  using (employee_id = (select public.current_employee_id()));

alter table public.driver_heartbeats add column location_restarts integer;
comment on column public.driver_heartbeats.location_restarts is
  'How often the phone restarted the location service since the previous heartbeat: no position for 90 s while moving (the battery manager had frozen it).';
grant insert (location_restarts) on public.driver_heartbeats to authenticated;
