// Round 48 (item 1): a change to a task proposed by someone without approve, waiting for the fleet admin, as Office mode
// shows and decides it (office/changeLogic.ts, the screens, the strings in both languages).
//
//   npm run test:proposed-change          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CHANGE_DECLINE_TEXT, changeDecideInput, changeFieldKey, changeLine, changeLines, changeOutcome, changeStateKey, changeSummary, changeTitle, changeView, isChange,
  pendingChangeTarget, pendingChangeText,
} from '../src/office/changeLogic';
import { requestOutcome } from '../src/office/trip/formsLogic';
import { successOf } from '../src/office/trip/successLogic';
import type { Me, PendingChange, RequestCard } from '../src/office/types';

// The words straight from the JSON files (src/i18n pulls react-native in; the scripts read the files, as test-relative-words does).
const load = (lang: string) => JSON.parse(readFileSync(join(__dirname, '..', 'src', 'i18n', `${lang}.json`), 'utf8'));
const dicts = { en: load('en'), si: load('si') };
const lookup = (lang: 'en' | 'si', key: string): unknown => key.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), dicts[lang]);
const translate = (lang: 'en' | 'si', key: string, vars: Record<string, string | number> = {}) => {
  const v = lookup(lang, key);
  if (typeof v !== 'string') throw new Error(`No text for "${key}" (${lang})`);
  return v.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
};

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const read = (p: string) => readFileSync(join(__dirname, '..', 'src', p), 'utf8');
const en = (k: string, v?: Record<string, string | number>) => translate('en', k, v);
const si = (k: string, v?: Record<string, string | number>) => translate('si', k, v);

const changes = { driver: { from: 'Nuwan Perera', to: 'Kamal Silva' }, time: { from: 'Thu 29 Oct 09:00', to: 'Thu 29 Oct 10:00' } };
const card = {
  id: 'r1', kind: 'change', title: 'Team drop · Galle', requested_by: 'Sashen', status: 'waiting', version: 2, when: 'Thu 29 Oct 10:00', asked: '10:42',
  change: { task_id: 't1', task_title: 'Team drop · Galle', tool: 'reassign_task', summary: 'driver Kamal Silva instead of Nuwan Perera · time Thu 29 Oct 10:00 instead of Thu 29 Oct 09:00', changes, task_was: 'declined' },
} as unknown as RequestCard;
const pending: PendingChange = { request_id: 'r1', by: 'Sashen', at: '10:42', tool: 'reassign_task', summary: card.change!.summary, changes, text: 'Change waiting for approval · Sashen · driver Kamal Silva instead of Nuwan Perera' };
const approver = { name: 'Admin', permissions: ['view', 'approve', 'assign_tasks'], tools: ['decide_request', 'cancel_request', 'task_detail'] } as unknown as Me;
const proposer = { name: 'Sashen', permissions: ['view', 'assign_tasks'], tools: ['cancel_request', 'task_detail', 'reassign_task'] } as unknown as Me;

console.log('\nThe outcome of a change page (the site\'s changeOutcome)');
{
  check(same(changeOutcome({ waiting_for_approval: true, request_id: 'r1', task_unchanged: true }), { waiting: true, requestId: 'r1' }), 'waiting_for_approval: the change waits, the request named');
  check(same(changeOutcome({ task_id: 't1' } as never), { waiting: false }) && same(changeOutcome(undefined), { waiting: false }), 'a normal answer (or none): the task changed');
  const o = requestOutcome('saved', { waiting_for_approval: true, request_id: 'r1', task_id: 't1', warnings: ['x'] });
  check(o.kind === 'waiting' && o.requestId === 'r1' && o.taskId === 't1' && o.warnings.length === 0, 'update_task_stops answering waiting_for_approval: the editor\'s outcome is waiting, nothing to flash', o);
  check(requestOutcome('saved', { task_id: 't1', warnings: ['x'] }).kind === 'saved', 'a normal stop change stays saved');
  const s = successOf({ ...o, mode: 'stops', conflicts: [] }, { openTasks: true, openRequests: true, request: true });
  check(same(s.target, { kind: 'task', id: 't1' }) && s.snack === 'changeWaiting' && s.notice.length === 0, 'a waiting stop change goes back to the task with "the task is unchanged"', s);
  const w = successOf({ kind: 'waiting', mode: 'task', requestId: 'r2', warnings: [], conflicts: [] }, { openTasks: true, openRequests: true, request: true });
  check(same(w.target, { kind: 'request', id: 'r2' }) && w.snack === 'taskWaiting', 'a proposed task still opens its request (unchanged)');
  check(pendingChangeTarget('r1', approver) === '/office/request/r1' && pendingChangeTarget('r1', proposer) === '/office/request/r1', 'a pending change\'s line opens the request (the approver decides there)');
}

