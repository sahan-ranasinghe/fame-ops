// Sahan's removals (22 October 2026), Office mode (and /m/) through the router with the sample answers' fake client
// (src/design/sampleOffice.ts officeDesignValue: each tool's answer, {} for the rest). One block per decision:
//   1. Issues: each group heading says its severity by an icon (with the word for the screen reader) beside the dot; a
//      row in a group has no Warning / Info chip (Critical keeps its chip; a row unlike its group keeps its own); a flat
//      list (a kind's list) keeps every chip;
//   2. the Activity log: no "Done" chip; Refused, Failed and In progress keep theirs;
//   3. the Tasks tab: no "Waiting" chip on Waiting for approval; a late one says "Late" in words;
//   4. Vehicles (list and page): all three documents valid = one quiet "Documents valid" line that tells the screen reader
//      each expiry; anything expiring, expired, not set or missing keeps the chips;
//   5. the task page: no five-steps card; Approved (with the plan version) and Sent · Seen · Accepted with their times on
//      the timeline's first lines, Left when no start row says it;
//   6. Review: no vehicle-used line for a "chosen" vehicle (its plate is on the driver's row); another reason keeps it;
//   7. a conflict whose holder is its requester: the holder line's Call / WhatsApp only (no second pair); another holder or
//      no holder line (holder_contact off): the requester's own pair stays; a save's notice never had the pair.
//   8. kept: the Pre-trip tag on an issue (whatever the vehicle_check switch says).
// The words: en.json with the strings sidecars (src/i18n/parts/*.json, here removals.json) merged in while they wait
// (tests/fakeOffice.tsx mockUseApp); a missing key fails the test.
/* eslint-disable @typescript-eslint/no-require-imports */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';
import { Stack } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';

import { failOnConsoleError, FIX } from './fakeOffice';

jest.mock('@/state/app', () => ({ useApp: () => require('./fakeOffice').mockUseApp() }));

/* eslint-disable import/first */
import TasksTab from '@/app/office/(tabs)/tasks';
import IssuesScreen from '@/app/office/issues/index';
import ActivityLogScreen from '@/app/office/people/activity';
import TaskDetailScreen from '@/app/office/task/[id]';
import TripReview from '@/app/office/trip/review';
import VehicleScreen from '@/app/office/vehicles/[reg]';
import VehiclesScreen from '@/app/office/vehicles/index';
import { SavedNotice } from '@/components/office/SavedNotice';
import { hideSnackbar } from '@/components/patterns/Snackbar';
import { reviewAnswers, reviewDraft, tripAnswers, officeDesignValue } from '@/design/sampleOffice';
import { dateWords } from '@/lib/dateWords';
import { colomboDate } from '@/lib/time';
import { setSavedNotice } from '@/office/savedNotice';
import { OfficeValueProvider } from '@/office/state';
import { forgetSwitches } from '@/office/switches';
import { setDraft } from '@/office/trip/draft';
import { clearPlans } from '@/office/trip/useTrip';
import type { Conflict, Holder, Issue, Me, PlanPreview, TaskDetail, VehicleCard } from '@/office/types';

const t = require('./fakeOffice').mockUseApp().t as (k: string, v?: Record<string, string | number>) => string;
const TODAY = colomboDate();

type Answers = Record<string, (args: Record<string, unknown>) => unknown>;
const ME: Me = { ...FIX('me'), tools: [...FIX('me').tools, 'activity_log', 'update_issues', 'ask_for_it', 'holder_asks'] };

/** One screen at its route with the fake client; the others it may open are plain pages. */
function routesFor(answers: Answers, screens: Record<string, () => React.ReactElement | null>) {
  const value = officeDesignValue(answers, ME);
  const wrap = (S: () => React.ReactElement | null) => function Wrapped() {
    return <OfficeValueProvider value={value}><S /></OfficeValueProvider>;
  };
  return {
    _layout: () => <Stack screenOptions={{ headerShown: false }} />,
    ...Object.fromEntries(Object.entries(screens).map(([k, S]) => [k, wrap(S)])),
    'office/issues/[id]': () => <Text>issue page</Text>,
    'office/maintenance/index': () => <Text>maintenance</Text>,
    'office/request/[id]': () => <Text>request page</Text>,
    'office/task-history': () => <Text>history</Text>,
    'office/trip/where': () => <Text>where</Text>,
    'office/vehicles/form': () => <Text>form</Text>,
    'office/(tabs)/live': () => <Text>live</Text>,
    'office/(tabs)/alerts': () => <Text>alerts</Text>,
    'office/task/[id]/route': () => <Text>route</Text>,
    'office/holder-asks': () => <Text>asks</Text>,
  };
}

