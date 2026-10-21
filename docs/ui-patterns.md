# UI patterns: one standard control per job

Sahan, 20 October 2026: every control uses the pattern people already know from Gmail, Google Calendar, Airbnb, Uber,
PickMe and Samsara (Material 3 and Apple's Human Interface Guidelines where they apply), never a new invention. One shared
component implements each pattern in each codebase; a screen never builds its own. The fresh reviewer checks every
screen against this file at every checkpoint (CLAUDE.md, working rules), together with the principle in
`docs/phase8-plan.md` §16.

The three codebases:
- **Driver app** — the driver's screens in `apps/driver` (Expo / React Native).
- **Office mode** — the office's screens in the same app (`apps/driver/src/app/office`), and from O4 the mobile website
  (the same screens built for the web).
- **Website** — the desktop office site `apps/office` (Vite + React), which also serves laptops after O4.

The app's shared components live in `apps/driver/src/components/patterns/` (used by the driver side and Office mode),
their pure rules in `apps/driver/src/lib/patterns/` (tested with tsx, no react-native). The website's live in
`apps/office/src/ui/` with their rules in `.ts` files beside them (tested with Vitest).

---

## 1. Filters

**The pattern.** A search bar at the top of the list, and beside it one **Filter** button with a count badge (the number
of filters in use). The button opens a **bottom sheet** on a phone, a **popover panel** under the button on a desktop:
sections, each a set of tick boxes (several may be on) or radio choices (one of), with **Clear** and **Apply** at the
bottom. Nothing changes until Apply. The filters in use show as **removable chips** under the search bar (tap the ✕ to
drop one; "Clear all" when two or more). **Sort** is its own small control ("Sort: Newest ▾", a menu of choices) beside
the Filter button, never inside the filter sheet. No rows of filter chips across the top of a list.

**Where people know it.** Gmail's search chips and filter panel, Airbnb's Filters sheet with its count badge, Google
Drive's chips, Samsara's fleet lists (search + Filter + removable chips), Material 3 "filter chips under a search bar".

**Phone:** a 48 px Filter button with the badge; the sheet slides up to at most 85 % of the screen, its sections
scroll, Clear (text button, left) and Apply (primary, right) stay at the bottom. **Desktop:** the popover is 320–380 px
wide under the button, closes on Esc or a click outside (without applying), Apply closes it.

**Counts on choices.** When the server gives counts (e.g. "Open · 5"), they show beside the choice in the sheet, not on
the list.

**State.** The website keeps the filters in the URL (a link or a reload shows the same list); the app keeps them in the
screen's state and, for lists a person returns to all day, in the phone's kv (per person).

| Codebase | Component | Rules |
|---|---|---|
| App (both sides) | `components/patterns/FilterBar.tsx` (`FilterBar`, `FilterSheet`, `SortMenu`) | `lib/patterns/filterLogic.ts` |
| Website | `ui/FilterBar.tsx` (`FilterBar`, `FilterPanel`, `SortMenu`) | `ui/filterLogic.ts` |

## 2. Date range

**The pattern.** One button showing the range in words ("This month · 1–20 Oct", "Mon 14 – Sun 20 Oct"). It opens
**one calendar** with the **presets** beside it (desktop) or above it (phone): Today, Yesterday, Last 7 days, This
month, Last month. On the calendar, **tap the start day, then the end day**; the days between are shaded. **Tap one day
twice** to pick a single day. A page's limit (e.g. 62 days) greys the days past it and says why. **Apply** closes it;
the presets apply at once. No separate From and To calendars or fields.

**Where people know it.** Google Analytics and Google Ads' date range picker (presets + one calendar), Airbnb's dates
(tap check-in then check-out on one calendar), Material 3's date range picker.

**Phone:** the button opens a bottom sheet: the preset chips across the top, the month's calendar (swipe or ‹ › for
the month), Apply at the bottom. **Desktop:** a popover with the presets as a list on the left and two months side by
side.

| Codebase | Component | Rules |
|---|---|---|
| App | `components/patterns/Calendar.tsx` (`DateRangeButton`, `MonthCalendar` with the year jump) | `lib/patterns/calendarLogic.ts` |
| Website | `ui/DateRangePicker.tsx` (replaces `ui/DateRange.tsx`, same URL parameters `?range=&from=&to=`) | `ui/dateRange.ts` |

## 3. A single day