console.log('\nThe words in both languages');
{
  check(isChange(card) && !isChange({ kind: 'task' }) && !isChange({ kind: 'request' }) && !isChange(null), 'kind change');
  check(changeFieldKey('end by') === 'office.change.field_end_by' && changeFieldKey('driver') === 'office.change.field_driver' && changeFieldKey('odd thing') === null, 'the server\'s field names → the i18n keys; unknown ones pass through');
  const lines = changeLines(changes, en);
  check(same(lines.map((l) => [l.label, l.text]), [['Driver', 'Nuwan Perera → Kamal Silva'], ['Time', 'Thu 29 Oct 09:00 → Thu 29 Oct 10:00']]), 'the from → to rows (English)', lines);
  const siLines = changeLines(changes, si);
  check(siLines[0].label === si('office.change.field_driver') && siLines[0].text === 'Nuwan Perera → Kamal Silva', 'the from → to rows (Sinhala labels, the values as they are)', siLines);
  check(changeSummary(card.change, en) === 'Driver Kamal Silva (was Nuwan Perera) · Time Thu 29 Oct 10:00 (was Thu 29 Oct 09:00)', 'the summary in the person\'s words', changeSummary(card.change, en));
  check(changeSummary({ changes: {}, summary: 'stops: Stop 2 added' }, en) === 'stops: Stop 2 added' && changeSummary({ changes: {}, summary: '' }, en) === 'a change', 'no fields: the server\'s summary, else "a change"');
  check(changeSummary({ changes: { 'end by': { from: null, to: '17:00' } }, summary: '' }, en) === 'End by: 17:00' && changeSummary({ changes: { vehicle: { from: 'WP AB-1', to: null } }, summary: '' }, en) === 'Vehicle cleared', 'a field set, a field cleared');
  check(changeTitle(card, en) === 'Change · Team drop · Galle' && changeTitle({ title: '', change: { task_title: 'X', summary: '', changes: {} } }, en) === 'Change · X', '"Change · <task title>"');
  check(changeLine(card, en) === 'Driver Kamal Silva (was Nuwan Perera) · Time Thu 29 Oct 10:00 (was Thu 29 Oct 09:00) · proposed by Sashen', '"<summary> · proposed by <name>"', changeLine(card, en));
  check(pendingChangeText(pending, en) === 'Change waiting for approval · Sashen · Driver Kamal Silva (was Nuwan Perera) · Time Thu 29 Oct 10:00 (was Thu 29 Oct 09:00)', 'the pending line on the task, the board and needs a driver', pendingChangeText(pending, en));
  const siLine = changeLine(card, si);
  check(siLine.includes('Kamal Silva') && siLine.includes(si('office.change.proposedBy', { name: 'Sashen' })) && !/instead of|proposed by/.test(siLine), 'the Sinhala line carries no English phrase', siLine);
  const siPending = pendingChangeText(pending, si);
  check(siPending.startsWith(si('office.change.waitingLine', { name: 'Sashen', summary: '' }).split(' · ')[0]) && !/waiting for approval/.test(siPending), 'the Sinhala pending line', siPending);
  check(changeStateKey('waiting') === 'untouched' && changeStateKey('approved') === 'applied' && changeStateKey('declined') === 'left' && changeStateKey('cancelled') === 'left', 'the note by state');
}

