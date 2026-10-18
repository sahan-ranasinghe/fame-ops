// Part 3b (H3): the Ask drivers rules: the form from the link, its check and ask_drivers' arguments, the answer chips,
// the state and open lines, the Assign link per case, and the ?driver= / ?time= the dispatch pages read.
import { describe, expect, it } from "vitest";
import type { Ask, AskDriverRow } from "../../data/types";
import { readAskLink } from "./askLink";
import { answerChip, askFormFrom, askInput, assignLink, colomboMs, countsLine, linkedDriver, linkedTime, openLine, placeLine, stateLine } from "./askLogic";

const NOW = Date.parse("2026-10-19T09:00:00+05:30");
const form = (over: Partial<ReturnType<typeof askFormFrom>> = {}) => ({ ...askFormFrom({}, "2026-10-19"), ...over });
const err = (r: ReturnType<typeof askInput>) => ("error" in r ? r.error : null);
const args = (r: ReturnType<typeof askInput>) => ("input" in r ? r.input : null);

describe("the ask form", () => {
  it("opens from the link: its question, trip and drivers (each once), or all the free ones; today and a trip question by default", () => {
    const link = readAskLink(new URLSearchParams("kind=free_for_trip&drivers=kamal,nuwan.p,kamal&date=2026-10-20&from=09:00&to=12:00&task=t1"));
    expect(askFormFrom(link, "2026-10-19")).toEqual({ kind: "free_for_trip", date: "2026-10-20", from: "09:00", to: "12:00", note: "", who: "picked", drivers: ["kamal", "nuwan.p"] });
    expect(askFormFrom(readAskLink(new URLSearchParams("all_free=1&kind=where_now")), "2026-10-19")).toMatchObject({ kind: "where_now", who: "all_free", date: "2026-10-19", from: "" });
    expect(askFormFrom({}, "2026-10-19")).toMatchObject({ kind: "free_for_trip", who: "picked", drivers: [] });
  });

  it("a trip question: the day and From are needed, To later than From, never a time that has passed", () => {
    expect(err(askInput(form({ drivers: ["kamal"] }), {}, NOW))).toBe("Add the time the trip starts (From).");
    expect(err(askInput(form({ date: "", from: "10:00", drivers: ["kamal"] }), {}, NOW))).toBe("Choose the day of the trip.");
    expect(err(askInput(form({ from: "10:00", to: "09:30", drivers: ["kamal"] }), {}, NOW))).toBe("To must be later than From.");
    expect(err(askInput(form({ from: "10:00", to: "10:00", drivers: ["kamal"] }), {}, NOW))).toBe("To must be later than From.");
    expect(err(askInput(form({ from: "08:59", drivers: ["kamal"] }), {}, NOW))).toBe("That trip time has passed: ask about a later time.");
    expect(err(askInput(form({ from: "09:00", drivers: ["kamal"] }), {}, NOW))).toBe("That trip time has passed: ask about a later time.");
    expect(colomboMs("2026-10-19", "09:00")).toBe(NOW);
  });

  it("who: the drivers picked (trimmed, each once, at most 100), or all_free; never both, never none", () => {
    expect(err(askInput(form({ kind: "office_time" }), {}, NOW))).toBe("Add the drivers to ask, or choose All free ones.");
    expect(err(askInput(form({ kind: "office_time", drivers: ["  "] }), {}, NOW))).toBe("Add the drivers to ask, or choose All free ones.");
    expect(err(askInput(form({ kind: "office_time", drivers: Array.from({ length: 101 }, (_, i) => `d${i}`) }), {}, NOW))).toBe("At most 100 drivers in one question.");
    expect(args(askInput(form({ kind: "office_time", drivers: [" kamal ", "kamal", "nuwan.p"] }), {}, NOW))).toEqual({ kind: "office_time", drivers: ["kamal", "nuwan.p"] });
    // All free ones sends all_free and no drivers, even with some still in the form.
    expect(args(askInput(form({ kind: "where_now", who: "all_free", drivers: ["kamal"] }), {}, NOW))).toEqual({ kind: "where_now", all_free: true });
  });

  it("ask_drivers' arguments: the trip only for a trip question, the note trimmed, the link's task or request", () => {
    expect(args(askInput(form({ from: "10:00", to: "12:30", note: "  Six people to Kurunegala ", drivers: ["kamal"] }), { task: "t1" }, NOW))).toEqual({
      kind: "free_for_trip", date: "2026-10-19", from: "10:00", to: "12:30", note: "Six people to Kurunegala", drivers: ["kamal"], task_id: "t1",
    });
    expect(args(askInput(form({ from: "10:00", drivers: ["kamal"] }), { request: "r1" }, NOW))).toEqual({
      kind: "free_for_trip", date: "2026-10-19", from: "10:00", drivers: ["kamal"], request_id: "r1",
    });
    // The other questions take no trip (a day and times left in the form from the link are not sent).
    expect(args(askInput(form({ kind: "office_time", from: "10:00", to: "12:00", drivers: ["kamal"] }), {}, NOW))).toEqual({ kind: "office_time", drivers: ["kamal"] });
    expect(err(askInput(form({ kind: "office_time", note: "x".repeat(301), drivers: ["kamal"] }), {}, NOW))).toBe("The note is too long (at most 300 characters).");
  });
});

