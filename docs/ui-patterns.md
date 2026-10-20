# UI patterns

The standard pattern per control, for the driver app (driver side and Office mode, `apps/driver`) and the office site
(`apps/office`). Every control uses the industry's standard pattern (Gmail, Google Calendar, Google Contacts, WhatsApp,
Airbnb, Uber, PickMe, Samsara; Material 3 and Apple's guidelines). One shared component per pattern per codebase, never a
new one. The reviewer checks every screen against this file at every checkpoint. Other sections (filters, dates, times,
lists, the snackbar) are added by their own rounds.

## Selection

A picked thing always looks picked, everywhere, the same way (Hotfix O2-H2, Part 3, 20 October 2026).

### The components

| Pattern | App (`apps/driver/src/components/patterns/Select.tsx`) | Site (`apps/office/src/ui/Select.tsx` + `styles.css` "Selection") | Use it for |
|---|---|---|---|
| Pick many (WhatsApp "Forward to", Gmail) | `SelectableRow` | `SelectableRow` (a label around a hidden native checkbox) | Ask drivers' drivers; any list where several are picked |
| Pick one, a row | `ChoiceRow` (`mark="start"` or `"end"` after an avatar / plate) | `ChoiceRow` (a native radio of a named group); `.opt` rows with a native radio get the same look from the CSS | Who's available, Give it a driver, vehicles to choose, Swap vehicle, a reasons sheet, personal trips |
| Pick one, a card | `ChoiceCard` | `ChoiceCard` (a button with `role="radio"`, `aria-checked`) | The question type (Ask drivers), today's vehicle with its photo |
| One of a few short words, a filter | `ChoiceChip` / `ChoiceChips` (`Controls.Chips` and `FilterChips` are built on it) | `ChoiceChip` (a `.chip` toggle button, `aria-pressed`; `basics.Chips` is built on it) | Today / Tomorrow / a date, stop type, people / goods / documents, minutes at a stop, vehicle type, presets, list filters, playback speed |
| Two or three options side by side | `Segmented` (`components/ui.tsx`), `LanguageSwitch` | `.chip` row | Yes / No, Company work / Personal, English / සිංහල |
| A form tick | `Checkbox` (`tone="danger"` for a tick that warns) | `Checkbox`, and every native `input[type=checkbox]` (drawn by the CSS) | Permissions, "The vehicle cannot go on", settings ticks |
| A form radio | `Radio` | `Radio`, and every native `input[type=radio]` | A short group inside a form |
| The mark alone | `SelectMark` (`check`, `radio`, `box`), `pickedStyle` | `SelectMark`, `.sel-mark` | A control that cannot be one of the above |

### The visual rules

