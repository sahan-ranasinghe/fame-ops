# Updating the Teams copy of the Fame Fleet artifact (Phase 5)

14 October 2026. Sahan updates the Teams artifact (`RsGzozM5V4qCv4UeAECatu`, made in his
Teams chat) himself from the file below; Claude Code never publishes to it, and nobody else
gets access yet.

## The file

- `apps/office/dist-artifact/index.html`, built with `npm run build:artifact` from the
  commit of deploy round 4 (one self-contained file; no Supabase code, no key inside).
- `apps/office/dist-artifact/capabilities.json`, the declaration to paste unchanged when
  publishing: the connector named exactly **Fame Fleet** (as claude.ai shows it) and the
  43 tools the page calls. The four personal notification tools are not declared: the
  artifact has no service worker and sends nobody to Settings → Notifications but the web
  app.

## In the Teams chat

1. Open the artifact, choose Update, give it the file, keep the declaration as in
   `capabilities.json` (the server name must read "Fame Fleet": the `mcp__…` segment is not
   resolved for you).
2. Open it once: the Overview loads after the connector's permission prompt; the Issues
   item is in the menu; Settings lists Users and Fleet.
3. Do not share it with anyone new yet.

## The message for the Teams chat

> Fame Fleet is updated to Phase 5. What is new for the office:
>
> - Tasks have stops now (pickup, drop-offs, visits) and a leave-by time worked out from the
>   deadlines. Assign a task shows the plan: each leg's road time, the minutes at each stop,
>   and when the driver must leave. You can change the stops later; the driver's phone follows.
> - Each person has their own permissions (Settings → Users): what you cannot open is greyed
>   with a lock, and the requests queue, the tasks board, vehicles, issues and users are
>   separate rights.
> - Issues: the bell shows everything that needs attention (a breakdown, a document about to
>   expire, a task not accepted, running late, a request waiting). Take one, add a note, resolve
>   it; resolving a vehicle problem closes the driver's report.
> - Drivers accept or decline a task on the phone. A declined task waits under "Needs a
>   driver" with the reason; Reassign offers who is free.
> - Vehicles can be assigned to someone (a custodian). Booking a vehicle for someone is one
>   step from New request: the free vehicles for that time in four groups, the free drivers,
>   Book now. A booking can be cancelled with a reason. Everyone who asks for a vehicle sees
>   their request's timeline: sent, seen, approved or declined.
> - Notifications on your laptop or phone (a request comes in, your request is decided, a task
>   declined, a critical issue, a booking of your vehicle) are in the web app only:
>   fame-fleet.pages.dev → Settings → Notifications. This artifact refreshes by itself every
>   half minute instead.
>
> The web app at fame-fleet.pages.dev has the same screens plus the live map, the driver
> pages with playback, and notifications; it can be installed on a phone from Chrome's menu.
