-- =============================================================================
-- Phase 6, Part 3b: the video covers the whole fill (docs/phase6-plan.md, 7.5)
--
--   fuel-videos        per-file limit 250 MB (a 12-minute fill at 1.5 Mbps is about
--                      135 MB; at the default 480p / 1.0 Mbps about 90 MB).
--   fuel_logs          video_segments: a fill recorded in up to three pieces when the
--                      recording was interrupted (a call, the app sent to the back, the
--                      camera taken away): [{path, duration_s, bytes}], the first piece
--                      is video_path; video_interrupted says the office should expect a
--                      break; video_duration_s and video_bytes are the totals.
--   fuel_video_quality     '480p' (default, about 1.0 Mbps) or '720p' (about 1.5 Mbps).
--   fuel_video_keep_months 12 (default) or 6: how long the files stay before the prune.
--   get_driver_settings()  answers the quality too.
-- =============================================================================

update storage.buckets set file_size_limit = 262144000 where id = 'fuel-videos';

alter table public.fuel_logs
  add column video_segments    jsonb,
  add column video_interrupted boolean not null default false;

comment on column public.fuel_logs.video_segments is
  'The pieces of an interrupted recording, in order: [{path, duration_s, bytes}] (the first piece is video_path). Null = one piece.';

grant update (video_segments, video_interrupted) on public.fuel_logs to authenticated;

insert into public.fleet_settings (key, value, updated_by) values
  ('fuel_video_quality', '"480p"'::jsonb, 'migration'),
  ('fuel_video_keep_months', '12'::jsonb, 'migration')
on conflict (key) do nothing;

create or replace function public.get_driver_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'shift_start', coalesce((select value #>> '{}' from public.fleet_settings where key = 'shift_start'), '08:00'),
    'shift_days',  coalesce((select value from public.fleet_settings where key = 'shift_days' and jsonb_typeof(value) = 'array'),
                            '[1, 2, 3, 4, 5, 6]'::jsonb),
    'fuel_video_checklist',
                   coalesce((select value from public.fleet_settings where key = 'fuel_video_checklist' and jsonb_typeof(value) = 'array'),
                            '[{"key": "pump", "en": "Pump display: litres and amount", "si": "පොම්ප තිරය: ලීටර් සහ මුදල"},
                              {"key": "odometer", "en": "Odometer", "si": "ඔඩෝමීටරය"},
                              {"key": "plate", "en": "Number plate", "si": "අංක තහඩුව"}]'::jsonb),
    'fuel_video_quality',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'fuel_video_quality'), '480p')
  )
$$;
