-- Round 4–7 (Sahan, 22 October 2026): every feature of the round has an on/off switch in Settings → Dispatch, on by default,
-- so the office can switch one off live without a deploy: vehicle_check, trip_close_prompt, fuel_card, passengers,
-- holder_contact. They are fleet_settings rows like every other setting (no row = on). The office reads them through
-- get_settings; the phone through get_driver_settings, which now answers all five (the driver app uses vehicle_check and
-- fuel_card); the server's own jobs and triggers through fleet_switch.

create function public.fleet_switch(p_key text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::boolean from public.fleet_settings s
                    where s.key = p_key and jsonb_typeof(s.value) = 'boolean'), true)
$$;
revoke all on function public.fleet_switch(text) from public, anon, authenticated;
comment on function public.fleet_switch(text) is
  'Round 4–7: a feature switch (vehicle_check, trip_close_prompt, fuel_card, passengers, holder_contact); no row = on.';

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
                            '[1, 2, 3, 4, 5]'::jsonb),
    'fuel_video_checklist',
                   coalesce((select value from public.fleet_settings where key = 'fuel_video_checklist' and jsonb_typeof(value) = 'array'),
                            '[{"key": "plate", "short": "Plate", "en": "Number plate", "si": "අංක තහඩුව"},
                              {"key": "zero", "short": "Zero", "en": "Pump display at zero before pumping", "si": "පොම්ප කිරීමට පෙර පොම්ප තිරය බිංදුවේ"},
                              {"key": "pumping", "short": "Pumping", "en": "Pumping", "si": "පොම්ප කරමින්"},
                              {"key": "final", "short": "Final", "en": "Final pump display: litres and amount", "si": "අවසාන පොම්ප තිරය: ලීටර් සහ මුදල"}]'::jsonb),
    'fuel_video_quality',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'fuel_video_quality'), '480p'),
    -- Phase 7 (§13): Start a trip offers Personal per this setting (allowed, default, off; ask_first behaves as allowed).
    'driver_personal_trips',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'driver_personal_trips'), 'allowed'),
    -- Part 3b (H1): a morning ends and an afternoon starts here.
    'half_day_split',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'half_day_split'), '13:00'),
    -- Part 6: the phones' map follows the office's map package (google | open).
    'map_package',
                   coalesce((select value #>> '{}' from public.fleet_settings where key = 'map_package'), 'google'),
    -- Part 6: how long a phone waits for Google's map to finish loading while online before it uses the free map.
    'phone_map_wait_s',
                   coalesce((select value from public.fleet_settings where key = 'phone_map_wait_s' and jsonb_typeof(value) = 'number'),
                            '30'::jsonb),
    -- Round 4–7: the feature switches (on unless the office switched one off).
    'vehicle_check',     public.fleet_switch('vehicle_check'),
    'trip_close_prompt', public.fleet_switch('trip_close_prompt'),
    'fuel_card',         public.fleet_switch('fuel_card'),
    'passengers',        public.fleet_switch('passengers'),
    'holder_contact',    public.fleet_switch('holder_contact')
  )
$$;
