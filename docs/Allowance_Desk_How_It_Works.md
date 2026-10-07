# Fame Group Allowance Desk: how the current Claude artifact works

**Purpose of this file:** a complete technical description of the existing "Fame Group Allowance Desk" artifact, so another Claude session (Claude Code / Claude Max) can understand it fully before building a driver app around it. It was produced by reading the page's full source code (version `1791129187-b4dc`, 290,372 bytes, 3,022 lines). **Nothing in the artifact was changed.**

**Context:** Sahan is an intern at Fame Group. His boss built this artifact in Claude and keeps using it. The plan is to build a separate driver app (Android, Supabase, live GPS) without forcing drivers to have Claude accounts. This document describes only what exists today.

**Important clarification:** this artifact is an **allowance / expense** system. It has **no** GPS, odometer, trips, multi-stop pickup/drop or task assignment. Those are new requirements for the driver app. If another artifact has those features, it is a different page.

---

## 1. What the artifact is

| Item | Value |
|---|---|
| Title | Fame Group Allowance Desk |
| URL | https://claude.ai/code/artifact/cb6e1693-8d90-4e74-bef3-e081fde39d82 |
| Owner | The boss. "Owner" in the code is `me.isOwner`, the Claude account that published it. |
| Format | One self-contained HTML file: HTML, CSS and plain JavaScript, no framework. All JS is inside one IIFE `(() => { ... })()`. |
| Runtime contract | Claude artifact runtime `0.2.67` |
| Origin | Code comments say it "keeps Bill Desk's foundations". The boss first built a similar artifact called **Bill Desk** (for bills) and reused its access model, activity log, multi-company and multi-Zoho-login handling, email code verification, project index and pre-posting checks. |
| What it does | Records daily allowances for employees (meal, accommodation, travel and so on). It splits each day's money across the project sites worked, lets field staff submit their own claims for approval, and posts the totals as **Draft bills in Zoho Books**, with each line costed to its Zoho project. |

### External resources loaded
- Google Fonts: **Instrument Sans** (body), **Montserrat** (headings), **JetBrains Mono** (numbers and codes).
- SheetJS `xlsx 0.18.5` from cdnjs (Excel export).
- Two embedded base64 PNG logos of Fame Group: a light version and a dark version, switched by colour scheme.

### Look and feel
- Sticky white header band with the Fame Group logo and the product name "Allowance **Desk**". A 3px blue gradient line sits under it, and the header shrinks on scroll.
- Cards ("stages") on a blue-grey background, with numbered steps (1, 2, 3).
- Brand colour `#00569d` (deep `#003d70`), background `#eef2f7`. Status colours: ok `#1d7a4a`, warn `#a15c00`, bad `#b3261e`.
- Full dark mode through `prefers-color-scheme` and `data-theme`.
- Footer: "Fame Group · Driving Innovation, Empowering Progress".

---

## 2. How a Claude artifact like this works (runtime model)

The page runs inside claude.ai and gets special powers through `window.claude.use(name)`. These powers are "capabilities" the owner declared when publishing. This is the key reason **everyone who opens it needs a Claude account**.

| Capability | How the code uses it |
|---|---|
| `user` (scope `profile`) | `user.me()` gives the viewer's Claude identity: `id`, `name`, `email`, `avatarUrl`, `isOwner`. `user.profiles(ids)` turns IDs into names and avatars. `user.search(q)` searches people in the organization (used to add people and approvers). |
| `db` | A shared, Firestore-like document database stored with the artifact. API: `db.doc(path).get()/set()/update()/delete()`, `db.collection(path).where(f,"==",v).orderBy().limit().get()`, `.doc()` for an auto ID, `.add()`, and `.onSnapshot()` for live updates. Access is controlled by path rules (section 3). |
| `mcp` | Calls the **viewer's own** Claude connectors: `mcp.callTool(server, tool, input, {cache})` and `mcp.listTools()`. Zoho Books, Gmail, Google Sheets and Google Drive are all reached this way. Each person uses **their own** connector logins, not the boss's. |
| `downloads` | `dl.save({filename, data: Blob})` saves the Excel export to the viewer's computer. |
| `permissions` | `perms.state("mcp:Google Sheets")` checks whether the page is already allowed to use a connector. Used for the automatic daily HR sync. |

Because identity, database and connectors all come from Claude, the page cannot work outside claude.ai, and every viewer must be signed in to Claude. The "field staff" and "approver" username/password logins are an **extra layer inside** a Claude session, not a replacement for it. Field staff still open the page inside someone's Claude account, typically a shared device or shared account. Each claim even records `deviceUid`, the Claude user ID of the session it came from.

---

## 3. Declared capabilities (exactly as stored)

### 3.1 Database rules
`read`/`write` values: `interact` means anyone who can use the page; `owner` means only the boss; `{self}` means the path segment equals the viewer's own Claude user ID.

