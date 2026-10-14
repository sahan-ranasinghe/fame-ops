-- =============================================================================
-- Heartbeat history: the insert grant covers the video columns (found 14 October 2026)
--
--   route_quality granted drivers INSERT on an explicit list of driver_heartbeats
--   columns; fuel_videos then added video_uploads_waiting / video_bytes_waiting
--   to the table without extending the grant. The app sends both, so every batch
--   of history rows was refused with "permission denied" and no row reached the
--   table: driver_route answered heartbeats: 0 and called every gap "App not
--   running". The grant is extended here; the pgTAP test fuel_videos.test.sql and
--   the connector suite now insert a row as a driver with every column the app
--   sends, so a column added without its grant fails the tests.
-- =============================================================================

grant insert (video_uploads_waiting, video_bytes_waiting) on public.driver_heartbeats to authenticated;
