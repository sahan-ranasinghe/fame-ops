// Round 52 (docs/phase8-plan.md §40): Office mode's archive, delete and Recently deleted (office/binLogic.ts, the shared
// components/office/BinParts.tsx and the screens that use them), in node.
//
//   npm run test:bin          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  appendPage, appendProjects, archivedFilterDefs, archivedWords, asksFirst, binArgs, binRowWords, companiesShown, companyDeletable, confirmMatches, deleteEntryInput,
  deleteReady, deleteRecordInput, deleteState, HISTORY_KEYS, historyText, previewInput, projectLine, projectsArgs, projectTitle, reasonOk, showArchivedOf,
  vehicleActiveInput,
} from '../src/office/binLogic';
import { moreFor, routeForUrl } from '../src/office/nav';
import type { BinItem, CanDeleteResult, ProjectsList } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const src = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const en = JSON.parse(src('i18n/en.json'));
const si = JSON.parse(src('i18n/si.json'));
const get = (o: unknown, k: string): unknown => k.split('.').reduce<unknown>((x, p) => (x && typeof x === 'object' ? (x as Record<string, unknown>)[p] : undefined), o);
const t = (k: string, v?: Record<string, string | number>) => String(get(en, k) ?? k).replace(/\{(\w+)\}/g, (_m, n: string) => String(v?.[n] ?? `{${n}}`));

console.log('\nType to confirm (GitHub), as the server compares');
{
  check(confirmMatches('vehicle', 'wp cab 4521', 'WP CAB-4521') && confirmMatches('vehicle', 'WPCAB4521', 'WP CAB-4521'), 'a plate: spaces, dashes and case do not matter');
  check(!confirmMatches('vehicle', 'WP CAB-452', 'WP CAB-4521') && !confirmMatches('vehicle', '', 'WP CAB-4521'), 'a plate: one character short or nothing typed is no match');
  check(confirmMatches('driver', '  kamal   perera ', 'Kamal Perera') && !confirmMatches('driver', 'Kamal-Perera', 'Kamal Perera'), 'a name: case and extra spaces do not matter, a dash does');
  const person: CanDeleteResult = { kind: 'driver', id: 'e1', label: 'Kamal Perera', deletable: true, confirm_with: 'Kamal Perera' };
  check(!deleteReady('driver', person, 'Kamal') && deleteReady('driver', person, 'kamal perera'), 'Delete waits for the name typed');
  check(deleteReady('place', { kind: 'place', id: 'p1', label: 'Depot', deletable: true }, ''), 'a place: one confirm, nothing typed');
  check(!deleteReady('place', { kind: 'place', id: 'p1', label: 'Depot', deletable: false, history_words: '2 stops' }, ''), 'not deletable: never ready');
  check(same(deleteRecordInput('driver', 'kamal', ' Kamal Perera ', person), { kind: 'driver', ref: 'kamal', confirm_text: 'Kamal Perera' }) && same(deleteRecordInput('project', 'p1', 'x', {}), { kind: 'project', ref: 'p1' }), "delete_record's input: confirm_text only for a person or a vehicle");
}

console.log('\nDelete permanently: the button, or why not');
{
  check(deleteState(null).kind === 'none' && deleteState({ kind: 'vehicle', id: 'v', label: 'X', deletable: true }).kind === 'button', 'deletable: the button; no answer yet: nothing');
  const hist: CanDeleteResult = { kind: 'vehicle', id: 'v', label: 'X', deletable: false, history: { tasks: 3, fuel: 1 }, history_words: '3 tasks, 1 fill' };
  check(same(deleteState(hist, t), { kind: 'history', words: '3 tasks, 1 fill' }), 'history: its words in the person\'s language', deleteState(hist, t));
  check(historyText({ history: { tasks: 1, odometer: 1200 }, history_words: 'x' }, t) === '1 task, 1,200 odometer readings', 'one and many, Latin digits with commas');
  check(historyText({ history: { something_new: 2 }, history_words: '2 something new' }, t) === '2 something new', "a count the app does not know: the server's words");
  check(same(deleteState({ ...hist, problem: 'You cannot delete your own account. Ask another admin.' }), { kind: 'problem', text: 'You cannot delete your own account. Ask another admin.' }), "the account guard's sentence comes first");
  check(HISTORY_KEYS.every((k) => typeof get(en, `office.bin.h1.${k}`) === 'string' && typeof get(si, `office.bin.h.${k}`) === 'string'), 'every history count has its words in both languages');
}

console.log('\nWrong entries');
{
  check(!reasonOk('') && !reasonOk('  ab ') && reasonOk('typo'), 'a reason of 3 characters or more');
  check(same(previewInput('fuel', 'f1'), { kind: 'fuel', id: 'f1', preview: true }) && same(deleteEntryInput('task', 't1', ' entered twice '), { kind: 'task', id: 't1', reason: 'entered twice' }), "delete_entry's preview and its delete");
}