let errors: ReturnType<typeof failOnConsoleError>;
beforeEach(() => {
  forgetSwitches();
  clearPlans();
  act(() => hideSnackbar());
  errors = failOnConsoleError();
});
afterEach(() => {
  errors.restore();
  setDraft(null);
  expect(errors.seen.map((a) => String(a[0]))).toEqual([]);
});

// ---- 1 and 8: Issues ------------------------------------------------------------------------------------------------

const issue = (over: Partial<Issue>): Issue => ({
  id: 'x', kind: 'missed_task', kind_text: 'Missed task', severity: 'warning', title: 'Missed task: Trip', headline: 'Kamal missed the trip', meta: 'WP CAB-4521 · Kamal · 2 h ago',
  vehicle: 'WP CAB-4521', status: 'open', opened: '2026-10-22 08:00', updated: '2026-10-22 08:00', ...over,
});
const BREAKDOWN = issue({ id: 'b1', kind: 'vehicle_report', kind_text: 'Vehicle problem', severity: 'critical', headline: 'Breakdown', pre_trip: true });
const TYRE = issue({ id: 'b2', kind: 'vehicle_report', kind_text: 'Vehicle problem', severity: 'warning', headline: 'Tyre worn' });
const MISSED = [1, 2, 3].map((n) => issue({ id: `m${n}`, headline: `Kamal missed trip ${n}` }));
const SERVICE = issue({ id: 's1', kind: 'service_due', kind_text: 'Service due', severity: 'info', headline: 'Service in 400 km' });

function issuesAnswers(): Answers {
  const counts = { count: 0, open: 7, in_progress: 0, snoozed: 0, needs_action: 6, critical: 1 };
  return {
    list_vehicles: () => ({ filter: 'all', counts: {}, vehicles: [] }),
    list_issues: (args) => {
      if (args.group) {
        return {
          ...counts, status: 'active', issues: [], groups: [
            { kind: 'vehicle_report', kind_text: 'Vehicle problem', severity: 'critical', count: 2, newest: [BREAKDOWN, TYRE] },
            { kind: 'missed_task', kind_text: 'Missed task', severity: 'warning', count: 3, newest: MISSED },
            { kind: 'service_due', kind_text: 'Service due', severity: 'info', count: 1, newest: [SERVICE] },
          ],
        };
      }
      const rows = args.kind === 'missed_task' ? MISSED : [BREAKDOWN, TYRE, ...MISSED, SERVICE];
      return { ...counts, status: 'active', count: rows.length, total: rows.length, issues: rows };
    },
  };
}

