-- =============================================================================
-- Phase 6, Part 3b addition: the checklist is an ordered sequence of steps
-- (docs/phase6-plan.md, 7.5)
--
--   fuel_video_checklist   the steps in order, the driver ticks each to move to the
--                          next; the last one (the final pump display) unlocks Stop.
--                          Default: 1 Number plate, 2 Pump display at zero before
--                          pumping, 3 Pumping, 4 Final pump display (litres and
--                          amount). `short` is the word on the office's timeline.
--                          Replaced only where the seeded value was never edited.
--   fuel_logs.video_checklist   now [{key, at_s}]: each tick with its second in the
--                          fill (older rows: a list of keys). The office shows them as
--                          a timeline and opens the video at the tapped bookmark.
--   get_driver_settings()  the new default when the setting is missing.
-- =============================================================================

update public.fleet_settings
   set value = '[{"key": "plate", "short": "Plate", "en": "Number plate", "si": "අංක තහඩුව"},
                 {"key": "zero", "short": "Zero", "en": "Pump display at zero before pumping", "si": "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ"},
                 {"key": "pumping", "short": "Pumping", "en": "Pumping", "si": "පොම්ප කරමින්"},
                 {"key": "final", "short": "Final", "en": "Final pump display: litres and amount", "si": "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල"}]'::jsonb
 where key = 'fuel_video_checklist' and updated_by = 'migration';

comment on column public.fuel_logs.video_checklist is
  'The steps ticked while recording, in order, with the second of each in the fill: [{key, at_s}]. Older rows: a list of keys.';

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
                            '[{"key": "plate", "short": "Plate", "en": "Number plate", "si": "අංක තහඩුව"},
                              {"key": "zero", "short": "Zero", "en": "Pump display at zero before pumping", "si": "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ"},
                              {"key": "pumping", "short": "Pumping", "en": "Pumping", "si": "පොම්ප කරමින්"},
                              {"key": "final", "short": "Final", "en": "Final pump display: litres and amount", "si": "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල"}]'::jsonb),
    'fuel_video_quality',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'fuel_video_quality'), '480p')
  )
$$;
