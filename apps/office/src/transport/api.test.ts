import { describe, expect, it, vi } from "vitest";
import { ApiTransport, mapHttpError } from "./api";
import { errText } from "./errors";
import { READ_TIMEOUT_MS, timeoutFor } from "./retryRule";

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

function transport(fetchFn: typeof fetch, token: string | null = "tok") {
  return new ApiTransport("https://x.test/functions/v1/office-api/", async () => token, fetchFn);
}

describe("ApiTransport", () => {
  it("posts the tool's arguments with the session and returns the result as the connector would", async () => {
    const fetchFn = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe("https://x.test/functions/v1/office-api/tools/task_board");
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).authorization).toBe("Bearer tok");
      expect(JSON.parse(String(init?.body))).toEqual({ date: "2026-10-12" });
      return reply(200, { result: { date: "2026-10-12", assigned: [] } });
    });
    const out = await transport(fetchFn as typeof fetch).call("task_board", { date: "2026-10-12" });
    expect(out).toEqual({ date: "2026-10-12", assigned: [] });
  });

  it("reads /me", async () => {
    const fetchFn = vi.fn(async () => reply(200, { name: "Sahan", role: "admin", tools: ["fleet_overview"], mfa: true }));
    expect(await transport(fetchFn as typeof fetch).me()).toMatchObject({ name: "Sahan", role: "admin" });
  });

  // Sahan, 19 October 2026: GET /me is a read under the retry rule, and only a 401 or 403 means signed out.
  it("/me dropped once (a 503) is asked again after 2 s and loads", async () => {
    vi.useFakeTimers();
    try {
      const answers = [reply(503, {}), reply(200, { name: "Sahan", role: "admin", tools: [] })];
      const fetchFn = vi.fn(async () => answers.shift()!);
      const me = transport(fetchFn as typeof fetch).me();
      await vi.advanceTimersByTimeAsync(1_999);
      expect(fetchFn).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(await me).toMatchObject({ name: "Sahan" });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("/me dropped twice fails as 'did not answer' (not signed out); a 401 fails at once, never asked again", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => reply(503, {}));
      const me = transport(fetchFn as typeof fetch).me();
      const caught = me.catch((e) => e);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(await caught).toMatchObject({ code: "upstream_error", status: 503 });
      expect(fetchFn).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
    const refused = vi.fn(async () => reply(401, { error: "not_signed_in" }));
    await expect(transport(refused as typeof fetch).me()).rejects.toMatchObject({ code: "not_signed_in" });
    expect(refused).toHaveBeenCalledTimes(1);
  });

  it("refuses without a session before calling", async () => {
    const fetchFn = vi.fn();
    await expect(transport(fetchFn as typeof fetch, null).call("fleet_overview")).rejects.toMatchObject({ code: "not_signed_in" });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("maps every office-api answer to the error code the screens know", () => {
    expect(mapHttpError(401, { error: "not_signed_in" }).code).toBe("not_signed_in");
    expect(mapHttpError(403, { error: "mfa_required" }).code).toBe("mfa_required");
    expect(mapHttpError(403, { error: "switched_off" }).code).toBe("switched_off");
    expect(mapHttpError(403, { error: "Your role (viewer) cannot use create_task." })).toMatchObject({ code: "forbidden", message: "Your role (viewer) cannot use create_task." });
    expect(mapHttpError(400, { error: "bad_input", issues: [{ path: "date", message: "Use the form YYYY-MM-DD" }] }).message).toBe("Check date: Use the form YYYY-MM-DD");
    expect(mapHttpError(409, { error: "This task is already completed; it cannot be cancelled." })).toMatchObject({ code: "tool_error" });
    expect(mapHttpError(429, null).code).toBe("rate_limited");
    expect(mapHttpError(500, { error: "boom" }).code).toBe("upstream_error");
  });

  it("turns a failed fetch into a network error", async () => {
    const fetchFn = vi.fn(async () => { throw new TypeError("Failed to fetch"); });
    await expect(transport(fetchFn as typeof fetch).call("fleet_overview")).rejects.toMatchObject({ code: "network" });
  });

  it("watches: fetches at once, again on the interval, and at once on invalidate", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchFn = vi.fn(async () => reply(200, { result: { n: ++n } }));
    const t = transport(fetchFn as typeof fetch);
    const seen: unknown[] = [];
    const stop = t.watch("fleet_overview", {}, (ev) => seen.push(ev.type === "data" ? ev.data : ev.error), 30000);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([{ n: 1 }]);
    await vi.advanceTimersByTimeAsync(30000);
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
    await t.invalidate();
    expect(seen).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    stop();
    await vi.advanceTimersByTimeAsync(60000);
    expect(seen.length).toBe(3);
    vi.useRealTimers();
  });

  it("Part 6: a dropped request is asked again after 2 s, once, before the page hears of it; a second failure is shown", async () => {
    vi.useFakeTimers();
    let n = 0;
    const answers = [() => { throw new TypeError("connection reset"); }, () => reply(200, { result: { ok: 1 } }), () => reply(502, { error: "x" }), () => reply(502, { error: "x" })];
    const fetchFn = vi.fn(async () => answers[Math.min(n++, answers.length - 1)]());
    const seen: string[] = [];
    const stop = transport(fetchFn as unknown as typeof fetch).watch("fleet_overview", {}, (ev) => seen.push(ev.type === "data" ? "data" : `error:${ev.error.code}`), 30000);
    await vi.advanceTimersByTimeAsync(0);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toEqual(["data"]);
    // The interval's call at 30 s fails (dropped): not shown yet; its quick retry at 32 s fails too: shown.
    await vi.advanceTimersByTimeAsync(28000);
    expect(seen).toEqual(["data"]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(seen).toEqual(["data", "error:upstream_error"]);
    expect(fetchFn).toHaveBeenCalledTimes(4);
    stop();
    vi.useRealTimers();
  });

  it("Part 6: a refusal (4xx) is shown at once, never retried early", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => reply(409, { error: "no" }));
    const seen: string[] = [];
    const stop = transport(fetchFn as unknown as typeof fetch).watch("fleet_overview", {}, (ev) => seen.push(ev.type === "data" ? "data" : `error:${ev.error.code}`), 30000);
    await vi.advanceTimersByTimeAsync(2500);
    expect(seen).toEqual(["error:tool_error"]);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    stop();
    vi.useRealTimers();
  });
});

