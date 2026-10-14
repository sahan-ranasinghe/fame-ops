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

const me = { email: "sahan@fame.test", name: "Sahan", permissions: ["view"], tools: [] } as unknown as Me;
const fleet = { me, store: {}, transport: {}, noConnector: false } as unknown as Fleet;
const wrapper = ({ children }: { children: ReactNode }) => <StrictMode><FleetProvider value={fleet}>{children}</FleetProvider></StrictMode>;
const key = draftKey(me.email ?? "", "request-new");

describe("useFormDraft", () => {
  // Unmounting (the library's own cleanup) saves a resumed draft again, so each test starts clean.
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.useRealTimers());

  it("offers an earlier draft until it is resumed, and resumes it", () => {
    writeDraft(key, { note: "Draft note" }, 1700000000000);
    const { result } = renderHook(() => useFormDraft("request-new", null, { note: "" }), { wrapper });
    expect(result.current[2].saved).toEqual({ at: 1700000000000 });
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
