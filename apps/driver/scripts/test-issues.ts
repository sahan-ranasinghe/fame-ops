// Office mode (Phase 8, O2): the Issues screens' pure rules (office/issuesLogic.ts), no phone: the status chips and
// list_issues' input, the severity chips, the next page appended, the tones, the rows' lines, the facts, the actions by
// status and tools, update_issue's inputs, the card merged after a change, the links by permission and the timeline.
//
//   npm run test:issues          (from apps/driver)

import {
  activeCount, appendPage, DEFAULT_STATUS, defaultSort, eventParts, fitsStatus, isActive, isSeverityFilter, isStatusFilter, issueActions, issueFacts, issuesArgs, kindText, LIMIT,
  linksFor, listRows, mergeIssue, noteRequired, patchHistory, REPORT_STATUS_KEYS, reportCategoryKey, rowLine, SEVERITY_FILTERS, severityCounts, severityTone, snoozeParts,
  STATUS_FILTERS, statusTone, updateInput, whoLine, type WhoWords,
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

console.log(failures === 0 ? '\nAll issue checks passed.' : `\n${failures} issue check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
