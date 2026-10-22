// Round 4–7, item 12: the sample answers the office design pages draw Office mode's REAL screens with (src/design/
// OfficeHome.tsx, OfficeReview.tsx, OfficeRequest.tsx, OfficeTrip.tsx; the mockup comparison's screenshots, the e2e build
// only). No network: the office client is a fake answering each tool from here, every write answers nothing. The names,
// places and plates are samples (never seeded anywhere). A .ts file, so scripts/make-web-routes.mjs makes no page of it.

import ME_FIXTURE from '@/office/__fixtures__/me.json';
import { colomboDate } from '@/lib/time';
import type { Language } from '@/lib/types';
import type { OfficeValue } from '@/office/state';
import type { TripDraft } from '@/office/trip/draftLogic';
import type {
  Availability, Board, LiveDrivers, Me, Overview, PlanPreview, RequestCard, RequestsList, SettingsResult, TaskDetail, TimelineItem,
} from '@/office/types';

/** ?lang=si: the page in Sinhala, anything else English. */
export function officeDesignLanguage(value: unknown): Language {
  return value === 'si' ? 'si' : 'en';
}

export const SAMPLE_ME: Me = {
  ...(ME_FIXTURE as unknown as Me),
  name: 'Asha Silva',
  email: 'asha@example.invalid',
  map: { package: 'open', places: false },
};

type Answer = (args: Record<string, unknown>) => unknown;

