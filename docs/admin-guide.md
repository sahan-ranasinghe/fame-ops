# Fame Fleet: a guide for office admins

You are an **Admin** (you hold the **Users** permission) or a **Fleet admin** (you hold **Approve**). This guide is for
running Fame Fleet day to day without a developer: people, vehicles, documents, password links, fixing a wrong entry,
approvals, the bin and how long data is kept. A Coordinator has their own guide (docs/coordinator-guide.md).

Work from a computer at **https://fame-fleet.pages.dev**, or from a phone at the same address under **/m/**, or in the
Fame Fleet app with **Office** chosen at sign-in. The names below are the website's; the phone has the same screens under
its tabs and **More**. Claude (the "Fame Fleet" connector in Claude Teams) can do most of this too, **except deleting**:
Claude archives, never deletes.

## 1. The three ways to make something go away

| You want | Do | Who | Can it come back? |
|---|---|---|---|
| A person, vehicle, place, project or rental company **no longer used** | **Archive** | whoever manages that record | Yes, any time: **Show archived** → **Restore** |
| Something **registered by mistake** and never used | **Delete permanently** | Admins only | Yes, for 30 days: **Settings → Recently deleted → Restore** |
| A **wrong entry** (a fill, an odometer reading, a vehicle check, an issue, a request, a task) | **Delete…** with a reason | Admins and Fleet admins | Yes, for 30 days: **Recently deleted** |

- **Archive is the normal way.** An archived record leaves every list and picker, but stays in reports, trips and
  history. An archived person can no longer sign in; an archived vehicle cannot be given a trip.
- **Delete permanently** only works for a record with **no history** (no trips, fills, readings, documents…). If it has
  history the page says "Has history (…): archive instead". To delete a person or a vehicle you must **type their name or
  the plate**.
- **Cancel** (a task, a request) and **Dismiss** (an issue) still exist and are what you normally use; Delete is for an
  entry that should never have existed.
- After **30 days** in Recently deleted, things are removed for good, with their photos and documents.

## 2. People

**Add a driver:** Drivers → **+ Add driver** → name, code, username, a 6-digit PIN, phone → Save. Tell the driver their
username and PIN; they sign in on the Fame Fleet app with **Driver**.

**Add an office person:** Settings → Users → **+ Add user** → name, e-mail, permissions (or a ready-made role) → Save.
Copy the **set-password link** shown once and send it by WhatsApp. The link works for 7 days.

**A new password link** (someone forgot their password): Settings → Users → the person → **New set-password link** → send
it. Drivers: Drivers → the driver → **New PIN**.

**Archive a person** (they left): their page → **Archive**. If a driver still has trips from today on, the page lists
them: reassign them first (or **Archive anyway**). They can no longer sign in; their history stays. **Restore** brings
them back exactly as they were.

**Delete a person** (created by mistake, never used): their page → **Delete permanently** → type their name → Delete. You
cannot delete yourself, and the last admin can never be archived or deleted. You can add them again at once with the same
e-mail or username (their old sign-in is taken over).

## 3. Vehicles

**Register:** Vehicles → **+ Register vehicle** → plate, type, seats, rental company, km allowance, document dates → Save.
**Documents and photos:** the vehicle → Documents → **Add** (camera or file): revenue licence, insurance, emission test,
CR, the lease agreement. The expiry dates show as chips and remind you 30 days ahead.

**Archive a vehicle** (returned to the rental company): the vehicle → **Archive**. Trips from today on are listed first.
**Delete** only a vehicle registered by mistake: **Delete permanently** → type the plate.

**Rental companies, places, projects:** Settings → Rental companies; Places; Projects. Each has **Show archived**,
**Archive / Restore**, and **Delete permanently** when it was never used.

## 4. Fixing a wrong entry

A driver typed a fill twice, a reading is from the wrong vehicle, a test task was left behind:
1. Open it (the fill under Fuel, the reading on its task or vehicle, the task, the request, the issue).
2. **Delete…** → the page says what goes with it (for a request: its task) → write **why** → **Delete**. A task still with
   its driver must be **cancelled** first (the driver is told), then deleted.
3. Totals, km and the vehicle's current reading update at once. A task's own km stay as recorded.
4. A mistake? **Settings → Recently deleted → Restore** within 30 days.

An issue the system opened by itself comes back while its cause is still there: use **Dismiss** for those.

## 5. Approvals

**Requests** (the Approve tab on a phone): open a request → choose the vehicle and driver (the best match is first) →
**Approve and send**, or **Decline** with a reason. A request that asks for a change after approval shows what changed;
decide it again. A task made by someone without Approve waits here too ("New tasks need the fleet admin's OK", Settings
→ Fleet).

## 6. Settings that matter

- **Settings → Fleet:** the base place (where trips start and end), working days and the duty cut-off (21:00), the map
  package and its Google limits, whether people may drive themselves, whether new tasks need approval.
- **Settings → Data retention:** how long notifications, the activity log, location points, heartbeats and drafts are
  kept. Business records (trips, fills, readings, documents) are never removed by it. The nightly job also empties
  Recently deleted after 30 days.
- **Settings → Recently deleted:** what was deleted, by whom, why, and until when it can be restored.

## 7. When something is wrong

| Problem | First check | Then |
|---|---|---|
| A driver's location is not showing | Live → the driver: "Location off" or "App not running"? | Ask them to open the app and turn Location on; Me → Phone setup for their phone brand |
| Someone cannot sign in | Settings → Users: are they archived? | Archived: **Restore** them. Otherwise send a new set-password link |
| The map or the place search says "paused" or "limit reached" | Settings → Fleet → Map package (today's calls) | It resets the next day; tell the developer if it repeats |
| A page says "Fame Fleet did not answer" | Your internet | Try again in a minute; tell the developer if it lasts |

**Who to call:** the developer (Sahan Ranasinghe) for anything this guide does not cover; the account owners listed in
docs/handover.md §6 for billing, Google, Expo or Supabase problems.
