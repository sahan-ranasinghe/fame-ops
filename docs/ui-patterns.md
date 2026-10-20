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

**The pattern.** The field shows the time (HH:MM in mono) or a dash; tapping it opens **one time sheet**: **Now**
(rounded up to the next 5 minutes) and the **common times** of the office day (07:00, 08:00, 09:00, 12:00, 13:00, 17:00)
as chips, then a list in **5-minute steps** scrolled to the current value (or now), Clear and Done. A suggested time
(the plan's leave-by) shows as the first chip, "Planned 07:24". The field can still be typed into on a desktop (the
site's typed HH:MM rule), never on a phone.

**Where people know it.** Google Calendar's time list in 15-minute steps, Uber's scheduled-ride time wheel, Material 3's
time picker in input mode on desktop.

| Codebase | Component | Rules |
|---|---|---|
| App (both sides) | `components/patterns/TimeField.tsx` (`TimeField`, `TimeSheet`) — replaces `components/office/TimeInput.tsx` and typed times | `lib/patterns/timeLogic.ts` |
| Website | `ui/TimeField.tsx` — replaces `ui/TimeInput.tsx` (the popover list; typing kept on desktop) | `ui/timeLogic.ts` |

A native wheel needs `@react-native-community/datetimepicker` (a native module): the sheet is JavaScript and stays
until the 1.4.0 build, which may swap the list for the system wheel (`docs/release-1.4.0.md`).

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

## 10. Confirmations, Undo and toasts

**The pattern.** A destructive or outward action (cancel a task, decline, remove, switch off) asks once in a sheet with
the reason when the server needs one; a reversible one happens at once with a **toast** and **Undo** for 6 s (Gmail's
"Conversation archived · Undo"). A toast is one line at the bottom, 4 s, never covering the primary button. Errors are
never toasts: they stay on the screen with Try again.

| Codebase | Component |
|---|---|
| App | `components/ReasonSheet.tsx` (on the shared Sheet); Undo as an inline line where the change happened (Home's Snooze); a shared toast is not built yet: a native `Alert` asks before a remove |
| Website | `ui/Toast.tsx` (`useToast`, Undo); `ui/WriteRetry.tsx` |

---

## The reviewer's checklist (each checkpoint)

For every screen changed or added: the filters are one Filter button + sheet + chips; a date range is one button + one
calendar with presets; a day of history is a week strip; a trip date is Today / Tomorrow / Pick a date; a time is the
time sheet; a list has skeletons, pull to refresh, Load more, an empty state and Try again; every call has a timeout;
spinners only on a pressed button; sheets, cards, tabs, the place search, confirmations and toasts are the shared ones;
nothing is invented twice.
