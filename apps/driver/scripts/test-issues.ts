// Office mode (Phase 8, O2): the Issues screens' pure rules (office/issuesLogic.ts), no phone: the status chips and
// list_issues' input, the severity chips, the next page appended, the tones, the rows' lines, the facts, the actions by
// status and tools, update_issue's inputs, the card merged after a change, the links by permission and the timeline.
//
//   npm run test:issues          (from apps/driver)

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  activeCount, appendPage, DEFAULT_STATUS, defaultSort, ISSUE_SORTS, issuesChoice, issuesFilterDefs, eventParts, fitsStatus, isActive, isSeverityFilter, isStatusFilter, issueActions, issueFacts, issuesArgs, kindText, LIMIT,
  linksFor, listRows, mergeIssue, noteRequired, patchHistory, REPORT_STATUS_KEYS, reportCategoryKey, rowLine, SEVERITY_FILTERS, severityCounts, severityTone, snoozeParts,
  STATUS_FILTERS, statusTone, updateInput, whoLine, type WhoWords,
} from '../src/office/issuesLogic';
import {
  bulkCalls, groupText, groupTick, ISSUE_TABS, metaParts, needsAction, rowTitle, rowWho, showsGroups, statusShown, TAB_STATUS, tabExtra, tabFor, toggled, withoutIssues,
} from '../src/office/issuesLogic';
import type { Issue, IssueHistory, IssuesList } from '../src/office/types';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const issue = (patch: Partial<Issue> = {}): Issue => ({
  id: 'i1',
  kind: 'vehicle_report',
  kind_text: 'Vehicle problem',
  severity: 'critical',
  title: 'Breakdown · WP CAB-4521',
  detail: 'Engine stalled near Kadawatha',
  status: 'open',
  opened: '2026-10-18 09:12',
  updated: '2026-10-18 09:12',
  ...patch,
});

const WORDS: WhoWords = {
  opened: (at) => `Opened ${at}`,
  takenBy: (name, at) => `taken by ${name}${at ? ` ${at}` : ''}`,
  closed: (at) => `closed ${at}`,
  dismissed: (at) => `dismissed ${at}`,
};
const FACT_WORDS = { system: 'System', nobody: 'Nobody yet', by: (name: string) => `by ${name}` };

console.log('\n== The status chips and list_issues (issuesArgs) ==');
{
  check(same(STATUS_FILTERS, ['active', 'open', 'in_progress', 'resolved', 'dismissed']), 'five chips: Active, Open, In progress, Resolved, Dismissed (no Snoozed, no All)');
  check(DEFAULT_STATUS === 'active', 'the list opens on Active');
  check(LIMIT === 50, 'a page is 50');
  check(same(issuesArgs('active'), { status: 'active', sort: 'urgent', limit: 50 }), 'Active: the status, the most urgent first, 50, no search', issuesArgs('active'));
  check(same(issuesArgs('resolved'), { status: 'resolved', sort: 'newest', limit: 50 }), 'Resolved: the newest first', issuesArgs('resolved'));
  check(same(issuesArgs('dismissed'), { status: 'dismissed', sort: 'newest', limit: 50 }), 'Dismissed: the newest first');
  check(defaultSort('open') === 'urgent' && defaultSort('in_progress') === 'urgent', 'Open and In progress: the most urgent first');
  check(same(issuesArgs('open', '  CAB-4521 '), { status: 'open', sort: 'urgent', limit: 50, search: 'CAB-4521' }), 'the words searched for go trimmed as search', issuesArgs('open', '  CAB-4521 '));
  check(same(issuesArgs('open', '   '), { status: 'open', sort: 'urgent', limit: 50 }), 'blank words send no search');
  check(same(issuesArgs('active', '', 'c2'), { status: 'active', sort: 'urgent', limit: 50, cursor: 'c2' }), 'Load more sends the cursor');
  check(!('snoozed' in issuesArgs('active')), 'the snoozed ones are not left out (no Snoozed chip on the phone)');
  check(isStatusFilter('in_progress') && !isStatusFilter('snoozed') && !isStatusFilter('all') && !isStatusFilter(undefined), 'isStatusFilter knows the five');
  check(isSeverityFilter('all') && isSeverityFilter('info') && !isSeverityFilter('bad'), 'isSeverityFilter knows all + three');
  check(same(SEVERITY_FILTERS, ['all', 'critical', 'warning', 'info']), 'the severity chips: All, Critical, Warning, Info');
}

