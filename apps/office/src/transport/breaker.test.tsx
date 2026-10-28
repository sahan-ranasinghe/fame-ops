// The circuit breaker (Round 48, item 6c): a screen that asks the same tool over and over from an effect loop is stopped
// after 30 calls in a minute, told in one sentence, reported once (not once per call), and heard again a minute later.
import { render, screen } from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiTransport } from "./api";
import { LOOP_ERROR, LOOP_LIMIT, LoopBreaker, loopReportMessage } from "./breaker";
import { errText } from "./errors";
import type { FleetError, Transport } from "./types";

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

afterEach(() => vi.useRealTimers());

describe("the breaker's rule (pure)", () => {
  it("30 calls of one tool in a minute pass; the 31st opens it for a minute, with one report; another tool is untouched", () => {
    let now = 1_000_000;
    const b = new LoopBreaker({}, () => now);
    for (let i = 0; i < LOOP_LIMIT; i++) expect(b.check("task_board")).toEqual({ open: false });
    expect(b.check("task_board")).toEqual({ open: true, report: true, calls: 31 });
    expect(b.check("task_board")).toEqual({ open: true, report: false, calls: 31 });
    expect(b.check("live_drivers")).toEqual({ open: false });
    now += 59_000;
    expect(b.check("task_board").open).toBe(true);
    now += 2_000; // a minute after it opened: the old calls are out of the window
    expect(b.check("task_board")).toEqual({ open: false });
  });

  it("one report per tool per 10 minutes: a second burst within them opens the breaker again but reports nothing", () => {
    let now = 0;
    const b = new LoopBreaker({}, () => now);
    for (let i = 0; i <= LOOP_LIMIT; i++) b.check("plan_task");
    now += 120_000;
    for (let i = 0; i < LOOP_LIMIT; i++) expect(b.check("plan_task").open).toBe(false);
    expect(b.check("plan_task")).toMatchObject({ open: true, report: false });
    now += 600_000;
    for (let i = 0; i < LOOP_LIMIT; i++) b.check("plan_task");
    expect(b.check("plan_task")).toMatchObject({ open: true, report: true });
    expect(loopReportMessage("plan_task", 31)).toBe("Loop: plan_task asked 31 times in a minute; stopped for a minute");
  });

  it("the words: the loop's sentence and the server's 429 sentence, nothing to fix but wait", () => {
    expect(errText({ ...LOOP_ERROR })).toEqual(["This screen asked the server too often · try again in a minute", null]);
    expect(errText({ code: "rate_limited", message: "Too many requests · try again in a minute", status: 429 })).toEqual([
      "Too many requests · try again in a minute",
      null,
    ]);
  });
});

/** A screen whose effect asks the server again after every answer: a render loop. */
function Looper({ t }: { t: Transport }) {
  const [answers, setAnswers] = useState(0);
  const [words, setWords] = useState("");
  useEffect(() => {
    t.call("task_board", { date: "2026-10-28" }).then(() => setAnswers((n) => n + 1), (e: FleetError) => setWords(errText(e)[0]));
  }, [t, answers]);
  return <div>{words || `Answers so far: ${answers}`}</div>;
}

describe("ApiTransport with a looping screen", () => {
  it("stops the loop at 30 calls, shows the sentence, and sends ONE report through POST /errors", async () => {
    const seen: { path: string; body: unknown }[] = [];
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      const path = String(url).replace("https://x.test/functions/v1/office-api", "");
      seen.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path === "/errors") return reply(200, { ok: true });
      return reply(200, { result: { date: "2026-10-28", assigned: [] } });
    });
    const t = new ApiTransport("https://x.test/functions/v1/office-api/", async () => "tok", fetchFn as typeof fetch);
    render(<Looper t={t} />);
    expect(await screen.findByText("This screen asked the server too often · try again in a minute")).toBeTruthy();
    const calls = seen.filter((s) => s.path === "/tools/task_board");
    const reports = seen.filter((s) => s.path === "/errors");
    expect(calls.length).toBe(LOOP_LIMIT);
    expect(reports.length).toBe(1);
    expect(reports[0].body).toMatchObject({ side: "office", fatal: false, message: "Loop: task_board asked 31 times in a minute; stopped for a minute" });
    expect((reports[0].body as { screen: string }).screen).toBe("/");
    // Refused again at once, with no call and no second report.
    await expect(t.call("task_board", {})).rejects.toMatchObject({ code: "loop" });
    expect(seen.filter((s) => s.path === "/tools/task_board").length).toBe(LOOP_LIMIT);
    expect(seen.filter((s) => s.path === "/errors").length).toBe(1);
  });

  it("a minute later the tool is asked again; a write stopped by the breaker is not 'may not have been saved'", async () => {
    let now = 10_000_000;
    const fetchFn = vi.fn(async () => reply(200, { result: { ok: true } }));
    const t = new ApiTransport("https://x.test/functions/v1/office-api/", async () => "tok", fetchFn as typeof fetch, new LoopBreaker({}, () => now));
    for (let i = 0; i < LOOP_LIMIT; i++) await t.call("cancel_task", { task_id: "t" });
    const refused = await t.call("cancel_task", { task_id: "t" }).catch((e: FleetError) => e);
    expect(refused).toMatchObject({ code: "loop" });
    expect((refused as FleetError).write).toBeUndefined();
    expect(fetchFn).toHaveBeenCalledTimes(LOOP_LIMIT + 1); // 30 calls and the one report
    now += 61_000;
    await expect(t.call("cancel_task", { task_id: "t" })).resolves.toEqual({ ok: true });
  });
});