console.log('\nArchive asks first');
{
  check(asksFirst({ needs_confirm: true, trips: [{ task_id: 't', title: 'x', when: '2026-10-31 08:00' }], note: '' }) && !asksFirst({ active: false }) && !asksFirst(null), 'needs_confirm with trips: the list first');
  check(same(vehicleActiveInput('WP CAB-4521', false), { reg_no: 'WP CAB-4521', active: false }) && same(vehicleActiveInput('WP CAB-4521', false, true), { reg_no: 'WP CAB-4521', active: false, confirm: true }), 'set_vehicle_active: confirm only the second time');
}

console.log('\nThe lists');
{
  const defs = archivedFilterDefs(t);
  check(defs.length === 1 && defs[0].default === 'active' && same(defs[0].options.map((o) => o.label), ['Active', 'Show archived']), 'one Filter: Active or Show archived');
  check(showArchivedOf({ show: 'archived' }) && !showArchivedOf({ show: 'active' }) && !showArchivedOf({}), 'the archived ones only when chosen');
  check(same(projectsArgs(false, ''), { limit: 25 }) && same(projectsArgs(true, ' TRK ', 'c'), { limit: 25, archived: true, search: 'TRK', cursor: 'c' }), "list_projects' input");
  check(same(binArgs(''), { limit: 25 }) && same(binArgs(' van ', 'n'), { limit: 25, search: 'van', cursor: 'n' }), "list_bin's input");
  const a: ProjectsList = { projects: [{ id: '1', name: 'A' }], total: 2, next: 'n' };
  const b = appendProjects(a, { projects: [{ id: '1', name: 'A' }, { id: '2', name: 'B' }], total: 2 });
  check(b.projects.length === 2 && b.next === undefined, 'Load more: never a row twice; the last page has no next');
  check(appendPage({ items: [{ id: 'x' }] as BinItem[], next: 'n' }, { items: [{ id: 'y' }] as BinItem[] }, 'items').items.length === 2, 'Recently deleted: Load more');
  check(projectTitle({ id: '1', name: 'Kandy towers', short_name: 'TRKAN1' }) === 'TRKAN1 · Kandy towers' && projectLine({ id: '1', name: 'x', job_no: '13021', customer: 'Mobitel' }) === '13021 · Mobitel', "a project's title and line");
  check(archivedWords({ archived_on: '2026-10-01', archived_by: 'Sahan' }, t) === 'Archived 2026-10-01 by Sahan' && archivedWords({ archived_on: '2026-10-01' }, t) === 'Archived 2026-10-01'
    && archivedWords({}, t) === undefined && archivedWords({ archived_on: '2026-10-01', archived_by: 'Sahan' }, t, (d) => `[${d}]`) === 'Archived [2026-10-01] by Sahan', "the archive in the app's own words from archived_on / archived_by (the date through the day words); nothing from the server's English sentence");
  check(!src('app/office/projects.tsx').includes('when: p.archived') && !src('app/office/rental-companies.tsx').includes('when: c.archived'), "the server's archived sentence is never shown");
  check(src('app/office/task/[id].tsx').includes('<DeleteEntry kind="odometer" id={o.id}'), 'the task page: Delete… on each odometer reading');
  check(companyDeletable({ vehicles: 0 }) && !companyDeletable({ vehicles: 2 }), 'a rental company may go only with no vehicle');
  check(companiesShown([{ id: '1', name: 'Malkey', vehicles: 1 }, { id: '2', name: 'Casons', phone: '+94771234567', vehicles: 0 }], ' cas').map((c) => c.id).join() === '2', 'the search filters the whole list');
  const row = binRowWords({ id: 'b', kind: 'vehicle', record_id: 'v', label: 'WP CAB-4521', detail: 'Toyota HiAce', reason: 'entered twice', deleted_by: 'Sahan', deleted_at: '2026-10-30 14:05', until: '2026-11-29', days_left: 30 }, t);
  check(row.line === 'Toyota HiAce · Deleted by Sahan · 2026-10-30 14:05' && row.reason === 'Why: entered twice' && row.restoreLine === 'Restore until 2026-11-29 (30 days)', 'a Recently deleted row in words', row);
}

console.log('\nMore and the links');
{
  const admin = ['view', 'request', 'approve', 'assign_tasks', 'vehicles', 'issues', 'users'];
  const m = moreFor(admin);
  check(m.includes('projects') && m.includes('rental_companies') && m.includes('bin'), 'an admin: Projects, Rental companies, Recently deleted');
  check(moreFor(['view']).includes('projects') && !moreFor(['view']).includes('rental_companies') && !moreFor(['view']).includes('bin'), 'view: Projects only (as the site)');
  check(!moreFor(['view', 'vehicles']).includes('bin') && moreFor(['view', 'vehicles']).includes('rental_companies'), 'Recently deleted only with users; rental companies with vehicles');
  check(routeForUrl('https://x/projects', ['view']) === '/office/projects' && routeForUrl('/projects', ['issues']) === null, "the site's /projects opens Projects");
}