console.log('\n== The Filter sheet and Sort (issuesFilterDefs, issuesChoice, the sort) ==');
{
  const tr = (k: string) => k;
  const defs = issuesFilterDefs({ open: 3, in_progress: 2 }, { all: 5, critical: 1, warning: 3, info: 1 }, tr);
  check(same(defs.map((d) => [d.key, d.kind, d.default]), [['status', 'single', 'active'], ['severity', 'single', 'all']]), 'two sections: the status (Active by default) and the severity (All)');
  check(same(defs[0].options.map((o) => [o.value, o.count]), [['active', 5], ['open', 3], ['in_progress', 2], ['resolved', undefined], ['dismissed', undefined]]), 'the status with the server\'s counts where the answer has them');
  check(same(defs[1].options.map((o) => o.count), [5, 1, 3, 1]) && defs[1].options[0].label === 'office.common.all' && defs[1].options[1].label === 'office.issues.severity.critical', 'the severity with the counts of the rows shown');
  check(issuesFilterDefs(null, null, tr).every((d) => d.options.every((o) => o.count === undefined)), 'no counts before the first answer');
  check(same(issuesChoice({ status: 'resolved', severity: 'info' }), { status: 'resolved', severity: 'info' }) && same(issuesChoice({ status: 'snoozed', severity: 'x' }), { status: 'active', severity: 'all' }), 'the choice read back (anything unknown is the default)');
  check(same(ISSUE_SORTS, ['urgent', 'newest']), 'Sort: the tool\'s own two orders');
  check(same(issuesArgs('active', '', undefined, 'newest'), { status: 'active', sort: 'newest', limit: 50 }) && same(issuesArgs('resolved', '', 'c3', 'urgent'), { status: 'resolved', sort: 'urgent', limit: 50, cursor: 'c3' }), 'a Sort picked goes as sort; none picked = the status\'s own order (as before)');
}

