// Part 3b (H3): asking drivers one question with one-tap answers, instead of calling around (no chat: free talk stays on
// WhatsApp). "Free for a trip <date> <from–to>?" (Yes / No / Call me), "When can you be at the office?" (a time), "Where
// are you now?" (one point the driver chooses to share). The push goes from the database (driver_ask_answers_push); each
// answer reaches the person who asked (driver_ask_answers_notify) and shows here.

import { z } from "zod";
import type { AvailabilityWindow } from "../availability.ts";
import { ToolError, unwrap } from "../db.ts";
import { type Employee, findDriver, loadRefs, nearestTown } from "../fleet.ts";
import { mapsPoint, personLinks } from "../format.ts";
import { driverPhotoLinks } from "../media.ts";
import { pageOf, pageWindow } from "../paging.ts";
import { colomboDate, colomboDay, colomboDayTime, colomboTime, dayRange, utcIso } from "../time.ts";
import { realDate, tool, zDate, zId, zPaging, zText, zTime } from "../tool.ts";
import { driverRows } from "./driverRows.ts";

/** How long a question that is not about a trip stays open. */
export const ASK_OPEN_MS = 2 * 60 * 60 * 1000;

type AskRow = {
  id: string;
  kind: string;
  trip_from: string | null;
  trip_to: string | null;
  note: string | null;
  task_id: string | null;
  request_id: string | null;
  asked_by_name: string;
  created_at: string;
  expires_at: string;
};
type AnswerRow = {
  ask_id: string;
  employee_id: string;
  sent_at: string;
  seen_at: string | null;
  answer: string | null;
  answer_at: string | null;
  lat: number | null;
  lng: number | null;
  accuracy_m: number | null;
  answered_at: string | null;
};

/** The question in words: "Free for a trip Mon 20 Oct 09:00–12:00?" */
export function questionText(a: Pick<AskRow, "kind" | "trip_from" | "trip_to">): string {
  if (a.kind === "free_for_trip" && a.trip_from) {
    return `Free for a trip ${colomboDayTime(a.trip_from)}${a.trip_to ? `–${colomboTime(a.trip_to)}` : ""}?`;
  }
  return a.kind === "office_time" ? "When can you be at the office?" : "Where are you now?";
}

/** The answer in words: "Yes" · "No" · "Call me" · "At the office at 10:30" · "Shared where they are". */
export function answerText(r: Pick<AnswerRow, "answer" | "answer_at">): string | undefined {
  switch (r.answer) {
    case "yes":
      return "Yes";
    case "no":
      return "No";
    case "call_me":
      return "Call me";
    case "time":
      return r.answer_at ? `At the office at ${colomboTime(r.answer_at)}` : "A time";
    case "location":
      return "Shared where they are";
    default:
      return undefined;
  }
}

