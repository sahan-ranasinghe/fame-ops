// Round 50 (docs/phase8-plan.md §37.4): Driving mode, an office person who drives their own trips with the driver screens
// in the same account (Uber's driver mode switch). The rules of src/lib/drivingMode.ts with made-up rows, the task list's
// query for both kinds of account (a fake client records what fetchTasks asks), the sharing rule, what the driver screens
// leave out, the sign-in switch, the push taps, then the screens and the provider read as text (the rule is where it must
// be, and a driver's paths are unchanged), and every driving.* key in both languages. Pure code, no stack needed:
//   npx tsx scripts/test-driving-mode.ts          (from apps/driver)

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { fetchTasks } from '../src/lib/api';
import {
  canEnterDriving, driverParts, drivingShown, isOfficeDriver, isOwnTask, leaveOutcome, ownTasks, shouldStopSharing, showSideSwitch, tapSide,
  taskScope, tripRunning, tripToDrive,
} from '../src/lib/drivingMode';

let failures = 0;
function check(ok: unknown, label: string, detail?: unknown): void {
  console.log(`${ok ? '  PASS  ' : '  FAIL  '}${label}${!ok && detail !== undefined ? `   [${JSON.stringify(detail)}]` : ''}`);
  if (!ok) failures += 1;
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const SRC = join(__dirname, '..', 'src');
const read = (p: string) => readFileSync(join(SRC, p), 'utf8');

const DRIVER = { id: 'e-driver', role: 'driver' };
const OFFICE = { id: 'e-office', role: 'fleet_admin' };
const STAFF = { id: 'e-staff', role: 'staff' };
type Row = { id: string; employee_id: string; driven_by: string; status: string; start_at: string };
const task = (id: string, over: Partial<Row>): Row => ({ id, employee_id: OFFICE.id, driven_by: 'self', status: 'assigned', start_at: '2026-10-29T03:30:00Z', ...over });

async function main(): Promise<void> {
  console.log('\n== Who is an office driver, and who may enter ==');
  {
    check(!isOfficeDriver(DRIVER), 'a driver\'s row is never an office driver');
    check(isOfficeDriver(OFFICE) && isOfficeDriver(STAFF) && isOfficeDriver({ role: 'admin' }) && isOfficeDriver({ role: 'viewer' }), 'any other role is (fleet_admin, staff, admin, viewer)');
    check(!isOfficeDriver(null) && !isOfficeDriver(undefined), 'nobody loaded: no');
    check(canEnterDriving({ can_drive: true }, true), 'can_drive true, self_drive_mode absent (= on), the app: offered');
    check(canEnterDriving({ can_drive: true, self_drive_mode: true }, true), 'can_drive true and the setting on: offered');
    check(!canEnterDriving({ can_drive: true, self_drive_mode: false }, true), 'the setting self_drive_mode off: never');
    check(!canEnterDriving({}, true) && !canEnterDriving({ can_drive: false }, true), 'can_drive absent (= false) or taken away: never');
    check(!canEnterDriving({ can_drive: true }, false), 'in a browser (/m/): never (it has its driver-lite page)');
    check(!canEnterDriving(null, true), 'no office person: never');
    check(drivingShown(false, false) && drivingShown(false, true), 'a driver\'s screens are always in front');
    check(drivingShown(true, true) && !drivingShown(true, false), 'an office person\'s only after Start driving, until Back to office');
  }

  console.log('\n== The task list: a driver\'s own tasks; an office person\'s own self-drive trips only ==');
  {
    check(same(taskScope(DRIVER), { employeeId: 'e-driver', selfOnly: false }), 'a driver: their own tasks, every kind', taskScope(DRIVER));
    check(same(taskScope(OFFICE), { employeeId: 'e-office', selfOnly: true }), 'an office person: their own, driven_by self', taskScope(OFFICE));
    const rows = [
      task('mine-self', {}),
      task('mine-other', { driven_by: 'other' }),
      task('mine-driver', { driven_by: 'driver' }),
      task('someone-else', { employee_id: 'e-x' }),
      task('a-driver', { employee_id: DRIVER.id, driven_by: 'driver' }),
    ];
    check(same(ownTasks(rows, OFFICE).map((r) => r.id), ['mine-self']), 'the phone\'s copy for an office person: never another person\'s task, never one they do not drive', ownTasks(rows, OFFICE).map((r) => r.id));
    check(same(ownTasks(rows, DRIVER).map((r) => r.id), ['a-driver']), 'for a driver: their own tasks only', ownTasks(rows, DRIVER).map((r) => r.id));
    check(ownTasks(rows, null).length === 0, 'nobody loaded: nothing');
    check(isOwnTask({ employee_id: DRIVER.id, driven_by: 'self' }, DRIVER), 'a driver\'s task whatever driven_by says (as before)');

    // What fetchTasks asks the server: a fake client records every call (RLS lets an office person with view read every task,
    // so the employee filter must be in the query itself).
    const asked = async (scope: ReturnType<typeof taskScope>) => {
      const log: [string, unknown[]][] = [];
      const builder: Record<string, unknown> = {};
      for (const name of ['from', 'select', 'eq', 'or', 'neq', 'order']) {
        builder[name] = (...args: unknown[]) => {
          log.push([name, args]);
          return builder;
        };
      }
      builder.then = (resolve: (v: unknown) => void) => resolve({ data: [], error: null, status: 200 });
      await fetchTasks(builder as never, new Date('2026-10-28T18:30:00Z'), scope);
      return log;
    };
    const forDriver = await asked(taskScope(DRIVER));
    const forOffice = await asked(taskScope(OFFICE));
    const eqs = (log: [string, unknown[]][]) => log.filter(([n]) => n === 'eq').map(([, a]) => a);
    check(same(eqs(forDriver), [['employee_id', 'e-driver']]), 'a driver\'s query: employee_id = me, nothing about driven_by', eqs(forDriver));
    check(same(eqs(forOffice), [['employee_id', 'e-office'], ['driven_by', 'self']]), 'an office person\'s query: employee_id = me and driven_by = self', eqs(forOffice));
    // The fresh review (finding 10): an office person's query also leaves out a trip under way on the web or from My trip.
    const notElsewhere = (a: unknown[]) => same(a, ['driven_in.is.null,driven_in.eq.app']);
    check(forOffice.some(([n, a]) => n === 'or' && notElsewhere(a)) && !forDriver.some(([n, a]) => n === 'or' && notElsewhere(a)),
      'an office person\'s query leaves out trips started on the web or from My trip (a driver\'s does not ask)');
    const rest = (log: [string, unknown[]][]) => log.filter(([n, a]) => n !== 'eq' && !(n === 'or' && notElsewhere(a)));
    check(same(rest(forDriver), rest(forOffice)), 'the rest of the query is the same for both (the window, never a missed task, by start)');
    check(!isOwnTask({ employee_id: OFFICE.id, driven_by: 'self', driven_in: 'web' }, OFFICE)
      && !isOwnTask({ employee_id: OFFICE.id, driven_by: 'self', driven_in: 'office' }, OFFICE)
      && isOwnTask({ employee_id: OFFICE.id, driven_by: 'self', driven_in: 'app' }, OFFICE)
      && isOwnTask({ employee_id: OFFICE.id, driven_by: 'self', driven_in: null }, OFFICE)
      && isOwnTask({ employee_id: DRIVER.id, driven_by: 'driver', driven_in: 'web' }, DRIVER),
      'on the phone too: an office person\'s web or My-trip start stays out of Driving mode; a driver is unchanged');
    const appSource = readFileSync(join(__dirname, '..', 'src/state/app.tsx'), 'utf8');
    check(/forgetEverything\(\{ keepQueue: left\.ops > 0 \|\| left\.points > 0 \}\)/.test(appSource) && /if \(!options\?\.keepQueue\) clearQueue\(\);/.test(appSource),
      'a sign-out forced mid-trip keeps the trip\'s unsent finish, readings and points on the phone');
    check(forDriver.some(([n, a]) => n === 'neq' && same(a, ['status', 'missed'])) && forDriver.some(([n, a]) => n === 'or' && String(a[0]).includes('status.in.(assigned,in_progress)')), 'the window as before: still to do or under way, or from the day\'s start; no missed task');
  }

  console.log('\n== Sharing: an office person shares only while a trip of theirs runs ==');
  {
    const running = [task('t1', { status: 'in_progress' })];
    const done = [task('t1', { status: 'completed' })];
    check(!shouldStopSharing({ officeDriver: true, sharing: true, tasks: running }), 'a trip under way: sharing goes on');
    check(shouldStopSharing({ officeDriver: true, sharing: true, tasks: done }), 'the trip finished (or was cancelled): sharing stops');
    check(shouldStopSharing({ officeDriver: true, sharing: true, tasks: running, except: 't1' }), 'at Finish, the trip just finished does not count (the phone\'s copy may not be written yet)');
    check(!shouldStopSharing({ officeDriver: true, sharing: true, tasks: [...running, task('t2', { status: 'in_progress' })], except: 't1' }), 'another trip of theirs still runs: sharing goes on');
    check(!shouldStopSharing({ officeDriver: true, sharing: false, tasks: done }), 'not sharing: nothing to stop');
    check(!shouldStopSharing({ officeDriver: false, sharing: true, tasks: done }), 'a driver: never (they stay on duty until Finish work)');
    check(tripRunning(running) && !tripRunning(done) && !tripRunning(running, 't1'), 'tripRunning');

    const app = read('state/app.tsx');
    const start = app.slice(app.indexOf('const startTask = useCallback'), app.indexOf('const queueFuel = useCallback'));
    const patchAt = start.indexOf("patch: { status: 'in_progress'");
    const shareAt = start.indexOf('await startSharing(serviceTexts)');
    check(patchAt > 0 && shareAt > patchAt, 'Start task queues the task\'s in_progress before the duty period opens (the server refuses an office person\'s period without a running trip)', { patchAt, shareAt });
    const complete = app.slice(app.indexOf('const completeTask = useCallback'), app.indexOf('// --- logs and reports outside a task'));
    const finishAt = complete.indexOf("patch: { status: 'completed'");
    const stopAt = complete.indexOf('stopTripSharing()');
    check(finishAt > 0 && stopAt > finishAt && complete.includes('shouldStopSharing({ officeDriver: officeDriverRef.current'), 'Finish stops an office person\'s sharing, after the finish is in the queue', { finishAt, stopAt });
    check(/useEffect\(\(\) => \{\s*if \(waitingTasks\.size > 0\) return;\s*if \(shouldStopSharing\(\{ officeDriver, sharing, tasks \}\)\) void stopTripSharing\(\);/.test(app), 'a trip cancelled or ended elsewhere stops it too, once no start or finish waits on the phone');
    check(/api\.fetchTasks\(supabase, startOfColomboDay\(colomboDate\(\)\), scope\)/.test(app) && app.includes('const scope = taskScope(meRef.current);'), 'refresh asks for the person\'s own tasks (the scope), never all RLS lets them read');
    check(app.includes('keepLocalTrips(ownTasks(taskRows, meRef.current)'), 'and filters the answer again on the phone');
  }

  console.log('\n== What the driver screens leave out for an office person ==');
  {
    const office = driverParts(true);
    const driver = driverParts(false);
    check(Object.values(office).every((on) => on === false), 'an office person: no duty, Start a trip, Change vehicle, Availability, Edit, forced steps, shift nudge, Sign out, decline / late, New task notice', office);
    check(Object.values(driver).every((on) => on === true), 'a driver: everything as before', driver);
    const today = read('app/(tabs)/index.tsx');
    check(today.includes('{parts.duty ? <DutyTiles /> : <DrivingCard />}') && today.includes('{parts.duty && <DutyNotices />}'), 'Today: the duty tiles (and notices) for a driver, the Driving mode card for an office person');
    check(today.includes('{parts.startTrip && app.sharing && !running && ('), 'Today: Start a trip only with startTrip');
    check(today.includes('parts.declineAndLate && next.status === \'assigned\' && next.accepted_at && canReportLate(next)') && today.includes('parts.declineAndLate && next.status === \'assigned\' && !isSelfTrip(next) && decline'), 'Today: Running late and Can\'t do this task only with declineAndLate');
    const me = read('app/(tabs)/me.tsx');
    check(me.includes('{parts.availability && (') && me.includes('{parts.changeVehicle && sharing && <Button') && me.includes('{parts.profileEdit && <Button'), 'Me: Availability, Change vehicle and Edit by the parts');
    check(me.includes('{parts.signOut ? (') && me.includes("label={t('driving.backToOffice')}"), 'Me: Sign out for a driver, Back to office for an office person');
    check(me.includes("router.push('/phone-setup')") && me.includes("router.push('/documents')") && me.includes("router.push('/permissions')"), 'Me keeps Phone setup, Documents and Permissions for both');
    const tabs = read('app/(tabs)/_layout.tsx');
    check(tabs.includes('if (me && officeMe && !driving) return <Redirect href="/office" />;'), 'the tabs go back to Office mode when Driving mode is not in front');
    check(tabs.indexOf('permissionsSeen') < tabs.indexOf('if (!driverParts(officeDriver).forcedSteps) return <DriverTabs />;') && tabs.indexOf('forcedSteps) return <DriverTabs />') < tabs.indexOf('needsPhonePrompt(me'), 'Permissions stays (first), the forced phone and photo steps are skipped for an office person only');
    const appSrc = read('state/app.tsx');
    check(appSrc.includes('if (sharing || !driverParts(officeDriver).shiftNudge) void disarmShiftNudge();') && appSrc.includes('else void armShiftNudge(shift'), 'the shift nudge: armed for a driver off duty as before, never for an office person');
    check(appSrc.includes('driverParts(officeDriverRef.current).newTaskNotice'), 'the Realtime "New task" notice: never for an office person');
    const task = read('app/task/[id].tsx');
    check(task.includes("app.officeDriver && sharing && (") && task.includes("t('driving.sharingUntil')"), 'the task under way says "Sharing location until this trip ends" for an office person only');
    const preview = read('components/TaskPreview.tsx');
    check(preview.includes('parts.declineAndLate && !isSelfTrip(task) && decline') && preview.includes('parts.declineAndLate && accepted && canReportLate(task)'), 'the task preview: no Can\'t do this task / Running late for an office person');
    const root = read('app/_layout.tsx');
    check(root.includes('{me && driving && <LocationGate />}'), 'the Location cover only while the driver screens are in front');
  }

  console.log('\n== Back to office ==');
  {
    const none = { ops: 0, points: 0 };
    check(leaveOutcome({ tasks: [task('t', { status: 'in_progress' })], queue: none }) === 'keep', 'a trip under way: the driver state stays behind Office mode (location and queue go on)');
    check(leaveOutcome({ tasks: [task('t', { status: 'completed' })], queue: { ops: 2, points: 0 } }) === 'keep', 'data still to send: kept until it is sent (never lost)');
    check(leaveOutcome({ tasks: [], queue: { ops: 0, points: 40 } }) === 'keep', 'points still to send: kept too');
    check(leaveOutcome({ tasks: [task('t', { status: 'completed' })], queue: none }) === 'drop', 'nothing running, nothing waiting: the driver state goes (the sign-in stays)');
    const app = read('state/app.tsx');
    const drop = app.slice(app.indexOf('const dropDriving = useCallback'), app.indexOf('const leaveDriving = useCallback'));
    check(drop.includes('forgetEverything({ keepPermissions: true })') && !drop.includes('auth.signOut'), 'dropping it never signs out of Auth and keeps the Permissions step done');
    const enter = app.slice(app.indexOf('const enterDriving = useCallback'), app.indexOf('const dropDriving = useCallback'));
    check(enter.includes('api.fetchMe(supabase)') && enter.includes('saveMe(row)') && !enter.includes('signIn(') && !enter.includes('forgetEverything') && !enter.includes('clearQueue'), 'Start driving loads their own row with no sign-in and nothing forgotten');
    check(/if \(officeSignedIn \|\| !officeDriverRef\.current\) return;/.test(app), 'Office mode signed out: the driver state goes with it');
  }

  console.log('\n== Home\'s line: a trip of theirs today, or one under way ==');
  {
    const today = '2026-10-29';
    const dateOf = (iso: string) => iso.slice(0, 10);
    const rows = [
      task('later', { start_at: '2026-10-29T09:00:00Z' }),
      task('first', { start_at: '2026-10-29T03:00:00Z' }),
      task('tomorrow', { start_at: '2026-10-30T03:00:00Z' }),
      task('someone', { employee_id: 'e-x', start_at: '2026-10-29T01:00:00Z' }),
      task('not-self', { driven_by: 'other', start_at: '2026-10-29T01:00:00Z' }),
    ];
    check(tripToDrive(rows, OFFICE, today, dateOf)?.id === 'first', 'the first own self-drive trip today still to start', tripToDrive(rows, OFFICE, today, dateOf)?.id);
    check(tripToDrive([...rows, task('going', { status: 'in_progress', start_at: '2026-10-28T03:00:00Z' })], OFFICE, today, dateOf)?.id === 'going', 'one under way comes first, whatever its day');
    check(tripToDrive([task('tomorrow', { start_at: '2026-10-30T03:00:00Z' })], OFFICE, today, dateOf) === null, 'only tomorrow: no line today');
    check(tripToDrive([task('done', { status: 'completed' })], OFFICE, today, dateOf) === null, 'finished: no line');
  }

  console.log('\n== The sign-in\'s Driver | Office switch ==');
  {
    check(showSideSwitch({ web: false, lastOfficeCanDrive: false }), 'a phone whose last office account cannot drive (or none): the switch as before');
    check(!showSideSwitch({ web: false, lastOfficeCanDrive: true }), 'the last office account can drive: hidden (they sign in as office)');
    check(!showSideSwitch({ web: true, lastOfficeCanDrive: false }), 'a browser: never (as before)');
    const store = read('office/store.ts');
    check(store.includes('setJson(OFFICE_KEYS.lastCanDrive, me.can_drive === true);') && !/else \{?[^}]*remove\(OFFICE_KEYS\.lastCanDrive\)/.test(store), 'remembered from every /me, kept after sign-out');
    const app = read('state/app.tsx');
    const signIn = app.slice(app.indexOf('const signIn = useCallback'), app.indexOf('const signOut = useCallback'));
    check(signIn.includes('remove(OFFICE_KEYS.lastCanDrive)'), 'a driver\'s sign-in on the phone brings the switch back');
    const login = read('app/login.tsx');
    check(login.includes('showSideSwitch({ web: webOnly, lastOfficeCanDrive: officeDrives })') && login.includes('{(switchShown || driverAsked) && <View') && login.includes("t('driving.driverLink')"), 'the sign-in uses the rule, with "Driver? Sign in with your PIN" to bring it back');
  }

  console.log('\n== A tapped notification with both sides on the phone ==');
  {
    const both = { driver: true, office: true, canDrive: true };
    check(tapSide({ kind: 'office' }, both) === 'office', 'an office notification (notify-office): Office mode');
    for (const kind of ['new', 'changed', 'cancelled', 'removed', 'reopened', 'leave_30', 'leave_now', 'fuel']) {
      check(tapSide({ kind, taskId: 't1' }, both) === 'driver', `a task's (push-task, ${kind}): the driver screen`);
    }
    check(tapSide({ kind: 'changed', taskId: 't1' }, { driver: false, office: true, canDrive: true }) === 'enter_driving', 'only Office mode loaded, the person can drive: Driving mode first');
    check(tapSide({ kind: 'changed', taskId: 't1' }, { driver: false, office: true, canDrive: false }) === null, 'cannot drive: nothing opens (as before)');
    check(tapSide({ kind: 'office' }, { driver: true, office: false, canDrive: false }) === null, 'a driver alone: an office notification opens nothing (as before: none comes)');
    check(tapSide({ kind: 'changed', taskId: 't1' }, { driver: true, office: false, canDrive: false }) === 'driver', 'a driver alone: their task as before');
    check(tapSide({ kind: 'office' }, { driver: false, office: true, canDrive: false }) === 'office', 'an office person alone: Office mode as before');
    const root = read('app/_layout.tsx');
    check(root.includes('tapSide(data, { driver: !!me, office: !!officeMe, canDrive: canEnterDriving(officeMe, Platform.OS !== \'web\') })'), 'the root layout routes the tap by the rule');
    check(root.includes('showDriving();') && root.includes("if (side === 'enter_driving')"), 'and brings the driver screens to the front (or enters Driving mode) first');
  }

  console.log('\n== Office mode\'s entries ==');
  {
    const home = read('app/office/(tabs)/index.tsx');
    check(home.includes('<DriveLine />'), 'Home has the drive line');
    const more = read('app/office/(tabs)/more.tsx');
    check(more.includes('canDrive && drivingMatches') && more.includes('testID="more-driving"'), 'More has the Driving row (only with can_drive and self_drive_mode, on the app)');
    check(more.includes('await officeSignOutCheck()'), 'More\'s Sign out asks first while a trip runs or its data waits');
    check(read('app/office/profile.tsx').includes('await officeSignOutCheck()'), 'My profile\'s Sign out too');
    const trip = read('app/office/my-trip/[id].tsx');
    check(trip.includes("appDrive && mode === 'check'") && trip.includes('testID="my-trip-start-driving"') && trip.includes("t('office.myTrip.alreadyDone')"), 'My trip: Start driving in place of the manual check; "Trip already done? Enter the odometer" kept');
    const driving = read('office/driving.tsx');
    check(!/'@\/lib\/api'|'\.\.\/lib\/api'/.test(driving), 'Office mode reads the trips through the app (no Office-mode file imports lib/api)');
  }

  console.log('\n== The words, in both languages ==');
  {
    const en = JSON.parse(read('i18n/en.json')) as Record<string, Record<string, string>>;
    const si = JSON.parse(read('i18n/si.json')) as Record<string, Record<string, string>>;
    const keys = Object.keys(en.driving ?? {});
    check(keys.length >= 20, 'the driving.* keys', keys.length);
    check(same(keys.sort(), Object.keys(si.driving ?? {}).sort()), 'the same keys in Sinhala');
    const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    const badVars = keys.filter((k) => vars(en.driving[k]) !== vars(si.driving[k] ?? ''));
    check(badVars.length === 0, 'the same placeholders', badVars);
    const sinhalaDigits = keys.filter((k) => /[෦-෯]/.test(si.driving[k] ?? ''));
    check(sinhalaDigits.length === 0, 'Latin digits only', sinhalaDigits);
    const empty = keys.filter((k) => !en.driving[k]?.trim() || !si.driving[k]?.trim() || si.driving[k] === en.driving[k]);
    check(empty.length === 0, 'every one written, the Sinhala not a copy of the English', empty);
    const files = ['app/(tabs)/index.tsx', 'app/(tabs)/me.tsx', 'app/task/[id].tsx', 'app/login.tsx', 'app/office/(tabs)/more.tsx', 'app/office/profile.tsx', 'app/office/my-trip/[id].tsx', 'components/DrivingCard.tsx', 'components/office/DriveLine.tsx', 'office/driving.tsx'];
    const used = [...new Set(files.flatMap((f) => [...read(f).matchAll(/'driving\.(\w+)'/g)].map((m) => m[1])))];
    const missing = used.filter((k) => !(k in en.driving) || !(k in si.driving));
    check(used.length >= 15 && missing.length === 0, 'every key the screens use is there', { used: used.length, missing });
  }

  if (failures > 0) {
    console.log(`\n${failures} check(s) failed.`);
    process.exit(1);
  }
  console.log('\nAll Driving mode checks passed.');
}

void main();
