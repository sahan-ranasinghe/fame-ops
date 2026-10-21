// Hotfix O2-H2, Part 3: selected state visible everywhere. Every audited screen of the driver app and Office mode picks
// with the shared controls (src/components/patterns/Select.tsx: SelectableRow, ChoiceRow / ChoiceCard, ChoiceChip(s),
// Checkbox, Radio, SelectMark, pickedStyle) and no screen keeps a home-made picked style of its own (a dark fill with white
// words and no mark: chipOn, optionOn, presetOn, kindOn, speedOn, timeOn). Read as text, no phone:
//   npm run test:select          (from apps/driver)
// The component tests (tests/select.test.tsx, npm run test:components) prove what the controls draw.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

let failed = 0;
function check(ok: unknown, label: string, detail?: unknown) {
  if (ok) console.log(`  PASS  ${label}`);
  else {
    failed++;
    console.log(`  FAIL  ${label}${detail === undefined ? '' : `   ${JSON.stringify(detail)}`}`);
  }
}
const read = (path: string) => readFileSync(join(__dirname, '..', 'src', path), 'utf8');

console.log('\n== The shared controls ==');
{
  const select = read('components/patterns/Select.tsx');
  for (const name of ['SelectMark', 'SelectableRow', 'ChoiceRow', 'ChoiceCard', 'ChoiceChip', 'ChoiceChips', 'Checkbox', 'Radio']) {
    check(new RegExp(`export function ${name}\\b`).test(select), `Select.tsx exports ${name}`);
  }
  check(/on: colors\.blue/.test(select) && /tint: colors\.blueChip/.test(select) && /border: 2/.test(select), 'picked = blue #1e4fa0 on the blue chip tint #e6edf8 with a 2 px border (theme.ts)');
  check(/accessibilityRole="checkbox"[\s\S]*?accessibilityState=\{\{ checked: selected, selected, disabled \}\}/.test(select), 'SelectableRow: role checkbox, state checked / selected / disabled');
  check(/accessibilityRole="radio"[\s\S]*?accessibilityState=\{\{ checked: selected, selected, disabled \}\}/.test(select), 'ChoiceRow: role radio, state checked / selected / disabled');
  check(/accessibilityRole=\{multi \? 'checkbox' : 'radio'\}/.test(select), 'ChoiceChip: radio (one of a few) or checkbox (a filter among others)');
  check((select.match(/disabled=\{disabled\}/g) ?? []).length >= 4 && (select.match(/disabledReason \?/g) ?? []).length >= 4 && /accessibilityHint=\{disabled \? disabledReason/.test(select),
    'a disabled control is not pressable and says why (under the words and to TalkBack)');
  check(/\{selected && corner \?[\s\S]*?: selected \?[\s\S]*?<Check/.test(select), 'a picked chip always has its check (before the words, or in the corner of a narrow tile)');
  const ui = read('components/ui.tsx');
  check(/accessibilityRole="radio"\s+accessibilityState=\{\{ checked: on, selected: on \}\}/.test(ui) && /\{on && <Check /.test(ui) && /segmentOn: \{ backgroundColor: colors\.blueChip, borderColor: colors\.blue \}/.test(ui),
    'Segmented (ui.tsx): the picked segment has a check, the tint and the border; radio role');
  const lang = read('components/LanguageSwitch.tsx');
  check(/\{on && <Check /.test(lang) && /accessibilityRole="radio"/.test(lang) && /optionOn: \{ backgroundColor: colors\.blueChip, borderColor: colors\.blue \}/.test(lang), 'the language switch: check, tint, border, radio role');
}

console.log('\n== Every audited screen uses them ==');
const uses: [string, RegExp, string][] = [
  ['components/office/AskDriversSheet.tsx', /<SelectableRow[\s\S]*?selected=\{on\}[\s\S]*?disabledReason=/, 'Ask drivers: the drivers as SelectableRows (the circle fills with a check), with the reason on a row without an account'],
  ['components/office/AskDriversSheet.tsx', /<ChoiceCard selected=\{on\}/, 'Ask drivers: the question type as ChoiceCards with a radio'],
  ['components/office/AskDriversSheet.tsx', /setPicked\(allFree\(drivers\)\)[\s\S]*?setPicked\(\[\]\)/, 'Ask drivers: "N picked" with All free · None kept'],
  ['components/office/DriverRows.tsx', /<ChoiceRow[\s\S]*?selected=\{on\}[\s\S]*?mark="end"/, 'Who\'s available (Who step, Change the task): ChoiceRow, the radio after the avatar'],
  ['app/office/task/[id]/driver.tsx', /<ChoiceRow[\s\S]*?disabledReason=\{declined \?/, 'Give it a driver: ChoiceRow; the driver who declined is greyed with the reason'],
  ['app/office/request/[id].tsx', /<ChoiceRow[\s\S]*?selected=\{on\}/, 'Approve a request: Who\'s available as ChoiceRows'],
  ['app/office/trip/who.tsx', /<View key=\{v\.reg_no\}[\s\S]*?<ChoiceRow selected=\{shown === v\.reg_no\}[\s\S]*?disabledReason=\{reason\}[\s\S]*?<\/ChoiceRow>[\s\S]*?accessibilityRole="button"/, 'Who step: the vehicles as ChoiceRows; a busy / in-garage group says why; the custodian\'s Call / WhatsApp under the row, not in it'],
  ['app/office/trip/who.tsx', /<ChoiceChip label=\{t\('office\.trip\.onTheDay'\)\}/, 'Who step: On the day / Any van / the driver\'s vehicle / Choose as ChoiceChips'],
  ['app/office/trip/who.tsx', /<ChoiceChip key=\{o\.username\} label=\{o\.name\}/, 'Who step (Book now): the free drivers as ChoiceChips'],
  ['app/office/trip/when.tsx', /<TripDayPicker /, 'When step: the day is Stage 0\'s TripDayPicker (its chips below)'],
  ['components/patterns/Calendar.tsx', /<ChoiceChip key=\{key\} label=\{label\} selected=\{on\}/, 'TripDayPicker: Today / Tomorrow / the day picked as ChoiceChips'],
  ['components/patterns/Calendar.tsx', /<ChoiceChip key=\{k\} small label=\{t\(`patterns\.preset_\$\{k\}`\)\} selected=\{on\}/, 'The date range\'s presets as ChoiceChips'],
  ['components/patterns/Calendar.tsx', /styles\.stripDay, on && pickedStyle/, 'The day strip: the picked day with the tint and the border'],
  ['components/patterns/TimeDial.tsx', /accessibilityState=\{\{ selected: mode === 'hour' \}\}[\s\S]*?mode === 'hour' && styles\.partOn/, 'The clock: the part being set (hour or minute) with the selection tint (21 October 2026: the clock replaced the time list)'],
  ['components/patterns/FilterBar.tsx', /<Checkbox key=\{o\.value\}[\s\S]*?<Radio key=\{o\.value\}[\s\S]*?<Radio key=\{o\.value\} checked=\{o\.value === sort\.value\}/, 'The Filter sheet\'s options and the sort list as the shared Checkbox / Radio'],
  ['components/patterns/DurationField.tsx', /<ChoiceChip key=\{min\}/, 'Stay at a stop: the sheet\'s presets as ChoiceChips (the When step\'s Stay field)'],
  ['app/office/trip/where.tsx', /<ChoiceChip key=\{type\} small/, 'Where step: the stop type as ChoiceChips'],
  ['app/office/trip/where.tsx', /<ChoiceChip key=\{w\} small/, 'Where step: people / goods / documents as ChoiceChips'],
  ['app/office/task/[id]/time.tsx', /<ChoiceChip key=\{key\} selected=\{on\}/, 'Change the task: the day and vehicle chips'],
  ['app/office/task/[id]/time.tsx', /<ChoiceRow key=\{v\.reg_no\}/, 'Change the task: the vehicles as ChoiceRows'],
  ['app/office/task/[id]/swap.tsx', /<ChoiceRow key=\{r\.reg_no\} selected=\{on\}[\s\S]*?disabled=\{r\.disabled\}/, 'Swap vehicle: ChoiceRows, the ones that cannot go greyed'],
  ['components/office/Controls.tsx', /<ChoiceChips /, 'Controls.Chips (vehicle type, purpose, …) is the shared ChoiceChips'],
  ['office/ui.tsx', /<ChoiceChip key=\{o\.key\}/, 'FilterChips (Tasks, Requests, Issues, Reports, Vehicles, Drivers, Alerts, My trips) are ChoiceChips'],
  ['app/office/(tabs)/drivers.tsx', /<ChoiceChip key=\{k\} onDark label/, 'Drivers tab: Now / Week as ChoiceChips on the dark header'],
  ['app/office/(tabs)/drivers.tsx', /<FilterBar/, 'Drivers tab: the board filters are Stage 0\'s FilterBar (its sheet checked above)'],
  ['app/office/(tabs)/drivers.tsx', /<ChoiceChips options=\{options\}/, 'Drivers tab, Not available sheet: the part of the day and the reason as ChoiceChips'],
  ['components/office/PlaybackBar.tsx', /<ChoiceChip key=\{s\} small mono/, 'The shared playback bar (Live, a driver\'s day): the speed as ChoiceChips'],
  ['app/office/(tabs)/live.tsx', /selected && pickedStyle/, 'Live: the row shown on the map gets the tint and the border'],
  ['components/office/DayRoute.tsx', /on && pickedStyle/, 'The shared day route (a driver\'s page): the timeline row shown on the map gets the tint and the border'],
  ['app/office/vehicles/form.tsx', /<ChoiceChips</, 'Vehicle form: the type, the rental company, the regular driver as ChoiceChips'],
  ['app/office/people/settings.tsx', /<ChoiceRow[\s\S]*?testID=\{`personal-trips-\$\{v\}`\}/, 'Quick settings: personal trips as ChoiceRows'],
  ['components/office/PeopleParts.tsx', /<ChoiceChip key=\{key\}/, 'Office users / drivers: the permission presets as ChoiceChips'],
  ['components/office/PeopleParts.tsx', /<Checkbox[\s\S]*?checked=\{on\}[\s\S]*?disabled=\{disabled \|\| lock \|\| barred\}/, 'Office users: every permission as a Checkbox (View locked and the ones only an admin gives say why)'],
  ['app/vehicle.tsx', /<ChoiceCard selected=\{selected\}/, 'Driver: Change vehicle / today\'s vehicle as ChoiceCards'],
  ['app/vehicle.tsx', /<ChoiceCard selected=\{picked === null\}/, 'Driver: "No vehicle today" as a ChoiceCard'],
  ['components/VehicleConfirm.tsx', /<ChoiceRow[\s\S]*?disabled=\{!fits\}[\s\S]*?disabledReason=/, 'Driver: the task\'s vehicle on the day; one that does not fit is greyed with the reason'],
  ['components/ReasonSheet.tsx', /<ChoiceRow key=\{r\.value\} selected=\{on\}/, 'The reasons sheet (Can\'t do this task, skip a stop, and the office\'s decline / cancel / reopen): ChoiceRows'],
  ['components/ReportForm.tsx', /<ChoiceChip\s+key=\{item\}/, 'Driver: the report category as ChoiceChips'],
  ['components/ReportForm.tsx', /<Checkbox[\s\S]*?tone="danger"/, 'Driver: "The vehicle cannot go on" as a Checkbox'],
  ['app/availability-edit.tsx', /<ChoiceChip selected=\{on\}/, 'Driver: Not available days and reasons as ChoiceChips'],
  ['app/availability-edit.tsx', /<ChoiceRow selected=\{on\}/, 'Driver: Not available part of the day as ChoiceRows'],
  ['app/ask/[id].tsx', /<ChoiceChip[\s\S]*?corner[\s\S]*?selected=\{on\}/, 'Driver: the answer\'s time tiles as ChoiceChips (the check in the corner)'],
];
for (const [file, re, label] of uses) check(re.test(read(file)), label, re.test(read(file)) ? undefined : file);

console.log('\n== No home-made picked style left ==');
{
  const files = Array.from(new Set(uses.map(([f]) => f)).values()).concat(['components/office/Controls.tsx', 'components/ui.tsx']);
  const oldStyle = /\b(chipOn|optionOn|presetOn|kindOn|speedOn|timeOn|driverOn|rowOn|boxOn|tickOn)\b/;
  const left = files.filter((f) => oldStyle.test(read(f)));
  check(left.length === 0, 'none of the audited files keeps a picked style of its own (a fill with no mark)', left);
  // A choice is a radio or a checkbox, never a plain button with "selected". Live's list row and trails toggle are not
  // choices (the row shown on the map, a map layer): they stay buttons, with the tint and the border (docs/ui-patterns.md).
  const plain = /accessibilityRole="button" accessibilityState=\{\{ selected/;
  const buttons = files.filter((f) => f !== 'app/office/(tabs)/live.tsx' && plain.test(read(f)));
  check(buttons.length === 0, 'no choice announced as a plain button', buttons);
}

console.log(failed ? `\n${failed} FAILED` : '\nAll selection checks passed.');
process.exit(failed ? 1 : 0);