describe('1. Issues: the severity on the group heading, not on every row', () => {
  it('each heading has its icon with the word for the screen reader; Warning / Info leave the rows, Critical stays', async () => {
    renderRouter(routesFor(issuesAnswers(), { 'office/issues/index': IssuesScreen }), { initialUrl: '/office/issues' });
    const critical = await screen.findByTestId('issue-group-vehicle_report');
    const missed = screen.getByTestId('issue-group-missed_task');
    const service = screen.getByTestId('issue-group-service_due');
    // The heading's icon carries the severity's word (the dot is still there beside it).
    expect(within(critical).getByTestId('issue-group-vehicle_report-severity').props.accessibilityLabel).toBe(t('office.issues.severity.critical'));
    expect(within(missed).getByTestId('issue-group-missed_task-severity').props.accessibilityLabel).toBe(t('office.issues.severity.warning'));
    expect(within(service).getByTestId('issue-group-service_due-severity').props.accessibilityLabel).toBe(t('office.issues.severity.info'));
    // A warning group: no "Warning" on its rows; an info group: no "Info".
    expect(within(missed).getAllByTestId('issue-row')).toHaveLength(3);
    expect(within(missed).queryByText(t('office.issues.severity.warning'))).toBeNull();
    expect(within(service).queryByText(t('office.issues.severity.info'))).toBeNull();
    // The critical group: the critical row keeps "Critical"; the warning row in it keeps its own "Warning" (the heading
    // does not say it).
    expect(within(critical).getByText(t('office.issues.severity.critical'))).toBeTruthy();
    expect(within(critical).getByText(t('office.issues.severity.warning'))).toBeTruthy();
    // 8: the Pre-trip tag stays.
    expect(within(critical).getByTestId('issue-pre-trip')).toBeTruthy();
  });

  it('a flat list (a search, a kind\'s list: no heading) keeps the chip on every row', async () => {
    renderRouter(routesFor(issuesAnswers(), { 'office/issues/index': IssuesScreen }), { initialUrl: '/office/issues' });
    const missed = await screen.findByTestId('issue-group-missed_task');
    expect(within(missed).queryByTestId('issue-severity')).toBeNull();
    // Words searched for list their results as one list.
    fireEvent.changeText(screen.getByPlaceholderText(t('office.issues.searchPlaceholder')), 'Kamal');
    // The words go to the server half a second after the last key (renderRouter's clock is a fake one).
    await act(async () => { jest.advanceTimersByTime(600); });
    await waitFor(() => expect(screen.queryByTestId('issue-group-missed_task')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('issue-severity')).toHaveLength(6));
    expect(screen.getAllByText(t('office.issues.severity.warning'))).toHaveLength(4);
    expect(screen.getAllByText(t('office.issues.severity.info'))).toHaveLength(1);
    expect(screen.getAllByText(t('office.issues.severity.critical'))).toHaveLength(1);
  });

  it('a kind\'s list (the Filter\'s kind) keeps the Warning chip on its rows', async () => {
    renderRouter(routesFor(issuesAnswers(), { 'office/issues/index': IssuesScreen }), { initialUrl: '/office/issues' });
    await screen.findByTestId('issue-group-missed_task');
    fireEvent.press(screen.getByTestId('filter-button'));
    const sheet = await screen.findByTestId('filter-sheet');
    fireEvent.press(within(sheet).getAllByText(t('office.issues.kind.missed_task'))[0]);
    fireEvent.press(within(screen.getByTestId('filter-sheet')).getByText(t('patterns.apply')));
    await waitFor(() => expect(screen.queryByTestId('issue-group-missed_task')).toBeNull());
    await waitFor(() => expect(screen.getAllByTestId('issue-severity')).toHaveLength(3));
    expect(screen.getAllByText(t('office.issues.severity.warning'))).toHaveLength(3);
  });
});

// ---- 2: the Activity log ------------------------------------------------------------------------------------------

describe('2. the Activity log: no "Done" chip', () => {
  it('a done row has no chip; Refused, Failed and In progress keep theirs', async () => {
    const answers: Answers = {
      activity_log: () => ({
        from: '2026-10-15', to: '2026-10-22', count: 4, total: 4,
        entries: [
          { id: 1, at: '2026-10-22 09:00', person: 'Sahan', channel: 'Website or app', action: 'Approved a request', outcome: 'done' },
          { id: 2, at: '2026-10-22 09:05', person: 'Sahan', channel: 'Website or app', action: 'Cancelled a task', outcome: 'refused', reason: 'Already started' },
          { id: 3, at: '2026-10-22 09:10', person: 'Sahan', channel: 'Website or app', action: 'Booked a vehicle', outcome: 'failed' },
          { id: 4, at: '2026-10-22 09:15', person: 'Sahan', channel: 'Website or app', action: 'Imported places', outcome: 'running' },
        ],
      }),
    };
    renderRouter(routesFor(answers, { 'office/people/activity': ActivityLogScreen }), { initialUrl: '/office/people/activity' });
    await screen.findByText('Approved a request');
    expect(screen.queryByText(t('office.activity.done'))).toBeNull();
    expect(screen.getByText(t('office.activity.refused'))).toBeTruthy();
    expect(screen.getByText(t('office.activity.failed'))).toBeTruthy();
    expect(screen.getByText(t('office.activity.running'))).toBeTruthy();
  });
});

// ---- 3: the Tasks tab ----------------------------------------------------------------------------------------------

describe('3. Tasks: Waiting for approval without the always-on chip', () => {
  it('no "Waiting" on the rows; "Late" only on the one whose leave-by passed', async () => {
    const answers: Answers = {
      task_board: () => ({
        date: colomboDate(),
        counts: { assigned: 0, in_progress: 0, completed: 0, cancelled: 0 },
        assigned: [], in_progress: [], completed: [],
        waiting_approval: [
          { request_id: 'r1', time: '09:00', leave_by: '09:00', title: 'Proposed on time', stops_count: 2, driver: 'Kamal', vehicle: 'WP CAB-4521', proposed_by: 'Nimal', status: 'Waiting for approval · proposed by Nimal' },
          { request_id: 'r2', time: '07:00', leave_by: '07:00', title: 'Proposed and late', stops_count: 2, driver: 'Sunil', vehicle: 'WP KL-1234', proposed_by: 'Nimal', status: 'Leave-by passed · not decided', late: true },
        ],
      }),
    };
    renderRouter(routesFor(answers, { 'office/(tabs)/tasks': TasksTab }), { initialUrl: '/office/tasks' });
    await screen.findByText('Proposed on time');
    expect(screen.queryByText(t('office.chip.waiting'))).toBeNull();
    expect(screen.getAllByText(t('office.chip.lateWord'))).toHaveLength(1);
    // The section still says it, and a row still opens its request.
    expect(screen.getByText(t('office.tasks.waitingApproval').toUpperCase())).toBeTruthy();
  });
});

