-- Round 48 item 5 (28 October 2026, Sahan's decision): Google's road-snapped lines are display only and are never
-- stored. route_matched keeps a map-matching provider's answer per driving leg; until now that was Google's Roads
-- API (provider google_roads, kept 30 days by prune_google_content) or a self-hosted OSRM (provider osrm, kept with
-- the location points by the retention job). From now on only OSRM's legs may be stored: Google's answers live in
-- the server's memory for 30 minutes (_shared/fleet/matching.ts googleRoadsStore) and are drawn, never written.
--   1. The Google rows stored so far go.
--   2. The provider check (the inline check of 20261014170000_route_quality.sql, named route_matched_provider_check
--      by Postgres) now allows osrm only, so a google_roads row can never come back by any write path.
--   3. The comments say so. prune_google_content keeps its delete of google_roads rows: a no-op now, kept so the
--      function's answer shape ("matched": 0) and the jobs that read it do not change.

delete from public.route_matched where provider = 'google_roads';

alter table public.route_matched drop constraint if exists route_matched_provider_check;
alter table public.route_matched
  add constraint route_matched_provider_check check (provider in ('osrm'));

comment on table public.route_matched is
  'A driving leg snapped to roads by a map-matching provider we may keep (OSRM only since Round 48; Google''s Roads lines are never stored: they live 30 minutes in the server''s memory); one row per leg start, replaced when the leg grows; removed with the location points by the retention job.';
comment on column public.route_matched.provider is
  'osrm (a self-hosted OSRM /match). google_roads is refused since Round 48: Google''s road-snapped lines are display only.';
