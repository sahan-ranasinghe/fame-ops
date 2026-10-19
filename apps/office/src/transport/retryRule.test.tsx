// The one retry rule (Sahan, 19 October 2026): only reads are asked again by themselves; a write never is, unless the server
// keys it itself; a dropped write the person started offers Try again, which presses the same thing again.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WriteRetry } from "../ui/WriteRetry";
import { ApiTransport } from "./api";
import { errText } from "./errors";
import { resetGesturesForTests } from "./gesture";
import { BACKGROUND_WRITES, callWithRetry, IDEMPOTENT_WRITES, isWrite, mayRetry, QUICK_RETRY_MS, READ_TOOLS } from "./retryRule";

const TOOLS_DIR = join(process.cwd(), "../../supabase/functions/_shared/fleet/tools");
/** Every tool's readOnly flag, read from the server's own files. */
function serverTools(): Map<string, { readOnly: boolean; body: string }> {
  const out = new Map<string, { readOnly: boolean; body: string }>();
  for (const f of readdirSync(TOOLS_DIR).filter((n) => n.endsWith(".ts") && !n.includes("_test"))) {
    const src = readFileSync(join(TOOLS_DIR, f), "utf8");
    for (const m of src.matchAll(/tool(?:<[^>]*>)?\(\{([\s\S]*?)\n\}\);/g)) {
      const name = /\bname:\s*"([a-z_]+)"/.exec(m[1])?.[1];
      const flag = /\breadOnly:\s*(true|false)/.exec(m[1])?.[1];
      if (name && flag) out.set(name, { readOnly: flag === "true", body: m[1] });
    }
  }
  return out;
}
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const transport = (fetchFn: typeof fetch) => new ApiTransport("https://x.test/functions/v1/office-api/", async () => "tok", fetchFn);

afterEach(() => {
  resetGesturesForTests();
  vi.useRealTimers();
});

describe("which calls may be asked again by themselves", () => {
  it("READ_TOOLS is exactly the server's readOnly tools (99 tools, 36 reads)", () => {
    const tools = serverTools();
    expect(tools.size).toBeGreaterThan(90);
    expect([...READ_TOOLS].sort()).toEqual([...tools].filter(([, t]) => t.readOnly).map(([n]) => n).sort());
  });

  it("each keyed write is a write whose server upserts on its key, so a repeat changes nothing", () => {
    const tools = serverTools();
    for (const [name, key] of Object.entries(IDEMPOTENT_WRITES)) {
      expect(tools.get(name)?.readOnly).toBe(false);
      expect(tools.get(name)!.body).toMatch(/\.upsert\(/);
      expect(tools.get(name)!.body).toContain(`onConflict: "${/\(([^)]+)\)/.exec(key)![1].replace(/\s/g, "")}"`);
    }
    expect([...BACKGROUND_WRITES].every((t) => tools.get(t)?.readOnly === false)).toBe(true);
  });

  it("the rule: a dropped read or keyed write, yes; a write, a refusal, never", () => {
    const net = { code: "network", message: "x" }, gone = { code: "upstream_error", message: "x" }, no = { code: "tool_error", message: "x" };
    expect([mayRetry("fleet_overview", net), mayRetry("availability", gone), mayRetry("reviewing", net)]).toEqual([true, true, true]);
    expect([mayRetry("create_task", net), mayRetry("decide_request", gone), mayRetry("cancel_task", net), mayRetry("update_settings", net)])
      .toEqual([false, false, false, false]);
    expect(mayRetry("fleet_overview", no)).toBe(false);
    expect([isWrite("decide_request"), isWrite("reviewing"), isWrite("task_board")]).toEqual([true, false, false]);
  });
});

describe("the transport under the rule", () => {
  it("a dropped read is asked again once after 2 s", async () => {
    vi.useFakeTimers();
    let n = 0;
    const fetchFn = vi.fn(async () => (n++ === 0 ? reply(502, { error: "gone" }) : reply(200, { result: { ok: 1 } })));
    const p = callWithRetry(transport(fetchFn as unknown as typeof fetch), "task_board", {});
    await vi.advanceTimersByTimeAsync(QUICK_RETRY_MS);
    await expect(p).resolves.toEqual({ ok: 1 });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("a dropped write is sent once, never again by itself, and says it may not have been saved", async () => {
    vi.useFakeTimers();
    const fetchFn = vi.fn(async () => reply(502, { error: "gone" }));
    const p = callWithRetry(transport(fetchFn as unknown as typeof fetch), "decide_request", { request_id: "r1", decision: "approve" });
    const caught = p.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(QUICK_RETRY_MS * 3);
    const e = await caught as { code: string; write?: boolean };
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(e).toMatchObject({ code: "upstream_error", write: true });
    expect(errText(e as never)).toEqual(["Fame Fleet didn’t answer, so this may not have been saved. Try again.", "retry"]);
    expect(errText({ code: "upstream_error", message: "x" })[0]).toBe("Fame Fleet didn’t answer. The page tries again by itself.");
  });

  it("Try again presses what the person pressed: the form is submitted again by its own handler; only when they choose", async () => {
    const fetchFn = vi.fn(async () => reply(502, { error: "gone" }));
    const t = transport(fetchFn as unknown as typeof fetch);
    const submitted = vi.fn();
    function Form() {
      return (
        <form onSubmit={(ev) => { ev.preventDefault(); submitted(); void t.call("create_task", { title: "x" }).catch(() => undefined); }}>
          <button type="submit">Assign &amp; send</button>
        </form>
      );
    }
    render(<><Form /><WriteRetry /></>);
    const button = screen.getByRole("button", { name: "Assign & send" });
    fireEvent.pointerDown(button);
    fireEvent.click(button);
    expect(await screen.findByTestId("write-retry")).toBeTruthy();
    expect(screen.getByTestId("write-retry").textContent).toContain("may not have been saved");
    expect([submitted.mock.calls.length, fetchFn.mock.calls.length]).toEqual([1, 1]);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect([submitted.mock.calls.length]).toEqual([2]);
  });

  it("a write the page makes by itself (the Live watch) never offers Try again", async () => {
    const fetchFn = vi.fn(async () => reply(502, { error: "gone" }));
    const t = transport(fetchFn as unknown as typeof fetch);
    render(<><button type="button" onClick={() => void t.call("watch_drivers", { drivers: ["a"] }).catch(() => undefined)}>Live</button><WriteRetry /></>);
    const b = screen.getByRole("button", { name: "Live" });
    fireEvent.pointerDown(b);
    fireEvent.click(b);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId("write-retry")).toBeNull();
  });
});