// ---- 4: Vehicles ---------------------------------------------------------------------------------------------------

const VALID: VehicleCard = {
  reg_no: 'WP CAB-4521', make_model: 'Toyota HiAce', seats: 14, status: 'Available', availability: 'Free', km_this_month: 100, km_allowance: 2500, active: true,
  documents: { lic: { chip: 'ok', expiry: '2027-03-12' }, ins: { chip: 'ok', expiry: '2027-01-05' }, emi: { chip: 'ok', expiry: '2026-12-20' } },
} as VehicleCard;
const EXPIRING: VehicleCard = { ...VALID, reg_no: 'WP GA-1111', documents: { ...VALID.documents, ins: { chip: 'orange', expiry: '2026-11-01' } } } as VehicleCard;
const MISSING: VehicleCard = { ...VALID, reg_no: 'WP NO-0001', documents_missing: ['registration'], documents_missing_text: '1 document missing: CR' } as VehicleCard;

function vehiclesAnswers(rows: VehicleCard[]): Answers {
  return {
    list_vehicles: (args) => ({ filter: args.filter, counts: {}, total: rows.length, vehicles: args.search ? rows.filter((v) => v.reg_no === args.search) : rows }),
    vehicle_documents: (args) => ({ vehicle: args.vehicle, documents: [] }),
  };
}
const valid = (doc: string, date: string) => t('office.lists2.vehicles.docValidUntil', { doc: t(`office.vehicles.doc_${doc}`), date: dateWords(t, date) });

describe('4. Vehicles: one quiet line when every document is valid', () => {
  it('the list: "Documents valid" (each expiry to the screen reader) for an all-valid vehicle; the chips for the others', async () => {
    renderRouter(routesFor(vehiclesAnswers([VALID, EXPIRING, MISSING]), { 'office/vehicles/index': VehiclesScreen }), { initialUrl: '/office/vehicles' });
    await screen.findByText('WP GA-1111');
    const line = screen.getByTestId('docs-valid');
    expect(screen.getAllByTestId('docs-valid')).toHaveLength(1);
    expect(within(line).getByText(t('office.lists2.vehicles.docsValid'))).toBeTruthy();
    for (const [doc, date] of [['lic', '2027-03-12'], ['ins', '2027-01-05'], ['emi', '2026-12-20']]) expect(line.props.accessibilityLabel).toContain(valid(doc, date));
    // The expiring one and the one with a document missing keep their three chips (Ins in colour, the valid ones quiet).
    expect(screen.getAllByText(t('office.vehicles.doc_ins'))).toHaveLength(2);
    expect(screen.getAllByTestId('doc-ok').length).toBeGreaterThanOrEqual(4);
  });

  it('the vehicle page: the line instead of the chips; an expiring one keeps its chips with their dates', async () => {
    renderRouter(routesFor(vehiclesAnswers([VALID, EXPIRING]), { 'office/vehicles/[reg]': VehicleScreen }), { initialUrl: '/office/vehicles/WP CAB-4521' });
    const line = await screen.findByTestId('docs-valid');
    expect(within(line).getByText(t('office.lists2.vehicles.docsValid'))).toBeTruthy();
    expect(line.props.accessibilityLabel).toContain(valid('lic', '2027-03-12'));
    expect(screen.queryByTestId('doc-chips')).toBeNull();
  });

  it('the vehicle page of an expiring one: the chips as before', async () => {
    renderRouter(routesFor(vehiclesAnswers([VALID, EXPIRING]), { 'office/vehicles/[reg]': VehicleScreen }), { initialUrl: '/office/vehicles/WP GA-1111' });
    const chips = await screen.findByTestId('doc-chips');
    expect(within(chips).getByText(`${t('office.vehicles.doc_ins')} · ${dateWords(t, '2026-11-01')}`)).toBeTruthy();
    expect(screen.queryByTestId('docs-valid')).toBeNull();
  });
});