console.log('\nThe decide input and who sees what');
{
  check(same(changeDecideInput(card, 'approve'), { request_id: 'r1', decision: 'approve', version: 2 }), 'approve: the id, the decision and the version the page loaded');
  check(same(changeDecideInput(card, 'decline', ' Keep Nuwan on it '), { request_id: 'r1', decision: 'decline', version: 2, reason: 'Keep Nuwan on it' }), 'decline: with its reason, trimmed');
  check(same(changeDecideInput({ id: 'r1' }, 'approve'), { request_id: 'r1', decision: 'approve', version: 0 }), 'no version known: 0 (the server refuses a stale one)');
  check(CHANGE_DECLINE_TEXT.keep === 'Keep the task as it is' && CHANGE_DECLINE_TEXT.not_approved === 'Not approved', 'the decline reasons the office reads in English');
  check(same(changeView(card, approver), { decides: true, withdraw: false, own: false }), 'an approver decides while it waits');
  check(same(changeView(card, proposer), { decides: false, withdraw: true, own: true }), 'the proposer (no approve) may withdraw while it waits');
  check(same(changeView({ ...card, status: 'approved' }, proposer), { decides: false, withdraw: false, own: true }), 'nothing once decided');
  check(changeView(card, { ...proposer, tools: ['task_detail'] }).withdraw === false, 'no withdraw without cancel_request');
}

console.log('\nThe screens as text');
{
  const give = read('app/office/task/[id]/driver.tsx');
  const time = read('app/office/task/[id]/time.tsx');
  const review = read('app/office/trip/review.tsx');
  const forms = read('office/trip/formsLogic.ts');
  const success = read('office/trip/successLogic.ts');
  const task = read('app/office/task/[id].tsx');
  const tasks = read('app/office/(tabs)/tasks.tsx');
  const home = read('app/office/(tabs)/index.tsx');
  const approve = read('app/office/(tabs)/approve.tsx');
  const trips = read('app/office/(tabs)/trips.tsx');
  const request = read('app/office/request/[id].tsx');
  const decide = read('components/office/ChangeDecide.tsx');
  const parts = read('components/office/ChangeParts.tsx');
  check(give.includes('if (changeOutcome(out).waiting) {') && give.includes("showSnackbar({ text: t('office.saved.changeWaiting') });") && give.indexOf('changeOutcome(out).waiting') < give.indexOf('setSavedNotice(`task:${task.id}`'), 'Give it a driver: a waiting answer goes back with the snackbar before anything is flashed');
  check(time.includes('if (changeOutcome(out).waiting) {') && time.includes("showSnackbar({ text: t('office.saved.changeWaiting') });") && time.indexOf('changeOutcome(out).waiting') < time.indexOf('setSavedNotice(`task:${id}`'), 'Change the task: the same');
  check(forms.includes("if (p.waiting_for_approval) return { kind: 'waiting'") && success.includes("snack = 'changeWaiting'") && review.includes("requestOutcome(chosen.tool === 'create_request' ? 'request_sent' : 'saved', out)") && review.includes("if (d!.mode === 'stops' && s.target.kind === 'task')"), 'Change stops: a waiting answer lands back on the task with "the task is unchanged"');
  check(task.includes('{task?.pending_change && <PendingChangeLine change={task.pending_change} />}'), 'the task page shows the pending change with its tap');
  check(tasks.includes('below={c.pending_change ? <PendingChangeLine change={c.pending_change} compact') && tasks.includes('below={x.pending_change ? <PendingChangeLine change={x.pending_change} compact'), 'the board\'s cards and the needs-a-driver rows show it');
  check(home.includes('below={x.pending_change ? <PendingChangeLine change={x.pending_change} compact') && home.includes('isChange(r) ? changeTitle(r, t) : requestTitle(r)') && home.includes('isChange(r) ? changeLine(r, t) : requestLine('), 'Home: the needs-a-driver rows, and a change in the requests');
  check(approve.includes('isChange(r) ? { title: changeTitle(r, t), line: changeLine(r, t) } : approveRowShown('), 'the Approve queue: "Change · <task>" with its line');
  check(trips.includes('isChange(trip) ? changeTitle(trip, t)') && trips.includes('isChange(trip) ? changeLine(trip, t)'), 'My trips: one\'s own proposed change');
  check(request.includes('if (card && isChange(card)) return <ChangeDecide') && request.indexOf('if (card && isChange(card))') > request.lastIndexOf('useState(') && request.indexOf('if (card && isChange(card))') > request.lastIndexOf('useSwitch('), 'the request page hands a kind change to its own screen, after every hook');
  check(decide.includes("api.call<DecideResult & { task_id?: string; applied?: unknown }>('decide_request', changeDecideInput(card, decision, reason))") && decide.includes("api.call('cancel_request', { request_id: card.id, reason })"), 'the decide screen: decide_request with the version; the proposer\'s withdraw through cancel_request');
  check(decide.includes('testID="change-approve"') && decide.includes('testID="change-decline"') && decide.includes('testID="change-withdraw"') && decide.includes('testID="change-open-task"') && decide.includes('<ChangeLines changes={change?.changes} />') && decide.includes("t('office.change.willDecide')"), 'Approve the change, Decline…, Withdraw, Open the task, the from → to lines, the proposer\'s note');
  check((decide.match(/<StickyActions>/g) ?? []).length === 3 && decide.includes('<ReasonSheet<ChangeDeclineKey>'), 'one sticky bar per state; the decline asks its reason in the sheet');
  check(parts.includes("me.tools.includes('decide_request') ? t('office.change.decideIt') : t('office.change.openRequest')") && parts.includes('router.push(pendingChangeTarget(change.request_id, me) as never)'), 'the pending line says Decide it → for an approver, Open the request → for the rest, and opens it');
  for (const [name, src] of [['the decide screen', decide], ['the parts', parts]] as const) {
    const bare = src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    const hard = Array.from(bare.matchAll(/>\s*([A-Z][a-z]+(?: [a-z]+)+)\s*</g)).map((m) => m[1]);
    check(hard.length === 0, `${name}: no hard-coded sentence`, hard);
  }
}

