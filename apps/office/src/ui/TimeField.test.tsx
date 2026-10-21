// The time field (Hotfix 2, C; docs/ui-patterns.md §4): on a desktop the value counts on blur, on Enter, or 1 s after the
// last change when it is a whole valid HH:MM; a value set from outside shows at once unless the person is typing another
// one; a click drops the time list (Now, the common times, every 5 minutes). On a phone it opens the time sheet.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWholeTime, TIME_SETTLE_MS, TimeField } from "./TimeField";

function Harness({ initial = "", onCommit }: { initial?: string; onCommit: (v: string) => void }) {
  const [v, setV] = useState(initial);
  return (
    <>
      <label htmlFor="t">Leave by</label>
      <TimeField id="t" value={v} onCommit={(x: string) => { setV(x); onCommit(x); }} suggested="07:24" />
      <output data-testid="held">{v}</output>
      <button type="button" onClick={() => setV("07:24")}>Use 07:24</button>
      <button type="button" onClick={() => setV("06:00")}>Use 06:00</button>
    </>
  );
}

const field = () => screen.getByLabelText("Leave by") as HTMLInputElement;
const held = () => screen.getByTestId("held").textContent;
const later = async (ms: number) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("TimeField (desktop: typed)", () => {
  it("knows a whole time", () => {
    expect(isWholeTime("07:05")).toBe(true);
    expect(isWholeTime("23:59")).toBe(true);
    expect(isWholeTime("24:00")).toBe(false);
    expect(isWholeTime("7:05")).toBe(false);
    expect(isWholeTime("")).toBe(false);
  });

  it("counts a whole time 1 s after its last change, once", async () => {
    const commits: string[] = [];
    render(<Harness onCommit={(v) => commits.push(v)} />);
    fireEvent.change(field(), { target: { value: "02:00" } });
    expect(field().value).toBe("02:00");
    await later(TIME_SETTLE_MS - 100);
    fireEvent.change(field(), { target: { value: "14:00" } });
    await later(TIME_SETTLE_MS - 100);
    expect(commits).toEqual([]);
    expect(held()).toBe("");
    await later(100);
    expect(commits).toEqual(["14:00"]);
    expect(held()).toBe("14:00");
    fireEvent.blur(field()); // already counted: not again
    expect(commits).toEqual(["14:00"]);
  });

  it("counts on blur and on Enter, an emptied field too; a half-typed time never by itself", async () => {
    const commits: string[] = [];
    render(<Harness initial="09:00" onCommit={(v) => commits.push(v)} />);
    fireEvent.change(field(), { target: { value: "09:30" } });
    fireEvent.blur(field());
    expect(commits).toEqual(["09:30"]);
    fireEvent.change(field(), { target: { value: "10:15" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(commits).toEqual(["09:30", "10:15"]);
    // While only the hours are typed the browser gives "": nothing counts until the field is left.
    fireEvent.change(field(), { target: { value: "" } });
    await later(TIME_SETTLE_MS * 3);
    expect(commits).toEqual(["09:30", "10:15"]);
    fireEvent.blur(field());
    expect(commits).toEqual(["09:30", "10:15", ""]);
  });

  it("shows a value set from outside (Use 07:24), but never over a time being typed", async () => {
    const commits: string[] = [];
    render(<Harness initial="09:00" onCommit={(v) => commits.push(v)} />);
    fireEvent.click(screen.getByRole("button", { name: "Use 07:24" }));
    expect(field().value).toBe("07:24");
    expect(commits).toEqual([]);
    fireEvent.change(field(), { target: { value: "08:00" } });
    // The plan answers meanwhile (or another button): the time being typed stays, and counts when it is done.
    fireEvent.click(screen.getByRole("button", { name: "Use 06:00" }));
    expect(held()).toBe("06:00");
    expect(field().value).toBe("08:00");
    await later(TIME_SETTLE_MS);
    expect(commits).toEqual(["08:00"]);
    expect(held()).toBe("08:00");
  });
});

describe("TimeField (desktop: the list)", () => {
  it("typing a short time counts it whole when the field is left: 930 → 09:30, 7 → 07:00; nonsense goes back", () => {
    const commits: string[] = [];
    render(<Harness initial="09:00" onCommit={(v) => commits.push(v)} />);
    fireEvent.change(field(), { target: { value: "930" } });
    fireEvent.blur(field());
    expect(field().value).toBe("09:30");
    fireEvent.change(field(), { target: { value: "7" } });
    fireEvent.keyDown(field(), { key: "Enter" });
    expect(field().value).toBe("07:00");
    fireEvent.change(field(), { target: { value: "25:99" } });
    fireEvent.blur(field());
    expect(field().value).toBe("07:00");
    expect(commits).toEqual(["09:30", "07:00"]);
  });

  it("a click drops the list: the planned time first, Now, the common times, then every 5 minutes; a pick counts at once", () => {
    const commits: string[] = [];
    render(<Harness initial="" onCommit={(v) => commits.push(v)} />);
    fireEvent.click(field());
    const list = screen.getByTestId("time-list");
    const chips = within(list).getByRole("group", { name: "Quick times" });
    expect(within(chips).getAllByRole("button")[0].textContent).toBe("Planned 07:24");
    expect(within(chips).getByRole("button", { name: /^Now/ })).toBeTruthy();
    expect(within(chips).getByRole("button", { name: "13:00" })).toBeTruthy();
    expect(within(list).getAllByRole("option")).toHaveLength(288);
    fireEvent.click(within(list).getByRole("option", { name: "08:35" }));
    expect(commits).toEqual(["08:35"]);
    expect(field().value).toBe("08:35");
    expect(screen.queryByTestId("time-list")).toBeNull();
  });

  it("focus alone opens nothing (typing stays free); ↓ opens the list and Esc closes it first", () => {
    render(<Harness onCommit={() => {}} />);
    fireEvent.focus(field());
    expect(screen.queryByTestId("time-list")).toBeNull();
    fireEvent.keyDown(field(), { key: "ArrowDown" });
    expect(screen.getByTestId("time-list")).toBeTruthy();
    fireEvent.keyDown(field(), { key: "Escape" });
    expect(screen.queryByTestId("time-list")).toBeNull();
  });
});

describe("TimeField (phone: the sheet)", () => {
  const realMatch = window.matchMedia;
  beforeEach(() => {
    window.matchMedia = ((q: string) => ({ matches: true, media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => { window.matchMedia = realMatch; });

  // A fixed clock (21 October 2026: at 08:56 "Now" became 09:00 and the 09:00 chip was gone; the test ran at the real time).
  it.each([["08:48", "2026-10-21T03:18:00Z"], ["08:59", "2026-10-21T03:29:00Z"], ["23:58", "2026-10-21T18:28:00Z"], ["00:01", "2026-10-21T18:31:00Z"]])("at %s: Now and 09:00 are both there", (_at, iso) => {
    vi.setSystemTime(new Date(iso));
    render(<Harness initial="" onCommit={() => {}} />);
    fireEvent.click(screen.getByLabelText("Leave by"));
    const sheet = screen.getByTestId("time-sheet");
    expect(within(sheet).getByRole("button", { name: "09:00" })).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: /^Now/ })).toBeTruthy();
  });

  it("is never typed: a tap opens the sheet; 09:00 counts and closes it; Clear empties it", () => {
    vi.setSystemTime(new Date("2026-10-21T03:26:00Z")); // 08:56 Colombo: "Now" is 09:00
    const commits: string[] = [];
    render(<Harness initial="" onCommit={(v) => commits.push(v)} />);
    const btn = screen.getByLabelText("Leave by");
    expect(btn.tagName).toBe("BUTTON");
    fireEvent.click(btn);
    const sheet = screen.getByTestId("time-sheet");
    fireEvent.click(within(sheet).getByRole("button", { name: "09:00" }));
    expect(commits).toEqual(["09:00"]);
    expect(screen.queryByTestId("time-sheet")).toBeNull();
    fireEvent.click(screen.getByLabelText("Leave by"));
    fireEvent.click(within(screen.getByTestId("time-sheet")).getByRole("button", { name: "Clear" }));
    expect(commits).toEqual(["09:00", ""]);
  });
});