// ---- 5: the task page ----------------------------------------------------------------------------------------------

function tripWith(edit: (task: TaskDetail['task']) => TaskDetail['task']): Answers {
  const answers = tripAnswers();
  const detail = answers.task_detail({}) as TaskDetail;
  return { ...answers, task_detail: () => ({ ...detail, task: edit({ ...detail.task }) }) };
}

describe('5. the task page: the five-steps card goes, its facts on the timeline', () => {
  it('no steps card; "Approved by … · plan v2" and "Sent · Seen · Accepted" open the timeline (the start row says Left)', async () => {
    const answers = tripWith((x) => ({ ...x, sent: `${TODAY} 07:30`, seen: `${TODAY} 07:35`, accepted: `${TODAY} 07:41`, started: `${TODAY} 08:21` }));
    renderRouter(routesFor(answers, { 'office/task/[id]': TaskDetailScreen }), { initialUrl: '/office/task/t-design-4' });
    const card = await screen.findByTestId('task-stops', {}, { timeout: 5000 });
    expect(screen.queryByTestId('task-steps')).toBeNull();
    expect(screen.queryByText(t('office.task.step_on_the_way'))).toBeNull();
    expect(within(card).getByTestId('task-approved')).toHaveTextContent(`${t('office.request.approvedBy', { name: 'Palitha Fernando', at: 'Thu 21:10' })} · ${t('office.task.planVersion', { v: 2 })}`);
    expect(within(card).getByTestId('task-dispatch-line')).toHaveTextContent(
      [t('office.task.sentAt', { time: '07:30' }), t('office.task.seenAt', { time: '07:35' }), t('office.line.accepted', { time: '07:41' })].join(' · '),
    );
    // The start row (S) says when the driver left; the line does not say it again. The stop's row is still there.
    expect(within(card).getByTestId('task-dispatch-line')).not.toHaveTextContent(t('office.timeline.left', { time: '08:21' }), { exact: false });
    expect(within(card).getByText(`${t('office.task.planned', { time: '08:16' })} · ${t('office.task.left', { time: '08:21' })}`)).toBeTruthy();
    expect(within(card).getByTestId('timeline-stop-0')).toBeTruthy();
  });

  it('not opened yet: no Seen (the banner says it); no start place: "Left" on the line', async () => {
    const answers = tripWith((x) => ({ ...x, start_place: undefined, approved_by: undefined, sent: `${TODAY} 07:30`, seen: 'not opened yet', accepted: undefined, started: `${TODAY} 08:21` }));
    renderRouter(routesFor(answers, { 'office/task/[id]': TaskDetailScreen }), { initialUrl: '/office/task/t-design-4' });
    const line = await screen.findByTestId('task-dispatch-line', {}, { timeout: 5000 });
    expect(line).toHaveTextContent([t('office.task.sentAt', { time: '07:30' }), t('office.timeline.left', { time: '08:21' })].join(' · '));
    // Without an approver the line above carries the plan version alone, as the card did.
    expect(screen.getByTestId('task-approved')).toHaveTextContent(t('office.task.planVersion', { v: 2 }));
  });
});

// ---- 6 and 7: Review -----------------------------------------------------------------------------------------------

function reviewRoutes(answers: Answers) {
  return routesFor(answers, {
    'office/trip/review': function Review() {
      useState(() => {
        setDraft(reviewDraft());
        return true;
      });
      return <TripReview />;
    },
  });
}
const planWith = (over: Partial<PlanPreview>): Answers => {
  const answers = reviewAnswers();
  const plan = answers.plan_task({}) as PlanPreview;
  return { ...answers, plan_task: () => ({ ...plan, ...over }) };
};

describe('6. Review: the vehicle-used line', () => {
  it('"chosen": no line (the plate is on the driver\'s row)', async () => {
    renderRouter(reviewRoutes(planWith({})), { initialUrl: '/office/trip/review' });
    expect(await screen.findByTestId('review-driver', {}, { timeout: 6000 })).toBeTruthy();
    await screen.findByTestId('review-stepper', {}, { timeout: 6000 });
    expect(screen.queryByTestId('vehicle-used')).toBeNull();
  });

  it('another reason (the driver\'s vehicle today) keeps its line', async () => {
    renderRouter(reviewRoutes(planWith({ vehicle_used: { reg_no: 'CAP-2207', why: "Kamal's vehicle today" } })), { initialUrl: '/office/trip/review' });
    const line = await screen.findByTestId('vehicle-used', {}, { timeout: 6000 });
    expect(line).toHaveTextContent(t('office.trip.vehicleUsedLine', { text: "CAP-2207 · Kamal's vehicle today" }));
  });
});