| Path | Read | Write | Used for |
|---|---|---|---|
| `""` (root, default for everything not listed) | interact | interact | `e/...` entries, `claims`, `employees`, `meta/...` |
| `access` | interact | owner | List of approved Claude users |
| `requests` | owner | owner | Access requests (the owner sees them all) |
| `requests/{self}` | interact | interact | A person creates their own request |
| `log` | owner | owner | Activity log (the owner reads everyone's) |
| `log/{self}` | interact | interact | Each person writes their own log |
| `companies` | interact | owner | Companies (Zoho organizations) |
| `settings` | interact | owner | Verify emails, Drive folder, connector link |
| `types` | interact | owner | Allowance types |
| `projindex` | interact | owner | Shared project index |
| `fieldUsers` | interact | owner | Field staff logins |
| `approvers` | interact | owner | Approvers |

### 3.2 Connectors (MCP servers) and allowed tools
| Server | Tools |
|---|---|
| `FameGroupBillCreatePortal` (default Zoho login) | `ZohoBooks_list_projects`, `ZohoBooks_list_contacts`, `ZohoBooks_list_chart_of_accounts`, `ZohoBooks_list_bills`, `ZohoBooks_create_bill`, `ZohoBooks_submit_bill`, `ZohoBooks_get_all_tag_options`, `ZohoBooks_get_bill` |
| `FameGroupBillPortalCharuka2` (a second Zoho login) | same 8 tools |
| `Gmail` | `send_message`, `trash_message` |
| `Google Sheets` | `get_values` |
| `Google Drive` | `create_file`, `trash_file` |

The two Zoho servers are **custom connectors** (Zoho Books MCP endpoints). Each person adds them in claude.ai → Settings → Connectors under the exact name (for example `FameGroupBillCreatePortal`), using the URL the owner stores in `settings/connector`, and signs in with **their own Zoho account**. The page has a built-in 5-step setup guide for this (section 15).

---

## 4. Three modes (who uses the page and how)

The global variable `MODE` is one of:

1. **`desk`**: office staff with a Claude account that the owner approved, plus the owner. They get the full app: Daily entry, Entries, Project costs, Post to Zoho, Approvals (if they are an approver or the owner) and Owner settings (owner only).
2. **`field`**: field staff who sign in with a **username + password** the office created. They only see **Daily entry** (renamed "Your day") and **My claims**. They submit claims for approval and never touch Zoho.
3. **`approver`**: approvers who sign in with a **username + password**, typically on a shared Claude account. They only see **Approvals**, plus the entry form when splitting a claim. They never touch Zoho.

There is also a fourth kind of approver: a person with **their own Claude account**, made an approver by the owner. They work in `desk` mode and see the Approvals tab.

### 4.1 Boot sequence (`boot()`)
1. Wire up all static buttons (`initStatic`, `initEntry`).
2. `resolveAccess()` loads `user` and `db` and gets `me`:
   - Not signed in, or no db → message "You haven't been invited to Allowance Desk yet…".
   - Owner → allowed.
   - Otherwise allowed only if `access/<myClaudeId>` exists.
   - Not allowed → "Request access" button, which writes `requests/<id>` with `{at}`. If a request already exists → "Your request has been sent…".
   - Allowed → it must also be able to write a log event `opened`. If logging fails → "Allowance Desk can't record your activity… needs Contributor access". **Every user must be loggable.**
3. Decide the mode:
   - The URL hash or query containing `field` → field mode; containing `approv` → approver mode.
   - Otherwise `localStorage` `ad.intent` (set when switching login pages; used once), or the last mode `ad.mode` if that session is still valid.
   - A person without office access who has no mode → **chooser screen**: "Welcome to Allowance Desk" with buttons "Field staff — submit my expenses", "Approver — approve claims" and a small link "Office staff? Request access".
4. Desk mode (allowed): shows "Field staff page →" and "Approver sign in →" links in the header. Shows Owner settings for the owner. Loads `mcp`.
5. Detect Zoho connectors: `mcp.listTools()`, keeping servers (not `kind:"artifact"`) that have `ZohoBooks_create_bill` or `ZohoBooks_list_bills`. Each is marked `ok` if `authStatus !== "needs_reauth"` and it has tools. If `listTools` fails, it assumes the default server is ok.
6. Start live watchers: types, employees, companies, Drive settings, HR sync meta, approvers. Then run the automatic daily HR employee sync and open the last tab used (`ad.tab`).

Header status chip examples: "Connecting to Zoho…", "Zoho Books connected", "Zoho connected · <server>", "Recording entries · Zoho not connected", "This company's Zoho account isn't connected", "Zoho verification needed", "Access needed".

---

## 5. Data model (every collection and field)

All amounts are stored in **LKR as numbers with 2 decimals**. Calculations are done in **cents** (integers) to avoid rounding errors (`cents = Math.round(v*100)`).

### 5.1 Entries (the core record): `e/<orgId>/<yyyy-mm>/<empId>_<yyyy-mm-dd>`
- One document = one employee's allowances for one day, in one company. The rule is **one entry per employee per day per company**.
- Additional "missed bill" entries for the same day use the suffix `_a1`, `_a2`, … up to `_a30` (`nextSuppPath`).
- Partitioned by work month (`yyyy-mm`), so reading a period means reading each month's collection.

Fields:
```
org, ym, date (work date, "YYYY-MM-DD"),
empId, empName, empCode,
method: "time" | "manual",
amts: { <typeId>: amountLKR },            // per allowance type, day total
typeNames: { <typeId>: "Meal Allowance" }, // names frozen at save time
sites: [ { pid (Zoho project_id), pname (project name), cid (customer_id), cname (customer name),
           hours (number | null), amts: { <typeId>: amountLKR }, total } ],
projectIds: [pid, ...],
total,
attachments: [ { tid, id (Drive file id), name, url, mime, size, by (Claude user id), at } ],
status: "open" | "posted",
supplement: true            // only on _aN extra entries
// from field claims:
claimId, source: "field", fieldUser, remarks, approvedBy, approvedByName,
// bookkeeping:
requestedAt (claim submitted time, or first save time), createdBy, createdAt, updatedBy, updatedAt,
// after posting:
billId, billNo, billOrg, postedAt, postedBy,
zoho: { status, billNo, total, balance, paid, submittedAt, approver, approvedAt, nextApprover, payDate, payMode, payNo, at },
// after owner unlock:
unlockedAt, unlockedBy
```

### 5.2 Claims from field staff: `claims/<autoId>`
Same shape as an entry when submitted, with these differences:
- `sites` contain only `{pid, pname, cid, cname}`. There are **no hours or split**, because field staff only list the sites and the **approver** does the split.
- `method: null`, `needsSplit: true`.
- `status: "pending"` → `"approved"` | `"rejected"`. A pending claim can also be deleted by the employee ("withdraw").
- `approverId` (approvers doc id), `approverUid` (Claude user id, or null for username approvers), `approverName`.
- `remarks` (up to 500 characters), `fieldUser` (username), `deviceUid` (Claude user id of the session), `submittedAt`, optional `supplement: true`.
- On decision: `decidedAt`, `decidedBy` (Claude id), `decidedByName`, `decidedByLogin` (approver username if a username approver), `entryPath` (the e/… doc created), plus final `method`, `sites` and `total` when split. On rejection: `reason` (required, up to 500 characters).
- When later posted: `billId`, `billNo`, `billOrg`, `zoho` (status summary) are copied so field staff can follow progress.

### 5.3 Other collections
| Path | Fields |
|---|---|
| `access/<claudeUserId>` | `{addedAt, addedBy}`: the person may use the desk |
| `requests/<claudeUserId>` | `{at}` |
| `log/<claudeUserId>` | `{lastAt}` |
| `log/<claudeUserId>/events/<auto>` | `{type, at, …details}` (section 13) |
| `companies/<zohoOrgId>` | `{name, server (default connector), servers: [connector names], addedAt}` |
| `settings/verify` | `{accounts: {<connectorName>: email}, updatedAt}` |
| `settings/drive` | `{folderId, url, at}` |
| `settings/connector` | `{url, at}`: the Zoho connector link shown to colleagues in setup |
| `types/<auto>` | `{name, rate (default amount), active, attach (bills allowed), order, accounts: {<orgId>: {id, name}}}` |
| `employees/<id>` | `{name, code, active, vendors: {<orgId>: {id, name}}, source: "sheet" \| absent, sheetStatus, addedBy, addedAt}`. Sheet employees use id `emp_<code>`; hand-added ones use an auto id. |
| `meta/empSync` | `{at, by, auto, active, added, updated, deactivated}` |
| `meta/zsync_<orgId>` | `{at, by}`: last Zoho bill status sync |
| `projindex/<orgId>` | `{builtAt, updatedAt, count, chunks, customers: {customerId: name}}` |
| `projindex/<orgId>/chunks/c<n>` | `{items: [[projectId, projectName, customerId, status], …]}`, max 1,500 per chunk |
| `fieldUsers/<username>` | `{empId, name, code, active, createdAt, salt, hash, iter, lastLogin, pwSetAt}` |
| `approvers/<claudeUserId>` | `{uid, name, active, addedAt}`: Claude-account approver |
| `approvers/u_<username>` | `{kind: "login", u, name, active, addedAt, salt, hash, iter, lastLogin, pwSetAt}`: username approver |

### 5.4 Browser localStorage keys (per device)
`ad.mode`, `ad.intent`, `ad.tab`, `ad.company` (`"orgId|server"`), `ad.field` (field session), `ad.appr` (approver session), `ad.verified` (Zoho verification time per connector), `ad.cfg.<org>` (cached Zoho company config), `ad.location.<org>`, `ad.dept.<org>`, `ad.recent.<org>` (last 10 sites), `ad.fieldApprover.<username>` (last approver chosen).

---

## 6. Companies, multiple Zoho logins and email verification

### 6.1 Companies
- Each company is a Zoho Books **organization ID**. The default is **Fame Global Solutions (Pvt) Ltd**, org `917614220`. It is created automatically through `FameGroupBillCreatePortal` if the list is empty and the owner opens the page.
- A company can be opened through one or more Zoho connectors (`servers`). The company dropdown values are `"orgId|server"`. With several connectors, options are grouped as "Zoho account: <server>" and labelled "· via <server>", plus "(Zoho not connected)" where relevant.
- **Add company** (owner): enter name, org ID and which connector. The page first test-calls `ZohoBooks_list_bills {organization_id, per_page:1}` through that connector. Only if that works is it saved. Error: "Zoho wouldn't open that organization: …".
- "Open via" checkboxes per company let the owner add or remove connectors; adding one is also test-called first. A company needs at least one. **Remove** is allowed only when more than one company exists.
- Switching company resets the entry form, the post section, the list and the cost tables. It then checks whether that company's connector is connected and verified, loads the company's Zoho config, starts the auto Zoho status sync and (for the owner) loads accounts and keeps the project index fresh.
- Field and approver modes see a plain company list and never use Zoho.

### 6.2 Email code when switching Zoho account
- Owner setting: for each connector name, an email (the registered email of that Zoho account). Stored in `settings/verify`.
- When a desk user opens a company through a connector that has an email set, and they haven't verified it in the last **12 hours** on this device, a modal appears: "Verify Zoho account".
- The code is a **6-digit** random number generated in the browser. Only a salted SHA-256 hash is kept in memory. It is emailed **from the viewer's own Gmail** (`Gmail.send_message`, subject "Fame Group Allowance Desk verification code"), and the sent copy is then moved to Trash (`Gmail.trash_message`).
- The code expires in 10 minutes. After 5 wrong tries a new code is needed. "Send a new code" unlocks after 45 seconds. Escape or Cancel closes the modal.
- Success stores a timestamp in `ad.verified`. Without verification, people can still record entries but can't post to Zoho or build the project index.
- Logged events: `verify_sent`, `verify_ok`, `verify_failed`, `verify_set`.

### 6.3 Per-company Zoho settings (`loadCompanyConfig`)
Cached in `localStorage` `ad.cfg.<org>` for 7 days.
- **Locations:** collected from the `location_id`/`location_name` of the latest 200 bills.
- **Month tag:** a bill tag named "Month". **Department tag:** found on vendor contacts' tags named "Department".
- Hard-coded fallback for org `917614220`:
  - Department tag `7559274000000000335`, Month tag `7559274000000000341`.
  - Locations: Telecommunications Department `7559274000002451031`, Head Office `7559274000000093109`, IT Department `7559274000003244687`.
- Defaults:
  - Location: the one matching "telecommunications", or the last one used.
  - Department: "**Telecom Installation**", or the last one used.
  - Month: option names like `26_October` (two-digit year _ month name). It is picked automatically from the post period's end date, or the bill date.
- Tag options are loaded with `ZohoBooks_get_all_tag_options {organization_id, tag_id}`, keeping only active ones.

---

## 7. Projects / sites (DU ID lookup)

Sites are **Zoho Books projects**. Project names appear to follow a `<number>_<DU ID>…` pattern. The input placeholder is "e.g. GMAHU2 or 13015".

### 7.1 Shared project index
- Only the owner can build it (with Zoho connected). Everyone can read it, so **people without Zoho** (field staff, approvers) can still find sites.
- **Build:** reads `ZohoBooks_list_projects {per_page:200, sort_column:"created_time", filter_by:"Status.All", page}` for up to 200 pages, saves chunks of 1,500 and deletes leftover chunks.
- **Automatic upkeep** when the owner opens the desk with Zoho ready: build if missing; a full rebuild if older than 7 days; otherwise, once every 20 hours, add new projects by reading the newest pages until it hits a known project (maximum 20 pages).
- Desk users with Zoho also merge the newest 600 projects live (3 pages, cached 5 minutes) on top of the index.

### 7.2 Matching rules (`findProject`), in order
1. Exact full project name (case-insensitive).
2. The part after the first `_` (the DU ID).
3. The part before the first `_` (the number).
4. Otherwise, names *containing* the text, showing up to 25 candidates: "No exact match. Pick the project:".

If several projects match at one step → "Several projects match. Pick one:". A site's status shows "✓ <project name> · <customer>", plus the project status if it isn't active.

---

## 8. Allowance types (owner settings)

- Examples given in the UI: Meal Allowance, Accommodation Allowance, Travel Allowance.
- Each type has:
  - a name;
  - a **default amount**, which pre-fills the daily entry and can be changed;
  - **In use** (active);
  - **Bills** (whether receipts can be attached);
  - an order;
  - per company, the **Zoho expense account** it posts to.
- Accounts come from `ZohoBooks_list_chart_of_accounts {filter_by:"AccountType.Expense", per_page:200}` (up to 5 pages, active only), shown as "code · name".
- Each type becomes its own bill line in Zoho, posted to that account.
- Logged as `type_saved`.

---

## 9. Employees

- **Source:** the HR Google Sheet `1rWeS-zR3OBjk5RtfvN4I_lH2bfKM9sNWOueooy9B2wg`, tab **Master List**, read with `Google Sheets.get_values` over the range `'Master List'!A1:C3000`.
  - The header row must contain **Employee No**, **Status** and **Name** (case-insensitive).
  - Only rows with Status **Current Employee** are active.
- **Sync:**
  - New codes are added with id `emp_<code>` and `source:"sheet"`.
  - Changed names or codes are updated, and inactive people are reactivated.
  - Sheet employees who are no longer current are set `active:false` with `sheetStatus` set to their sheet status or "Not in sheet". Their past entries stay.
  - People added by hand are never touched.
  - Duplicate codes among current employees are reported, and the first is kept.
  - Each run writes `meta/empSync` and logs a summary.
- **Automatic daily sync:** the first visit each day by someone whose Google Sheets connector is already allowed on the page (or the owner) runs it. Anyone can press "↻ Refresh list".
- **Manual add:**
  - "New" button in the entry form (name + optional employee number).
  - Bulk add in Owner settings: one per line, "Name, Employee no.".
  - Duplicates by code (or by name when there is no code) are rejected.
- **Owner table:** edit name and code, Deactivate/Reactivate, and see the linked **Zoho vendor** for the current company ("Not linked (set when posting)").
- **Vendor link:** each employee is paid as a Zoho **vendor** (contact_type vendor). The link is stored per company in `employees/<id>.vendors[orgId] = {id, name}` and is set from the Post to Zoho screen.

---

## 10. Daily entry (office / desk mode)

**Step 1, "Employee and day":**
- **Date worked** (default today; a warning if it's in the future).
- **Employee:** a text field with autocomplete over active employees. It matches the label "Name · Code", the code alone, or an exact unique name. A note shows "Employee no. X", "Inactive employee", or "Not in the list yet…".
- **Allowances paid for this day (LKR):** lines of [allowance type dropdown + amount + "📎 Attach bill" + ✕].
  - Default amounts pre-fill.
  - The same type can't appear twice.
  - "+ Add allowance" adds a line.
  - The header shows "Day total LKR …".

**Step 2, "Sites worked and the split":** a table of sites, each a DU ID / project lookup (press Enter or leave the field to search). Two split methods:
- **By time spent** (default): enter hours per site. "7.5", "7:30" and "7h30" all work.
  - Every allowance type is split in proportion to hours.
  - It uses the largest-remainder method in cents; leftover cents go to the largest fractions, with ties going to the site with more hours.
  - A single site with no hours gets everything ("all day").
  - Errors: a missing hours value when there are several sites, or a total over 24 hours.
- **Manual split:** type each allowance's amount per site. Each column must add up exactly to the allowance; the footer shows over/short. A "Split evenly" button divides cents equally, with the remainder going to the first sites.
- Helpers:
  - "+ Add site".
  - "**Copy sites from this employee's last entry**" searches this month and last month for the latest earlier entry and copies its sites, hours and method (and amounts if manual).
  - "**Recent sites**" chips: the last 10 sites used on this device for this company.

**Live checklist** (✓ ok / ! warn / ✕ blocks saving):
- Choose a company.
- Choose the date.
- Pick the employee.
- Inactive employee warning.
- Each line with an amount needs a type.
- At least one allowance with an amount.
- Wait for uploads.
- A bill attached to a type with no amount.
- A type that doesn't take bills has a file attached.
- Every site must be found.
- The same project can't be listed twice.
- Split errors.
- A summary such as "Split by hours: GMAHU2 1,250.00 · …".

**Saving:**
- Writes `e/<org>/<yyyy-mm>/<empId>_<date>`.
- If an entry already exists for that person and day: the first press shows "already has an entry… Press Save again to replace it", and the second press replaces it.
- A **posted** entry can never be replaced: "already posted in bill X". Instead, the page offers "**Add a missed bill as an additional entry**", which is saved as `_aN` and marked "additional".
- A banner appears as soon as you pick a person and date that already has an entry, with "Open it to edit" if the entry isn't posted.
- **Save** clears the form. **Save and add next employee** keeps the date and sites, clears the person, and resets amounts to the defaults (in manual mode it also clears per-site amounts).
- **Edit** (from the Entries tab) loads an entry back into the form ("Editing X on date. Saving replaces this entry.", "Cancel editing"). If the date or person changes, the old doc is deleted after the new one saves.
- Logged as `entry_saved` or `entry_replaced`, with company, employee, date, total, number of sites, method and number of bills attached.

---

## 11. Bill (receipt) attachments → Google Drive

- The owner sets one Drive folder (`settings/drive`) and must share it as **Editor** with colleagues.
- Uploads use **each person's own Google Drive connector**: `Google Drive.create_file {title, base64Content, contentMimeType, disableConversionToGoogleType:true, parentId: folderId}`.
- Only images and PDFs are allowed. Images over 1.2 MB are shrunk in the browser to a maximum of 2,000 px, as JPEG at quality 0.82. The size limit after shrinking is **8 MB**.
- File title: `<date>_<empCode or name>_<allowance type>_<original name>`, with unsafe characters replaced and a maximum of 180 characters.
- Each attachment is tied to one allowance type (`tid`) and saved in the entry's `attachments`.
- A file uploaded in this visit and removed before saving is sent to the Drive trash (`trash_file`). Files from an already-saved entry are only unlinked, never deleted.
- When posting, Drive links are written into the Zoho bill notes (section 14).
- Errors guide the user: Drive not connected, consent required, re-auth needed, or no Editor access to the folder.

---

## 12. Field staff (drivers / site workers today)

### 12.1 Logins (owner creates them)
- Owner settings → **Field staff logins**:
  - pick the employee;
  - username (3–40 characters: a–z, 0–9, `.`, `_`, `-`; it defaults to the employee code in lowercase);
  - password (at least 6 characters, or "Generate" for a random 10-character one).
- **One login per employee.** The password is shown **once**.
- Stored only as a **PBKDF2-SHA256 hash** with 120,000 iterations and a random 16-byte salt, computed in the browser.
- Actions: **New password** (random, shown once), **Disable/Enable**, **Delete** (two clicks).
- The table shows username, employee, and last sign-in ("Never").

### 12.2 Sign-in
- "Field staff sign in" asks for username + password. The check runs **in the browser**: it reads `fieldUsers/<username>`, computes PBKDF2 and compares.
- After 5 failures the browser waits 60 seconds. A failed attempt is logged as `field_login_failed`. A disabled login shows "This login is disabled. Contact the office."
- The session is saved in `localStorage` `ad.field` for **12 hours**. Sign-ins and sign-outs are logged.
- The header shows "Allowance Desk · Field — Submit your daily allowances and bills for approval." and "Signed in as <name> (<code>) · username X" with a Sign out button.

### 12.3 What field staff fill in ("Your day")
- **Date worked.**
- **Employee:** fixed to themselves and locked.
- **Allowances (LKR):** type + amount lines, each with **📎 Attach bill** (photo/PDF to Drive). Meal allowance and similar types come from here.
- **Sites worked:** a list of DU IDs / projects only. There are no hours and no split; the note says the approver splits the cost.
- **Approver:** a required dropdown that remembers the last choice.
- **Remarks** (optional), for example "Night work at GMAHU2, taxi from Kandy".
- Button: **Submit for approval**.

### 12.4 Rules on submit
- If the office already recorded an entry for that day → blocked with "Your allowances for <date> are already recorded… Missed a bill for that day? [Add a missed bill]". That creates a **supplement** claim.
- If a pending (non-supplement) claim already exists for that date and company → blocked until it is withdrawn.
- If the 12-hour session expired → signed out.
- Success shows "✓ Sent to <approver> · <date> · LKR …" and logs `claim_submitted`.

### 12.5 My claims
- Lists their claims plus days the **office recorded directly** for them in the last 6 months for this company (up to 120 rows).
- Each claim shows: the date, a status tag, the approver, the total, allowances, sites, bill links, remarks and the rejection reason.
- Approved claims show a **progress tracker**:
  1. Claim approved (by whom, when).
  2. Bill <no> created.
  3. Sent for bill approval.
  4. Bill approved (by whom).
  5. Paid (date, mode, payment no).
  
  Cancelled and rejected bills are shown too.
- Pending claims can be **withdrawn** (two clicks; it re-checks that the claim is still pending).

---

## 13. Approvals

### 13.1 Approver types
- **Claude-account approver:** the owner searches a person and presses "Make approver". This also grants them page access.
- **Username approver:** name + username + password, stored as `approvers/u_<username>` with a PBKDF2 hash. They sign in on the "Approver sign in" page and get a 12-hour session in `ad.appr`. The owner can set a new password or remove them.

### 13.2 The Approvals tab
- It watches pending claims live, with a red badge for the count assigned to me.
- Filter: Waiting for approval / Approved / Rejected. The owner can also choose "Assigned to me" or "Everyone".
- Each card shows the employee, code, date, company, sent time, total, allowances, sites, bills and remarks.
- Actions on a pending claim:
  - **Approve as is** (single-site claims only): copies the claim into `e/…` with the whole amount on that site (`method:"time"`), then marks the claim approved with `entryPath`.
  - **Review and approve** / **Split cost and approve**: opens the claim in the Daily entry form, switching company if needed, with a banner "Approving the claim from X… Split the cost between the sites below, then press **Approve and save**". The approver enters hours or a manual split and saves. That creates the entry (with `claimId`, `source:"field"`, `fieldUser`, `remarks`, `approvedBy`, `approvedByName`) and marks the claim approved with the final `method`, `sites` and `total`.
  - **Reject:** a reason is required ("Enter the reason so the employee knows what to fix").
- Safeguards:
  - It re-reads the claim first ("already decided or withdrawn").
  - If an entry exists for that day, a second click is needed ("Approve and replace").
  - If that entry is posted → "Can't approve… Reject it instead".
  - Supplement claims go to `_aN`.
- Logged as `claim_approved` or `claim_rejected`.

---

## 14. Post to Zoho (creating Draft bills)

This needs the viewer's own Zoho connector for the company, verified if an email code is set. Without it, a setup card shows (section 15) or a warning banner explains what's missing. Entries can still be recorded without Zoho.

**Step 1, Entries to post:**
- Period "Requested from/to". This filters by the **request date**: when a field claim was submitted or an office entry was first saved, **not** the work date. It looks back 6 months of work-date partitions to find them.
- "Find unposted entries" groups unposted entries by employee and shows Days, Projects, Amount and Zoho vendor (payee), with checkboxes and Select all.

**Step 2, Bill details:**
- Pay mode:
  - **One bill per employee**, to each employee's own Zoho vendor. Missing links show "Not linked" with a "Link vendor" search that uses `ZohoBooks_list_contacts {contact_type:"vendor", search_text, filter_by:"Status.Active", per_page:25}`. The choice is saved to the employee.
  - **One combined bill** to a single vendor (for example a site supervisor or petty cash holder).
- Bill date (default today), Location, Department tag, Month tag (automatic) and Notes (optional, for example "Site allowances, week 40").

**Step 3, Review and create → Run checks:**
- Zoho is available.
- At least one employee is ticked.
- The combined vendor is chosen, or every employee has a linked vendor.
- A bill date is set.
- Every entry is re-read: it must still exist, be unposted and have the same total ("changed, deleted or posted by someone else… Press Find unposted entries again").
- Every allowance type used has a Zoho account for this company (the account mapping is listed).
- Every site has a project.
- A warning if any bill has more than 100 lines.
- A summary: "N Draft bills ready · LKR …".
- Then a **preview** of each bill: project, account, description and amount per line.

**Bill lines:**
- Grouped by **project + allowance type** (+ employee in combined mode), summing the amounts.
- Description: `<Type>[ – <Employee (code)>] – <N> days – <date range>`.

**Bill number:** `ALW_Desk_<n>`. The page reads existing bills matching the prefix (up to 5 pages × 200) and uses the maximum + 1, starting at **ALW_Desk_26001**.

**Create call:** `ZohoBooks_create_bill {query_params:{organization_id}, body}`, where `body` is:
```json
{
  "vendor_id": "<vendor>",
  "bill_number": "ALW_Desk_26001",
  "date": "<bill date>", "due_date": "<bill date>", "payment_terms": 0,
  "reference_number": "Allowances <from> to <to>",          // max 50 chars
  "location_id": "<optional>",
  "line_items": [{
    "item_order": 1,
    "account_id": "<type's Zoho expense account for this org>",
    "location_id": "<optional>",
    "description": "Meal Allowance – 5 days – 1 Oct 2026 – 5 Oct 2026",
    "quantity": 1, "rate": 2500.00,
    "project_id": "<pid>", "customer_id": "<cid>",
    "tags": [{"tag_id": "<Department tag>", "tag_option_id": "<dept option>"}]
  }],
  "notes": "<user notes>\nAllowance Desk · <names or N employees> · <range>\nBills (Google Drive):\n<date> <emp> <type>: <url> …",  // max 2000 chars; links cut at ~1900 with "…and N more"
  "tags": [{"tag_id": "<Month tag>", "tag_option_id": "<month option>"}]
}
```

**After creating each bill:**
- If the create call failed with a timeout-like error, it searches for the bill number to check whether it was actually created (and not void), to avoid duplicates.
- Each included entry is marked `status:"posted"` with `billId`, `billNo`, `billOrg`, `postedAt`, `postedBy` and `zoho:{status:"draft", …}`. The linked claims get the bill info too.
- If some entries couldn't be marked → a warning to tell the owner before posting again.
- Logged as `bill_created` or `create_failed`.
- Results list each bill number as a link to Zoho (`https://books.zoho.com/app/<org>#/bills/<billId>`) with a **Submit for approval** button (`ZohoBooks_submit_bill {path_variables:{bill_id}}`, logged as `bill_submitted`). Failed bills get a "Retry N failed bills" button.
- The location and department chosen are remembered per company.

**Unlock** (owner only, in Entries): sets a posted entry back to open and clears the bill fields. Use it only if the Zoho bill was voided or deleted. Logged as `entry_unlocked`.

### 14.1 Zoho bill status sync
- `ZohoBooks_get_bill` per posted bill.
- The summary is copied onto entries and claims as `zoho`: status, bill number, total, balance, amount paid, submitted date, last approver and date, next approver, last payment date, mode and number.
- Runs automatically at most every **2 hours per company** (`meta/zsync_<org>`) when a desk user with Zoho opens it. It can also be run manually with "↻ Zoho bill status".
- Covers the last 4 months of posted entries, up to 60 bills per run, and skips paid or void bills unless run manually.
- Labels:
  - draft → "Bill created"
  - pending_approval → "Bill waiting for approval" (with the next approver)
  - open / overdue / approved → "Bill approved · payment pending"
  - partially_paid → "Partly paid"
  - paid → "Paid" (date · mode · number)
  - rejected → "Bill rejected in Zoho"
  - void → "Bill cancelled"

---

## 15. Owner settings panel ("Settings, access and activity", visible only to the owner)
1. **Waiting for approval:** access requests with Approve / Dismiss.
2. **Allowed people:** a list with Remove, plus "Add someone from your organization" (search by name or email).
3. **Connector link for colleagues:** the URL of the `FameGroupBillCreatePortal` server, saved to `settings/connector`. It is shown in the Zoho setup steps:
   1. Open claude.ai/settings/connectors.
   2. Add a custom connector named exactly `FameGroupBillCreatePortal`.
   3. Paste the link.
   4. Connect and sign in with **your own** Zoho account.
   5. Come back, press Check again (which reloads), and Allow the page to use the connector.
4. **Allowance types** (section 8).
5. **Employees** (section 9), with a link to open the HR sheet.
6. **Companies** + email code per Zoho account (section 6).
7. **Approvers** (section 13).
8. **Field staff logins** (section 12).
9. **Google Drive folder for bills** (section 11).
10. **Project index:** build button + status, for example "N projects indexed on <date>" (section 7).
11. **Activity log:** every event from everyone, newest first, 25 at a time with "Show more", as When / Who / Action / Details. Details can include company, employee, date, sites, split method, vendor, LKR total, number of entries, field login, connector, the bill number linked to Zoho, and errors.
    - Event types: `opened`, `entry_saved`, `entry_replaced`, `entry_deleted`, `entry_unlocked`, `claim_submitted`, `claim_approved`, `claim_rejected`, `claim_deleted`, `field_login`, `field_login_failed`, `field_user`, `approver_change`, `bill_created`, `bill_submitted`, `create_failed`, `access_granted`, `access_removed`, `company_added`, `company_removed`, `index_built`, `type_saved`, `employee_added`, `employee_changed`, `verify_sent`, `verify_ok`, `verify_failed`, `verify_set`.

---

## 16. Entries tab and Project costs tab

**Entries:**
- Filters: From/To (default this month), Employee, Status (All / Not posted / Posted to Zoho).
- Each row shows the date (marked "additional" for supplements), the employee and code, projects with hours and amounts, the split method, allowances with 📎 bill links, the total, and the status (Zoho label + bill link + detail).
- Actions:
  - Unposted entries: **Edit** and **Delete** (two clicks; it re-checks the entry isn't posted).
  - Posted entries: **Unlock** (owner only).
- Footer: number of entries, number of people, posted LKR, not posted LKR and the total.
- Periods can be up to 24 months; each month reads up to 1,000 docs.

**Project costs:**
- Filters: From/To and Status.
- One table row per project: Project, Customer, a column per allowance type, Total, **Person-days** (number of employee-days charged to the project) and **People** (distinct employees). It is sorted by total, with a footer of totals.
- **Download Excel** (SheetJS + downloads capability) creates the file "Allowances by project <from> to <to>.xlsx" with two sheets:
  - "**Project costs**": Project, Customer, one column per type, Total (LKR), Person-days, People.
  - "**Entry lines**": Date, Employee, Employee no., Project, Customer, Split method, Hours, one column per type, Site total (LKR), Status, Zoho bill, and Bills (Google Drive) links.

---

## 17. Zoho Books calls used (complete list)
| Tool | Parameters used | Where |
|---|---|---|
| `ZohoBooks_list_bills` | `organization_id`, `per_page`, `page`, `filter_by:"Status.All"`, `sort_column:"created_time"`, `sort_order:"D"`, `search_text` | Test company access, discover locations and month tag, find the next bill number, recover after a failed create |
| `ZohoBooks_list_contacts` | `contact_type:"vendor"`, `search_text`, `filter_by:"Status.Active"`, `per_page` | Vendor picker, discover the department tag |
| `ZohoBooks_list_projects` | `per_page:200`, `page`, `sort_column:"created_time"`, `filter_by:"Status.All"` | Project index and live newest projects |
| `ZohoBooks_list_chart_of_accounts` | `filter_by:"AccountType.Expense"`, `per_page:200`, `page` | Map allowance types to accounts |
| `ZohoBooks_get_all_tag_options` | `tag_id` | Department and Month dropdowns |
| `ZohoBooks_create_bill` | `query_params:{organization_id}`, `body` (section 14) | Create Draft bills |
| `ZohoBooks_submit_bill` | `path_variables:{bill_id}` | Submit for approval |
| `ZohoBooks_get_bill` | `path_variables:{bill_id}` | Status sync |

Responses are unwrapped from `res.payload` (a JSON string or an object, optionally under `.data`). A non-zero `code` is treated as a Zoho error. Read calls are cached for 2 minutes (`staleTime 120000`).

Error codes are translated into plain messages:
- `needs_reauth`: reconnect in Settings → Connectors.
- `server_not_connected` / `server_not_found`: the connector isn't added.
- `selection_required`: several connections; choose one.
- `not_in_manifest` / `consent_required`: allow the page to use the connector.
- `blocked_by_policy` / `approval_required`: organization policy.
- `server_unavailable` / `upstream_error`: Zoho timeout.
- `not_granted` / `capability_disabled`: page opened outside Claude.
- `tool_error`: Zoho rejected the request, with its message.

---

## 18. Facts that matter for the driver app

1. **Why drivers can't simply use this page:** every viewer needs a Claude session. Identity, database and connectors all come from claude.ai. The field username/password only identifies *which employee* is submitting inside a Claude session.
2. **Where the data lives:** inside the artifact's own Claude database (section 5). Nothing is in Supabase or Zoho until a bill is posted. Zoho receives only the final Draft bills, as totals per project and allowance type. A new app writing to Supabase will **not** appear in this page's Entries or Approvals unless the page is later changed to read it, or the data is copied across. The page owner can export the current records from the artifact database.
3. **Login security is browser-side:**
   - Password hashes and salts in `fieldUsers` and `approvers` can be read by anyone with page access (rule `read: interact`).
   - The lockout (5 tries → 60 s) exists only in the browser.
   - Entries, claims, employees and meta fall under the root rule (anyone with access can read and write).

   A real driver app should do authentication and permissions on the server, for example Supabase Auth + Row Level Security.
4. **Business rules worth keeping in the new app:**
   - One entry per employee per day per company, with extra entries only for missed bills.
   - Field staff list sites, and the approver splits the cost by hours or manually, in cents with largest-remainder rounding.
   - Allowance types with default amounts, the "bills allowed" flag, and a per-company Zoho expense account.
   - Bill photos/PDFs are compressed and stored with predictable names.
   - Approver required; rejection needs a reason; pending claims can be withdrawn.
   - Statuses: pending → approved → posted (Draft bill) → submitted → approved in Zoho → paid, shown to the employee.
   - The project / DU ID lookup rules from section 7.2.
   - The HR Master List sync rule: Status "Current Employee" means active.
5. **Things that don't exist yet** and must be designed new: GPS/live location, vehicles, odometer readings and photos, trips, multi-stop routes with pickup/drop per stop, proof-of-delivery photos, task assignment, Sinhala language, offline mode.
6. **Zoho posting** today uses each office person's own Zoho connector login through Claude. A standalone app would instead need its own Zoho API access (OAuth client + refresh token, kept on the server). Or it could keep posting through this page or through the boss's Claude.
7. **Internal IDs in this document** (Zoho org and tag IDs, the HR sheet ID) are company-internal. Don't publish them.
