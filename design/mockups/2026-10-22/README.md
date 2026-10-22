# Fame Fleet mockups (approved 22 Oct 2026)

Approved by Charuka. These screens are the target: build to match them.

| File | Screen | Surfaces |
|---|---|---|
| 1-office-home | Office Home | Office mode (app), /m/; the site's Overview follows the same structure at desktop width |
| 2-office-review | New trip, step 4 Review | Office mode, /m/, site (assign/request/book review) |
| 3-office-request-approve | Request to approve | Office mode, /m/, site request page |
| 4-office-trip-on-the-way | Task/trip detail while on the way | Office mode, /m/, site task page; requester and passenger view without the actions |
| 5-driver-today | Driver Today | Driver app |
| 6-driver-task-in-progress | Driver task in progress | Driver app |

Folders:
- png/: what each screen should look like (phone width 390 px, 2x). The PNGs use fallback fonts; the real build uses the app's fonts (IBM Plex Sans, IBM Plex Mono, Archivo ExtraBold; Sinhala: Yaldevi, Gemunu Libre).
- html/: plain HTML of each screen: exact colours, sizes, spacing, radii and icons (inline SVG, stroke icons) to copy.
- source/: the original design-canvas files (same content).

Tokens used: ink #15181c, page #f3f2ee, card #ffffff with border #e7e5df and radius 16, divider #efede8, secondary text #5f646b, amber #f2a900 (primary buttons, active tab), blue #1e4fa0 / #e6edf8 (live, on the way, links), amber text #8a5a00 on #fdf3dc (late, waiting), red #b3261e on #fbe9e7 (needs action), green #1f6b2a on #e8f3e9 (on time, free). Plates in mono inside a thin bordered chip. Times and numbers in mono.

Patterns: thin top bar (no big dark header); stats row with icons; one status banner per screen; route stepper (time left, dot on a thin line, one-line name, one meta line with icons, leg lines "99 km · 2 h 23 min"); list rows = icon/avatar + one title line + one grey meta line + small chip; actions in a sticky bottom bar; one floating "+ New trip" button on office Home; driver: two tiles (On duty, vehicle checked), one Next task card, slide-to-confirm control.
Sample names, places and plates are illustrations only: never seed them.