/** One ask with every driver's row, as both tools answer it. */
async function askCard(db: Parameters<typeof driverPhotoLinks>[0], ask: AskRow, rows: AnswerRow[], people: Employee[], now: Date) {
  const photos = await driverPhotoLinks(db, people, now);
  const expired = Date.parse(ask.expires_at) <= now.getTime();
  const drivers = await Promise.all(rows.map(async (r) => {
    const e = people.find((p) => p.id === r.employee_id);
    const near = r.answer === "location" && r.lat != null && r.lng != null ? await nearestTown(db, r.lat, r.lng) : null;
    return {
      name: e?.name ?? "A driver",
      username: e?.username ?? undefined,
      photo_url: photos.get(r.employee_id),
      links: personLinks(e?.phone, e?.whatsapp),
      sent: colomboTime(r.sent_at),
      seen: r.seen_at ? colomboTime(r.seen_at) : undefined,
      answer: r.answer ?? undefined,
      answer_text: answerText(r),
      answer_time: r.answer === "time" && r.answer_at ? colomboTime(r.answer_at) : undefined,
      answered: r.answered_at ? colomboTime(r.answered_at) : undefined,
      location: r.answer === "location" && r.lat != null && r.lng != null
        ? {
          lat: r.lat,
          lng: r.lng,
          accuracy_m: r.accuracy_m != null ? Math.round(r.accuracy_m) : undefined,
          near: near ?? undefined,
          map: mapsPoint(r.lat, r.lng),
        }
        : undefined,
      // A Yes to an open trip question can be given the trip in one tap.
      assignable: ask.kind === "free_for_trip" && r.answer === "yes" && !expired ? true : undefined,
      state: r.answered_at ? "answered" : r.seen_at ? "seen" : "sent",
    };
  }));
  return {
    id: ask.id,
    kind: ask.kind,
    question: questionText(ask),
    note: ask.note ?? undefined,
    trip: ask.trip_from
      ? {
        date: colomboDate(ask.trip_from),
        from: colomboTime(ask.trip_from),
        to: ask.trip_to ? colomboTime(ask.trip_to) : undefined,
      }
      : undefined,
    task_id: ask.task_id ?? undefined,
    request_id: ask.request_id ?? undefined,
    asked_by: ask.asked_by_name,
    asked: colomboTime(ask.created_at),
    asked_day: colomboDay(ask.created_at),
    expires: colomboDayTime(ask.expires_at),
    expired: expired || undefined,
    counts: {
      asked: rows.length,
      seen: rows.filter((r) => r.seen_at).length,
      answered: rows.filter((r) => r.answered_at).length,
      yes: rows.filter((r) => r.answer === "yes").length,
    },
    drivers,
  };
}

export const askDrivers = tool({
  name: "ask_drivers",
  title: "Ask drivers",
  description: "Part 3b (H3): sends drivers one question with one-tap answers in their app (a push with its own sound): " +
    'free_for_trip ("Free for a trip <date> <from–to>?": Yes / No / Call me; it expires at the trip\'s start), office_time ' +
    '("When can you be at the office?": the driver picks a time) or where_now ("Where are you now?": the driver shares ' +
    "one point, even off duty). The other two expire after 2 hours. Name the drivers, or all_free (free for the trip, or on " +
    "duty and not on a task). ask_answers shows the answers.",
  readOnly: false,
  input: z.object({
    kind: z.enum(["free_for_trip", "office_time", "where_now"]),
    drivers: z.array(zText(80)).max(100).optional().describe("Usernames, codes or names"),
    all_free: z.boolean().optional().describe("Every driver free then (instead of drivers)"),
    date: zDate.optional().describe("free_for_trip: the trip's day, YYYY-MM-DD"),
    from: zTime.optional().describe("free_for_trip: from HH:MM"),
    to: zTime.optional().describe("free_for_trip: to HH:MM"),
    note: zText(300).optional().describe("A line under the question (where to, how many people)"),
    task_id: zId.optional().describe("The task it is for (its page offers Assign on a Yes)"),
    request_id: zId.optional().describe("The request it is for"),
  }),
  async run(args, { db, now, actor }) {
    if (!!args.all_free === !!args.drivers?.length) throw new ToolError("Name the drivers, or say all_free (one of the two).");
    let tripFrom: string | null = null;
    let tripTo: string | null = null;
    if (args.kind === "free_for_trip") {
      if (!args.date || !args.from) throw new ToolError("A trip question needs the date and the time from (to is optional).");
      realDate(args.date);
      tripFrom = utcIso(args.date, args.from);
      tripTo = args.to ? utcIso(args.date, args.to) : null;
      if (tripTo && tripTo <= tripFrom) throw new ToolError("to must be later than from.");
      if (Date.parse(tripFrom) <= now.getTime()) throw new ToolError("That trip time has passed: ask about a later time.");
    }
    const refs = await loadRefs(db);
    let chosen: Employee[];
    if (args.all_free) {
      const w: AvailabilityWindow = tripFrom
        ? { from: tripFrom, to: tripTo, day_end: dayRange(colomboDate(tripFrom)).to }
        : { from: now.toISOString(), to: new Date(now.getTime() + ASK_OPEN_MS).toISOString(), day_end: dayRange(colomboDate(now)).to };
      const { rows } = await driverRows(db, refs, w, now, null);
      const free = rows.filter((r) => tripFrom ? r.free : r.free && r.now_status.kind === "on_duty");
      chosen = free.flatMap((r) => refs.employees.filter((e) => e.username === r.username && e.username !== null));
      if (chosen.length === 0) throw new ToolError(tripFrom ? "No driver is free then." : "No driver is on duty and free now.");
    } else {
      chosen = [...new Map(args.drivers!.map((d) => {
        const e = findDriver(refs, d);
        return [e.id, e] as const;
      })).values()];
    }
    const expires = tripFrom ?? new Date(now.getTime() + ASK_OPEN_MS).toISOString();
    const ask = unwrap(
      await db.from("driver_asks").insert({
        kind: args.kind,
        trip_from: tripFrom,
        trip_to: tripTo,
        note: args.note ?? null,
        task_id: args.task_id ?? null,
        request_id: args.request_id ?? null,
        asked_by_employee_id: actor.employeeId,
        asked_by_name: actor.name,
        channel: actor.channel === "web" ? "web" : "claude",
        expires_at: expires,
      }).select("*").single(),
      "question",
    ) as AskRow;
    // One row per driver; each insert sends that driver's push (the trigger).
    const rows = unwrap(
      await db.from("driver_ask_answers").insert(chosen.map((e) => ({ ask_id: ask.id, employee_id: e.id }))).select("*"),
      "question",
    ) as AnswerRow[];
    const card = await askCard(db, ask, rows, chosen, now);
    return {
      result: { ask: card, next: "The drivers get a push; their answers show in ask_answers and in your notifications." },
      summary: `asked ${chosen.length} driver(s): ${card.question}`,
    };
  },
});