console.log('\nStrings in both languages');
{
  const enJ = JSON.parse(read('i18n/en.json')) as { office: { change: Record<string, string>; saved: Record<string, string> } };
  const siJ = JSON.parse(read('i18n/si.json')) as typeof enJ;
  const code = [read('office/changeLogic.ts'), read('components/office/ChangeDecide.tsx'), read('components/office/ChangeParts.tsx')].join('\n');
  const keys = Array.from(new Set(Array.from(code.matchAll(/'office\.change\.([A-Za-z_]+)'/g)).map((m) => m[1])));
  const missing = keys.filter((k) => !(k in enJ.office.change) || !(k in siJ.office.change));
  check(keys.length > 20 && missing.length === 0, `every office.change key the screens use exists in en and si (${keys.length})`, missing);
  const fields = ['driver', 'vehicle', 'time', 'end_by', 'leave_by', 'stops', 'start', 'return_to_base', 'avoid_expressway', 'title', 'passengers', 'contact', 'notes', 'day'];
  check(fields.every((f) => `field_${f}` in enJ.office.change && `field_${f}` in siJ.office.change), 'every field the server names has its word in both languages');
  check('changeWaiting' in enJ.office.saved && 'changeWaiting' in siJ.office.saved && enJ.office.saved.changeWaiting === "Waiting for the fleet admin's OK · the task is unchanged", 'the snackbar after a waiting change');
  const unmatched = Object.keys(enJ.office.change).filter((k) => !(k in siJ.office.change)).concat(Object.keys(siJ.office.change).filter((k) => !(k in enJ.office.change)));
  check(unmatched.length === 0, 'the same keys in both languages', unmatched);
  const sinhalaDigits = Object.values(siJ.office.change).filter((v) => /[෦-෯]/.test(v));
  check(sinhalaDigits.length === 0, 'Latin digits only in Sinhala');
  const ph = (s: string) => (s.match(/\{[a-z]+\}/g) ?? []).sort().join(',');
  const badPh = Object.keys(enJ.office.change).filter((k) => ph(enJ.office.change[k]) !== ph(siJ.office.change[k]));
  check(badPh.length === 0, 'the same placeholders in both languages', badPh);
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
