# Fame Fleet: the screen inventory (Part B, Round D design pass; the patterns: docs/design-pass.md)

Read-only inventory of branch `phase9-r3` (22 October 2026, last commit 17be9da). Every screen file was listed and its
imports and render structure read; the six pilot screens were read in full. Paths are relative to the repo root
`/home/sahan-ranasinghe/projects/fame-ops`. Nothing in the repo was changed.

Pattern legend (the families `docs/design-pass.md` will define):
**DASH** Dashboard · **ROW** List row · **TABLE** Desktop table · **DETAIL** Detail page · **STEP** RouteStepper (a
trip's stops as steps) · **BANNER** StatusBanner · **STATS** StatsRow · **FORM** Forms · **PROF** Profile/settings ·
**STATES** Empty / loading / error states.

---

## 1. Summary

### 1.1 Screens per surface

| Surface | Screens | Where |
|---|---|---|
| 1. Website, desktop | **58**: 51 routed screens in the shell (`apps/office/src/app/routes.tsx`) + No access + 6 outside the shell (Sign in, Set password, Second step, Blocked, Unreachable, Privacy). Variants inside a screen: Overview's side panel (`/?open=`), Booked (NewRequest after Book now), TripDecide (Decide's trip variant), Give it a driver (TaskEdit `?driver=1`), Fleet settings sections (`/settings/fleet/:section`) | `apps/office/src/screens/**`, `apps/office/src/auth/*` |
| 2. Website, phone width (≤ 768 px) | The same **58** (More is a phone-tab screen; the rail is hidden). **14 have a distinct phone layout** (Shell, Overview, the 7 list + detail pages, IssuePage, DriversBoard, the table pages as cards, PlanMap's height, the sheets); the rest reflow | `ui/phone.ts` (768 px), `ui/Page.tsx`, `styles.css` `@media (max-width: 768px)` |
| 3. Office mode (app) and /m/ | **50** screen files (52 route files minus 2 layouts) + the shared Login. **/m/ has all 50**: `apps/driver/src/web-app/office/**` is generated 1:1 by `scripts/make-web-routes.mjs` (re-exports; `diff` of the two trees is empty) plus `web-app/index.tsx` (redirect), `web-app/login.tsx` (the app's login, Office side only) and `web-app/_layout.tsx` | `apps/driver/src/app/office/**` |
| 4. Driver app | **23**: 5 tabs (Today, Mileage, Fuel, Report, Me) + 18 stack / full screens (Login shared with Office mode) | `apps/driver/src/app/(tabs)/*`, `apps/driver/src/app/*.tsx`, `task/[id].tsx`, `ask/[id].tsx` |

### 1.2 Pattern families found, and the components that implement them today

| Family | Website (`apps/office/src`) | Office mode (`apps/driver/src`) | Driver app (`apps/driver/src`) |
|---|---|---|---|
| Dashboard | `screens/Overview.tsx` + `screens/overview/Section.tsx` (collapsible sections) + `OverviewPanel.tsx` | `app/office/(tabs)/index.tsx` (TopBar + StatTiles + `office/ui.tsx` Section) | `app/(tabs)/index.tsx` Today (dark header, NEXT TASK card) |
| List row | `.row` markup per screen; `ui/DriverRow.tsx` (DriverRow, DriverLine); `overview/rows.tsx`; `NeedsDriverList.tsx`; board `TaskCard` in `Tasks.tsx` | `office/ui.tsx` `Row` (+ `StatusChip`); but Trips, Alerts, Drivers tab, Live, Issues draw their own rows; `components/office/DriverRows.tsx` (DriverChoiceRow, TaskDriverCard) | `components/TaskRows.tsx` (TaskList/TaskRows); per-screen rows in Mileage, Fuel, Report, Availability |
| Desktop table | `<table>` in `.tbl-wrap` (Requests, My trips, Drivers, Vehicles, Places, Users, Duty log, Task history, Fuel, Mileage's `MileageTable`, `ui/GenericTable.tsx`, Fleet settings, Import sites); DriversBoard's week `table.wk` | none (Reports draws `key: value` rows, a local `Rows`) | none |
| Detail page | `ui/Page.tsx` `PageTop` + `ListWithDetail` (panel on desktop, full screen on phone); `dl.kv` fact lists; IssuePage has its own header | `office/ui.tsx` `BackHeader` + `Screen` + `Section`; hand-made `styles.card` blocks | `task/[id].tsx` (map + sheet); others own header |
| RouteStepper | `StopProgress.tsx` (dots), `PlanTimeline.tsx` (text rows + legs), `TaskSummary.tsx` (`.stop-pin` S/1/2), Tasks card "From … To …" | `components/office/StopTimeline.tsx` (numbered marks) + hand-built S/B marks in task detail, Review, Approve, Give a driver; Task detail's 5-step strip | `components/task.tsx` `StopTimeline` (hollow/filled dots) and `task/[id].tsx` stop cards with `StopProgressLine` |
| StatusBanner | `ui/basics.tsx` `Notice` (tone `""/bad/info/ok`), `WarningsNote`, `DraftBanner`, Shell's `PhoneBanner` / `NeedsDriverBanner`, `requestParts` `LateNotice` | `components/office/SavedNotice.tsx`, `TripShell` `DepartureNote`, `TaskDetailParts` `TaskWarnings`, hand-made `styles.needs` / `styles.changed` | `components/ui.tsx` `Notice` (warn/danger/info), `DutyNotices`, `TrackingNotice`, `GeofenceCard`, `SwapCard` |
| StatsRow | `ui/basics.tsx` `Tile` (Overview, DriverPage, Mileage, Fuel) | `office/ui.tsx` `StatTiles` (Home only), a local `Tile` in `reports/index.tsx`, `Chip` header counts (Issues), km as a muted line (Task detail) | Task in progress `styles.stats` box; Mileage tab card with progress bar |
| Forms | `StickyActions` (sticky only ≤ 768 px), `DraftBanner`, `TripEditor`, `TimeField`, `DayPicker`, `LocationSearch`, `Select` | `StickyActions` (office/ui), `TripShell` `TripHeader`/`TripFooter`, `Controls` (MoreDetails, Stepper, ToggleRow, Chips), `patterns/*` | per-screen bottom bar `View` (Start a trip, Add a stop, Profile edit, Availability, Phone prompt, Vehicle); button inside the scroll (Log mileage, ReportForm) |
| Profile / settings | `settings/*` (SettingsHome, MyProfile, Notifications with `SwitchLine`), `More.tsx` | `profile.tsx`, `notifications/*` (`NotifParts` SwitchRow/LinkRow/RowCard), `people/settings.tsx` (`PeopleParts` Toggle) | `(tabs)/me.tsx` (Cards), `profile-edit`, `phone-setup`, `permissions` |
| Empty / loading / error | `ListKit` `SkeletonRows`, `EmptyLine`, `LoadMore`, `Pager`; `basics` `Empty`, `Loading`, `ErrBox`, `StaleNote`; `listLocal` `ListWaiting`/`ListStale`/`ListFooter` | `patterns/ListState.tsx` `SkeletonRows`, `ListEmpty`, `ListError`, `LoadMore`; `office/ui.tsx` `ListFailed`, `ErrorNotice`, `Loading`, `Empty` (unused) | only `LoadMore` from ListState; `ActivityIndicator` spinners; `Notice`; hand-written empty lines |

### 1.3 Top 10 inconsistencies across surfaces

1. **A trip's stops are drawn at least nine ways, with different marks and colours.** Site: `screens/StopProgress.tsx`
   (unnumbered dots: done green `ok`, arrived blue `live`, skipped red `bad`), `screens/PlanTimeline.tsx` (text rows "Stop 2 ·
   Drop", legs with a left border, no marks), `screens/TaskSummary.tsx` (`.stop-pin` S/1/2 discs), `screens/Tasks.tsx`
   TaskCard ("From X / To Y" text). Office mode: `components/office/StopTimeline.tsx` (numbered marks: done = ink, here =
   blue, skipped = **grey**, against `docs/ui-patterns.md` §16 which says left = green, skipped = red), plus hand-built
   S / n / B marks in `app/office/trip/review.tsx` (styles.mark), `app/office/request/[id].tsx` (styles.mark from
   `tripView`), `app/office/task/[id].tsx` (S and B rows around StopTimeline) and `app/office/task/[id]/driver.tsx`; and the
   horizontal 5-step strip (Approved · Accepted · On the way · Arrived · Done) in task detail. Driver app:
   `components/task.tsx` StopTimeline (hollow pickup → filled drop dots) and `app/task/[id].tsx` bordered stop cards with
   `StopProgressLine`.
2. **One status has many words, tones and shapes.** `in_progress` is "In progress" (site TaskDetail Pill via
   `cap(t.status)`, site board column, driver "IN PROGRESS" label), "on the way" (Office task detail Pill,
   `office.status.in_progress`, lower case), "On the way" (Office Tasks section title) and "Under way" (Office row chip
   `office.chip.underWay`, Home's On the road). Late: red chip in Office rows (`statusWords.ts taskChip` tone red), amber
   Pill in Office task detail, amber in StopTimeline, red `status bad` on the site board and ETA. Shapes: Office `Pill`
   (14 px, padding 12/5) and `StatusChip` (13 px, max 112 px) are two components for the same thing; site Tasks cards show
   the status as coloured text (`span.status`), not a pill; driver Report hand-builds its own chip (radius 10,
   `app/(tabs)/report.tsx` styles.status); driver Documents shows expiry as coloured text although its comment says "as the
   office's chips do".
3. **Stats are shown six ways and one number differs.** Site `Tile` (label · big value · unit · sub); Office
   `StatTiles` (number + one-line label, Home only); a second, local `Tile` in `app/office/reports/index.tsx` copying the
   site's; header `Chip` counts in `app/office/issues/index.tsx`; the driver's task stats box and Mileage progress card; Office
   task detail's km as a muted sentence. Home's "Free" tile shows `ov.vehicles.parked` (`app/office/(tabs)/index.tsx` l.110),
   which the server computes as all vehicles minus those on the road (`_shared/fleet/tools/overview.ts` l.120), so it
   includes vehicles in the garage; the site's "Free now" subtracts `in_garage` (`screens/Overview.tsx` l.64).
4. **Detail-page headers differ in structure, and the status sits in different places.** Office mode has six header
   variants: `DarkHeader` (tabs), `TopBar` (Home), Live's own slim dark bar (`(tabs)/live.tsx` styles.top), `BackHeader`
   (stack screens), `TripHeader` (trip editor), and a hand-built dark header in `people/driver/[username].tsx`. Issues
   (`app/office/issues/index.tsx`) is a pushed stack screen but uses `DarkHeader`, which has no back arrow. The driver app has
   13 copies of the same `styles.header` + ChevronLeft row (add-stop, availability, availability-edit, documents, log-mileage,
   phone-setup, profile-edit, profile-photo, report-problem, start-trip, today-tasks, vehicle, ask/[id]) and no shared
   header. The site puts the status pill in `PageTop`'s eyebrow (TaskDetail, RequestDetail); Office mode puts it in a pill row
   under `BackHeader` in the body; design 14 puts the pills inside the dark header. Site `IssuePage.tsx` builds its own
   header (back on a phone, X on a desktop) instead of `PageTop`.
5. **The primary button is in a different place on similar screens.** Office: `StickyActions` (card background, reason
   under the button) on Approve and most forms, but `TripFooter` (page background, the reason ABOVE the button,
   `components/office/TripShell.tsx`) on the trip editor and the reason above the button in `task/[id]/time.tsx`; Swap
   vehicle and the vehicle form disable with no reason at all; Task detail has no sticky bar (its Reassign / Cancel / Change
   time / Change stops / Swap buttons sit mid-scroll in pairs); Home's "+ New trip" is a floating button but the Tasks tab's
   "Assign a task" is a full-width button in the list. Site: TaskDetail offers "Change" in `PageTop` and again "Change the
   task" at the bottom; RequestDetail has "Review" in `PageTop`, an `.acts` row, and a separate "Approve or decline" link
   below. Driver: each form draws its own bottom `View` (no top border); Log mileage and ReportForm put Save inside the
   scroll.
6. **The same entity is drawn differently.** A task row: the site's board card (time, label, title, tags, From/To, leave-by,
   ETA, DriverLine with vehicle chip and photo, status line, approved by), Office `Row` (time, title, "driver · status
   sentence", chip, **no plate**; design 03 shows a plate chip), the driver's `TaskRows`. A request: Office Home `Row`
   (avatar, "asked" text, no status), Approve tab `Row` (+ reviewing/late line, status chip, "New" chip), Trips tab standalone
   card (`styles.card`, radius 16, Call button); site Requests table / phone cards and Overview `RequestLine` with a "Decide"
   button. A driver: site `DriverRow`/`DriverLine`; Office `DriverChoiceRow`, `TaskDriverCard`, the Drivers tab's own card
   rows, Live's own rows, People's `Row` + Avatar, Home's On the road `Row` (Avatar without the photo); Office has two driver
   pages with different headers (`driver/[username].tsx` BackHeader profile, `people/driver/[username].tsx` dark header
   Manage).
7. **Empty / loading / error states are not one set.** Site: `Empty` (`basics`, class `empty`) and `EmptyLine` (`ListKit`,
   `card-b muted`) and the board's `<p className="col-empty">No tasks</p>`; `Loading` text on detail pages, `SkeletonRows` on
   lists; detail pages that fail show `<Notice tone="bad">` with **no Try again** (`TaskDetail.tsx` l.130, `RequestDetail.tsx`
   l.120). Office: `ListEmpty` (with an action) everywhere, but `office/ui.tsx` still exports `Empty` (unused) and `Loading`
   (spinner) used on Review, When and Quick settings; `ErrorNotice` vs `ListFailed`; "No access" is a `ListEmpty` in
   task-history and plain `Txt` in vehicles/doc, while the site has a `NoAccess` page. Driver app: none of `SkeletonRows`,
   `ListEmpty`, `ListError` is used (only `LoadMore`); spinners (`ActivityIndicator`) on task, vehicle, documents, ask and log
   mileage; empty lists are hand-written muted text (Mileage, Today's own block).
8. **Office lists mix two row systems and four card radii.** `Row` inside a `Section` card (radius 18) on Home, Approve,
   Tasks, People, Places, Maintenance, Vehicles, Task history, Questions; standalone cards per item on Trips (radius 16),
   Alerts (radius 16 + amber left border), the Drivers tab (radius 14), Issues (own `styles.row` with an icon tile), Live
   (transparent-bordered rows); the driver's task stop cards radius 12. `docs/ui-patterns.md` §7 says one card, 18 px.
9. **Duplicates inside one codebase.** Site: two `SearchBox` components (`ui/ListKit.tsx` l.328 and
   `screens/listLocal.tsx` l.65); the needs-a-driver row twice (`NeedsDriverList.tsx` and `overview/rows.tsx`
   `NeedsDriverLine`); `RequestDetail.tsx` re-implements the `dl.kv` of `RequestDetailCard.tsx` instead of using it. Office:
   `Pill` vs `StatusChip`; `Chip` vs `StatTiles`; `FilterChips` (unused) vs `Controls.Chips` vs `ChoiceChips`; the view switch is
   `ChoiceChip`s on the Drivers tab (Now · Attendance · Week) but `Segmented` on Reports; three sticky footers
   (`StickyActions`, `TripFooter`, the driver's per-screen bars).
10. **Home and Overview, the same job, disagree.** Site Overview: role-ordered collapsible sections, 6 `Tile`s inside an
    "At a glance" section, Critical issues and Needs attention as two sections, Needs a driver only while there is one,
    "View all (N)", a "Decide" button per request. Office Home: TopBar + 3 `StatTiles` + a Reminders row outside any section,
    one "Needs attention" section, Needs a driver always shown (with an empty line), Today's tasks (the site has no such
    section), links "View all" / "Board" / "Live map" and an extra "All today's tasks (N)" line, a "Give a driver" red button
    per row; My trips rows open the Trips tab, not the trip (`(tabs)/index.tsx` l.273), against "every tappable thing opens its
    own place".

Also found (smaller): confirmations are inline boxes on the site (cancel booking, withdraw, cancel task on the edit page,
place remove) but a `ReasonSheet` in Office mode (`ui-patterns` §10 asks for a sheet); the site's More shows "Role"
(`screens/More.tsx`, `ROLE_LABEL`) while Office mode never shows a role word; Maintenance needs `vehicles` on the site
(`routes.tsx`) but `issues` in Office mode (`office/nav.ts` moreFor); "Switch to desktop view" appears on both More and
Profile on /m/; the primary action's wording differs for the same act ("Assign & send" on the site's NewTask, "Send to
<driver>" on Review, "Approve · send to <name>" on Approve, "Give to <name> · <plate>" on Give a driver).

---

## 2. Screens per surface

### 2.1 Website, desktop width (`apps/office`)

Permission = the route's guard in `app/routes.tsx` (`Guard` any-of; `ToolGuard` = the tool in `me.tools`). Layout shell:
`app/Shell.tsx` (dark rail with sections Today / Fleet / Reports / Admin, `app/nav.ts`).

| Screen | Route / file | Permission | What it is for | Patterns | Shared components | Notes |
|---|---|---|---|---|---|---|
| Overview | `/` · `screens/Overview.tsx` (+ `overview/*`, `OverviewPanel.tsx`) | view (request-only → /requests, else → /settings) | Action-first home by permission; tiles open a side panel | DASH, ROW, STATS, STATES | overview `Section`, `Tile`, `IssueLine`, `RequestLine`, `NeedsDriverLine`, `TripLine`, `RoadRows`, `SkeletonRows`, `ErrBox`, `Empty`, `StaleNote` | Pilot (e). Tiles are not first for approvers; NeedsDriverLine duplicates NeedsDriverList |
| Overview side panel | `/?open=road\|free\|garage\|tasks\|requests\|reminders` · `OverviewPanel.tsx` | per tile (`canOpen`) | The list a tile counts, beside the Overview | ROW, STATES | `Avatar`, `Pill`, `Plate`, `VehicleThumb`, `IconLink`, `SkeletonRows`, `ErrBox`, `Empty` | Uses `Empty`, not `EmptyLine` |
| Live locations | `/live` · `Live.tsx` | view | Every driver on the map; the selected driver's route, gaps, trails | ROW, DETAIL (card), STATES | `MapView`, `FilterBar`, `GapsList`, `Avatar`, `Pill`, `ContactButtons`, `VehicleChip`, `SkeletonRows`, `ErrBox`, `Empty`, `Loading` | Own list rows (not DriverRow) |
| Tasks (board) | `/tasks` · `Tasks.tsx` | assign_tasks | The day's board in columns; needs-a-driver block on top | ROW (cards), BANNER, STATES | `DayStrip`, `DriverLine`, `VehicleThumb`, `NeedsDriverList`, `WaitingApprovalColumn`, `LoadMore`, `Dot`, `ErrBox`, `StaleNote`, `Updated` | Pilot (f) |
| Task detail | `/tasks/:id` · `TaskDetail.tsx` | assign_tasks (child of Tasks) | One task: facts, route, stops, plan, swap, odometer/fuel, problems, history | DETAIL, STEP, BANNER, STATES | `PageTop`, `StopProgress`, `PlanWithMap`, `DriverLine`, `ContactButtons`, `StopArrival`, `TripPurposeCard`, `Notice`, `WarningsNote`, `Pill`, `Loading`, `Empty` | Pilot (b). Load error has no Try again |
| Assign a task | `/tasks/new` · `NewTask.tsx` | assign_tasks | One long form: start, stops, plan, who drives, driver, vehicle, projects | FORM, STEP, BANNER | `PageTop`, `StickyActions`, `DraftBanner`, `TripRoute`, `TripPlanCard`, `WhoDrives`, `AvailabilityPanel`, `ConflictCards`, `TripDayPicker`, `WarningsNote`, `Toast` | Button "Assign & send" / "Send for approval" / "Save the task" |
| Task history | `/tasks/history` · `TaskHistory.tsx` | assign_tasks | Tasks over a date range with filters | TABLE, STATS (totals line), STATES | `PageTop`, `DateRangePicker`, `FilterBar`, `SearchBox` (ListKit), `ListHeader`, `Pager`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `Pill`, `Plate` | List page with `PageTop` (back arrow), unlike other lists' `.ph` |
| Change a task / Give it a driver | `/tasks/:id/edit` (`?driver=1`) · `TaskEdit.tsx` | assign_tasks | update_task; driver first; cancel task inline (#cancel) | FORM, BANNER | `PageTop`, `StickyActions`, `DraftBanner`, `TaskSummary`, `AvailabilityPanel`, `DriverSelect`, `VehicleSelect`, `TimeField`, `TripDayPicker`, `ChoiceChip`, `DepartureNote` | Cancel is an inline confirm box with free text (Office: ReasonSheet) |
| Edit stops | `/tasks/:id/stops` · `TaskStops.tsx` | assign_tasks | update_task_stops with the plan version | FORM, STEP | `PageTop`, `StickyActions`, `DraftBanner`, `StopsRows`, `PlanWithMap`, `DwellPicker`, `TimeField`, `DepartureNote` | |
| Reminders | `/reminders` · `Reminders.tsx` | issues or assign_tasks | Documents, services and other reminders due | ROW, STATES | `PageTop`, `ListHeader`, `LoadMore`, `Pager`, `EmptyLine`, `SkeletonRows`, `ErrBox`, `StaleNote` | |
| Issues | `/issues` · `Issues.tsx` | issues or assign_tasks | The issues centre, list + panel | ROW, STATES | `ListWithDetail`, `DateRangePicker`, `FilterBar`, `SearchBox` (ListKit), `ListHeader`, `Pager`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `ErrBox`, `Avatar`, `Pill`, `Plate` | |
| Issue | `/issues/:id` · `IssuePage.tsx` | issues or assign_tasks | One issue: facts, links, timeline, Take / Resolve / Dismiss | DETAIL, STATES | `Avatar`, `Pill`, `Plate`, `Loading`, `Notice`, `Toast`, `useIsPhone` | Own header (X on desktop, back on phone), not `PageTop` |
| Requests | `/requests` · `Requests.tsx` | view or request | The approval queue / one's own requests | TABLE, STATES | `ListWithDetail`, `FilterBar`, `SearchBox` (ListKit), `ListHeader`, `Pager`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `ErrBox`, `StaleNote`, `Avatar`, `RequestStatusPill`, `ReviewingLine` | Status pill words `cap(status)` |
| Request detail | `/requests/:id`, `/my-trips/:id` · `RequestDetail.tsx` | view/request (or request/assign_tasks via My trips) | One request read-only; Review, Edit, Withdraw, Cancel booking | DETAIL, STEP, BANNER, STATES | `PageTop`, `RequestHead`, `LateNotice`, `ChangesList`, `Timeline`, `DecidedBy`, `ReviewingLine`, `AssignedBlock`, `TellRequester`, `TripSection`, `RequestAgain`, `ContactButtons`, `Notice`, `Loading` | Pilot (b). Duplicates RequestDetailCard |
| My trips | `/my-trips` · `MyTrips.tsx` | request or assign_tasks | Everything the person asked for, with live state | TABLE, STATES | `ListWithDetail`, `DateRangePicker`, `FilterBar`, `Segmented`, `SearchBox` (ListKit), `ListHeader`, `Pager`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `DriverLine`, `Pill`, `ExpiredBadge`, `RequestAgain`, `ContactButtons` | phone-only "New request" button |
| Notifications (inbox) | `/inbox` · `InboxPage.tsx` (+ `app/inbox.tsx` InboxList) | everyone | The notification centre as a page | ROW, STATES | `FilterBar`, `SearchBox` (ListKit), `ListHeader`, `Pager`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `Notice` | |
| New request | `/requests/new` · `NewRequest.tsx` (Booked state inside) | request or approve | A request with its trip; Book now for approvers | FORM, STEP, BANNER | `PageTop`, `StickyActions`, `DraftBanner`, `TripEditor`, `WhoDrives`, `DriverPicker`, `AvailabilityPanel`, `VehicleGroups`, `WarningsNote`, `Notice`, `Empty`, `SkeletonRows` | Buttons "Save as waiting" + "Book now" |
| Decide a request | `/requests/:id/decide` · `RequestDecide.tsx` (+ `TripDecide.tsx` variant) | approve | Approve / change / decline; Who's available; the plan | FORM, STEP, DETAIL | `PageTop`, `StickyActions`, `RequestDetailCard`, `AvailabilityPanel`, `ConflictCards`, `PlanWithMap`, `VehicleChoiceRadios`, `DwellPicker`, `TimeField`, `TripDayPicker`, `DecidedBy`, `ReviewingLine`, `DepartureNote` | Two StickyActions bars in one file (decide vs redecide) |
| Edit request | `/requests/:id/edit` · `RequestEdit.tsx` | request or approve | The requester changes the trip | FORM, STEP | `PageTop`, `StickyActions`, `DraftBanner`, `TripEditor`, `WhoDrives`, `RequestStatusPill` | |
| Vehicles | `/vehicles` · `Vehicles.tsx` | view | The fleet board with filters | TABLE, STATES | `ListWithDetail`, `FilterBar`, `SearchBox` (listLocal), `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Pill`, `VehicleThumb` | Uses the second SearchBox |
| Vehicle detail | `/vehicles/:reg` · `VehicleDetail.tsx` | view | One vehicle, photo, document chips, documents | DETAIL | `PageTop`, `VehiclePhotoCard`, `VehicleDocumentsSection`, `DocChip`, `MissingDocs`, `Pill`, `Loading`, `Notice` | |
| Register / edit vehicle | `/vehicles/new`, `/vehicles/:reg/edit` · `VehicleForm.tsx` | vehicles | register_vehicle / update_vehicle | FORM | `PageTop`, `StickyActions`, `DraftBanner`, `DateField`, `VehicleDocumentsSection`, `Toast` | |
| Projects | `/projects` · `Projects.tsx` | view or request | Find a Zoho project; import prompt | FORM (search), ROW, STATES | `Loading`, `Notice`, `Empty`, `Pill`, `Toast` | Search is a form with a Search button, not the list search box |
| Maintenance | `/maintenance` · `Maintenance.tsx` | vehicles | Reported problems + service/document reminders | ROW, STATES | `FilterBar`, `SearchBox` (ListKit), `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Pill`, `Plate`, `Toast` | Office mode gates it by `issues` |
| Mileage | `/mileage` · `Mileage.tsx` (+ `MileageTable.tsx`) | vehicles | Task km, odometer km, gaps, fuel for a range | STATS, TABLE, STATES | `Tile`, `DateRangePicker`, `FilterBar`, `MileageTable`, `GenericTable.human`, `SkeletonRows`, `Notice` | |
| Fuel | `/fuel` · `Fuel.tsx` | vehicles | Fills with receipts and videos | STATS, TABLE, STATES | `Tile`, `DateRangePicker`, `ListWithDetail`, `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Pill` | |
| Fuel fill | `/fuel/:id` · `FuelDetail.tsx` | vehicles | The fill's video with bookmarks, litres, LKR | DETAIL | `PageTop`, `Pill`, `Loading`, `Notice` | |
| Places | `/places` · `Places.tsx` | vehicles | Our places and operators' sites | TABLE, STATES | `ListWithDetail`, `FilterBar`, `SearchBox` (listLocal), `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Pill`, `Toast` | |
| Place | `/places/:id` · `PlacePage.tsx` | vehicles | Edit a place, its pin, remove / restore | DETAIL, FORM | `PageTop`, `PinMap`, `Pill`, `Loading`, `Notice`, `Toast` | Remove = second step on the page |
| Drivers | `/drivers` · `Drivers.tsx` | view | Driver sign-ins list | TABLE, STATES | `FilterBar`, `SearchBox` (listLocal), `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Avatar`, `Pill`, `VehicleChip` | |
| Add a driver | `/drivers/new` · `DriverForm.tsx` | vehicles | create_driver, PIN shown once | FORM | `PageTop`, `StickyActions`, `DraftBanner`, `Notice`, `Toast` | |
| Duty log | `/drivers/duty` · `DutyLog.tsx` | assign_tasks or vehicles | Duty periods over a range | TABLE, STATES | `PageTop`, `DateRangePicker`, `FilterBar`, `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Pill`, `Plate` | |
| Ask drivers | `/drivers/ask` · `asks/AskDrivers.tsx` | tool ask_drivers (approve/assign_tasks) | A question with one-tap answers | FORM | `PageTop`, `StickyActions`, `DraftBanner`, `ChoiceCard`, `SelectableRow`, `Chips`, `TimeField`, `TripDayPicker`, `Pill`, `Notice` | The sheet twin `asks/AskSheet.tsx` keeps its own dialog |
| Questions to drivers | `/drivers/asks` · `asks/AskList.tsx` | tool ask_answers | The last 7 days of questions | ROW, STATES | `PageTop`, `ListHeader`, `Pager`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `Pill`, `Notice` | |
| A question's answers | `/drivers/asks/:id` · `asks/AskAnswers.tsx` | tool ask_answers | Each driver's answer; Assign on Yes | DETAIL, ROW | `PageTop`, `ListHeader`, `SkeletonRows`, `ErrBox`, `StaleNote`, `Avatar`, `Pill`, `ContactButtons`, `Updated` | |
| Drivers board | `/drivers/board` · `DriversBoard.tsx` | approve or assign_tasks | Every driver now / the week; Ask drivers | ROW, TABLE (week), STATES | `DriverRow`, `FilterBar`, `SearchBox` (listLocal), `Segmented`, `ListHeader`, `EmptyLine`, `SkeletonRows`, `AskSheet`, `UnavailabilityEditor`, `Avatar`, `Pill` | Week view: table on desktop, day list on phone |
| Move to vehicle | `/drivers/:username/vehicle` · `MoveVehicle.tsx` | assign_tasks or vehicles | Move a driver to a vehicle / swap during a task | FORM, STATES | `PageTop`, `BackButton`, `StickyActions`, `SkeletonRows`, `ErrBox`, `Loading`, `Notice`, `Toast` | |
| Driver page | `/drivers/:username` · `DriverPage.tsx` | assign_tasks or vehicles | Status now and a day's route with playback | DETAIL, STATS, STEP (timeline), STATES | `MapView`, `Tile`, `DayStrip`, `GapsList`, `TimelineIcon`, `Chips` (speeds), `Avatar`, `Pill`, `Plate`, `VehicleThumb`, `ErrBox`, `Loading`, `Empty` | Uses `.ph` header, not `PageTop` |
| Manage a driver | `/drivers/:username/edit` · `DriverManage.tsx` | vehicles or users | Profile sections each with Edit, PIN, switch off | PROF, FORM | `PageTop`, `DraftBanner`, `ProfileSections`, `DriverPhotoCard`, `Loading`, `Notice`, `Toast` | Per-section Save, no StickyActions |
| Settings | `/settings` · `settings/SettingsHome.tsx` (+ `SecurityCard.tsx`) | everyone | The pages under Settings; 2-step sign-in, password | PROF | `Notice`, `TotpEnrol` | `.ph` header |
| My profile | `/settings/profile` · `settings/MyProfile.tsx` | everyone | Own phone, photo, licence | PROF, FORM | `PageTop`, `Avatar`, `DateField`, `LicenceSides`, `FilePick`, `Pill`, `Notice`, `Toast` | |
| Office users | `/settings/users` · `settings/Users.tsx` | users or office_users | Who can sign in | TABLE, STATES | `SearchBox` (listLocal), `ListHeader`, `ListFooter`, `ListStale`, `ListWaiting`, `EmptyLine`, `SkeletonRows`, `Avatar`, `Pill`, `PermissionChips` | No FilterBar (search only) |
| Add office user | `/settings/users/new` · `settings/UserForm.tsx` | users or office_users | create_office_user, link shown once | FORM | `PageTop`, `StickyActions`, `DraftBanner`, `PermissionPicker`, `Secret` | |
| Manage office user | `/settings/users/:email/edit` · `settings/UserManage.tsx` | users or office_users | Name, phone, permissions, link, keys, switch off | PROF, FORM | `PageTop`, `DraftBanner`, `PermissionChips`, `PermissionPicker`, `Secret`, `Avatar`, `Pill`, `Loading`, `Toast` | |
| Fleet settings | `/settings/fleet`, `/settings/fleet/:section` · `settings/FleetSettings.tsx` | users | Dispatch defaults, routing / Google usage | PROF, FORM, TABLE | `PageTop`, `GenericTable`, `TimeField`, `Pill`, `Loading`, `Notice`, `Toast` | 20 `card card-b` blocks in one file |
| App errors | `/settings/app-errors` · `settings/AppErrors.tsx` | users | Crash reports | ROW, STATES | `PageTop`, `EmptyLine`, `Loading`, `Pill`, `Notice` | Loading text, not skeleton |
| Activity log | `/settings/activity` · `settings/ActivityLog.tsx` | users | Who changed what | ROW, STATES | `PageTop`, `DateRangePicker`, `SearchBox` (ListKit), `SwitchLine`, `ListHeader`, `LoadMore`, `EmptyLine`, `SkeletonRows`, `Pill` | |
| Import sites | `/settings/import-sites` · `settings/ImportSites.tsx` | vehicles (web build only) | Spreadsheet import with column mapping, history, undo | FORM, TABLE | `PageTop`, `ListHeader`, `ListFooter`, `EmptyLine`, `SkeletonRows`, `Pill`, `Notice`, `Toast` | |
| Notifications settings | `/settings/notifications` · `settings/Notifications.tsx` | everyone | Pause all, groups, this browser's push | PROF | `SwitchLine`, `Pill`, `Empty`, `Loading`, `Notice`, `Toast` | `.ph` header |
| Notification sounds | `/settings/notifications/sounds` · `settings/NotificationSounds.tsx` | everyone | The site's sounds | PROF | `PageTop`, `SoundCard`, `Loading`, `Notice` | |
| Notification group | `/settings/notifications/:group` · `settings/NotificationGroup.tsx` | everyone | A switch per event | PROF | `PageTop`, `SwitchLine`, `Empty`, `Loading`, `Notice` | |
| More | `/more` · `More.tsx` | everyone (phone tab) | Account card, then the rest of the menu | PROF, ROW | `Avatar`, `dl.kv`, `.more-list` | Shows "Role" (a role word) |
| No access | any guarded route · `NoAccess.tsx` | — | Says the person may not open it | STATES | `.ph`, `card card-b` | |
| Sign in / Set password / Second step / Blocked / Unreachable | outside the shell · `auth/SignIn.tsx`, `SetPassword.tsx`, `SecondStep.tsx`, `Blocked.tsx`, `Unreachable.tsx` (+ `AuthPage.tsx`, `TotpEnrol.tsx`) | signed out / state | Sign-in flow and its states | FORM, STATES | `AuthPage`, `Notice` | |
| Privacy | `/privacy` · `Privacy.tsx` | public | The privacy policy | DETAIL (text) | — | |

### 2.2 Website at phone width (≤ 768 px)

Mechanisms: `ui/phone.ts` `useIsPhone()` (768 px); `ui/Page.tsx` `ListWithDetail` (the detail route alone, full screen),
`StickyActions` (sticky above the tab bar only here), `PageTop`; `styles.css` l.103–127 (rail hidden, `.tabbar` and
`.mhead` shown, 48 px targets, `.tbl-wrap` tables become cards with each cell's column name), l.373–377 (sticky actions),
l.729–749 (Overview's compact rows), l.888–902 (DriverRow and the board as cards); `ListKit`/`listLocal` page with
**Load more** on a phone and a **Pager** on a desktop; `app/nav.ts` `tabsFor` (Home, three by role, More). Plan: this
layout is retired once /m/ covers every function (`docs/phase8-plan.md` §7).

| Screen | Route / file | Permission | What it is for | Patterns | Shared components | Notes (distinct or reflow) |
|---|---|---|---|---|---|---|
| Shell | `app/Shell.tsx` | — | Mobile header (FF, date, bell) + bottom tab bar | — | `InboxBell`, `PullToRefresh`, banners | **Distinct**: rail → `mhead` + `tabbar` (`tabsFor`) |
| Overview | `/` · `Overview.tsx` | as desktop | Home on a phone | DASH, ROW, STATS | as desktop + `.home-action` | **Distinct**: one big `home-action` button (`homeAction`), 3 rows a section (`SECTION_ROWS.phone`), On the road rows hide avatar and actions, a tile's panel redirects to the full page (`FULL_PATH`) |
| Tasks, Requests, My trips, Issues, Vehicles, Fuel, Places (lists with a detail) | `ListWithDetail` in each | as desktop | List → full-screen detail | ROW/TABLE → cards, DETAIL | `ListWithDetail` | **Distinct**: the detail replaces the list (no split); the board's columns stack at 620 px (`.board` 1 column) |
| Task detail, Request detail, Issue, Vehicle detail, Fuel fill, Place | child routes | as desktop | Detail full screen | DETAIL | `PageTop` (Issue: own header) | **Distinct only by being full screen**; content reflows. IssuePage swaps X for a back arrow (`useIsPhone`) |
| Requests, My trips, Drivers, Vehicles, Places, Users, Duty log, Task history, Fuel, Mileage tables, Fleet settings tables, Import sites | `.tbl-wrap` tables | as desktop | Tables as cards | TABLE → card | `.tbl-wrap` CSS | **Distinct by CSS**: each row a card, cells labelled; phone-only / desktop-only "New request" buttons on Requests and My trips; Load more instead of page numbers |
| Drivers board | `/drivers/board` · `DriversBoard.tsx` | as desktop | Drivers now / week | ROW, TABLE | `DriverRow`, `useIsPhone` | **Distinct**: rows become cards; the week is a day list instead of the `table.wk` |
| Forms (Assign a task, New request, Decide, Edit request, Change a task, Edit stops, Add driver, Register vehicle, Add user, Ask drivers, Move to vehicle) | each form page | as desktop | Same form | FORM | `StickyActions` | **Partly distinct**: the button row becomes sticky above the tab bar, primary/dark buttons full width; fields reflow (`.stop-grid` one column at 480 px). Still one long page, not steps |
| Plan map (inside the forms and Task detail) | `PlanMap.tsx` | as desktop | Map + timeline | STEP | `useIsPhone` | **Distinct**: phone map height `PLAN_MAP_PHONE_PX`, no hover link to pins |
| Live locations, Driver page | `Live.tsx`, `DriverPage.tsx` | as desktop | Map pages | DETAIL | `.live-layout`, `.driver-layout` | **Reflow** at 900 px: one column, map first |
| Sheets (filters, dates, times, Ask drivers) | `ui/Sheet.tsx`, `asks/AskSheet.tsx` | — | Pickers | — | `Sheet` | **Distinct**: bottom sheet instead of popover / dialog |
| More | `/more` · `More.tsx` | everyone | The phone's hub | PROF, ROW | — | Phone only (the rail replaces it on a desktop) |
| All other screens (Reminders, Notifications inbox, Projects, Maintenance, Mileage tiles, Questions, Answers, Manage a driver, Settings pages, Auth, Privacy, No access) | — | as desktop | — | as desktop | — | **Reflow** only (`.two` and `.tiles` collapse at 900/1150 px; 48 px targets) |

### 2.3 Office mode (app) and the mobile website /m/

All 50 screens below are also on /m/ (generated re-exports in `apps/driver/src/web-app/office/**`). Web-only differences
in the same files: More and Profile show "Switch to desktop view" (`Platform.OS === 'web'`), Notifications hides "Phone sound
and vibration", Profile hides Take photo, `PhotoPick` hides Open settings; maps via `*.web.tsx` twins (`DriversMap.web`,
`TaskMap.web`, `RouteMap.web`, `PinAdjust.web`), uploads via `office/mediaFile.web.ts`, push via `BrowserPush.web.tsx`.
Permission = the nav rule (`office/nav.ts` `tabsFor`, `moreFor`, `homeSections`) or the tool the screen calls; screens have
no route guard (only Task history and Vehicle document say "no access").

| Screen | Route / file (`app/office/…`) | Permission | What it is for | Patterns | Shared components | Notes |
|---|---|---|---|---|---|---|
| Tabs layout | `(tabs)/_layout.tsx` | — | Bottom bar by permission, amber pill | — | `Badge`, `RouteCrash` | |
| Home | `(tabs)/index.tsx` | everyone (sections by permission) | Needs you now, today's tasks, on the road, my trips | DASH, ROW, STATS, STATES | `TopBar`, `StatTiles`, `Section`, `Row`, `Avatar`, `Pill`, `Divider`, `NewTripButton`, `SavedNotice`, `Sheet`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Pilot (c) |
| Approve | `(tabs)/approve.tsx` | approve | The request queue with search + Filter | ROW, STATES | `DarkHeader`, `FilterBar`, `Section`, `Row`, `Avatar`, `StatusChip`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | Request row differs from Home's |
| Tasks | `(tabs)/tasks.tsx` | assign_tasks | A day's tasks grouped by state | ROW, STATES | `DarkHeader`, `DayStrip`, `Section`, `Row`, `Divider`, `Button`, `SavedNotice`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | "Assign a task" full-width button in the list (Home uses a FAB); History as a pill in the dark header; section names Sent / On the way / Done vs site Assigned / In progress / Completed |
| Drivers (board) | `(tabs)/drivers.tsx` | approve or assign_tasks | Drivers now / attendance / week; Ask drivers | ROW, STATES | `DarkHeader`, `ChoiceChip(s)`, `FilterBar`, `AskDriversSheet`, `Sheet`, `TimeField`, `TripDayPicker`, `DateField`, `VehicleChipView`, `Avatar`, `StatusChip`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Own card rows (radius 14), not `Row` / `DriverChoiceRow`; view switch with ChoiceChips (Reports uses `Segmented`) |
| Live | `(tabs)/live.tsx` | view | Map of drivers, rows, a bottom card | ROW, DETAIL (card), STATES | `DriversMap`, `FilterBar`, `PlaybackBar`, `Sheet`, `DriverDot`, `VehicleChipView`, `pickedStyle`, `Pill`, `StatusChip`, `SavedNotice`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Own slim dark top bar (6th header variant); own rows |
| My trips | `(tabs)/trips.tsx` | request | The person's requests and tasks | ROW (cards), STATES | `DarkHeader`, `FilterBar`, `StatusChip`, `ReasonSheet`, `SavedNotice`, `Notice`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Standalone cards (radius 16), not `Row` in a `Section` |
| Alerts | `(tabs)/alerts.tsx` | everyone | Notification centre, grouped by day | ROW (cards), STATES | `DarkHeader` (bell off), `FilterBar`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Cards radius 16 with amber unread edge and an icon tile |
| More | `(tabs)/more.tsx` | everyone | Profile row, Work / People / Settings, Sign out | PROF, ROW | `DarkHeader`, `FilterBar` (search only), `Section`, `Row`, `Avatar`, `Divider`, `ListEmpty`, `Button` | |
| Office layout | `_layout.tsx` | office sign-in | The stack and its crash screen | — | `RouteCrash` | |
| Approve a request / request detail | `request/[id].tsx` | approve (decide) or request (own) | Decide, cancel booking, tell requester, timeline | DETAIL, STEP, ROW, BANNER, STATES | `BackHeader`, `Screen`, `Section`, `Pill`, `Avatar`, `ChoiceRow`, `DriverChoiceRow`, `TaskDriverCard`, `VehicleGroups`, `AskDriversSheet`, `TellRequester`, `ReasonSheet`, `SavedNotice`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Pilot (b) |
| Change time (approve) | `request/[id]/time.tsx` | approve | The day, leave-by, back-by before approving | FORM | `BackHeader`, `TripDayPicker`, `TimeField`, `PlaceSearch`, `Sheet`, `Section`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed` | Reason under the button |
| Task detail | `task/[id].tsx` | assign_tasks | Status, steps, driver, stops, actions | DETAIL, STEP, BANNER, STATES | `BackHeader`, `Screen`, `Section`, `Pill`, `TaskDriverCard`, `StopTimeline`, `TaskWarnings`, `TripPurposeCard`, `SwapSegments`, `StopArrival`, `TaskMoreDetails`, `ReasonSheet`, `SavedNotice`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Pilot (b) |
| Give it a driver | `task/[id]/driver.tsx` | assign_tasks | The task on top, who can take it below | DETAIL, STEP, ROW, FORM | `BackHeader`, `Section`, `Pill`, `Avatar`, `DriverChoiceRow`, `AskDriversSheet`, `ReasonSheet`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Hand-built stop list with S marks (`styles.mark`) |
| Change the task | `task/[id]/time.tsx` | assign_tasks | update_task: time, driver, vehicle, title | FORM | `BackHeader`, `TripDayPicker`, `TimeField`, `DepartureNote`, `Stepper`, `MoreDetails`, `DriverRows`, `AskDriversSheet`, `ChoiceChip`, `ChoiceRow`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ErrorNotice` | Reason ABOVE the button (other StickyActions: under) |
| Plan on the map | `task/[id]/plan.tsx` | assign_tasks | The stored plan on the task map | DETAIL, STEP | `BackHeader`, `TaskMap`, `Section`, `Pill`, `ListEmpty`, `SkeletonRows`, `ListFailed` | |
| Trip purpose | `task/[id]/purpose.tsx` | assign_tasks | Company work / Personal + project | FORM | `BackHeader`, `Segmented`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | |
| Driven route | `task/[id]/route.tsx` | driver_route tool | The task's own GPS route with playback | DETAIL, STEP (timeline) | `BackHeader`, `DayRoute`, `Section` | |
| Swap vehicle | `task/[id]/swap.tsx` | assign_tasks (move_driver_vehicle) | Move the running task to another vehicle | FORM, ROW | `BackHeader`, `ChoiceRow`, `Plate`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Disabled button has no reason |
| Task history | `task-history.tsx` | assign_tasks | Tasks over a date range | ROW, STATS (totals), STATES | `BackHeader`, `DateRangeButton`, `FilterBar`, `Section`, `Row`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | "No access" as a ListEmpty |
| Trip · 1 Where | `trip/where.tsx` | request (request mode) / assign_tasks (task mode) | Start and stops | FORM, STEP | `TripHeader`, `TripFooter`, `PlaceSearch`, `Chips`, `MoreDetails`, `ToggleRow`, `ChoiceChip`, `DurationField`, `ListEmpty`, `SkeletonRows`, `ErrorNotice` | |
| Trip · 2 When | `trip/when.tsx` | same | Day, arrive-by, stay, leave-by | FORM | `TripHeader`, `TripFooter`, `DepartureNote`, `TripDayPicker`, `TimeField`, `DurationField`, `Loading` | Spinner `Loading` while the draft loads |
| Trip · 3 Who | `trip/who.tsx` | same | Who drives, driver, vehicle, details | FORM, ROW | `TripHeader`, `TripFooter`, `WhoDrivesChoice`, `DriverRows`, `DriverChoiceRow`, `VehicleGroups`, `AskDriversSheet`, `Chips`, `MoreDetails`, `Stepper`, `ToggleRow`, `ChoiceChip`, `SkeletonRows`, `ErrorNotice` | |
| Trip · 4 Review | `trip/review.tsx` | same | Plan, timeline, conflicts, send | STEP, FORM, BANNER | `TripHeader`, `TripFooter`, `TaskMap`, `TimeField`, `Pill`, `Plate`, `Loading`, `ErrorNotice` | Pilot (a) |
| Ask drivers: questions | `asks/index.tsx` | approve or assign_tasks | Questions of the last 7 days | ROW, STATES | `BackHeader`, `Section`, `Row`, `Pill`, `Divider`, `LoadMore`, `ListEmpty`, `ListError`, `SkeletonRows`, `ListFailed` | Uses `ListError` directly (others `ListFailed`) |
| A question's answers | `asks/[id].tsx` | approve or assign_tasks | Each driver's answer | DETAIL, ROW | `BackHeader`, `Section`, `Avatar`, `Pill`, `Divider`, `SkeletonRows`, `ListFailed` | Own answer rows, not `Row` |
| Driver profile | `driver/[username].tsx` | approve or assign_tasks (from the board) | The driver now, this month, Today's route card | DETAIL, PROF, STATES | `BackHeader`, `Section`, `Avatar`, `Pill`, `Plate`, `Divider`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Second page for the same driver (see Manage a driver) |
| Driver's day route | `driver/[username]/route.tsx` | driver_route tool | A day's route with playback | DETAIL, STEP (timeline) | `BackHeader`, `DayStrip`, `DayRoute`, `SkeletonRows`, `ListFailed` | |
| Issues | `issues/index.tsx` | issues or assign_tasks | The issues list | ROW, STATS (chips), STATES | `DarkHeader`, `Chip`, `FilterBar`, `Section`, `Avatar`, `StatusChip`, `Plate`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | Stack screen with `DarkHeader`: no back arrow; header `Chip`s (Home moved to StatTiles); own rows |
| Issue | `issues/[id].tsx` | issues or assign_tasks | One issue; take, note, resolve, snooze | DETAIL, BANNER, FORM | `BackHeader`, `Section`, `Row`, `Pill`, `Avatar`, `Plate`, `Sheet`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | |
| Maintenance | `maintenance/index.tsx` | issues (site: vehicles) | Vehicle problem reports | ROW, STATES | `BackHeader`, `FilterBar`, `Section`, `Row`, `Plate`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | Permission differs from the site |
| Problem report | `maintenance/[id].tsx` | issues | One report; status, note, off the road | DETAIL, FORM | `BackHeader`, `Section`, `Pill`, `Field`, `Plate`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | |
| Move to vehicle | `move/[username].tsx` | assign_tasks or vehicles (from Live) | Give a driver another vehicle | FORM, ROW | `BackHeader`, `FilterBar`, `Plate`, `StickyActions`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Hint always under the button |
| Notifications | `notifications/index.tsx` | everyone | Pause all, groups, phone sound | PROF | `BackHeader`, `Section`, `RowCard`, `SwitchRow`, `LinkRow`, `BrowserPush`, `Divider`, `ListEmpty`, `SkeletonRows`, `ErrorNotice` | |
| Notification group | `notifications/[group].tsx` | everyone | A switch per event | PROF | `BackHeader`, `RowCard`, `SwitchRow`, `Divider`, `ListEmpty`, `SkeletonRows`, `ErrorNotice` | |
| Activity log | `people/activity.tsx` | users | Who changed what | ROW, STATES | `BackHeader`, `DateRangeButton`, `FilterBar`, `ToggleRow`, `Section`, `Row` (quiet), `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | |
| Add a driver | `people/driver-new.tsx` | users or vehicles (create_driver) | create_driver, PIN shown once | FORM | `BackHeader`, `Field`, `Notice`, `StickyActions`, `ErrorNotice` | |
| People · Drivers | `people/drivers.tsx` | users or vehicles | Driver accounts list | ROW, STATES | `BackHeader`, `FilterBar`, `Section`, `Row`, `Avatar`, `StatusChip`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | |
| Manage a driver | `people/driver/[username].tsx` | users or vehicles | Details, photos, account, PIN | PROF, FORM | own dark header, `Section`, `Avatar`, `Pill`, `PhotoPick`, `DateField`, `Sheet`, `Field`, `Notice`, `SavedNotice`, `Divider`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | Hand-built dark header with Call / WhatsApp / Today's route |
| Quick settings | `people/settings.tsx` | users | Settings saved at once | PROF | `BackHeader`, `Section`, `Toggle` (PeopleParts), `ChoiceRow`, `TimeField`, `Divider`, `Loading`, `ErrorNotice` | `PeopleParts.Toggle` vs `Controls.ToggleRow` vs `NotifParts.SwitchRow`: three switch rows; spinner `Loading` |
| Manage an office user | `people/user/[email].tsx` | users or office_users | Name, phone, permissions, link, switch off | PROF, FORM | `BackHeader`, `Section`, `Avatar`, `Pill`, `Field`, `ToggleRow`, `PermissionPicker`, `SecretCard`, `Notice`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | |
| Add an office user | `people/user-new.tsx` | users or office_users | create_office_user, link once | FORM | `BackHeader`, `Field`, `PermissionPicker`, `SecretCard`, `Notice`, `StickyActions`, `ErrorNotice` | |
| People · Office users | `people/users.tsx` | users or office_users | Office accounts list | ROW, STATES | `BackHeader`, `FilterBar`, `Section`, `Row`, `Avatar`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | |
| Places | `places/index.tsx` | vehicles | Places and sites | ROW, STATES | `BackHeader`, `FilterBar`, `Section`, `Row`, `Pill`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | |
| Place | `places/[id].tsx` | vehicles | One place; edit, remove | DETAIL, FORM | `BackHeader`, `Section`, `Field`, `Mono`, `Notice`, `SavedNotice`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | |
| My profile | `profile.tsx` | everyone | Permissions, contact, app, licence | PROF, FORM | `BackHeader`, `Section`, `Pill`, `PhotoPick`, `DateField`, `LanguageSwitch`, `LinkRow`, `Sheet`, `Field`, `Notice`, `Divider`, `ErrorNotice` | |
| Reminders | `reminders.tsx` | issues or assign_tasks | What Home's reminders row counts | ROW, STATES | `BackHeader`, `Section`, `Row`, `Pill`, `Plate`, `Divider`, `ListEmpty`, `SkeletonRows`, `ListFailed` | |
| Reports | `reports/index.tsx` | vehicles or assign_tasks | Mileage · Fuel · Duty log | STATS, ROW, STATES | `BackHeader`, `Segmented`, `DateRangeButton`, `FilterBar`, `Section`, `Pill`, `Plate`, `Divider`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` + local `Tile`, `Rows` | Local Tile duplicates the site's Tile, not `StatTiles` |
| Vehicle document | `vehicles/doc.tsx` | vehicles | Replace a document with photo + expiry | FORM | `BackHeader`, `Section`, `PhotoPick`, `DateField`, `Field`, `StickyActions`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | "No access" as plain Txt |
| Register / edit vehicle | `vehicles/form.tsx` | vehicles | Same form as the site | FORM | `BackHeader`, `DateField`, `ChoiceChips`, `StickyActions`, `ErrorNotice` | Disabled state has no reason |
| Vehicles | `vehicles/index.tsx` | view | Fleet list with Filter | ROW, STATES | `BackHeader`, `FilterBar`, `Row`, `Pill`, `Plate`, `LoadMore`, `ListEmpty`, `SkeletonRows`, `ListFailed` | Rows not inside a `Section` card |
| Vehicle | `vehicles/[reg].tsx` | view | One vehicle, photo, documents | DETAIL | `BackHeader`, `Section`, `Pill`, `PhotoPick`, `Notice`, `Divider`, `ListEmpty`, `SkeletonRows`, `ListFailed`, `ErrorNotice` | |
| Sign in (shared) | `app/login.tsx` (also `web-app/login.tsx`) | — | Driver \| Office tabs | FORM | `Card`, `Field`, `Notice`, `LanguagePill` | Listed in 2.4 |

### 2.4 Driver app

Everyone here is a driver (Login is shared with Office mode). Root stack: `app/_layout.tsx` (`headerShown: false`, every
screen draws its own header); tabs `app/(tabs)/_layout.tsx` (5 tabs: Today, Mileage, Fuel, Report, Me; the design has 4).

| Screen | Route / file (`app/…`) | Permission | What it is for | Patterns | Shared components | Notes |
|---|---|---|---|---|---|---|
| Today | `(tabs)/index.tsx` | driver | Greeting, vehicle, duty, NEXT TASK card, later today | DASH, ROW, STEP, BANNER | `DutyHeader`, `DutyNotices`, `TrackingNotice`, `StopTimeline` (components/task), `TaskList`, `CallButtons`, `DeclineSheet`, `RunningLate`, `LanguagePill`, `Thumb`, `Plate`, `PlateText`, `Card`, `Notice`, `Button` | Matches design `Driver · Today.png`; empty state hand-built |
| Mileage | `(tabs)/mileage.tsx` | driver | Month km vs allowance, today's tasks with km | STATS, ROW | `Card`, `Plate`, `Mono`, `Stretches`, `LoadMore`, `Button` | Stats as a card with a progress bar; own rows; empty = muted text |
| Fuel | `(tabs)/fuel.tsx` | driver | Month's fills and their video state | ROW | `Card`, `Plate`, `Mono`, `LoadMore`, `Button` | Own rows |
| Report | `(tabs)/report.tsx` | driver | Report a problem, earlier reports with status | FORM, ROW | `ReportForm`, `Card`, `Notice`, `LoadMore`, `Button` | Hand-made status chip (radius 10) |
| Me | `(tabs)/me.tsx` | driver | Photo, profile, language, vehicle, this month, sign out | PROF | `Card`, `Thumb`, `Plate`, `CallButtons`, `LanguageSwitch`, `Notice`, `Button` | 8 Cards |
| Task (preview / in progress / finished) | `task/[id].tsx` | driver | The designed task screen; preview before start | DETAIL, STEP, STATS, BANNER | `TaskMap`, `TaskPreview`, `ArrivalButton`, `SlideToConfirm`, `GeofenceCard`, `SwapCard`, `StopProgressLine`, `CallButtons`, `ApprovedLine`, `RunningLate`, `SkipSheet`, `StopTimeline`, `TrackingNotice`, `GoogleCredit`, `Notice`, `Button` | Pilot (d) |
| All today's tasks | `today-tasks.tsx` | driver | Every task today and coming up | ROW | `TaskList`, `TaskRows`, `Card`, `LoadMore` | Own header |
| Log mileage (6 modes) | `log-mileage.tsx` | driver | Odometer photo, fuel, Save & finish / Start / manual / swap | FORM, BANNER | `VehicleConfirm`, `PlateText`, `Card`, `Field`, `Segmented`, `Notice`, `Button` | Matches design `Driver · Log mileage.png`; Save inside the scroll |
| Record the fill | `record-video.tsx` | driver | Full-screen camera with checklist | FORM | `CameraView`, `Notice`, `Button` | |
| Report a problem | `report-problem.tsx` | driver | ReportForm on top of a task | FORM | `ReportForm` | Own header |
| Start a trip | `start-trip.tsx` | driver | Purpose, place, note, Start | FORM | `PlaceSearch`, `Segmented`, `Card`, `Field`, `Plate`, `Notice`, `Button` | Own bottom bar |
| Add a stop | `add-stop.tsx` | driver | A stop on the driver's own trip | FORM | `PlaceSearch`, `Notice`, `Button` | Own bottom bar |
| Choose vehicle | `vehicle.tsx` | driver | Today's vehicle / change vehicle | FORM, ROW | `ChoiceCard`, `Thumb`, `Notice`, `Button` | Spinner while loading |
| A question from the office | `ask/[id].tsx` | driver | One-tap answer | FORM | `ChoiceChip`, `Card`, `Notice`, `LocationDisclosure`, `Button` | |
| Availability | `availability.tsx` | driver | Times I can't take trips | ROW | `Card`, `Notice`, `Button` | Own rows in Cards |
| Add / change availability | `availability-edit.tsx` | driver | Day, part of day, reason | FORM | `TripDayPicker`, `DateField`, `TimeField`, `ChoiceChip`, `ChoiceRow`, `Card`, `Field`, `Notice`, `Button` | |
| Documents | `documents.tsx` | driver | Held vehicle's roadside documents | ROW | `PlateText`, `Card`, `Notice`, `Button` | Expiry as coloured text, not a chip |
| Edit profile | `profile-edit.tsx` | driver | Phone, WhatsApp, emergency contact, licence | FORM, PROF | `DateField`, `Thumb`, `Card`, `Field`, `Notice`, `Button` | |
| Add your photo | `profile-photo.tsx` | driver | Photo step / change photo | FORM | `Thumb`, `Notice`, `Button` | |
| Your phone number | `phone-prompt.tsx` | driver | Required phone number | FORM | `Card`, `Field`, `Notice`, `Button` | |
| Phone setup | `phone-setup.tsx` | driver | Brand battery / auto-start steps | PROF | `PhoneSetupSteps`, `Card`, `Button` | |
| Permissions | `permissions.tsx` | driver | First-run location, notifications, battery | FORM | `LocationDisclosure`, `PhoneSetupSteps`, `Card`, `Button` | Dark header block |
| Sign in | `login.tsx` | everyone | Driver \| Office sign-in | FORM | `Card`, `Field`, `Notice`, `LanguagePill`, `Button` | Dark header block; not designed for drivers, design 01 for Office |

---

## 3. Pilot screens

### (a) Trip Review (Office mode `app/office/trip/review.tsx`; site equivalent: none as a step)

**Structure, top to bottom.** `TripHeader` (dark; back chip; "New trip · step 4 of 4" / "Assign a task …"; title
"Review"; four amber progress bars) → `Screen` with no padding → `TaskMap` 300 px (both engines, `previewTask(p)`) → a
padded column: reapproval line (amber text) · "Planning…" `Loading` spinner or "Updating plan…" small blue text · the plan
reasons as amber bold text · (no time at all) a `TimeField` "Leave by" with its reason · **Leave by** block (label + 34 px
mono time; right side "94 km · 2 h 51 min" and "back at … 15:40") with the leave note · the **timeline** hand-built:
per stop a 54 px mono time column, a 28 px disc (`styles.mark`: S amber, number ink, B outlined) and the place with an
"on time / N min late" `Pill`, then the times line; per leg a small text line indented 66 px · conflict cards (`styles.conflict`:
1.5 px red border, radius 14, outline buttons Open that task / Call / WhatsApp / Pick another) · plan notes · the chips row
(hand-built `styles.chipRow` for driver + `Plate`, custodian, who drives; `Pill` size 15 for contact, notes, passengers) ·
vehicle-used line · error (`ErrorNotice` or red text). Bottom: `TripFooter` (page background, top border) with the problem
line above the button, primary "Send to <driver>" / "Send request" / "Book now" / "Save changes" / "Send for approval" /
"Save trip", and "Save as waiting" outlined beside Book now; the approval note under it.

**Inconsistent with the rest.** The timeline is a fourth hand-built stepper: it does not use
`components/office/StopTimeline.tsx` (task detail) nor share marks with Approve (`request/[id].tsx` uses a 30 px mark, Review
28 px); the site shows the same plan with `PlanTimeline.tsx` (no discs, "Stop 2 · Drop" text, legs with a left rule). Two
chip shapes in one row (`chipRow` with radius 999 and `#ebe9e3` vs `Pill`). The problem line sits above the button (the
principle and `StickyActions` put the reason under it). Loading is a spinner (`Loading`), not a skeleton. Conflict cards are
local (the site has `ConflictCards.tsx`, used on NewTask / Decide / TaskEdit). The design (`design/office/png/09 Trip · 4
Review.png`) matches the overall order (map, LEAVE BY, timeline with time column, chips, amber Send) but has map controls
and the plan's source chip on the map, and the chips carry the plate inside a bordered chip.

**Site equivalent.** No review step: `NewTask.tsx` / `NewRequest.tsx` / `RequestEdit.tsx` / `TaskStops.tsx` are one long
page; the plan shows inline in `TripEditor.tsx` `TripPlanCard` → `PlanMap.tsx` `PlanWithMap` (map + `PlanTimeline`), with
`ConflictCards` and `WarningsNote` after it and `StickyActions` at the end.

**Pattern to follow.** RouteStepper (one component for a planned trip and a live task: time column, S / 1..n / B marks,
leg lines, the late/on-time chip) + StatsRow for "Leave by · km · drive time · back at" + Forms (one sticky footer, the
reason under the button) + StatusBanner for conflicts and reapproval.

### (b) Request detail and Task detail

**Site `screens/RequestDetail.tsx`.** `PageTop` (title "Vehicle request" / "Proposed task", eyebrow = `RequestStatusPill`,
action "Review" small dark button) → one `card card-b`: `RequestHead` (avatar + asker / "Task" pill + title), `LateNotice`,
the changed notice, a `dl.kv` (When, Back by, Route, Need/Passengers, Who drives, Licence, Contact, Notes, Note, Declined
because, Cancelled because, Expired), `Timeline`, `DecidedBy`, `ReviewingLine`, Call office → `AssignedBlock` → `TellRequester`
→ `TripSection` (PlanWithMap) → proposal checks notice → an `.acts` row (Open the task →, Edit request, Request again
primary, Withdraw) → inline withdraw confirm → "Approve or decline" dark link or an info Notice → inline Cancel booking
confirm. Off-pattern: the `dl.kv` is a copy of `RequestDetailCard.tsx` (used by the decide pages); actions are spread over
the header, a middle row and the bottom; cancels are inline boxes; load errors show a Notice with no Try again; `Loading`
text instead of a skeleton.

**Site `screens/TaskDetail.tsx`.** `PageTop` (title, eyebrow = status `Pill` (`cap(t.status)`) + `TripTags` + mono start;
action "Change" or "Give it a driver") → needs-driver `Notice` (bad) with Find a driver → `WarningsNote` → finish flag
`Notice` → `card` with `dl.kv` (Driver as `DriverLine` + `ContactButtons`, Vehicle with thumb, Status line, Accepted, Leave
by, ETA, The driver says, Passengers, Contact with Call / WhatsApp buttons, Charged to, Sent · seen, Started · done, Odometer,
Km, Assigned by, Approved, Cancelled because, Notes) → `TripPurposeCard` → Reopen → unlogged-km Notice → declined Notice →
warnings saved → `TaskRoute` (map) → section "Stops" + `StopProgress` (dots) with Map buttons and Edit stops → section "Plan"
+ `PlanWithMap` → "Vehicle swap" rows → "Odometer and fuel" rows → "Problems reported" rows → `.acts` (Change the task,
Cancel task → the edit page #cancel) → "History" `dl.kv`. Off-pattern: Change is offered twice; Cancel lives on another
page; the stops appear twice in two forms (StopProgress and the PlanTimeline inside PlanWithMap); status as a capitalised
code; no sticky actions.

**Office `app/office/request/[id].tsx`.** `BackHeader` (title; subtitle "Request · asker · asked") → `SavedNotice` → a row
of `Pill`s size 15 (status in words, "also looking", late) → Expired `Section` with Request again → Decided `Section` → a
hand-built trip card (`styles.tripCard`, radius 18, padding 18: asker avatar line, date label, "Leave by" 28 px, rows with
30 px marks, totals line, Call requester button) → changed-time strip with Undo + "Change time" button → `TellRequester` →
"Who drives" `Section` (`TaskDriverCard`, two `ChoiceRow`s) → Vehicle `Section` (`VehicleGroups`) or "Who's available"
`Section` (`DriverChoiceRow` list, Ask drivers link) → Timeline `Section` (events with a 92 px mono date column) → Cancel
booking (danger-text) / Edit / Withdraw buttons inline → `ErrorNotice`. Bottom: `StickyActions` with Approve (· send to
<name>), the reason under it, Decline outlined red; or "Done" after a decision. Sheets: `AskDriversSheet`, two
`ReasonSheet`s.

**Office `app/office/task/[id].tsx`.** `BackHeader` (title; subtitle "Task · start · asked by / made by") → skeleton /
error → `SavedNotice` → `Pill` row (status `office.status.*` lower case, late amber, label, driver-started, finish flag) →
needs-driver red box (`styles.needs`) → cancelled / missed line → `TaskWarnings` → `styles.card` with the **5-step strip**
(Approved · Accepted · On the way · Arrived · Done; blue done dots, amber ring for now) + approved by · plan vN →
`styles.card` with `TaskDriverCard` and the "now near … · Live map" strip → `TripPurposeCard` → Stops `Section`: a hand-built
S row, `StopTimeline`, a hand-built B row, notes → km line → `SwapSegments` → "Show the driven route" button → button pairs
(Reassign / Cancel; Change time / Change stops) → Swap vehicle → Reopen card → requester line with Call → `TaskMoreDetails`
fold → `ErrorNotice`. No sticky bar. The design (`design/office/png/14 Task detail.png`) puts the title, subtitle and the
pills inside a dark header, shows "Stops · planned vs actual" with the S / 1 / B marks, and the action buttons in a 2×2 grid
with "Change time or stops" as one button.

**Inconsistent with each other and the rest.** Header: status in `PageTop`'s eyebrow (site) vs a pill row in the body
(Office) vs inside the dark header (design 14). Status words differ (`cap(status)` "In progress" vs "on the way"). Facts: a
`dl.kv` grid (site) vs prose lines and cards (Office). Stops: `StopProgress` dots (site) vs numbered `StopTimeline` with
hand-built S/B rows (Office) vs a hand-built trip card on the request (Office). Primary action: Office request detail has a
sticky Approve / Decline; Office task detail has none; the site has neither. Card containers: `Section` (radius 18, padding
16) mixed with `styles.card` (radius 18, padding 16, gap 12) and `styles.tripCard` (padding 18). Cancel: inline confirm (site)
vs ReasonSheet (Office).

**Pattern to follow.** Detail page: one header (back, title, one-line subtitle, the status chip in a fixed place), a
StatusBanner slot for needs-a-driver / late / changed / saved warnings, a StatsRow for times and km, the RouteStepper for
the stops (start and back included as steps), facts as one key-value block, then one sticky action bar (primary + at most
one secondary, the rest in an overflow sheet), confirmations in a sheet.

### (c) Office Home (`app/office/(tabs)/index.tsx`)

**Structure.** `TopBar` (light: greeting + date, bell) → `Screen` (pull to refresh) → `SavedNotice` → `StatTiles` light
(On the road blue, Free, In garage; each opens its list) → `ListFailed` → heading "Needs you now" (20 px) → `Section`
Requests to approve ("View all"; `Row` with avatar, title, line, asked text on the right) → `Section` Needs a driver (red;
`Row` with a red "Give a driver" button, or a red `Pill` without assign_tasks; an empty line when none) → `Section` Needs
attention (`Row` with chevron, severity `StatusChip`, expandable group, a "Snooze" text button per group) → a standalone
`Row` "N reminders due" with a bell, outside any section → `Section` Today's tasks ("Board"; `Row` with time column, chip;
"All today's tasks (N)" blue line) → `Section` On the road ("Live map"; `Row` with Avatar without the photo, chip Under way /
On duty) → `Section` My trips ("View all"; rows open the Trips tab) → `NewTripButton` FAB (amber, bottom right) → snooze
`Sheet`.

**Inconsistent with the rest.** The only screen with `TopBar`; every other tab has `DarkHeader` (designs 02–05 show the dark
header with chips and two big buttons). The only `StatTiles` user, while Issues still has header `Chip`s and Reports a local
`Tile`. Rows in one screen use four right-hand treatments (text, button, chip, pill). Section link words vary ("View all",
"Board", "Live map") and Today's tasks has a second link line. The Free tile counts in-garage vehicles (see 1.3 item 3).
Versus the site Overview: different sections (no Today's tasks there; two issue sections there), different visibility (site
hides Needs a driver at 0), different stats (6 vs 3), no collapse, no best match on needs-a-driver rows. My trips rows open
the tab, not the trip.

**Pattern to follow.** Dashboard: one header (decide TopBar or DarkHeader for all tabs), one StatsRow at the top with the
same counts and rule as the site, sections from one ordered list per permission shared with the site, each section with
one link word ("View all (N)") and the shared List row with one right-hand slot (chip, or a single action button for
needs-a-driver), Empty states only where a section is always shown.

### (d) Driver · Task in progress (`app/task/[id].tsx` vs `design/png/Driver · Task in progress.png`)

**Design.** Map (back button top left, "Sharing location" pill top right, destination label) → a white sheet with a grab
handle → "IN PROGRESS" blue label + "Started 07:06" mono → destination 28 px heavy → "Team drop · 5 passengers" → a grey
stats box with **three** values (Distance left 38 km, Arrive about 08:25, Start odo 84,512) → Navigate | Call contact
(outline, side by side) → **Complete task** (dark, full width) → "Report a problem with the vehicle" (red text).

**Current, top to bottom (running).** Map at 40 % of the height (`TaskMap`, both engines) with the round back button and the
sharing pill → sheet with grabber → line note (Google line / no route line) → label + "Started HH:MM" → current stop name
28 px + `GoogleCredit` + "title · people" → trip problem `Notice` → `TrackingNotice` → `GeofenceCard` → `SwapCard` → stats
box with **two** values (Distance left by road or ≈ straight line, Start odo) → GPS km line → **every stop as a bordered
card** (`styles.stopCard`, radius 12; current stop blue 2 px border and tint; "Current stop · Stop 2 · Drop", place,
`StopProgressLine`, note, Skip (red text) or a done check; the current stop's `ArrivalButton` slides; out-of-order slides)
→ Add a stop → Navigate | Call contact → All stops in Google Maps → `CallButtons` (WhatsApp, requester, fleet admin, office)
→ `ApprovedLine` → `RunningLate` → "needs last stop" `Notice` → Complete task (dark) → Report a problem (danger text).
Assigned: `TaskPreview`. Finished: `StopTimeline` (components/task.tsx), people, notes, km + `Stretches`, Back to Today.

**Inconsistent.** "Arrive about" is missing although the stop progress already has an estimate (`lib/stopProgress.ts`,
shown per stop as "about 12:10"); the stats box has two cells. The design's order (stats → Navigate/Call → Complete) is
pushed below a full list of stop cards, so the primary actions are far down the sheet. The stop list here is cards with
borders, while the same driver sees the rail timeline (`components/task.tsx`) on Today, the preview and the finished task,
and the office sees `StopTimeline` (Office) / `StopProgress` (site) for the same task. The header is a floating back button
(no title bar) — fine for a map screen, but its loading state is a full-screen spinner and the "gone" state a Notice + button,
unlike any shared state component.

**Pattern to follow.** Detail page (map variant: map + draggable sheet) with a StatsRow of three (distance left, arrive
about, start odo), the RouteStepper in its compact live form (current stop expanded with its slide, the others one line
each, the same marks as the office's), the primary actions (Navigate, Call, Complete) kept in the designed order and
position, StatusBanners (tracking, geofence, swap) in one slot above the stats.

### (e) Site Overview (`apps/office/src/screens/Overview.tsx`)

**Structure.** `section.view` → `.ph` (eyebrow long date, h1 "Overview"; desktop-only "New request" and "Assign task") →
phone-only `.home-action` big button (`homeAction`) → `ErrBox` / `SkeletonRows` while loading → `.split` (list + optional
`aside.split-detail` with `OverviewPanel` for `?open=`) → `StaleNote` → sections in the order `overviewSections(me)` gives,
two to a line where `inLines` allows: Requests to approve (`RequestLine` with "Decide"), Needs a driver (only when any;
`NeedsDriverLine`), Critical issues (only when any; `IssueLine` with snooze / dismiss strip), At a glance (6 `Tile`s: on
the road, free now, in garage, tasks today, requests, reminders), On the road (`RoadRows`), Needs attention, My trips
(`TripLine`) → info Notice for requesters. Every section is the collapsible `overview/Section.tsx` card with "View all (N)",
a summary when folded (remembered per person).

**Inconsistent.** The tiles sit in a section after the action sections for approvers and dispatchers (the boss's design
`Desktop · Overview.png` puts 4 tiles first, then On the road and Needs attention side by side, then the requests as a table
with Decline / Approve & assign). Rows: `RequestLine` and `NeedsDriverLine` are separate from `Requests.tsx`'s table rows and
from `NeedsDriverList.tsx` (the needs-a-driver row is written twice). Empties use `Empty`; lists elsewhere use `EmptyLine`.
Office Home differs as listed in (c). On the phone: a big button + 3 rows a section; a tile opens a full page.

**Pattern to follow.** Dashboard: StatsRow first (the design's four tiles, the same set and rules on both surfaces), then
the action sections with the shared List row and one "View all (N)" link, the side panel as the Detail-page panel.

### (f) Site Tasks (`apps/office/src/screens/Tasks.tsx`)

**Structure.** `ListWithDetail` → `.ph` (eyebrow "Today · date", h1 "Tasks", History and "Assign a task" primary) →
`NeedsDriverList` (red card with rows) → `DayStrip` (week strip) → `.board` grid: Waiting approval column (only when any),
Assigned (amber dot), In progress (blue), Completed, Needs a driver (only when any, last) — each column `.col` with a count
and `TaskCard` buttons (time, label, title, `TripTags`, From / To, Leave by · ETA · late, `LateReportLine`, `DriverLine`
with vehicle chip and thumb, status as coloured text, approved by, finish-flag pill), "No tasks" text when empty, `LoadMore`
per column → cancelled count + `Updated`. `?filter=needs_driver` shows only the needs-a-driver list. The detail opens beside
it (desktop) or full screen (phone); columns stack at 620 px.

**Inconsistent.** Column names (Assigned / In progress / Completed) differ from Office mode's sections (Sent / On the way /
Done) and from Office's chips (Sent / Under way / Done); declined tasks appear both in the red block on top and as the last
column; the card's status is coloured text, not the chip used elsewhere; the empty column is a bare `<p>` (not `EmptyLine`);
Office mode shows the same day as a single list with needs-a-driver first. The design (`Desktop · Tasks.png`) has
Yesterday / Today / Tomorrow, three columns and Assign a task as a side panel; the plate chip on the card matches.

**Pattern to follow.** Desktop table / board for the desktop, the shared List row for each task (one task row component
for every surface: time, title, driver + plate chip, the status chip with one vocabulary), Empty state component per
column, StatusBanner for needs-a-driver (not also a column).

---

## 4. Shared-component notes for the design pass

- Office `office/ui.tsx` exports never used by a screen: `Empty`, `FilterChips` (`Chip` only by Issues; `Loading` by Review,
  When, Quick settings).
- Switch rows in Office mode: `NotifParts.SwitchRow`, `Controls.ToggleRow`, `PeopleParts.Toggle` (three); the site has
  `basics.SwitchLine`.
- Sticky footers: `office/ui.tsx StickyActions` (card bg), `components/office/TripShell.tsx TripFooter` (page bg, problem
  above), the driver's per-screen bottom `View`s; site `ui/Page.tsx StickyActions` (sticky only ≤ 768 px).
- Headers: Office `DarkHeader`, `TopBar`, `BackHeader`, `TripHeader`, Live's bar, Manage-a-driver's dark block; driver 13
  per-screen copies; site `.ph` (lists), `PageTop` (details, forms, some lists: Task history, Duty log, Reminders, Questions),
  IssuePage's own.
- Search: site `ui/ListKit.tsx SearchBox` and `screens/listLocal.tsx SearchBox`; Office `FilterBar` (also used as a bare search
  on More) and `PeopleParts.SearchBox` (exported, used by no screen).
- Selection, sheets, dates, times and the place search already have one component per codebase (`docs/ui-patterns.md`
  §1–§11) and were not found duplicated, except the site's `asks/AskSheet.tsx` dialog (documented as kept).
