import { describe, expect, it, vi } from "vitest";
import { ApiTransport, mapHttpError } from "./api";

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
});