console.log('\nThe screens');
{
  const parts = src('components/office/BinParts.tsx');
  check(parts.includes("api.call<DeleteEntryPreview>('delete_entry', previewInput(kind, id))") && parts.includes("api.call<DeleteEntryResult>('delete_entry', deleteEntryInput(kind, id, reason))") && parts.includes('disabled={!preview || !reasonOk(reason)}'), 'a wrong entry: the preview first, the reason needed');
  check(parts.includes("useTool<CanDeleteResult>('can_delete'") && parts.includes("api.call<DeleteRecordResult>('delete_record'") && parts.includes('disabled={!deleteReady(kind, a, typed)}'), 'a record: can_delete, then delete_record once the name or plate matches');
  check(parts.includes("t('office.bin.deletedSnack'") && parts.includes("t('office.bin.archiveAnyway')") && parts.includes("pathname: '/office/task/[id]'"), 'the snackbar after a delete; the trips open their task; Archive anyway');
  const driver = src('app/office/people/driver/[username].tsx');
  check(driver.includes('<ArchiveTripsSheet') && driver.includes('<RecordDelete kind="driver"'), 'a driver: archive with the trips, Delete permanently');
  check(src('app/office/people/user/[email].tsx').includes('<RecordDelete kind="office_person" refText={email}'), 'an office user: Delete permanently');
  const vehicle = src('app/office/vehicles/[reg].tsx');
  check(vehicle.includes("'set_vehicle_active', vehicleActiveInput(") && vehicle.includes('<ArchiveTripsSheet') && vehicle.includes('<RecordDelete kind="vehicle"'), 'a vehicle: Archive / Restore with the trips, Delete permanently');
  check(src('app/office/vehicles/form.tsx').includes("t('office.vehicles.f_active')"), "the vehicle form's active chips kept");
  check(src('app/office/places/[id].tsx').includes('<RecordDelete kind="place"'), 'a place: Delete permanently');
  for (const [file, kind] of [['app/office/task/[id].tsx', 'task'], ['app/office/task/[id].tsx', 'fuel'], ['app/office/task/[id].tsx', 'check'], ['app/office/request/[id].tsx', 'request'], ['app/office/issues/[id].tsx', 'issue'], ['app/office/fuel-video.tsx', 'fuel']] as const) {
    check(src(file).includes(`<DeleteEntry kind="${kind}"`), `${file}: Delete… for a wrong ${kind}`);
  }
  check(src('app/office/recently-deleted.tsx').includes('binRowWords(item, t, (d) => dateWords(t, d))'), 'Recently deleted says its dates in words');
  check(src('app/office/recently-deleted.tsx').includes("api.call<RestoreBinResult>('restore_bin_item', { id: item.id })") && src('app/office/recently-deleted.tsx').includes("t('office.bin.restored'"), 'Recently deleted: Restore asks nothing, the snackbar says so');
  check(src('app/office/projects.tsx').includes("'set_project_archived', { project: p.id, archived: want }") && src('app/office/rental-companies.tsx').includes("'set_rental_company_archived', { company: c.id, archived: want }"), 'Projects and Rental companies: archive and restore');
}

console.log('\nWords');
{
  for (const ns of ['bin', 'projects', 'rentals'] as const) {
    check(Object.keys(en.office[ns]).every((k) => typeof en.office[ns][k] === 'object' || typeof si.office[ns][k] === 'string'), `office.${ns} in both languages`);
  }
  const used = ['components/office/BinParts.tsx', 'app/office/projects.tsx', 'app/office/rental-companies.tsx', 'app/office/recently-deleted.tsx', 'app/office/vehicles/[reg].tsx'].map(src).join('\n');
  const asked = [...used.matchAll(/'(office\.(?:bin|projects|rentals|vehicles)\.[a-zA-Z_]+)'/g)].map((m) => m[1]);
  check(asked.every((k) => typeof get(en, k) === 'string' && typeof get(si, k) === 'string'), 'every key asked for exists in both languages', asked.filter((k) => typeof get(si, k) !== 'string'));
  const kinds = ['vehicle', 'driver', 'office_person', 'place', 'project', 'rental_company', 'fuel', 'odometer', 'check', 'issue', 'request', 'task'];
  check(kinds.every((k) => typeof get(si, `office.bin.kind_${k}`) === 'string'), 'every kind in the bin has its chip');
  check(en.office.people.switchOff === 'Archive {name}…' && en.office.people.filterAll === 'Show archived' && en.office.vehicles.filter_inactive === 'Archived (returned)' && en.office.places.who_removed === 'Archived', 'the verb is Archive / Restore; the filters say Show archived');
  check(/switched off/.test(en.office.people.switchOffBody), "a person's confirm still says the sign-in is switched off");
}

console.log(failures === 0 ? '\nAll bin checks passed.' : `\n${failures} bin check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