export const askAnswers = tool({
  name: "ask_answers",
  title: "Answers from drivers",
  description: "Part 3b (H3): one question (ask_id) with each driver's answer (sent, seen, Yes / No / Call me, the time, or " +
    "the point they shared with the nearest town and a map link), or the questions of the last 7 days, newest first.",
  readOnly: true,
  input: z.object({
    ask_id: zId.optional(),
    ...zPaging,
  }),
  async run({ ask_id, limit, cursor }, { db, now }) {
    const refs = await loadRefs(db);
    if (ask_id) {
      const ask = unwrap(await db.from("driver_asks").select("*").eq("id", ask_id).maybeSingle(), "question") as AskRow | null;
      if (!ask) throw new ToolError("This question is not there (questions are kept 30 days).");
      const rows = unwrap(await db.from("driver_ask_answers").select("*").eq("ask_id", ask_id).order("sent_at"), "answers") as AnswerRow[];
      const card = await askCard(db, ask, rows, refs.employees, now);
      return { result: { ask: card }, summary: `answers to ${card.question}: ${card.counts.answered}/${card.counts.asked}` };
    }
    const since = new Date(now.getTime() - 7 * 86400000).toISOString();
    const asks = unwrap(
      await db.from("driver_asks").select("*").gte("created_at", since).order("created_at", { ascending: false }).limit(500),
      "questions",
    ) as AskRow[];
    const page = pageOf(asks, pageWindow(limit ?? 20, cursor));
    const rows: AnswerRow[] = page.rows.length
      ? unwrap(await db.from("driver_ask_answers").select("*").in("ask_id", page.rows.map((a) => a.id)).order("sent_at"), "answers")
      : [];
    const cards = await Promise.all(page.rows.map((a) => askCard(db, a, rows.filter((r) => r.ask_id === a.id), refs.employees, now)));
    return {
      result: { count: cards.length, total: page.total, next: page.next, asks: cards },
      summary: `${cards.length} questions to drivers`,
    };
  },
});
