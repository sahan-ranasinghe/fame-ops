# Part B (Round D): the design pass

Sahan, 21–22 October 2026. One design language across the four surfaces (the website at desktop and phone width, the
mobile website /m/, Office mode in the app, the driver app): the same thing looks and reads the same everywhere, each
screen follows a named industry pattern, nothing internal is shown, English and Sinhala alike. First the inventory, then
the patterns below, then a pilot of six screens with before / after screenshots, then **STOP for Sahan's approval**; the
rollout to every other screen only after his OK. `docs/ui-patterns.md` (the controls: filters, dates, times, sheets,
selection, …) stays; this file adds the page-level patterns on top of it.

Done first (from Checkpoint 3's review): the trip rules are one source (`scripts/shared-logic.mjs`: the site's files,
copied to Office mode with only their imports changed; `test:shared-logic` and the site's `sharedLogic.test.ts` fail on a
difference), and M5 (the server's "2 h ago", "in 45 min", an issue's "reported 2 h ago" said in Sinhala on Office mode).

## 1. The inventory (in full: `docs/design-pass-inventory.md`)

58 screens on the site (the same 58 at phone width, 14 with a layout of their own), 50 in Office mode (all 50 on /m/, the
same files), 23 in the driver app. The patterns exist, but each is built several ways. The ten that matter most:

1. A trip's stops are drawn nine ways (site: dots, text rows, S/1/2 discs, From/To; Office: a numbered timeline that greys
   a skipped stop against §16, and hand-built S/n/B marks on four screens; driver: a rail and bordered cards).
2. One state, many words and tones: a running task is "In progress", "on the way", "On the way" and "Under way"; late is
   red in one place and amber in another; two pill components in Office mode.
