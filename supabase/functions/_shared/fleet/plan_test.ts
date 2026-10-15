import { assert, assertEquals } from "@std/assert";
import {
  dwellFor,
  type LegFn,
  type PlanInput,
  type PlanSettings,
  planTask,
} from "./plan.ts";

const SETTINGS: PlanSettings = {
  dwell_min: {
    "pickup.people": 10,
    "pickup.goods": 15,
    "drop.people": 5,
    "drop.goods": 15,
    visit: 60,
    documents: 10,
    default: 10,
  },
  buffer_min: 15,
};
const COLOMBO = { lat: 6.9344, lng: 79.8428 };
const KALUTARA = { lat: 6.5854, lng: 79.9607 };
const GALLE = { lat: 6.0329, lng: 80.2168 };
const MATARA = { lat: 5.9549, lng: 80.555 };
const key = (p: { lat: number; lng: number }) => `${p.lat},${p.lng}`;
/** Fixed minutes per leg, with a record of the departure times asked. */
function fixedLegs(
  table: Record<string, number>,
  flag?: string,
): { fn: LegFn; asked: string[] } {
  const asked: string[] = [];
  const fn: LegFn = (from, to, departAt) => {
    asked.push(departAt);
    const k = `${key(from)}>${key(to)}`;
    const minutes = table[k];
    if (minutes === undefined) throw new Error(`no fixed leg for ${k}`);
    return Promise.resolve({
      km: minutes,
      minutes,
      source: "estimate",
      via_expressway: flag === k,
      factor: 1,
    });
  };
  return { fn, asked };
}
const LEGS = {
  [`${key(COLOMBO)}>${key(KALUTARA)}`]: 50,
  [`${key(KALUTARA)}>${key(GALLE)}`]: 60,
  [`${key(GALLE)}>${key(MATARA)}`]: 45,
  [`${key(MATARA)}>${key(COLOMBO)}`]: 150,
  [`${key(KALUTARA)}>${key(MATARA)}`]: 100,
  [`${key(COLOMBO)}>${key(MATARA)}`]: 200,
};
const T = (hhmm: string, day = "2026-10-20") =>
  new Date(`${day}T${hhmm}:00+05:30`).toISOString();
const hhmm = (iso: string) =>
  new Date(new Date(iso).getTime() + 5.5 * 3600000).toISOString().slice(11, 16);

function southRun(over: Partial<PlanInput> = {}): PlanInput {
  return {
    now: T("05:00"),
    start: null,
    base: { name: "Head office", point: COLOMBO },
    stops: [
      {
        seq: 1,
        type: "pickup",
        what: "people",
        name: "Kalutara",
        point: KALUTARA,
      },
      { seq: 2, type: "drop", what: "people", name: "Galle", point: GALLE },
      {
        seq: 3,
        type: "drop",
        what: "people",
        name: "Matara",
        point: MATARA,
        arrive_by: T("10:00"),
      },
    ],
    return_to_base: false,
    avoid_expressway: false,
    ...over,
  };
}

Deno.test("dwell: the stop's own, else type.what, else what, else type, else the default", () => {
  assertEquals(dwellFor(SETTINGS, "pickup", "people"), 10);
  assertEquals(dwellFor(SETTINGS, "drop", "goods"), 15);
  assertEquals(dwellFor(SETTINGS, "visit", null), 60);
  assertEquals(dwellFor(SETTINGS, "drop", "documents"), 10);
  assertEquals(dwellFor(SETTINGS, "pickup", "other"), 10);
  assertEquals(dwellFor(SETTINGS, "visit", "people", 20), 20);
});

Deno.test("Kalutara → Galle → Matara by 10:00: leave by 06:55, planned times, the buffer as slack", async () => {
  const { fn, asked } = fixedLegs(LEGS);
  const plan = await planTask(southRun(), SETTINGS, fn);
  assertEquals(plan.leave_by_source, "plan");
  assertEquals(hhmm(plan.leave_by), "06:55"); // 10:00 - 15 buffer - (50 + 10 + 60 + 5 + 45)
  assertEquals(
    plan.stops.map((
      s,
    ) => [hhmm(s.planned_arrive_at), hhmm(s.planned_depart_at)]),
    [["07:45", "07:55"], ["08:55", "09:00"], [
      "09:45",
      "09:50",
    ]],
  );
  assertEquals(plan.stops[2].slack_min, 15);
  assertEquals(hhmm(plan.ends_at), "09:50");
  assertEquals(plan.total_drive_min, 155);
  assertEquals(plan.warnings, []);
  // Every leg of the final pass was asked at its own departure time (the right rush-hour band).
  const last = asked.slice(-3);
  assertEquals(last.map(hhmm), ["06:55", "07:55", "09:00"]);
});