const TASK = '1b2c3d4e-0000-4000-8000-00000000abcd';
const anoja: Holder = {
  task_id: TASK, employee_id: 'e1', name: 'Anoja Perera', label: 'Fleet admin', by: 'asked', window: '08:00–11:00', from: '08:00', to: '11:00',
  call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567',
};
const conflict = (holder?: Holder): Conflict => ({
  kind: 'vehicle', text: 'CAP-2207 is on task Site visit 08:00–11:00 for Anoja Perera', task: { id: TASK, title: 'Site visit', window: '08:00–11:00' },
  requester: { name: 'Anoja Perera', call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567' }, ...(holder ? { holder } : {}),
});

describe('7. a conflict whose holder is its requester: one pair of Call / WhatsApp', () => {
  it('the holder line\'s Call and WhatsApp only; Open that task and Pick another vehicle kept', async () => {
    renderRouter(reviewRoutes(planWith({ conflicts: [conflict(anoja)] })), { initialUrl: '/office/trip/review' });
    await screen.findByText(conflict().text, {}, { timeout: 6000 });
    expect(screen.getByTestId('conflict-holder-0-call')).toBeTruthy();
    expect(screen.getByTestId('conflict-holder-0-whatsapp')).toBeTruthy();
    expect(screen.queryByText(t('office.trip.callName', { name: 'Anoja' }))).toBeNull();
    expect(screen.queryByText(t('office.trip.whatsappName', { name: 'Anoja' }))).toBeNull();
    expect(screen.getByText(t('office.trip.openThatTask'))).toBeTruthy();
    expect(screen.getByText(t('office.trip.pickAnotherVehicle'))).toBeTruthy();
  });

  it('another holder (who assigned it): the requester\'s own pair stays beside the holder line', async () => {
    const palitha: Holder = { ...anoja, employee_id: 'e2', name: 'Palitha Fernando', by: 'assigned', call: 'tel:+94771111111', whatsapp: 'https://wa.me/94771111111' };
    renderRouter(reviewRoutes(planWith({ conflicts: [conflict(palitha)] })), { initialUrl: '/office/trip/review' });
    await screen.findByText(conflict().text, {}, { timeout: 6000 });
    expect(screen.getByTestId('conflict-holder-0-call')).toBeTruthy();
    expect(screen.getByText(t('office.trip.callName', { name: 'Anoja' }))).toBeTruthy();
    expect(screen.getByText(t('office.trip.whatsappName', { name: 'Anoja' }))).toBeTruthy();
  });

  it('holder_contact off (no holder line, even with an older answer\'s holder): the requester\'s pair stays', async () => {
    const answers = planWith({ conflicts: [conflict(anoja)] });
    renderRouter(reviewRoutes({ ...answers, get_settings: () => ({ settings: { tasks_need_approval: false, self_drive_allowed: true, passengers: true, holder_contact: false } }) }), { initialUrl: '/office/trip/review' });
    await screen.findByText(conflict().text, {}, { timeout: 6000 });
    await waitFor(() => expect(screen.queryByTestId('conflict-holder-0')).toBeNull());
    expect(screen.getByText(t('office.trip.callName', { name: 'Anoja' }))).toBeTruthy();
    expect(screen.getByText(t('office.trip.whatsappName', { name: 'Anoja' }))).toBeTruthy();
  });

  it('a save\'s notice: the holder card\'s Call and WhatsApp, never a second pair', async () => {
    setSavedNotice(`task:${TASK}`, [conflict().text], undefined, [conflict(anoja)]);
    renderRouter(routesFor({}, { 'office/task/[id]': () => <SavedNotice noticeKey={`task:${TASK}`} /> }), { initialUrl: `/office/task/${TASK}` });
    expect(await screen.findByTestId('saved-conflict-0-holder-call')).toBeTruthy();
    expect(screen.getByTestId('saved-conflict-0-holder-whatsapp')).toBeTruthy();
    expect(screen.queryByText(t('office.trip.callName', { name: 'Anoja' }))).toBeNull();
    expect(screen.queryByText(t('office.trip.whatsappName', { name: 'Anoja' }))).toBeNull();
  });
});