/** The office context with the fake client: each tool's sample answer, {} for the rest (a write does nothing). */
export function officeDesignValue(answers: Record<string, Answer>, me: Me = SAMPLE_ME): OfficeValue {
  const api = {
    me: async () => me,
    call: async <T,>(tool: string, args: Record<string, unknown> = {}): Promise<T> => (answers[tool]?.(args) ?? {}) as T,
  } as unknown as OfficeValue['api'];
  return {
    me,
    api,
    refreshMe: async () => undefined,
    signOut: async () => undefined,
    unread: 3,
    setUnread: () => undefined,
    reloadUnread: () => undefined,
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mockup 1: Home
// ---------------------------------------------------------------------------------------------------------------------

export function homeAnswers(): Record<string, Answer> {
  const today = colomboDate();
  const overview: Overview = {
    date: today,
    vehicles: { on_the_road: 2, total: 6, parked: 3, in_garage: 0 },
    tasks: { total: 3, in_progress: 2, done: 0, assigned: 1 },
    requests: { waiting: 2, oldest_waiting: '1 h' },
    reminders: { count: 1, red: 0, window_days: 14 },
    on_the_road: [
      { driver: 'Kamal Fernando', username: 'kamal', vehicle: 'CAP-2207', task: 'To Wariyapola', near: 'about 10:52', status: 'live' as never },
      { driver: 'Test Driver', username: 'test.driver', vehicle: 'TEST-0001', task: 'Back to base', near: 'about 11:30', status: 'live' as never },
    ],
    needs_attention: [{ what: 'Insurance expires soon', vehicle: 'CAP-2207', due: 'in 5 days', kind: 'document', severity: 'warning' }],
    needs_driver: {
      count: 1,
      tasks: [{ task_id: 't-design-2', start: '13:07', title: 'Wariyapola Divisional Hospital', driver: 'Nuwan Perera', kind: 'declined', reason_text: 'Vehicle problem', line: 'Nuwan declined · Vehicle problem', minutes_to_start: 120, when: 'in 2 h' }],
    },
    attention: {
      count: 1,
      groups: [{ key: 'document:CAP-2207', kind: 'document', title: 'Insurance expires soon', count: 1, severity: 'warning', issue_ids: ['i-design-1'], vehicle: 'CAP-2207', items: [{ what: 'Insurance expires soon', vehicle: 'CAP-2207', due: 'in 5 days', issue_id: 'i-design-1' }] }],
    },
  };
  const requests: RequestsList = {
    requests: [
      { id: 'r-design-1', requested_by: 'Requester Test', route: 'Kelaniya → Maliyadeva', when: `${today} 09:29`, asked: '1 h ago', need: 'van', status: 'waiting' } as RequestCard,
      { id: 'r-design-2', requested_by: 'Nimali Jayasinghe', route: 'Head office → Kurunegala', when: `${today} 15:00`, asked: '20 min ago', need: 'car', status: 'waiting' } as RequestCard,
    ],
    count: 2,
  } as RequestsList;
  const board: Board = {
    date: today,
    counts: { assigned: 1, in_progress: 2, completed: 0, cancelled: 0 },
    assigned: [{ id: 't-design-3', time: '15:36', title: 'Kurunegala → Galgamuwa', driver: 'Kamal Fernando', status: 'assigned' }],
    in_progress: [
      { id: 't-design-1', time: '09:20', title: 'Site visit · Maliyadeva College', driver: 'Test Driver', status: 'in_progress', accepted: '08:40' },
      { id: 't-design-4', time: '08:16', title: 'Wariyapola Divisional Hospital', driver: 'Kamal Fernando', status: 'in_progress', late_min: 7 },
    ],
    completed: [],
  };
  return {
    fleet_overview: () => overview,
    list_requests: () => requests,
    task_board: () => board,
    list_issues: () => ({ issues: [], open: 1, in_progress: 0, needs_action: 1, count: 0 }),
    my_trips: () => ({ trips: [], count: 0 }),
    my_inbox: () => ({ unread: 3, items: [] }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mockup 2: Review (the trip editor's last step)
// ---------------------------------------------------------------------------------------------------------------------

const PLAN_ITEMS: TimelineItem[] = [
  { kind: 'leave', at: '08:16', source: 'plan' },
  { kind: 'stop', n: 0, label: 'S', place: 'Fame Global Solutions', planned_arrive: '08:16', planned_leave: '08:16', dwell_min: 0, is_start: true },
  { kind: 'leg', from_n: 'start', to_n: 1, km: 99, minutes: 143, source: 'estimate' },
  { kind: 'stop', n: 1, label: '1', place: 'Wariyapola Divisional Hospital', planned_arrive: '10:45', planned_leave: '11:45', arrive_by: '11:00', late_min: 0, dwell_min: 60 },
  { kind: 'leg', from_n: 1, to_n: 'base', km: 98, minutes: 159, source: 'estimate' },
];

export function reviewDraft(): TripDraft {
  const date = colomboDate();
  return {
    mode: 'task',
    driverName: 'Kamal Fernando',
    book: { defaultVehicle: 'CAP-2207' },
    fields: {
      date, leaveBy: '', stops: [
        { key: 'a', type: 'pickup', what: 'people', place: 'Fame Global Solutions', picked: true, lat: 7.29, lng: 80.63, dwell: '', arriveBy: '', note: '', pin: '' },
        { key: 'b', type: 'visit', what: '', place: 'Wariyapola Divisional Hospital', picked: true, lat: 7.62, lng: 80.24, dwell: '60', arriveBy: '11:00', note: '', pin: '' },
      ],
      returnToBase: true, avoidExpressway: false, end: '', start: '', startPax: true, title: 'Team drop · Wariyapola', buffer: '', driver: 'kamal', vehicle: 'CAP-2207',
      pax: '3', cname: '', cphone: '', notes: '', whatsapp: false,
      riders: [{ name: 'Achini Perera', person: 'p-1' }, { name: 'Githmi Silva', person: 'p-2' }],
    },
    req: { behalf: '', project: '', need: '', tools: false, note: '', requesterPhone: '' },
    rows: [{ project: 'Mobitel MS', percent: 100 }],
    step: 'review',
    at: Date.now(),
  } as unknown as TripDraft;
}

export function reviewAnswers(): Record<string, Answer> {
  const plan: PlanPreview = {
    date: colomboDate(),
    leave_by: '08:16',
    leave_by_source: 'plan',
    start: { name: 'Fame Global Solutions', has_pin: true, lat: 7.29, lng: 80.63 },
    stops: [],
    warnings: [],
    timeline: { items: PLAN_ITEMS, totals: { drive_min: 302, km: 197, ends: '14:23' } },
    vehicle_used: { reg_no: 'CAP-2207', why: 'chosen' } as PlanPreview['vehicle_used'],
  };
  const settings = { settings: { tasks_need_approval: false, self_drive_allowed: true, passengers: true } } as unknown as SettingsResult;
  return {
    plan_task: () => plan,
    get_settings: () => settings,
    list_vehicles: () => ({ vehicles: [{ reg_no: 'CAP-2207', check_today: { result: 'ok', result_text: 'All good', at: '07:42', by: 'Kamal Fernando' } }] }),
    my_inbox: () => ({ unread: 0, items: [] }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mockup 3: the request to approve
// ---------------------------------------------------------------------------------------------------------------------

export function requestAnswers(): Record<string, Answer> {
  const date = colomboDate();
  const items: TimelineItem[] = [
    { kind: 'leave', at: '09:29', source: 'plan' },
    { kind: 'stop', n: 0, label: 'S', place: 'Fame Global Solutions', planned_arrive: '09:29', planned_leave: '09:29', dwell_min: 0, is_start: true },
    { kind: 'leg', from_n: 'start', to_n: 1, km: 8, minutes: 10, source: 'estimate' },
    { kind: 'stop', n: 1, label: '1', place: 'University of Kelaniya', planned_arrive: '09:39', planned_leave: '11:39', dwell_min: 120 },
    { kind: 'leg', from_n: 1, to_n: 2, km: 81, minutes: 126, source: 'estimate' },
    { kind: 'stop', n: 2, label: '2', place: 'Maliyadeva College', planned_arrive: '13:45', planned_leave: '15:45', arrive_by: '14:00', late_min: 0, dwell_min: 120 },
    { kind: 'leg', from_n: 2, to_n: 'base', km: 84, minutes: 132, source: 'estimate' },
  ];
  const card = {
    id: 'r-design-1', kind: 'request', requested_by: 'Requester Test', project: 'Mobitel MS', route: 'Kelaniya → Maliyadeva', title: 'Kelaniya → Maliyadeva',
    when: `${date} 09:29`, asked: '1 h ago', need: 'van', status: 'waiting', version: 1, requester_phone: '+94771234567',
    note: 'Carry the survey kit and the tripod.',
    fields: { date, time: '09:29', back_by: '18:00', pax: 5 },
    trip: {
      start: { name: 'Fame Global Solutions', has_pin: true, lat: 6.91, lng: 79.88 }, leave_by: '09:29', leave_by_source: 'plan', return_to_base: true,
      stops: [
        { seq: 1, n: 0, type: 'pickup', what: 'people', place: 'Fame Global Solutions', is_start: true, planned_leave: '09:29' },
        { seq: 2, n: 1, type: 'visit', place: 'University of Kelaniya', planned_arrive: '09:39', dwell_min: 120 },
        { seq: 3, n: 2, type: 'drop', place: 'Maliyadeva College', planned_arrive: '13:45', arrive_by: '14:00', dwell_min: 120 },
      ],
      timeline: { items, totals: { drive_min: 268, km: 173, ends: '18:01' } },
    },
    events: [{ at: `${date} 08:29`, action: 'created', actor: 'Requester Test' }],
  } as unknown as RequestCard;
  const availability: Availability = {
    as_of: '09:10',
    window: { from: '09:29', until: '18:01', day: date },
    drivers: [
      { name: 'Kamal Fernando', username: 'kamal', state: 'on_duty', status_text: 'On duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true, rank: 1, vehicle: { reg_no: 'WP CAB-4521', source: 'on_duty' }, match_why: 'On duty · free all day' },
      { name: 'Test Driver', username: 'test.driver', state: 'on_task', status_text: 'On a task', accepted_today: 1, declined_today: 0, licence: { chip: 'ok' }, free: false, rank: 2, vehicle: { reg_no: 'TEST-0001', source: 'on_duty' } },
      { name: 'Nuwan Perera', username: 'nuwan', state: 'off_duty', status_text: 'Off duty', accepted_today: 0, declined_today: 0, licence: { chip: 'ok' }, free: true, rank: 3 },
    ],
    best: { name: 'Kamal Fernando', username: 'kamal', why: 'On duty · free all day' } as Availability['best'],
    counts: { free: 2, on_duty: 2, all: 3 },
    vehicles: { groups: { free_pool: [], free_assigned: [], busy: [], in_garage: [] }, drivers_free: [] },
  };
  return {
    list_requests: () => ({ requests: [card], count: 1 }),
    availability: () => availability,
    get_settings: () => ({ settings: { tasks_need_approval: true, self_drive_allowed: true } }),
    reviewing: () => ({ reviewing: [] }),
    my_inbox: () => ({ unread: 0, items: [] }),
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// Mockup 4: the trip on the way
// ---------------------------------------------------------------------------------------------------------------------

export function tripAnswers(): Record<string, Answer> {
  const date = colomboDate();
  const detail = {
    task: {
      id: 't-design-4', title: 'Team drop · Wariyapola', label: 'Mobitel MS', kind: 'dispatch', status: 'in_progress', start: '08:16', date, time: '08:16',
      leave_by: '08:16', driver: 'Kamal Fernando', vehicle: 'CAP-2207 · Suzuki Alto', driver_phone: { call: 'tel:+94771234567', whatsapp: 'https://wa.me/94771234567' },
      passengers: 3, start_place: 'Fame Global Solutions', start_lat: 6.91, start_lng: 79.88, return_to_base: true, plan_version: 2,
      approved_by: { name: 'Palitha Fernando', at: 'Thu 21:10' }, sent: '07:30', accepted: '07:41', started: '08:21',
      eta: { next_stop: 'Wariyapola', next: '10:52', final: '14:30', late_min: 7, as_of: '10:31' },
      passengers_list: [
        { name: 'Sahan', registered: true },
        { name: 'Achini Perera', registered: true },
        { name: 'Githmi Silva', registered: false, phone: '+94770000000', phone_display: '077 000 0000', call: 'tel:+94770000000', whatsapp: 'https://wa.me/94770000000' },
      ],
      holder: { task_id: 't-design-4', name: 'Palitha Fernando', label: 'Fleet admin', by: 'assigned', window: '08:16–14:30', from: '08:16', to: '14:30', call: 'tel:+94771111111', whatsapp: 'https://wa.me/94771111111' },
      fuel_card: { task_id: 't-design-4', km: 197, fuel_type: 'petrol', electric: false, litres_low: 13, litres_high: 16, answer: 'enough', answer_text: 'Enough fuel', answered_at: '08:20' },
      vehicle_checks: [{ id: 'c-1', date, at: '08:02', when: '08:02', vehicle: 'CAP-2207', person: 'Kamal Fernando', employee_id: 'e-1', result: 'ok', result_text: 'All good', how: 'task_start', how_text: 'At Start task', channel: 'app' }],
    },
    timeline: { items: PLAN_ITEMS, totals: { drive_min: 302, km: 197, ends: '14:23' } },
    stops: [
      { id: 's-1', seq: 1, n: 1, type: 'visit', place: 'Wariyapola Divisional Hospital', status: 'pending', arrive_by: '11:00', planned_arrive: '10:45', lat: 7.62, lng: 80.24, progress: { planned_arrive: '10:45', estimate: { arrive: '10:52', updated: '10:31' }, current: true } },
    ],
    projects: 'Mobitel MS 100%',
    odometer: [],
    fuel: [],
    vehicle_reports: [],
  } as unknown as TaskDetail;
  const live: LiveDrivers = {
    as_of: '10:31',
    counts: { all: 1, sharing: 1, stale: 0, not_sharing: 0 },
    drivers: [{ driver: 'Kamal Fernando', username: 'kamal', state: 'sharing', lat: 7.45, lng: 80.42 }],
  };
  return {
    task_detail: () => detail,
    live_drivers: () => live,
    holder_asks: () => ({ which: 'all', count: 0, asks: [] }),
    my_inbox: () => ({ unread: 0, items: [] }),
  };
}