- **Picked:** the mark, the blue chip tint `#e6edf8` and a 2 px blue `#1e4fa0` border (the site: `--live-bg`, `--live`,
  which follow the dark theme).
  - Pick many: the leading circle fills blue with a white check (WhatsApp / Gmail). Not picked: an empty circle outline in
    the same place, so people can see the row is tappable.
  - Pick one: a radio ring with a blue dot. Not picked: an empty ring.
  - A chip or a segment: a check before the words (Material 3's filter chip and segmented button); a tile too narrow for it
    (the driver's time tiles) has a filled check circle in its corner.
- **Never colour alone:** a picked state always has its mark (the check or the dot) as well as the tint; a dark fill with
  white words and no mark is not a picked state.
- **Tap anywhere:** the whole row, card or chip is the control. A row that picks has no other button inside it while it
  picks (Ask drivers shows Use / Call only after the question is sent).
- **Pick many keeps its count:** a list with multi-select says "N picked" in its header with "All free · None" beside it.
- **The same everywhere:** the site uses the same components in their web form with the same look and the same rules.
- Not a selection: the bottom tabs, the sign-in's Driver | Office tabs (role tab, the amber pill of the design), switches
  (the knob's place is the state), the map's toggles (trails, the compass) and a list row shown on the map (Live, a
  driver's timeline: the tint and the 2 px border, no mark, because nothing is being chosen).

### The accessibility rules

- App: `accessibilityRole` `checkbox` (pick many, a tick, a filter chip with `multi`) or `radio` (pick one, a chip, a
  segment); `accessibilityState` `{ checked, selected, disabled }` on every one; a group of radios sits in a view with
  `accessibilityRole="radiogroup"`. The reason a row is disabled is its `accessibilityHint`.
- Site: a native `input type=checkbox` / `radio` (its role and checked state come with it) named with `aria-label`, or a
  button with `role="radio"` and `aria-checked` inside `role="radiogroup"`; chips are toggle buttons with `aria-pressed`
  (`aria-selected` for chips that are tabs); a list box option has `role="option"` and `aria-selected`. The marks are
  `aria-hidden`: the control says the state. The keyboard focus ring shows on the whole row.

### The disabled rule

A control that cannot be picked is greyed (opacity 0.5), not tappable or clickable, and says why when the screen knows,
under its words and to the screen reader: "No app account", "On a task", "In garage", "Declined this task", the reason a
vehicle does not fit the task. Never hidden when it helps to see it (a busy vehicle in its group), never tappable only to
refuse afterwards.

## After a save

Gmail's "Sent" and Google Calendar's "Event saved" (Hotfix O2-H2, Part 1b, 20 October 2026).

- **The button while it saves:** the primary button shows a spinner, is disabled and cannot be pressed twice (`Button busy`
  in the app; `disabled` + the busy label on the site). A save that has not answered in 20 s ends in the error state
  (`CALL_TIMEOUT_MS`, which covers the answer's body too). A write is never sent again by itself: the person sees the
  sentence and Try again, which sends the same call once more.
- **After it saved:** the form closes and the new or changed item opens in its place (its detail screen when this person
  may open it, else the list it belongs to; `office/trip/successLogic.ts`). Approvals, cancels and switches go back to
  where the person came from (Gmail's triage). Nothing asks for an OK.
- **The snackbar / toast:** one line at the bottom saying what happened ("Task sent to Kamal", "Request sent", "Booking
  saved", "Changes saved", "Task cancelled"), one at a time, 4 s, 6 s with an action. At most one action, where it helps:
  View (the task an approval made), WhatsApp (the driver, when asked for), Call office, Try again. App:
  `components/patterns/Snackbar.tsx` (`showSnackbar`, drawn once at the root); site: `ui/Toast.tsx` (`useToast()(msg,
  action?)`).
- **Warnings and conflicts** of the save wait on the screen landed on as one amber card with OK (app:
  `components/office/SavedNotice.tsx` with `office/savedNotice.ts`, keyed `task:<id>`, `request:<id>` or the list's path;
  site: `data/flash.ts` and the task page's notice). Never in a dialog that must be closed first.
- **The driver side** saves to the phone's queue at once: back to where the flow started and a snackbar ("Fuel saved",
  "Odometer saved", "Task started", "Report sent"; "… on the phone, sent when online" without a connection). After Save &
  finish the task screen itself is the confirmation (Back to Today).
- **Dialogs stay only for questions** (Discard changes?, Sign out?, Remove?), never to say something worked.

## When something breaks

Never a white screen (Hotfix O2-H2, Part 1c).

- An error boundary at the root and one per stack (the root layout, Office mode's stack and its tabs, the driver's tabs)
  shows the crash screen: "Something went wrong" / "Your work was saved if you pressed Save.", **Go back** (that stack),
  **Reload app** (expo-updates `reloadAsync`), **Show details** (the error, the screen, the app version, the update id, the
  runtime and the first 8 stack lines, scrubbed of e-mails, phones, tokens, keys and ids) with **Copy** (the share sheet).
  App: `components/patterns/CrashScreen.tsx`, `lib/crash.ts`, `lib/crashLogic.ts`.
- An error outside rendering (`ErrorUtils`, an unhandled promise rejection) shows the crash screen when fatal, else a
  snackbar. Every crash is reported once a minute at most (`POST /errors` on office-api / driver-api; Settings → App
  errors on the site, `list_app_errors`).

## Settings lists

Instagram, WhatsApp and Uber's settings (Hotfix O2-H2, Part 2).

- A profile or Me page is short: the header, then one row per area with its state in a word ("Notifications · On /
  Paused / Some off"), each opening its own screen. Never 20 switches on one page.
- A long list of switches is grouped: a "Pause all" switch at the top, then one row per group with its count ("4 of 5
  on") opening the group's screen; a switch has a short title and at most one grey line under it.
- A switch saves at once (no Save button) and flips back with a snackbar and Try again when the save fails.
- Only what this person's permissions allow is shown; nothing greyed out for lack of a permission.
- The site follows the same groups and words (`screens/settings/notificationGroups.ts` is byte-identical to the app's
  `office/notificationGroups.ts`).