3. Stats six ways (site `Tile`, Office `StatTiles`, a local copy of `Tile`, header chips, the driver's box and card), and
   Office Home's "Free" counts vehicles in the garage while the site's "Free now" does not.
4. Six header kinds in Office mode (Issues, a pushed screen, has no back arrow); the driver app copies one header into 13
   screens; the status sits in the header on the site, in the body in Office mode.
5. The primary button: the reason under it (StickyActions), above it (the trip editor), or none; no action bar on Office
   task detail; "Change" twice on the site's task page.
6. The same entity drawn differently: a task row with or without its plate, a request three ways inside Office mode,
   a driver five ways.
7. Empty / loading / error states: two empty components on the site, detail pages that fail with no Try again, spinners
   where lists use skeletons, the driver app using none of the shared states.
8. Office lists mix two row systems and four card radii (12, 14, 16, 18).
9. The same part built twice inside one codebase (two search boxes, two pills, three switch rows, two view switchers).
10. Office Home and the site's Overview, the same job, show different sections, tiles and links; My trips rows on Home
    open the tab, not the trip.

## 2. The rules (every screen, every surface)

- **R1 One component per pattern per codebase.** A new screen uses the pattern's component; a second look-alike is a bug.
- **R2 One vocabulary for a state** (§3): the same words and the same tone everywhere, on a chip, in a banner, in a row.
- **R3 Tones mean one thing.** Red = someone must act now (needs a driver, declined, missed, a critical issue, danger).
  Amber = watch it (late, waiting, expiring, a warning). Blue = moving now (on the way, live). Green = done or fine.
  Grey = over or off (cancelled, off duty). Never colour alone: the word is always there too.
- **R4 Numbers, plates, times and LKR in mono, Latin digits**, in both languages; a plate always in its bordered chip.
- **R5 One card**: white, 1 px line, 18 px radius (app) / the site's `.card`. Rows inside a card are divided by a line;
  a list of things is rows in one card, not a card per thing (a card per thing only for a feed: Alerts).
- **R6 One header per kind of screen**: a tab's dark header (title, its one action); a pushed screen's back header (back,
  title, a one-line subtitle, the status chips under the title); a map screen's floating back button.
- **R7 One action bar**: the primary action at the bottom (sticky on a phone), at most one secondary beside it, the rest in
  a "More" sheet; when the primary is disabled, the reason in one line **under** it.
- **R8 Every state of a list or a page**: skeleton while loading (no spinner but on a pressed button), an empty state that
  says what will appear and offers the next step, an error with Try again, never a white screen.
- **R9 Every tappable thing opens its own place** (a row its item, a count its filtered list, a stat its list).
- **R10 Short words, the site's words**, both languages; nothing internal (no codes, no field names, no "null").
- **R11 Phone first, never the site squeezed**: one job per screen; on a desktop the same pattern gets room (panels,
  tables), never different words.
- **R12 The design PNGs win on layout** (`design/png`, `design/office/png`): where a pattern and a design disagree, the
  design's layout with the pattern's component.

## 3. One vocabulary for the states

| State (server) | Chip / words | Tone | Where it shows |
|---|---|---|---|
| task assigned, not opened | Sent | grey | rows, task header |
| task seen / accepted | Seen · Accepted | grey · blue | rows (the chip says the latest) |
| task in_progress | On the way | blue | every surface (never "In progress", "Under way") |
| a stop arrived, not left | At the stop | blue | the stepper, rows |
| late (an ETA or a stop past its time) | Late · 12 min | amber | chip beside the state, the stepper |
| task completed | Done | green | every surface (never "Completed") |
| task declined / not accepted | Needs a driver | red | rows, banner on the task |
| task missed | Missed | red | rows, task header |
| task cancelled | Cancelled | grey | rows, task header |
| request waiting | Waiting | amber | rows, request header |
| request waiting, its leave-by passed | Waiting · late | amber | rows |
| request approved | Approved | green | rows, request header |
| request changed after approval | Changed · decide again | amber | rows, request header |
| request declined / cancelled / expired | Declined · Cancelled · Expired | grey | rows, request header |
| driver live / on duty / off duty | Live · On duty · Off duty | blue · blue · grey | driver rows |
| driver location off / no signal | Location off · No signal | red · amber | driver rows |

The Sinhala is the app's existing keys for the same states (`office.chip.*`, `office.status.*`, `office.line.*`); a
word changed here changes its key's English, never its meaning.

## 4. The patterns

Each: what it is (the industry's pattern it follows), its parts top to bottom, its rules, and the component per codebase.
"New" = made in the pilot; "keep" = exists and becomes the only one.

### 4.1 Dashboard (Uber Fleet's and Samsara's overview; Material 3's "feed")
A greeting / date line; one **StatsRow** first (each surface's design decides its cells, §4.7; the counts follow one rule
everywhere); then the sections in the one order per permission (`overviewSections` on the site,
`homeSections` in Office mode: the same list), each a card with a title, a count and one link "View all (N)", its rows
the shared **List row**; a section that can be empty shows only while it has rows, except the person's own work.
Components: site `screens/Overview.tsx` + `overview/Section.tsx` (keep); Office `(tabs)/index.tsx` + `office/ui.tsx`
`Section` (keep); StatsRow (§4.7).

### 4.2 List row (Gmail's and Google Tasks' list, Material 3 list item)
Left: a time (mono) or an avatar / photo; middle: the title (one line, strong), a second line (who · where · when,
muted), an optional third (a warning in amber or red); right: one slot only, a status chip **or** one action button
(Give a driver, Decide) **or** a chevron. A plate shows as its chip on the second line. A tap opens the item.
Components: Office `office/ui.tsx` `Row` (keep; `right` = one slot) with `StatusChip`; site `.row` markup (pilot: the
board's `TaskCard` takes the same parts); driver `components/TaskRows.tsx` (keep).

### 4.3 Desktop table (Google Admin's and Samsara's tables)
Desktop only; a phone shows the same rows as List rows (the site's `.tbl-wrap` cards). Header row, sortable where it
helps, the status as a chip, plates as chips, numbers right-aligned in mono, one row action at the end, a tap on the row
opens the detail panel (`ListWithDetail`). Component: site `.tbl-wrap` + `ui/GenericTable.tsx` (keep).

### 4.4 Detail page (Material 3's detail screen; Uber's trip details)
Header (R6: back, title, one-line subtitle, the state chips under the title); a **StatusBanner** slot (needs a driver,
changed, late, saved); a **StatsRow** for the numbers that matter (leave by, km, drive time, back at); the **RouteStepper**
for the stops (the start and the way back included as steps); the facts as one key–value block; the history last; one
**action bar** (R7). A map page (the driver's task, Live) is the map with a draggable sheet holding the same parts.
Components: Office `BackHeader` (+ a `chips` slot, new) + `Section`; site `PageTop` + `dl.kv`; driver `task/[id].tsx`.

### 4.5 RouteStepper (Uber's and DoorDash's trip progress; Samsara's route view)
One vertical rail. Each step: a time column (mono: the planned time, the actual under it), a mark (S = start, 1…n = the
stops in order, B = back to base; filled green when left, ringed blue for the stop the driver is at or heading to, red
when skipped, plain for still to come), the place (strong) with its type (Pickup · Drop-off · Visit), the times line
("Planned 10:30–11:00 · Arrived 10:52 · Left 11:40") and the difference chip ("22 min late" amber, "On time" / "8 min early"
green); between steps the leg ("12 km · 25 min", muted). Two densities: full (detail pages, Review) and compact (the driver's
sheet: the current stop expanded, the others one line). §16 of `docs/ui-patterns.md` is its live part.
Components: **new** `components/patterns/RouteStepper.tsx` (app: Office mode and the driver app), replacing
`components/office/StopTimeline.tsx` and the hand-built marks (rollout); site **new** `ui/RouteStepper.tsx` replacing
`StopProgress` and `PlanTimeline` (rollout).

### 4.6 StatusBanner (Material 3's banner; Google's "something needs you")
A full-width band above the content: an icon, one strong line, one muted line, at most one action ("Find a driver",
"Decide again", "Undo"). Tones by R3. One banner slot per page, the most urgent first, the rest as lines inside it.
Components: **new** `components/patterns/StatusBanner.tsx` (app); site `ui/basics.tsx` `Notice` (keep, with the action slot).

### 4.7 StatsRow (Samsara's KPI tiles; Uber Fleet's summary)
Two to six cells in one card (two a line on a phone, the most used first): a small label (muted, upper case), the value
(big, mono for numbers), an optional unit / sub-line; a cell that counts a list opens it (R9). The same set and rule on every surface (Office Home's Free now leaves
out the garage, as the site does). The cells and their order follow each surface's design (R12): the site's Overview
(`Desktop · Overview.png`) leads with On the road, Tasks today, Requests to approve, Reminders due (the last two by
permission), then Free now and In garage; Office Home (`design/office/png/04 Home · Fleet admin.png`) has On the road,
Free, In garage (its requests are the section right under them). Each count follows the one rule on both.
Components: **new** `components/patterns/StatsRow.tsx` (app, replacing `StatTiles`, the reports' local `Tile` and the
driver's stats box in the rollout); site `ui/basics.tsx` `Tile` in a **new** `StatsRow` wrapper.

### 4.8 Forms (Material 3's forms; the booking forms of Uber, Airbnb, Turo)
Long jobs as steps with one sticky primary (R7); required on the screen, optional under "More details"; defaults and
pre-fills; the reason under the disabled button; a draft kept. Components: site `StickyActions`, `DraftBanner` (keep);
Office `StickyActions` and `TripFooter` (the reason moves under the button); driver: a shared bottom bar (rollout).

### 4.9 Profile / settings (Android's and iOS's settings)
Grouped lists (§14 of ui-patterns): a person card on top, then groups of rows (a switch, a value, a link), one Save only
where a form is. Components: site `settings/*`, `SwitchLine` (keep); Office `NotifParts` `RowCard` / `SwitchRow` (keep;
`PeopleParts.Toggle` and `Controls.ToggleRow` fold into `SwitchRow` in the rollout); driver `(tabs)/me.tsx` cards.

### 4.10 Empty, loading and error states (Material 3's empty states)
Skeleton rows shaped like the content; an empty state with an icon, one line saying what appears here and the next step
as a button; an error in words with Try again (and Sign in again on a 401); a whole page that fails keeps its header.
Components: app `components/patterns/ListState.tsx` (`SkeletonRows`, `ListEmpty`, `ListError`, keep; the driver app adopts
them in the rollout); site `ListKit` `SkeletonRows`, `EmptyLine` (keep; `basics.Empty` folds into `EmptyLine`), `ErrBox`
with Try again on detail pages.

## 5. The pilot (six screens; before / after as a CI artifact; then STOP)

| # | Screen | Surface | Pattern | What changes |
|---|---|---|---|---|
| a | Trip · 4 Review | Office mode + /m/ | Detail + RouteStepper + StatsRow + Forms | The plan as the RouteStepper (S, 1…n, B; time column; legs); Leave by · km · drive time · back at as a StatsRow; conflicts as StatusBanners; the reason under the button; skeleton, not a spinner |
| b | Task detail and request detail | Office mode + /m/ | Detail page | The state chips under the title in the header; one StatusBanner slot (needs a driver, changed, late); the stops as the RouteStepper (task: live; request: planned); a StatsRow; one action bar at the bottom (task: Change time or stops · More; request: Approve · Decline as now) |
| c | Office Home | Office mode + /m/ | Dashboard | The StatsRow with design 04's three (On the road, Free without the garage as on the site, In garage); the section links "View all (N)" (On the road keeps design 04's "Live map"); one right-hand slot per row; My trips rows open the trip |
| d | Task in progress | Driver app | Detail (map) | Three stats as designed (Distance left, Arrive about, Start odo); Navigate · Call · Complete task in the designed order right under the stats; the stops as the compact RouteStepper (the current stop with its slide, the others one line) under the actions |
| e | Overview | Site, desktop + phone width | Dashboard | The StatsRow first (the design's four), then the sections; one empty-state component; the needs-a-driver row written once |
| f | Tasks (board) | Site, desktop + phone width | List row / board | One status vocabulary (Sent · On the way · Done; Needs a driver only as the banner on top, not also a column); the task card's status as the chip; the empty column as the shared empty line |

As built (e, f; `apps/office`): the state→chip rule is `screens/taskStateLogic.ts` (Late is its own amber chip beside On the
way, as §3 says; a finish flag keeps its issue's name, "Completed early"). A past day's declined task keeps a Needs a
driver column on that day's board: the red block lists today and later only, so it would otherwise show nowhere.

**After the review (as built):** the task page's action bar is one rule (`office/taskLogic.ts` taskActionPlan: whatever is
not the primary is under More, so Change time and Change stops stay reachable when Give a driver comes first); the driver's
Arrive about says Arrived HH:MM at the stop, the estimate, the planned time while still ahead, else a dash; the compact
stepper opens any stop with a tap, keeps a stop's note visible and says Done / Skipped in words; the site's board opens a
needs-a-driver row's task for someone who may not change it; Review's Leave by is the big wide cell (design 09).

**For Sahan to decide at the pilot:** design 14 shows four buttons (Change time or stops, Reassign, Swap, Cancel) where the
pilot keeps one primary and More (R7 against R12); the driver's sheet keeps the design's "IN PROGRESS" label (§3 says "On
the way" everywhere else); the site's Overview at phone width now starts with the six tiles before the action sections.

**The screenshots.** `apps/office/e2e/design-pilot.spec.ts` makes the same data and photographs each pilot screen (the site
at 1440 × 900 and 412 × 915; /m/ at 412 × 915 in English and Sinhala; the driver's task screen through a design-only page
of the e2e build, never in a deployed build). CI keeps them in the run's artifact (`design-pilot/`). "Before" = a run on
branch `design-pilot-before` (main + the spec + a design page copying main's driver sheet with the same sample data:
faithful to the code it copies, not the phone itself); "after" = a run on
`phase9-rd`. Sahan compares the two folders and approves, changes or rejects each screen.

**After the OK (the rollout, in this order):** the shared components replace their look-alikes (StopTimeline and the
hand-built marks, StatTiles and the local Tile, Pill vs StatusChip, the three switch rows, the two search boxes, the
13 driver headers); then every screen of the inventory, surface by surface, each listed with its pattern in this file;
a fresh reviewer checks every screen against §2 and §3 at the checkpoint.
