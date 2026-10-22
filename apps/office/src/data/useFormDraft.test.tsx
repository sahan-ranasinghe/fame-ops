// The draft hook: an earlier draft is offered until resumed or discarded,
// typing saves one, leaving the page saves what was typed at once, and clear
// (after a successful save) stops saving. (The browser's StrictMode doubles the
// mount effects; Vitest's does not, so that case is covered by the e2e drafts tests.)
import { act, renderHook } from "@testing-library/react";
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import type { Fleet } from "../app/FleetContext";
import type { Me } from "../transport/types";
import { DRAFT_SAVE_MS, draftKey, readDraft, useFormDraft, writeDraft } from "./drafts";
import { queryKey } from "./useQuery";

const me = { email: "sahan@fame.test", name: "Sahan", permissions: ["view"], tools: [] } as unknown as Me;
const fleet = { me, store: {}, transport: {}, noConnector: false } as unknown as Fleet;
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><FleetProvider value={fleet}>{children}</FleetProvider></StrictMode>;
const key = draftKey(me.email ?? "", "request-new");

describe("useFormDraft", () => {
  // Unmounting (the library's own cleanup) saves a resumed draft again, so each test starts clean.
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("offers an earlier draft until it is resumed, and resumes it", () => {
    // An hour old (Round 4–7: a draft older than the keep period, 30 days by default, is not offered).
    const at = Date.now() - 3_600_000;
    writeDraft(key, { note: "Draft note" }, at);
    const { result } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper });
    expect(result.current[2].saved).toEqual({ at });
    expect(result.current[0]).toEqual({ note: "" });
    act(() => result.current[2].resume());
    expect(result.current[0]).toEqual({ note: "Draft note" });
    expect(result.current[2].saved).toBeNull();
  });

  it("saves a change after a moment, and the rest at once when the page is left", () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper });
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS * 2); });
    expect(readDraft(key)).toBeNull(); // nothing typed: nothing saved
    act(() => result.current[1]({ note: "Somebody" }));
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS); });
    expect(readDraft<{ note: string }>(key)?.state).toEqual({ note: "Somebody" });
    act(() => result.current[1]({ note: "Somebody else" }));
    unmount();
    expect(readDraft<{ note: string }>(key)?.state).toEqual({ note: "Somebody else" });
  });

  it("discard forgets the draft; clear (after a save) stops saving", () => {
    vi.useFakeTimers();
    writeDraft(key, { note: "old" });
    const { result } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper });
    act(() => result.current[2].discard());
    expect(readDraft(key)).toBeNull();
    act(() => result.current[1]({ note: "typed" }));
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS); });
    expect(readDraft(key)).not.toBeNull();
    act(() => result.current[2].clear());
    expect(readDraft(key)).toBeNull();
    act(() => result.current[1]({ note: "after save" }));
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS); });
    expect(readDraft(key)).toBeNull();
  });
});

describe("useFormDraft.reset", () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());
  it("sets the loaded record without saving a draft; typing after it does", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useFormDraft("request-edit", "r1", { note: "" }), { wrapper });
    act(() => result.current[2].reset({ note: "loaded" }));
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS * 2); });
    expect(result.current[0]).toEqual({ note: "loaded" });
    expect(readDraft(draftKey(me.email ?? "", "request-edit", "r1"))).toBeNull();
    act(() => result.current[1]({ note: "typed" }));
    act(() => { vi.advanceTimersByTime(DRAFT_SAVE_MS); });
    expect(readDraft<{ note: string }>(draftKey(me.email ?? "", "request-edit", "r1"))?.state).toEqual({ note: "typed" });
  });
});

describe("useFormDraft: the keep period (Round 4–7, item 9)", () => {
  beforeEach(() => localStorage.clear());
  const DAY = 86_400_000;
  /** A page whose store holds get_settings' answer with retention.drafts_days. */
  const withDays = (days: number) => {
    const answer = { settings: { retention: { drafts_days: days } } };
    const store = { get: (k: string) => (k === queryKey("settings", {}) ? { data: answer } : {}), subscribe: () => () => true };
    const f = { ...fleet, store } as unknown as Fleet;
    return ({ children }: { children: ReactNode }) => <FleetProvider value={f}>{children}</FleetProvider>;
  };

  it("the period not known yet: a draft older than 30 days is not offered, and not removed", () => {
    writeDraft(key, { note: "old" }, Date.now() - 31 * DAY);
    const { result } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper });
    expect(result.current[2].saved).toBeNull();
    expect(readDraft(key)).not.toBeNull();
  });

  it("drafts_days 7: an 8-day-old draft is dropped when read, with every expired draft here (anyone's); fresh ones stay", () => {
    const other = draftKey("anoja@fame.test", "task-new");
    const otherFresh = draftKey("anoja@fame.test", "request-new");
    writeDraft(key, { note: "old" }, Date.now() - 8 * DAY);
    writeDraft(other, { note: "Anoja's old" }, Date.now() - 9 * DAY);
    writeDraft(otherFresh, { note: "Anoja's" }, Date.now() - 2 * DAY);
    const { result } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper: withDays(7) });
    expect(result.current[2].saved).toBeNull();
    expect(readDraft(key)).toBeNull();
    expect(readDraft(other)).toBeNull();
    expect(readDraft(otherFresh)).not.toBeNull();
  });

  it("drafts_days 90: a 40-day-old draft is still offered and resumed", () => {
    const at = Date.now() - 40 * DAY;
    writeDraft(key, { note: "kept" }, at);
    const { result } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper: withDays(90) });
    expect(result.current[2].saved).toEqual({ at });
    act(() => result.current[2].resume());
    expect(result.current[0]).toEqual({ note: "kept" });
  });
});