Deno.test("the expressway leg is flagged", async () => {
  const { fn } = fixedLegs(LEGS, `${key(GALLE)}>${key(MATARA)}`);
  const plan = await planTask(southRun(), SETTINGS, fn);
  assertEquals(plan.legs.map((l) => l.via_expressway), [false, false, true]);
  assertEquals(plan.legs.map((l) => [l.from_seq, l.to_seq]), [[0, 1], [1, 2], [
    2,
    3,
  ]]);
});

Deno.test("a deadline on a middle stop binds; the return leg is planned when asked", async () => {
  const { fn } = fixedLegs(LEGS);
  const input = southRun({ return_to_base: true });
  input.stops[1].arrive_by = T("08:30");
  const plan = await planTask(input, SETTINGS, fn);
  assertEquals(hhmm(plan.leave_by), "06:15"); // 08:30 - 15 - (50 + 10 + 60)
  assertEquals(plan.stops[1].slack_min, 15);
  assertEquals(plan.stops[2].slack_min, 55);
  assertEquals(plan.legs.at(-1)?.to_seq, -1);
  assertEquals(hhmm(plan.ends_at), "11:40"); // Matara 09:05 + 5 + 150
  assertEquals(plan.total_km, 305);
});

Deno.test("a stop without coordinates: its leg counts as 0, the next leg starts from the last pin, a warning names it", async () => {
  const { fn, asked } = fixedLegs(LEGS);
  const input = southRun();
  input.stops[1].point = null;
  const plan = await planTask(input, SETTINGS, fn);
  assertEquals(plan.warnings.map((w) => [w.code, w.seq]), [[
    "no_coordinates",
    2,
  ]]);
  assertEquals(plan.legs.map((l) => [l.from_seq, l.to_seq]), [[0, 1], [1, 3]]);
  assert(asked.length > 0);
  assertEquals(hhmm(plan.leave_by), "07:00"); // 10:00 - 15 - (50 + 10 + 0 + 5 + 100 straight from Kalutara)
});

Deno.test("no base place: the plan starts at the first stop and says so", async () => {
  const { fn } = fixedLegs(LEGS);
  const plan = await planTask(southRun({ base: null }), SETTINGS, fn);
  assertEquals(plan.warnings.map((w) => w.code), ["no_base"]);
  assertEquals(plan.warnings[0].text, "No base place set — add it in Settings");
  assertEquals(plan.legs.map((l) => [l.from_seq, l.to_seq]), [[1, 2], [2, 3]]);
  assertEquals(hhmm(plan.leave_by), "07:45"); // 10:00 - 15 - (10 + 60 + 5 + 45): leaving means leaving Kalutara
});

Deno.test("across midnight: a deadline at 00:30 puts the leave-by on the day before", async () => {
  const { fn } = fixedLegs(LEGS);
  const input = southRun({ now: T("20:00") });
  input.stops[2].arrive_by = T("00:30", "2026-10-21");
  const plan = await planTask(input, SETTINGS, fn);
  assertEquals(plan.leave_by, T("21:25"));
  assertEquals(plan.stops[2].planned_arrive_at, T("00:15", "2026-10-21"));
  assertEquals(plan.warnings, []);
});

Deno.test("a second task of the same driver after the first: a manual leave time, the plan is advice", async () => {
  const { fn } = fixedLegs(LEGS);
  const first = await planTask(
    southRun({ return_to_base: true }),
    SETTINGS,
    fn,
  );
  const second = await planTask(
    southRun({
      leave_at: first.ends_at,
      stops: [{
        seq: 1,
        type: "drop",
        what: "goods",
        name: "Kalutara",
        point: KALUTARA,
      }],
    }),
    SETTINGS,
    fn,
  );
  assertEquals(second.leave_by, first.ends_at);
  assertEquals(second.leave_by_source, "manual");
  assertEquals(
    hhmm(second.stops[0].planned_arrive_at),
    hhmm(
      new Date(new Date(first.ends_at).getTime() + 50 * 60000).toISOString(),
    ),
  );
  assertEquals(second.stops[0].dwell_min, 15);
});

Deno.test("too late: leave-by already past gives not_reachable with the earliest arrival; a long day is flagged", async () => {
  const { fn } = fixedLegs(LEGS);
  const late = await planTask(southRun({ now: T("08:00") }), SETTINGS, fn);
  assertEquals(late.warnings.map((w) => w.code), ["not_reachable"]);
  assertEquals(late.warnings[0].seq, 3);
  assertEquals(hhmm(late.warnings[0].earliest_arrival!), "10:50");
  const long = await planTask(
    southRun({
      leave_at: T("06:00"),
      stops: [{
        seq: 1,
        type: "visit",
        name: "Matara",
        point: MATARA,
        dwell_min: 600,
      }],
    }),
    SETTINGS,
    fn,
  );
  assertEquals(long.warnings.map((w) => w.code), ["long_day"]);
});
