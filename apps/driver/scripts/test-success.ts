// Hotfix O2-H2, Part 1b: where a save lands (src/office/trip/successLogic.ts) and what waits there (src/office/savedNotice.ts).
//
//   npm run test:success          (from apps/driver)
import { requestIdOf, successOf } from '../src/office/trip/successLogic';
import { dismissSavedNotice, savedNotice, setSavedNotice } from '../src/office/savedNotice';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}

const ALL = { openTasks: true, openRequests: true, request: true };
const base = { warnings: [] as string[], conflicts: [] as { text: string }[] };

console.log('\nWhere a save lands');
{
  const s = successOf({ ...base, kind: 'sent', mode: 'task', taskId: 't1' } as never, ALL);
  check(s.target.kind === 'task' && s.snack === 'taskAssigned' && s.noticeKey === 'task:t1', 'a task sent to the driver opens the task: "Task sent to <name>"', s);
  const w = successOf({ ...base, kind: 'waiting', mode: 'task', requestId: 'r1' } as never, ALL);
  check(w.target.kind === 'request' && w.snack === 'taskWaiting', 'a task waiting for approval opens its request: "Waiting for the fleet admin's OK"', w);
  const b = successOf({ ...base, kind: 'booked', mode: 'request', taskId: 't2', requestId: 'r2' } as never, ALL);
  check(b.target.kind === 'task' && b.snack === 'booked', 'a booking opens its task: "Booking saved"', b);
  const r = successOf({ ...base, kind: 'request_sent', mode: 'request', requestId: 'r3' } as never, ALL);
  check(r.target.kind === 'request' && r.snack === 'requestSent', 'a request opens for an approver: "Request sent"', r);
  const asker = successOf({ ...base, kind: 'request_sent', mode: 'request', requestId: 'r3' } as never, { openTasks: false, openRequests: false, request: true });
  check(asker.target.kind === 'list' && (asker.target as { path: string }).path === '/office/(tabs)/trips', 'someone who only asks lands on My trips', asker);
  const e = successOf({ ...base, kind: 'saved', mode: 'edit', requestId: 'r4' } as never, ALL);
  check(e.target.kind === 'request' && e.snack === 'changesSaved', 'an edited request opens again: "Changes saved"', e);
  const st = successOf({ ...base, kind: 'saved', mode: 'stops', taskId: 't5' } as never, ALL);
  check(st.target.kind === 'task' && st.snack === 'stopsSaved', 'changed stops open the task: "Stops saved"', st);
  const noTask = successOf({ ...base, kind: 'sent', mode: 'task', taskId: 't6' } as never, { openTasks: false, openRequests: false, request: false });
  check(noTask.target.kind === 'list' && (noTask.target as { path: string }).path === '/office', 'no page to open: Home', noTask);
  const warn = successOf({ kind: 'sent', mode: 'task', taskId: 't7', warnings: ['Over its allowance'], conflicts: [{ text: 'FX 1 is busy 09:00' }] } as never, ALL);
  check(warn.notice.join('|') === 'Over its allowance|FX 1 is busy 09:00', 'the warnings, then the conflicts, wait on the task', warn.notice);
}

console.log('\nThe request id an answer carries');
check(requestIdOf({ request_id: 'a' }) === 'a' && requestIdOf({ request: { id: 'b' } }) === 'b' && requestIdOf(null) === undefined, 'book_vehicle at the top, create_request inside request, nothing at all');

console.log('\nThe notice on the landed screen');
{
  setSavedNotice('task:x', [' Over its allowance ', 'Over its allowance', '']);
  check(savedNotice('task:x')?.lines.join('|') === 'Over its allowance', 'trimmed, repeats and blanks dropped');
  setSavedNotice('task:x', []);
  check(savedNotice('task:x') === null, 'no lines = no card');
  setSavedNotice('task:y', ['End of FX 1: 12,300 km'], 'Vehicle swapped');
  check(savedNotice('task:y')?.title === 'Vehicle swapped', 'a heading of its own (a swap\'s readings)');
  dismissSavedNotice('task:y');
  check(savedNotice('task:y') === null, 'OK puts it away');
}

console.log(failures ? `\n${failures} FAILED` : '\nAll passed');
process.exit(failures ? 1 : 0);