console.log('\n== The screen as text ==');
{
  const screen = readFileSync(join(__dirname, '..', 'src', 'app', 'office', 'issues', 'index.tsx'), 'utf8');
  check(/<FilterBar/.test(screen) && /defs=\{defs\}/.test(screen) && /issuesFilterDefs\(d, d \? counts : null, t\)/.test(screen) && /sort=\{\{ value: sort, options: ISSUE_SORTS/.test(screen) && !/FilterChips/.test(screen), 'Issues: the search bar, one Filter button with the counts, Sort by the tool\'s order, no chip rows');
  check(/useTool<IssuesList>\('list_issues', issuesArgs\(status, search, undefined, sortPick \?\? undefined, extra\)\)/.test(screen), 'list_issues with the status, the search, the order picked and (O3) the kind, vehicle and dates chosen (none = as before)');
  check(/<SkeletonRows/.test(screen) && /<ListFailed stale/.test(screen) && /<LoadMore/.test(screen) && !/<Loading/.test(screen), 'skeleton rows first, "Couldn\'t refresh" over rows, Load more at the end');
  const page = readFileSync(join(__dirname, '..', 'src', 'app', 'office', 'issues', '[id].tsx'), 'utf8');
  check(/<SkeletonRows/.test(page) && /<ListFailed/.test(page) && /<Sheet/.test(page) && !/<Modal/.test(page) && !/<Loading/.test(page), 'the issue\'s page: skeleton rows, the error with Try again, the note sheet is the one bottom sheet');
}

console.log('\n== The rows under the chips (fitsStatus, listRows, severityCounts) ==');
{
  check(isActive('open') && isActive('in_progress') && !isActive('resolved') && !isActive('dismissed') && !isActive(undefined), 'active = open or in progress');
  check(fitsStatus({ status: 'open' }, 'active') && fitsStatus({ status: 'in_progress' }, 'active') && !fitsStatus({ status: 'resolved' }, 'active'), 'Active holds open and in progress');
  check(fitsStatus({ status: 'resolved' }, 'resolved') && !fitsStatus({ status: 'open' }, 'resolved'), 'Resolved holds only resolved');
  const rows = [
    issue({ id: 'a', status: 'open', severity: 'critical' }),
    issue({ id: 'b', status: 'in_progress', severity: 'warning' }),
    issue({ id: 'c', status: 'resolved', severity: 'warning' }),
    issue({ id: 'd', status: 'open', severity: 'info' }),
  ];
  check(same(listRows(rows, 'active', 'all').map((i) => i.id), ['a', 'b', 'd']), 'Active · All: the open and in-progress rows in the server\'s order');
  check(same(listRows(rows, 'active', 'warning').map((i) => i.id), ['b']), 'Active · Warning narrows on the phone');
  check(same(listRows(rows, 'open', 'all').map((i) => i.id), ['a', 'd']), 'Open: a row patched to resolved leaves the list at once');
  check(same(severityCounts(rows, 'active'), { all: 3, critical: 1, warning: 1, info: 1 }), 'the severity chips count the rows of the status chosen', severityCounts(rows, 'active'));
  check(same(severityCounts(rows, 'resolved'), { all: 1, critical: 0, warning: 1, info: 0 }), 'the counts follow the status chip');
  check(same(severityCounts([], 'active'), { all: 0, critical: 0, warning: 0, info: 0 }), 'no rows: zeros');
}

console.log('\n== Load more (appendPage) and the header count ==');
{
  const list: IssuesList = { status: 'active', count: 2, open: 60, in_progress: 3, snoozed: 1, total: 63, next: 'c2', issues: [issue({ id: 'a' }), issue({ id: 'b' })] };
  const page: IssuesList = { status: 'active', count: 2, open: 60, in_progress: 3, total: 63, next: 'c3', issues: [issue({ id: 'b' }), issue({ id: 'c' })] };
  const out = appendPage(list, page);
  check(same(out.issues.map((i) => i.id), ['a', 'b', 'c']) && out.count === 3, 'the next page is appended, an issue never twice', out.issues.map((i) => i.id));
  check(out.next === 'c3' && out.total === 63, 'the cursor moves on, the total is the server\'s');
  const last = appendPage(out, { ...page, next: undefined, issues: [issue({ id: 'd' })] });
  check(last.next === undefined && last.issues.length === 4, 'the last page clears the cursor');
  check(out.open === 60 && out.in_progress === 3 && out.snoozed === 1, 'the counts stay');
  check(activeCount(list) === 63 && activeCount(null) === 0 && activeCount({ open: 2, in_progress: 0 }) === 2, 'the header count = open + in progress');
}

console.log('\n== The tones and the kind\'s name ==');
{
  check(severityTone('critical') === 'red' && severityTone('warning') === 'amber' && severityTone('info') === 'muted' && severityTone(undefined) === 'muted', 'severity: critical red, warning amber, info muted');
  check(statusTone('open') === 'red' && statusTone('in_progress') === 'amber' && statusTone('resolved') === 'green' && statusTone('dismissed') === 'muted', 'status: open red, in progress amber, resolved green, dismissed muted');
  const tr = (key: string) => (key === 'office.issues.kind.vehicle_report' ? 'වාහන ගැටලුව' : key);
  check(kindText({ kind: 'vehicle_report', kind_text: 'Vehicle problem' }, tr) === 'වාහන ගැටලුව', 'a kind the phone knows: the phone\'s words');
  check(kindText({ kind: 'new_kind', kind_text: 'Something new' }, tr) === 'Something new', 'a kind the phone does not know: the server\'s words');
  check(kindText({ kind: 'new_kind' }, tr) === 'new_kind', 'no words at all: the kind itself');
  check(kindText({ kind: 'x' }, () => '') === 'x', 'an empty translation counts as none');
}

console.log('\n== The rows\' lines (rowLine, whoLine, snoozeParts) ==');
{
  check(rowLine(issue(), 'Vehicle problem') === 'Vehicle problem · Engine stalled near Kadawatha', 'kind · detail');
  check(rowLine(issue({ due: 'due 2026-10-20' }), 'Service') === 'Service · Engine stalled near Kadawatha · due 2026-10-20', 'kind · detail · due');
  check(rowLine({ detail: undefined, due: undefined }, 'Licence') === 'Licence', 'the kind alone when there is nothing else');
  check(whoLine(issue(), WORDS) === 'Opened 2026-10-18 09:12', 'opened only (nothing else known)');
  check(whoLine(issue({ opened_by: 'System · Vehicle problem' }), WORDS) === 'Opened 2026-10-18 09:12 · System · Vehicle problem', 'with who opened it');
  check(whoLine(issue({ opened_by: 'Sahan', taken_by: { name: 'Charuka', at: '2026-10-18 10:05' } }), WORDS) === 'Opened 2026-10-18 09:12 · Sahan · taken by Charuka 10:05', 'taken by, with the time of day only');
  check(whoLine(issue({ taken_by: { name: 'Charuka' } }), WORDS) === 'Opened 2026-10-18 09:12 · taken by Charuka', 'taken by without a time');
  check(whoLine(issue({ status: 'resolved', resolved_at: '2026-10-18 11:00' }), WORDS) === 'Opened 2026-10-18 09:12 · closed 2026-10-18 11:00', 'a resolved one says closed');
  check(whoLine(issue({ status: 'dismissed', resolved: '2026-10-18 11:30' }), WORDS) === 'Opened 2026-10-18 09:12 · dismissed 2026-10-18 11:30', 'a dismissed one says dismissed (the older resolved field too)');
  check(whoLine(issue({ status: 'open', resolved_at: '2026-10-18 11:00' }), WORDS) === 'Opened 2026-10-18 09:12', 'an active one never says closed');
  check(snoozeParts(issue()) === undefined, 'not snoozed: nothing');
  check(same(snoozeParts(issue({ snoozed_until: '2026-10-19 07:00' })), { until: '2026-10-19 07:00' }), 'snoozed until');
  check(same(snoozeParts(issue({ snoozed_until: '2026-10-19 07:00', snoozed_by: 'Sahan' })), { until: '2026-10-19 07:00', by: 'Sahan' }), 'snoozed until, by whom');
  // Review of Round 4–7: the row's photo alone said neither who took it nor when it was closed; the words are back.
  check(same(rowWho(issue({ taken_by: { name: 'Charuka', at: '2026-10-18 10:05' }, assigned_to: { name: 'Charuka' } })), { taken: { name: 'Charuka', at: '10:05' } }), 'an active row: taken by, with the time of day');
  check(same(rowWho(issue({ assigned_to: { name: 'Charuka' } })), { taken: { name: 'Charuka' } }) && same(rowWho(issue()), {}), 'taken by from the person it is given to; nobody: nothing');
  check(same(rowWho(issue({ status: 'resolved', resolved_by: 'Sahan', resolved_at: '2026-10-18 14:20', taken_by: { name: 'Charuka' } })), { closed: { how: 'resolved', by: 'Sahan', at: '2026-10-18 14:20' } }), 'a resolved row: who and when (not who took it)');
  check(same(rowWho(issue({ status: 'dismissed', resolved: '2026-10-18 11:30' })), { closed: { how: 'dismissed', by: null, at: '2026-10-18 11:30' } }) && same(rowWho(issue({ status: 'resolved', resolved_by: 'system' })), { closed: { how: 'resolved', by: 'system', at: null } }),
    'dismissed with the older field; resolved by itself without a time');
  const list = readFileSync(join(__dirname, '..', 'src', 'app', 'office', 'issues', 'index.tsx'), 'utf8');
  check(list.includes("t('office.issues.takenByAt', { name: who.taken.name, at: who.taken.at })") && list.includes("t(c.how === 'dismissed' ? 'office.issues.dismissedBy' : 'office.issues.resolvedBy', { name: c.by, at })")
    && list.includes("[t('office.issues.closedAuto'), at].filter(Boolean).join(' · ')") && list.includes('line={[dueWords(t, meta.rest), taken].filter(Boolean).join(\' · \')}'),
    'the row says "taken by Sahan 10:05" in the grey line and "Resolved by Sahan · Today 14:20" under it');
  check(/<ListRow\b/.test(list) && list.includes('onLongPress={canPick ? () => pick([i.id], !on) : undefined}') && list.includes('selected={on}') && list.includes('testID="issue-tick"') && list.includes('<Avatar name={i.assigned_to.name}'),
    'the row is the one list row: the tick, the long press, the ticked look, the chips and the photo kept');
}

console.log('\n== The facts on the page (issueFacts) ==');
{
  check(same(issueFacts(issue(), FACT_WORDS), [
    { key: 'opened', value: '2026-10-18 09:12' },
    { key: 'openedBy', value: 'System' },
    { key: 'takenBy', value: 'Nobody yet' },
  ]), 'a fresh system issue: opened, by System, nobody yet (updated = opened: not repeated)', issueFacts(issue(), FACT_WORDS));
  check(same(issueFacts(issue({ opened_by: 'Sahan', taken_by: { name: 'Charuka', at: '2026-10-18 10:05' }, due: 'due 2026-10-20', updated: '2026-10-18 10:05' }), FACT_WORDS), [
    { key: 'opened', value: '2026-10-18 09:12' },
    { key: 'openedBy', value: 'Sahan' },
    { key: 'takenBy', value: 'Charuka · 2026-10-18 10:05' },
    { key: 'due', value: 'due 2026-10-20' },
    { key: 'updated', value: '2026-10-18 10:05' },
  ]), 'opened by a person, taken with the time, due, updated later');
  check(issueFacts(issue({ assigned_to: { name: 'Charuka' } }), FACT_WORDS)[2].value === 'Charuka', 'assigned without a taken event: the assignee\'s name');
  const closed = issueFacts(issue({ status: 'resolved', resolved_at: '2026-10-18 11:00', resolved_by: 'Sahan', updated: '2026-10-18 11:00' }), FACT_WORDS);
  check(same(closed[3], { key: 'resolved', value: '2026-10-18 11:00 by Sahan' }), 'resolved at and by', closed);
  const dismissed = issueFacts(issue({ status: 'dismissed', resolved: '2026-10-18 11:30', resolved_by: 'Sahan' }), FACT_WORDS);
  check(same(dismissed[3], { key: 'dismissed', value: '2026-10-18 11:30 by Sahan' }), 'dismissed at and by (the older resolved field too)', dismissed);
  check(!issueFacts(issue({ status: 'open', resolved_by: 'Sahan' }), FACT_WORDS).some((f) => f.key === 'resolved'), 'an open one has no resolved row');
}

console.log('\n== The actions (issueActions, noteRequired, updateInput) ==');
{
  const TOOLS = ['list_issues', 'issue_history', 'update_issue'];
  check(same(issueActions(issue(), TOOLS), ['take', 'note', 'resolve', 'dismiss']), 'open, nobody has it: Take, Add a note, Resolve, Dismiss');
  check(same(issueActions(issue({ status: 'in_progress', assigned_to: { name: 'Charuka' } }), TOOLS), ['note', 'resolve', 'dismiss']), 'in progress and taken: no Take');
  check(same(issueActions(issue({ status: 'resolved' }), TOOLS), ['reopen']) && same(issueActions(issue({ status: 'dismissed' }), TOOLS), ['reopen']), 'resolved or dismissed: Reopen only');
  check(same(issueActions(issue(), ['list_issues', 'issue_history']), []), 'without update_issue (assign_tasks only): no buttons at all');
  check(same(issueActions(issue({ status: 'resolved' }), []), []), 'no tools: nothing');
  check(noteRequired('note') && !noteRequired('resolve') && !noteRequired('dismiss') && !noteRequired('reopen') && !noteRequired('take'), 'only Add a note needs words');
  check(same(updateInput('i1', 'take'), { id: 'i1', assign_to: 'me', status: 'in_progress' }), 'Take = assign to me and in progress');
  check(same(updateInput('i1', 'take', 'ignored'), { id: 'i1', assign_to: 'me', status: 'in_progress' }), 'Take carries no note');
  check(same(updateInput('i1', 'note', '  Called the driver  '), { id: 'i1', note: 'Called the driver' }), 'a note, trimmed');
  check(updateInput('i1', 'note', '   ') === null && updateInput('i1', 'note') === null, 'an empty note sends nothing');
  check(same(updateInput('i1', 'resolve', 'Towed to the garage'), { id: 'i1', status: 'resolved', note: 'Towed to the garage' }), 'Resolve with the resolution');
  check(same(updateInput('i1', 'resolve'), { id: 'i1', status: 'resolved' }), 'Resolve without a note');
  check(same(updateInput('i1', 'dismiss', 'Not ours'), { id: 'i1', status: 'dismissed', note: 'Not ours' }) && same(updateInput('i1', 'dismiss'), { id: 'i1', status: 'dismissed' }), 'Dismiss with or without a note');
  check(same(updateInput('i1', 'reopen', 'Came back'), { id: 'i1', status: 'open', note: 'Came back' }) && same(updateInput('i1', 'reopen'), { id: 'i1', status: 'open' }), 'Reopen = open, with or without a note');
  for (const a of ['take', 'note', 'resolve', 'dismiss', 'reopen'] as const) {
    const input = updateInput('i1', a, 'x');
    check(input === null || !Object.values(input).some((v) => v === undefined || v === null), `${a}: no empty fields in the input`);
  }
}

console.log('\n== The card merged after a change (mergeIssue, patchHistory) ==');
{
  const old = issue({ opened_by: 'System · Vehicle problem', status: 'open' });
  const fresh = issue({ status: 'in_progress', assigned_to: { name: 'Sahan', email: 's@x.lk' }, updated: '2026-10-18 10:05' });
  const merged = mergeIssue(old, fresh, '2026-10-18 10:05');
  check(merged.status === 'in_progress' && merged.opened_by === 'System · Vehicle problem', 'the answer\'s status, who opened it kept');
  check(same(merged.taken_by, { name: 'Sahan', at: '2026-10-18 10:05' }), 'a new assignee is the taker from takenAt', merged.taken_by);
  check(!('resolved' in merged) && !('due' in merged), 'no undefined fields left');
  const again = mergeIssue(merged, { ...fresh, updated: '2026-10-18 10:20' }, '2026-10-18 10:20');
  check(same(again.taken_by, { name: 'Sahan', at: '2026-10-18 10:05' }), 'the same assignee keeps the first taken time');
  const other = mergeIssue(merged, { ...fresh, assigned_to: { name: 'Charuka' } }, '2026-10-18 10:30');
  check(same(other.taken_by, { name: 'Charuka', at: '2026-10-18 10:30' }), 'another assignee is a new taker');
  check(mergeIssue(merged, { ...fresh, assigned_to: undefined }).taken_by === undefined, 'nobody assigned: no taker');
  check(same(mergeIssue(undefined, fresh).taken_by, { name: 'Sahan' }), 'without the old card or a time: the name alone');
  check(mergeIssue(old, { ...fresh, taken_by: { name: 'Sahan', at: '2026-10-18 10:00' } }, '2026-10-18 10:05').taken_by?.at === '2026-10-18 10:00', 'the server\'s own taken_by wins');
  const h: IssueHistory = { issue: old, events: [{ at: '2026-10-18 09:12', action: 'opened', actor: 'system' }], task: { id: 't1', title: 'Trip', status: 'assigned' } };
  const patched = patchHistory(h, fresh, '2026-10-18 10:05');
  check(patched.issue.status === 'in_progress' && patched.events === h.events && patched.task === h.task, 'the history keeps its events and links, the issue merged');
}

console.log('\n== The links by permission (linksFor) ==');
{
  const h = { task: { id: 't1', title: 'Trip', status: 'assigned' }, request: { id: 'r1', requested_by: 'Nimal', when: 'Sat 17 Oct 09:00', status: 'approved' } };
  check(same(linksFor(h, ['view', 'assign_tasks']), { task: '/office/task/t1' }), 'assign_tasks: the task, not the request');
  check(same(linksFor(h, ['view', 'approve']), { request: '/office/request/r1' }), 'approve: the request, not the task');
  check(same(linksFor(h, ['view', 'approve', 'assign_tasks', 'issues']), { task: '/office/task/t1', request: '/office/request/r1' }), 'both with both');
  check(same(linksFor(h, ['view', 'issues']), {}), 'issues alone: the words only, no link');
  check(same(linksFor({}, ['assign_tasks', 'approve']), {}), 'nothing linked: nothing');
}

console.log('\n== The timeline (eventParts) ==');
{
  check(same(eventParts({ at: 'x', action: 'opened', actor: 'system' }), { key: 'opened', who: 'system' }), 'opened by');
  check(same(eventParts({ at: 'x', action: 'assigned', actor: 'Sahan', note: 'Charuka' }), { key: 'assigned', who: 'Sahan', to: 'Charuka' }), 'assigned to (the note holds the name)');
  check(same(eventParts({ at: 'x', action: 'note', actor: 'Sahan', note: 'Called him' }), { key: 'note', who: 'Sahan', note: 'Called him' }), 'a note');
  check(same(eventParts({ at: 'x', action: 'note' }), { key: 'note', who: undefined, note: '' }), 'a note with nobody and no words: never a crash');
  check(same(eventParts({ at: 'x', action: 'status', actor: 'Sahan', from: 'open', to: 'resolved', note: 'Fixed' }), { key: 'statusFrom', who: 'Sahan', from: 'open', to: 'resolved', note: 'Fixed' }), 'a status change with from');
  check(same(eventParts({ at: 'x', action: 'status', actor: 'Sahan', to: 'open' }), { key: 'status', who: 'Sahan', to: 'open', note: undefined }), 'a status change without from');
  check(same(eventParts({ at: 'x', action: 'auto_resolved' }), { key: 'autoResolved' }), 'resolved by itself');
  check(same(eventParts({ at: 'x', action: 'snoozed', actor: 'Sahan' }), { key: 'other', who: 'Sahan', action: 'snoozed' }), 'an unknown action: who and the word');
}

console.log('\n== The driver\'s report words ==');
{
  check(REPORT_STATUS_KEYS.open === 'report.open' && REPORT_STATUS_KEYS.in_garage === 'report.in_garage' && REPORT_STATUS_KEYS.closed === 'report.closed', 'the report statuses use the driver\'s own keys');
  check(reportCategoryKey('breakdown') === 'report.breakdown' && reportCategoryKey('warning_light') === 'report.warning_light', 'the categories use the driver\'s own keys');
  check(reportCategoryKey('something_else') === undefined, 'an unknown category: the server\'s word is shown');
}


console.log('\n== Round 4–7, item 8: the tabs, the groups, Gmail\'s rows, the bulk actions ==');
{
  check(same(ISSUE_TABS, ['open', 'snoozed', 'resolved']), 'three tabs: Open, Snoozed, Resolved');
  check(tabFor('active', false) === 'open' && tabFor('in_progress', false) === 'open' && tabFor('resolved', false) === 'resolved' && tabFor('dismissed', false) === 'resolved' && tabFor('active', true) === 'snoozed',
    'the tab follows the sheet\'s status; Snoozed is its own');
  check(TAB_STATUS.open === 'active' && TAB_STATUS.resolved === 'resolved', 'a tab opens on its status');
  check(showsGroups('open', undefined, '') && !showsGroups('open', 'km_gap', '') && !showsGroups('open', undefined, 'CAB') && !showsGroups('snoozed', undefined, '') && !showsGroups('resolved', undefined, ''),
    'Open groups by kind until a kind is chosen or words are searched for');
  check(same(tabExtra('open', true, 'all'), { snoozed: false, group: true }) && same(tabExtra('open', true, 'critical'), { snoozed: false, group: true, severity: 'critical' })
    && same(tabExtra('open', false, 'warning'), { snoozed: false }) && same(tabExtra('snoozed', false, 'all'), { snoozed: true }) && same(tabExtra('resolved', false, 'all'), {}),
    'what each tab adds: the snoozed left out or alone, the groups with the severity asked of the server');
  check(same(issuesArgs('active', '', undefined, undefined, { snoozed: false, group: true }), { status: 'active', sort: 'urgent', limit: 50, snoozed: false, group: true }), 'list_issues with the groups');
  check(same(issuesArgs('active', '', 'c2', undefined, { snoozed: true }), { status: 'active', sort: 'urgent', limit: 50, snoozed: true, cursor: 'c2' }), 'the Snoozed tab pages as before');
  const tr = (k: string) => (k === 'office.issues.group.missed_task' ? 'Missed tasks' : k === 'office.issues.kind.brand_new' ? 'brand' : k);
  check(groupText({ kind: 'missed_task', kind_text: 'Missed task' }, tr) === 'Missed tasks' && groupText({ kind: 'new_kind', kind_text: 'New kind' }, tr) === 'New kind', 'a group\'s heading: its plural words, else the kind\'s');
  const i = issue({ kind: 'missed_task', title: 'Missed task: Trip · Head office', headline: "Test Driver missed 'Trip · Head office'", meta: 'CAP-2207 · Test Driver · 2 h ago', vehicle: 'CAP-2207', driver: 'Test Driver' });
  check(rowTitle(i) === "Test Driver missed 'Trip · Head office'" && rowTitle(issue()) === 'Breakdown · WP CAB-4521', 'ONE title: the headline, else the title');
  check(same(metaParts(i), { plate: 'CAP-2207', rest: 'Test Driver · 2 h ago' }) && same(metaParts(issue({ vehicle: undefined })), { rest: '2026-10-18 09:12' }), 'ONE grey line: the plate apart (its chip), the rest in words');
  check(!statusShown('active', 'open') && statusShown('active', 'in_progress') && !statusShown('resolved', 'resolved') && statusShown('open', 'in_progress'), 'the status chip only when the tab does not say it');
  check(needsAction({ open: 24, in_progress: 0, needs_action: 4 }) === 4 && needsAction({ open: 3, in_progress: 2 }) === 5 && needsAction(null) === 0, 'the header counts what needs action (an older server: the active ones)');
  check(same(bulkCalls(['a', 'b', 'a'], 'resolved', ' Test data '), [{ ids: ['a', 'b'], status: 'resolved', note: 'Test data' }]) && bulkCalls(['a'], 'dismissed', '  ').length === 0
    && same(bulkCalls(Array.from({ length: 230 }, (_, n) => `i${n}`), 'dismissed', 'x').map((c) => c.ids.length), [100, 100, 30]), 'update_issues: one reason (required), 100 a call, each id once');
  check(same([...toggled(new Set(['a']), ['b', 'c'], true)].sort(), ['a', 'b', 'c']) && groupTick(new Set(['a']), ['a', 'b']) === 'mixed' && groupTick(new Set(['a', 'b']), ['a', 'b']) === 'on', 'the ticks: a row, a group\'s rows');
  const grouped: IssuesList = { status: 'active', count: 0, open: 3, in_progress: 0, issues: [], groups: [{ kind: 'missed_task', kind_text: 'Missed task', severity: 'warning', count: 5, newest: [issue({ id: 'a' }), issue({ id: 'b' })] }, { kind: 'km_gap', kind_text: 'Km', severity: 'warning', count: 1, newest: [issue({ id: 'c' })] }] };
  const after = withoutIssues(grouped, ['a', 'c']);
  check(same(after.groups?.map((g) => [g.kind, g.count, g.newest.map((x) => x.id)]), [['missed_task', 4, ['b']]]), 'after the bulk action: the rows leave, the counts drop, an empty group goes');

  // Every action the screen had is still there (Round 4–7 UI rules, 4).
  const screen = readFileSync(join(__dirname, '..', 'src', 'app', 'office', 'issues', 'index.tsx'), 'utf8');
  const has = (x: string) => screen.includes(x);
  check(has('<Segmented') && has('ISSUE_TABS.map') && has("t('office.issues.chip_open')") && has("t('office.issues.chip_in_progress')") && has("t('office.issues.chip_snoozed')") && has('testID="issues-maintenance"'),
    'the tabs, the header\'s open / in progress / snoozed chips and the link to Maintenance');
  check(has("pathname: '/office/issues/[id]'") && has('onLongPress=') && has('testID="issue-tick"') && has('testID="group-tick"') && has('testID="group-select-all"') && has("api.call<{ done: number; failed?: { id: string; error: string }[] }>('update_issues', c)"),
    'a row opens its issue; the ticks (the icon, a long press, a group, all of a group) and update_issues');
  check(has('testID="bulk-bar"') && has('testID="bulk-sheet"') && has("t('office.issues.bulk.resolve')") && has("t('office.issues.bulk.dismiss')") && has('disabled={!reason.trim()}') && has('busy={bulk.busy}'),
    'the bar: Resolve and Dismiss; the reason sheet: required, the button\'s own spinner');
  check(has('showKind(g.kind)') && has("t('office.issues.showAll'") && has("t('office.issues.allKinds')") && has('onToggle='), 'Show all N (the kind), All kinds back, a group collapses');
  check(has('<ListEmpty icon='), 'the empty states have an icon');
  const page = readFileSync(join(__dirname, '..', 'src', 'app', 'office', 'issues', '[id].tsx'), 'utf8');
  check(page.includes('issueActions(') && same(issueActions(issue(), ['update_issue']), ['take', 'note', 'resolve', 'dismiss']), 'the issue\'s page keeps Take, Add a note, Resolve, Dismiss (Reopen when closed)');

  // The words: en.json / si.json with the strings sidecar (src/i18n/parts/*.json) merged in while it exists.
  const words = mergedWords();
  const asked = [...screen.matchAll(/t\(\s*'(office\.issues\.[A-Za-z_.]+)'/g)].map((m) => m[1]);
  const lookup = (o: unknown, k: string) => k.split('.').reduce<unknown>((n, p) => (n && typeof n === 'object' ? (n as Record<string, unknown>)[p] : undefined), o);
  check(asked.length > 10 && asked.every((k) => typeof lookup(words.en, k) === 'string' && typeof lookup(words.si, k) === 'string'), 'every office.issues word the screen asks for, in English and Sinhala', asked.filter((k) => typeof lookup(words.si, k) !== 'string'));
  const kinds = Object.keys((lookup(words.en, 'office.issues.kind') as Record<string, string>) ?? {});
  check(kinds.every((k) => typeof lookup(words.en, `office.issues.group.${k}`) === 'string' && typeof lookup(words.si, `office.issues.group.${k}`) === 'string'), 'every kind has its group heading in both languages');
}

/** en.json and si.json with every sidecar (src/i18n/parts/*.json, { en, si }) deep-merged in while one exists. */
function mergedWords(): { en: Record<string, unknown>; si: Record<string, unknown> } {
  const dir = join(__dirname, '..', 'src', 'i18n');
  const out = { en: JSON.parse(readFileSync(join(dir, 'en.json'), 'utf8')), si: JSON.parse(readFileSync(join(dir, 'si.json'), 'utf8')) };
  const merge = (a: Record<string, unknown>, b: Record<string, unknown>) => {
    for (const [k, v] of Object.entries(b)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) merge((a[k] ??= {}) as Record<string, unknown>, v as Record<string, unknown>);
      else a[k] = v;
    }
  };
  const parts = join(dir, 'parts');
  if (existsSync(parts)) {
    for (const f of readdirSync(parts).filter((n) => n.endsWith('.json'))) {
      const part = JSON.parse(readFileSync(join(parts, f), 'utf8'));
      merge(out.en, part.en ?? {});
      merge(out.si, part.si ?? {});
    }
  }
  return out;
}

console.log(failures === 0 ? '\nAll issue checks passed.' : `\n${failures} issue check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