// docs/ui-patterns.md §5: no call waits forever (retryRule.ts timeoutFor).
describe("ApiTransport: the time limits", () => {
  /** A fetch that never answers until it is aborted. */
  const hang = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_res, rej) => {
    init?.signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError")));
  }));

  it("a read gives up after 20 s with 'took too long', a write after 30 s as maybe not saved, a suggestion after 15 s", async () => {
    vi.useFakeTimers();
    try {
      const t = transport(hang as unknown as typeof fetch);
      let read: unknown = "pending";
      void t.call("task_board", { date: "2026-10-20" }).catch((e) => { read = e; });
      await vi.advanceTimersByTimeAsync(19_999);
      expect(read).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(read).toMatchObject({ code: "timeout", message: "Fame Fleet took too long to answer." });

      let write: unknown = "pending";
      void t.call("cancel_task", { task_id: "t1", reason: "x" }).catch((e) => { write = e; });
      await vi.advanceTimersByTimeAsync(29_999);
      expect(write).toBe("pending");
      await vi.advanceTimersByTimeAsync(1);
      expect(write).toMatchObject({ code: "timeout", write: true });

      let suggest: unknown = "pending";
      void t.call("search_places", { text: "Galle" }).catch((e) => { suggest = e; });
      await vi.advanceTimersByTimeAsync(15_000);
      expect(suggest).toMatchObject({ code: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("the time limits per call, and the sentences with Try again", () => {
    expect(timeoutFor()).toBe(READ_TIMEOUT_MS);
    expect(timeoutFor("list_issues")).toBe(20_000);
    expect(timeoutFor("cancel_task")).toBe(30_000);
    expect(timeoutFor("decide_request")).toBe(90_000);
    expect(timeoutFor("driver_route")).toBe(90_000);
    expect(timeoutFor("search_places")).toBe(15_000);
    expect(errText({ code: "timeout", message: "" })).toEqual(["Fame Fleet didn’t answer in time. Try again.", "retry"]);
    expect(errText({ code: "timeout", message: "", write: true })[0]).toContain("may not have been saved");
  });

  it("an answer in time clears the timer: nothing fires later", async () => {
    vi.useFakeTimers();
    try {
      const fetchFn = vi.fn(async () => reply(200, { result: { ok: true } }));
      expect(await transport(fetchFn as typeof fetch).call("task_board", {})).toEqual({ ok: true });
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