const row = (over: Partial<AskDriverRow> = {}): AskDriverRow => ({ name: "Kamal Perera", username: "kamal", sent: "10:02", state: "sent", ...over });

describe("the answers", () => {
  it("each answer as a chip: Yes green, No grey, Call me amber, a time and a shared point blue; none yet = null", () => {
    expect(answerChip(row({ answer: "yes", answer_text: "Yes" }))).toEqual({ text: "Yes", tone: "ok" });
    expect(answerChip(row({ answer: "no", answer_text: "No" }))).toEqual({ text: "No", tone: "" });
    expect(answerChip(row({ answer: "call_me", answer_text: "Call me" }))).toEqual({ text: "Call me", tone: "warn" });
    expect(answerChip(row({ answer: "time", answer_text: "At the office at 10:30", answer_time: "10:30" }))).toEqual({ text: "At the office at 10:30", tone: "live" });
    expect(answerChip(row({ answer: "time", answer_time: "10:30" }))).toEqual({ text: "At the office at 10:30", tone: "live" });
    expect(answerChip(row({ answer: "location" }))).toEqual({ text: "Shared where they are", tone: "live" });
    expect(answerChip(row())).toBeNull();
  });

  it("the state line as far as the driver got; the shared point's town and accuracy", () => {
    expect(stateLine(row())).toBe("Sent 10:02");
    expect(stateLine(row({ seen: "10:03", state: "seen" }))).toBe("Sent 10:02 · Seen 10:03");
    expect(stateLine(row({ seen: "10:03", answered: "10:05", state: "answered" }))).toBe("Sent 10:02 · Seen 10:03 · Answered 10:05");
    expect(placeLine({ lat: 7.1, lng: 79.9, accuracy_m: 12, near: "Kadawatha", map: "https://maps.example/1" })).toBe("near Kadawatha · ±12 m");
    expect(placeLine({ lat: 7.1, lng: 79.9, map: "https://maps.example/1" })).toBe("Shared point");
  });

  it("open until or closed; the counts (yes only for a trip question)", () => {
    expect(openLine({ expires: "Mon 20 Oct 09:00" })).toBe("Open until Mon 20 Oct 09:00");
    expect(openLine({ expires: "Mon 20 Oct 09:00", expired: true })).toBe("Closed");
    const counts = { asked: 5, seen: 3, answered: 2, yes: 1 };
    expect(countsLine({ kind: "free_for_trip", counts })).toBe("5 asked · 3 seen · 2 answered · 1 yes");
    expect(countsLine({ kind: "where_now", counts })).toBe("5 asked · 3 seen · 2 answered");
  });
});

describe("Assign on a Yes", () => {
  const ask: Pick<Ask, "task_id" | "request_id" | "trip"> = { trip: { date: "2026-10-20", from: "09:00", to: "12:00" } };
  const yes = row({ answer: "yes", assignable: true });
  const all = ["update_task", "decide_request", "create_task"];

  it("the task's change page, else the request's decide page, else a new task on the trip's day and time", () => {
    expect(assignLink({ ...ask, task_id: "t1" }, yes, all)).toBe("/tasks/t1/edit?driver=kamal");
    expect(assignLink({ ...ask, request_id: "r1" }, yes, all)).toBe("/requests/r1/decide?driver=kamal");
    expect(assignLink(ask, yes, all)).toBe("/tasks/new?driver=kamal&date=2026-10-20&time=09%3A00");
    expect(assignLink(ask, row({ answer: "yes", assignable: true, username: "nuwan.p" }), all)).toBe("/tasks/new?driver=nuwan.p&date=2026-10-20&time=09%3A00");
  });

  it("nothing for a row that is not assignable, a driver with no username, or a person without the page's tool", () => {
    expect(assignLink(ask, row({ answer: "yes" }), all)).toBeNull();
    expect(assignLink(ask, row({ answer: "no", assignable: undefined }), all)).toBeNull();
    expect(assignLink(ask, { ...yes, username: undefined }, all)).toBeNull();
    expect(assignLink({ ...ask, task_id: "t1" }, yes, ["create_task"])).toBeNull();
    expect(assignLink({ ...ask, request_id: "r1" }, yes, ["update_task"])).toBeNull();
    expect(assignLink(ask, yes, ["update_task"])).toBeNull();
  });

  it("the dispatch pages read the link back: ?driver= (not TaskEdit's own ?driver=1) and New task's ?time=", () => {
    const q = (s: string) => new URLSearchParams(s);
    expect(linkedDriver(q("driver=kamal"))).toBe("kamal");
    expect(linkedDriver(q("driver=nuwan.p&date=2026-10-20&time=09%3A00"))).toBe("nuwan.p");
    expect(linkedDriver(q("driver=1"))).toBe("");
    expect(linkedDriver(q(""))).toBe("");
    expect(linkedDriver(q(`driver=${"x".repeat(81)}`))).toBe("");
    expect(linkedTime(q("time=09%3A00"))).toBe("09:00");
    expect(linkedTime(q("time=9"))).toBe("");
    expect(linkedTime(q("time=24:00"))).toBe("");
  });
});