**For a day of history (a board, a driver's day, a route).** A **week strip**: seven days with the weekday and the
date, today marked, the chosen day filled; tap a day; swipe (or ‹ ›) week by week. Beside it a **Today** button and a
**calendar icon** that opens the calendar to jump to any date (past only where only the past makes sense).

**Where people know it.** Google Calendar's week strip on a phone, Samsara's and Uber's trip history day picker,
Apple's Calendar week row.

**For a trip's date (a request, a task).** **Today** and **Tomorrow** chips and **Pick a date** (the calendar, any date
from today). The chosen date shows on its chip when it is another day ("Thu 23 Oct").

**Where people know it.** Uber's and PickMe's "Now / Schedule" with a date, Google Calendar's new event.

| Codebase | Component | Rules |
|---|---|---|
| App | `components/patterns/Calendar.tsx`: `DayStrip` (history), `TripDayPicker` (a trip; `max` for a limit), `DateField` (`min` / `max`) | `lib/patterns/calendarLogic.ts` |
| Website | `ui/DayPicker.tsx` (`DayStrip`, `TripDayPicker`) | `ui/dateRange.ts` |

## 4. Time

**The pattern (21 October 2026, the boss's review).** The field shows the time (HH:MM in mono); empty, it shows the
planner's suggestion in grey ("07:24 · suggested") or a dash. Tapping it opens **one time sheet** with **the clock only**:
Material 3's time picker, a 24-hour dial (outer ring 00–11, inner 12–23), the hour then the minute, any minute, and a
**keyboard toggle** to type the hours and minutes. It starts at the value, else the suggestion, else now. Clear and
Done. **No quick-time chips** (Now and the common times were removed in Round 1). On a desktop the site's field can still
be typed into (the typed HH:MM rule) and drops the same clock; on a phone it is never typed into the field itself.
A suggested time is never written into the form by itself: the person picks it (Done) or types another.

**Where people know it.** Material 3's time picker (dial + keyboard input mode), Google Calendar on Android.

| Codebase | Component | Rules |
|---|---|---|
| App (both sides) | `components/patterns/TimeField.tsx` + `TimeDial.tsx` | `lib/patterns/timeLogic.ts`, `lib/patterns/dialLogic.ts` |
| Website | `ui/TimeField.tsx` + `ui/TimeDial.tsx` (the clock in the drop-down; typing kept on desktop) | `ui/timeLogic.ts`, `ui/dialLogic.ts` (byte-identical to the app's) |

Pure JavaScript; no native picker is needed (the 1.4.0 build no longer adds one: `docs/release-1.4.0.md` §1).

### 4b. The planner's suggestions (21 October 2026)

The planner advises and never blocks (Google Maps' "leave by" and Calendar's suggested times). The person gives ONE
time (the leave time or an arrive-by); the plan's other times show in grey as "suggested" and stay editable; nothing
the planner suggests is written into the form by itself (one calculation, the server's plan, is the source). A chosen
time that misses an arrive-by or the back-by gets an **amber** hint with "Use 09:18" (and Move arrive-by / back-by),
never red, never an error. No Plan now button: the plan comes 1.5 s after the last change. Next is enabled as soon as
the stops exist; only Review asks for one time when none was given. The fleet setting `planner_suggestions` (Settings →
Fleet → Dispatch, on by default) turns the suggestions and hints off. Stay at a stop: §4c.

### 4c. Stay at a stop (a duration, 21 October 2026)

Google Calendar's duration: one compact field, "Stay  1 h" (the suggested stay grey until one is chosen); the sheet has
5 min · 15 min · 30 min · 1 h · 2 h · 4 h · Custom (an hours column and a minutes column). Per stop on the When step ONE
compact row: Arrive by beside Stay. App: `components/patterns/DurationField.tsx` (`STAY_PRESETS` in `lib/durations.ts`);
website: `screens/DwellPicker.tsx`.

## 5. Lists

**The pattern.** While loading: **skeleton rows** (grey bars the shape of the rows), never a spinner in the list. **Pull
to refresh** (phone) / a refresh icon (desktop). **Load more** at the end when the server pages (25 a page; a count
"25 of 140"). An **empty state** that says what to do next ("No requests waiting. New ones appear here." with the
action when there is one). An **error** with the server's sentence and **Try again**. A list that fails while showing
rows keeps them and says "Couldn't refresh · Try again" above them.

**Spinners** only on a button the person just pressed (Save, Send), and **never without a timeout**: every call has a
timeout (20 s for reads, 30 s for writes, 15 s for suggestions); after it the person sees the error with Try again.

**Where people know it.** YouTube's and LinkedIn's skeletons, Gmail's pull to refresh and empty states, Material 3's
progress guidance (indicators only for an action, skeletons for content).

| Codebase | Component | Rules |
|---|---|---|
| App (both sides) | `components/patterns/ListState.tsx` (`SkeletonRows`, `ListEmpty`, `ListError`, `LoadMore`) | `lib/patterns/listLogic.ts` (`withTimeout`, the states) |
| Website | `ui/ListKit.tsx` (`SkeletonRows`, `EmptyLine`, `LoadMore`, `ErrBox`) | `ui/listLogic.ts` |

## 6. Bottom sheets

**The pattern.** One sheet: a grab handle, a title, the content scrolling inside, the actions fixed at the bottom; it
covers at most 85 % of the screen; tapping the dimmed area, the back button or a swipe down closes it (asking first when
something was typed). Used for filters, the date range, the time, the reasons (decline, cancel, reopen), Ask drivers.

**Where people know it.** Google Maps' place sheet, Uber's ride options, Material 3 modal bottom sheets.

| Codebase | Component |
|---|---|
| App | `components/patterns/Sheet.tsx` (`Sheet`: moves above the keyboard, a swipe down closes it); `ReasonSheet`, `LateSheet`, `AskDriversSheet`, Reset PIN, the filters, dates and times use it |
| Website | `ui/Sheet.tsx` (a bottom sheet under 768 px, a centred dialog or a popover above); `screens/asks/AskSheet.tsx` keeps its own dialog (Hotfix 4's design), its day and times on the shared pickers |

## 7. Cards

**The pattern.** One card style: white, 1 px line, 18 px radius (app) / the site's `.card`; a title line, one or two
lines of detail, a status pill on the right; a tap on the card opens its own screen (never a dead card). Counts on a
card open the filtered list.

| Codebase | Component |
|---|---|
| App | `office/ui.tsx` `Section`, `Row`; `components/ui.tsx` `Card` |
| Website | `.card` with `ui/basics.tsx` `Tile` |

## 8. Tabs

**The pattern.** A bottom bar of at most five on a phone (Material 3 navigation bar, Apple's tab bar): the daily work;
everything else under More, grouped, with a search at the top. On a desktop the site's left menu. A segmented control
(two or three options, e.g. "Now | Week") switches views inside a screen.

| Codebase | Component |
|---|---|
| App | `office/nav.ts` `tabsFor` + `app/office/(tabs)/_layout.tsx`; `Segmented` in `components/ui.tsx` |
| Website | `app/nav.ts` `tabsFor` / the menu; `ui/basics.tsx` `Segmented` |

## 9. The place search

**The pattern.** Google Maps' and Uber's "Where to?": a text field; under it, while empty, **suggestions** (recent,
saved, nearest); while typing, the **results** grouped by kind with their badges; a pasted pin or link answers a pin.
Typing never chooses a place; a pick fills it and shows the chosen place with **Change**. States from the list rules
(skeleton, empty, error with Try again, a timeout).

| Codebase | Component |
|---|---|
| App (Office mode) | `components/office/PlaceSearch.tsx` (rules `office/trip/locationLogic.ts`) |
| App (driver side) | `components/PlaceSearch.tsx` (Start a trip, Add a stop) |
| Website | `ui/LocationSearch.tsx` (rules `ui/locationLogic.ts`) |

### Where suggestions (Phase 9 Round 1, item 6)

**The pattern.** Google Maps' and Uber's empty destination box: at most **5 rows**, our places first (the office first,
then the saved places), then the **3 used most recently**. Each row has a leading **icon**, never a text badge: a
building for one of our places (and the office), a clock for a recent one. **No towns** until the person types. Under the
rows, **More places** (Google Maps' "More from recent history") opens the rest of the list in place (the rest of our
places, then the rest of the recent ones, at most 50; no towns); it is not shown when there is nothing more. While
typing, the results are as above, and every badge word the server sends is shown in the person's language (the app maps
it to a `where.badge.*` key, an unknown word to its layer's; never the server's English word raw; the website is English).

| Codebase | Component | Rules |
|---|---|---|
| App (Office mode and /m/) | `components/patterns/WhereSuggestions.tsx` inside `components/office/PlaceSearch.tsx` (search_places `{suggest}`) | `lib/placeSuggestLogic.ts` |
| App (driver side) | the same `WhereSuggestions` inside `components/PlaceSearch.tsx`: our places the phone knows, offices first (driver-api has no "used before"), building icons only; works offline | `lib/placeSuggestLogic.ts` |
| Website | `ui/LocationSearch.tsx`: on the first focus with nothing typed it asks search_places `{suggest}` once | `ui/placeSuggestLogic.ts` |

## 10. Confirmations, Undo and toasts

**The pattern.** A destructive or outward action (cancel a task, decline, remove, switch off) asks once in a sheet with
the reason when the server needs one; a reversible one happens at once with a **toast** and **Undo** for 6 s (Gmail's
"Conversation archived · Undo"). A toast is one line at the bottom, 4 s, never covering the primary button. Errors are
never toasts: they stay on the screen with Try again.

| Codebase | Component |
|---|---|
| App | `components/ReasonSheet.tsx` (on the shared Sheet); the snackbar `components/patterns/Snackbar.tsx` (`showSnackbar`, one action: View, Undo, WhatsApp, Try again; §12); Undo as an inline line where the change happened (Home's Snooze); a native `Alert` only asks before a remove |
| Website | `ui/Toast.tsx` (`useToast()(msg, action?)`: one action, Undo is `{ label: "Undo", onClick }`); `ui/WriteRetry.tsx` |

---

## 11. Selection

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
- **Light and dark (the site, Round 2b):** every colour is a token in `apps/office/src/styles.css`'s token blocks (light, the
  system's dark, `data-theme="dark"`); no hex in a rule or a component. Words on a filled colour use `var(--surface)`, a
  toast the `--inverse-*` tokens, pins on the map the `--map-*` tokens (the tiles stay light). Checked by
  `src/themeContrast.test.ts` (every pair 4.5 : 1 in both themes) and `e2e/contrast.spec.ts` (axe on every main screen,
  light and dark). The app and /m/ are light only for now.
- **Tap anywhere:** the whole row, card or chip is the control. A row that picks has no other button inside it while it
  picks (Ask drivers shows Use / Call only after the question is sent).
- **Pick many keeps its count:** a list with multi-select says "N picked" in its header with "All free · None" beside it.
- **The same everywhere:** the site uses the same components in their web form with the same look and the same rules.
- Not a selection: the bottom tabs, the sign-in's Driver | Office tabs (role tab, the amber pill of the design), switches
  (the knob's place is the state), the map's toggles (trails, the compass) and a list row shown on the map (Live, a
  driver's timeline: the tint and the 2 px border, no mark, because nothing is being chosen).
- Stage 0's controls use the same look (merged 20 October 2026): the trip day's Today / Tomorrow and the date range's
  presets are ChoiceChips; the Filter sheet's options and the sort list are the shared Checkbox / Radio; the day strip's
  day and the time sheet's time have the tint and the border (the time with its radio); the calendar's picked day is the
  Material date picker's filled circle, in the selection blue (`#1e4fa0`), with `role radio` / `aria-pressed`. The time
  sheet has no quick times since 21 October 2026 (the clock only).
- The sign-in's Driver | Office keeps the design's amber pill and carries a check on the picked side.

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

## 12. After a save

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

## 13. When something breaks

Never a white screen (Hotfix O2-H2, Part 1c).

- An error boundary at the root and one per stack (the root layout, Office mode's stack and its tabs, the driver's tabs)
  shows the crash screen: "Something went wrong" / "Your work was saved if you pressed Save.", **Go back** (that stack),
  **Reload app** (expo-updates `reloadAsync`), **Show details** (the error, the screen, the app version, the update id, the
  runtime and the first 8 stack lines, scrubbed of e-mails, phones, tokens, keys and ids) with **Copy** (the share sheet).
  App: `components/patterns/CrashScreen.tsx`, `lib/crash.ts`, `lib/crashLogic.ts`.
- An error outside rendering (`ErrorUtils`, an unhandled promise rejection) shows the crash screen when fatal, else a
  snackbar. Every crash is reported once a minute at most (`POST /errors` on office-api / driver-api; Settings → App
  errors on the site, `list_app_errors`).

## 14. Settings lists

Instagram, WhatsApp and Uber's settings (Hotfix O2-H2, Part 2).

- A profile or Me page is short: the header, then one row per area with its state in a word ("Notifications · On /
  Paused / Some off"), each opening its own screen. Never 20 switches on one page.
- A long list of switches is grouped: a "Pause all" switch at the top, then one row per group with its count ("4 of 5
  on") opening the group's screen; a switch has a short title and at most one grey line under it.
- A switch saves at once (no Save button) and flips back with a snackbar and Try again when the save fails.
- Only what this person's permissions allow is shown; nothing greyed out for lack of a permission.
- The site follows the same groups and words (`screens/settings/notificationGroups.ts` is byte-identical to the app's
  `office/notificationGroups.ts`).

---

## 15. Web parity (the mobile website /m/)

Office mode's screens run unchanged in a browser through react-native-web (`src/web-app`). The same components must look
the same there; a fix goes into the shared component or token (`theme.ts`, `components/ui.tsx`, `office/ui.tsx`,
`components/patterns/*`), never into a `/m/`-only copy of a screen, and the phone stays exactly as it was.

- **Shadows**: Android's `elevation` draws nothing in a browser. Use `shadow(level)` from `theme.ts` (elevation on the
  phone, the matching box-shadow on the web; `shadow(level, true)` for a card anchored to the bottom). Never a bare
  `elevation:` in an office screen.
- **Pressed states**: no `android_ripple`. A Pressable's feedback is a style: `pressed` opacity (both) plus
  `hoverStyle(state)` (a mouse only; touch never hovers). Button, Row, the selection controls, Chip, the bell, the back
  arrow and the tab bar have both.
- **Hit areas**: `hitSlop` does nothing in a browser. A small control without padding adds `webHitSlop(n)` (padding with
  a matching negative margin), or gets a 44 px box.
- **Fonts by family**: each weight is its own family (`IBMPlexSans_700Bold`, `Yaldevi_600SemiBold`, …) through `Txt` /
  `Mono`; never `fontWeight` on a styled text (a browser would fake the weight). Text is not selectable unless asked
  (`selectable`), as on the phone.
- **Line heights**: `Txt` sets `lineHeight` in px (×1.3 English, ×1.5 Sinhala); a browser has no Android font padding, so
  never pad a text by hand to centre it.
- **Inputs**: a text box inside its own bordered box (search, place search) takes `webInnerInput` (no focus ring inside
  the box); a stand-alone box keeps the browser's ring.
- **Safe areas**: a browser's insets are 0 (an iPhone in standalone mode gives real ones); headers use
  `insets.top + n`, never a fixed status-bar height.
- **Theme colour**: the browser's bar takes the colour of the screen's top, as the phone's transparent status bar does:
  `useWebThemeColor(colors.ink)` under a dark header (DarkHeader, TripHeader, Live, the driver's page, sign-in),
  `colors.page` under BackHeader. `index.html` and the manifest keep `#15181c` for the first paint.
- **Sheets**: the one Sheet is a React Native `Modal`; on the web it is a fixed layer over the page with the same slide,
  shade and close rules. Confirmations go through `lib/webAlert.ts` (Alert.alert does nothing in a browser).
- **What a browser cannot do, and what /m/ shows instead**: no pull to refresh (the lists poll and have Try again); no
  Android notification channels, sounds or full-screen ring (web push through the service worker, Settings →
  Notifications says this browser's state); no background location or duty (the site is Office mode only); no app
  settings page (no "Open settings" button); no share sheet on some browsers (copy, with a snackbar); no Google map on the
  phone's native SDK (the web map twins `*.web.tsx`). The app uses no haptics, so nothing is missing there.

## 16. Stop progress timeline (Phase 9 Round 2, 21 October 2026)

A task's stops with times are a vertical delivery timeline, the route progress of Uber's and DoorDash's order tracking
and Samsara's route view: one rail top to bottom, a dot per stop (left = green, here now = blue, skipped = red, still to
come = plain), the stop the driver is at or heading to ringed and marked "Here now" / "Next".

- Each stop: "Planned 10:30–11:00 · Arrived 10:52 · Left 11:40", then the difference in words: "22 min late" in amber
  (`--warn`), "8 min early" or "On time" in green (`--ok`). On time = within 2 minutes; the arrival's difference, else the
  leaving's (`deltaKind` from the shared rule `_shared/fleet/stopProgress.ts`, the same on every surface).
- A stop still to come once something was confirmed: "about 12:10 (updated 10:52)" (`progress.estimate`).
- A skipped stop: "Skipped · Nobody there" (the reason in words, never its code).
- Live: the page follows the driver without a reload (the site: Realtime on the task and its stops, one refetch about a
  second after a burst of changes, the data replaced in place; the artifact: every 60 s while the task is still to finish).
- The component, one per codebase: the site's `screens/StopProgress.tsx` (the task page); the app's
  `components/office/StopTimeline.tsx`.

## The reviewer's checklist (each checkpoint)

For every screen changed or added: the filters are one Filter button + sheet + chips; a date range is one button + one
calendar with presets; a day of history is a week strip; a trip date is Today / Tomorrow / Pick a date; a time is the
time sheet; a list has skeletons, pull to refresh, Load more, an empty state and Try again; every call has a timeout;
spinners only on a pressed button; sheets, cards, tabs, the place search, confirmations and toasts are the shared ones;
a picked thing has its mark, the tint and the border (§11); a save closes its form, opens the item and says so in the
snackbar, never an OK dialog (§12); no screen can go white (§13); a long settings list is grouped (§14); nothing is
invented twice.
