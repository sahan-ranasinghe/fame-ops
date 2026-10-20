// The standard controls on a page (docs/ui-patterns.md §1–3): the Filter button, its panel and chips with the values in
// the URL; the date-range picker; the week strip and the trip day.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { MemoryRouter, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { pickRange, tapCalendarDay } from "../test/controls";
import { addDays } from "../lib/format";
import { colomboDay } from "./dateRange";
import { DateRangePicker, useDateRange } from "./DateRangePicker";
import { DateField, DayStrip, TripDayPicker } from "./DayPicker";
import { FilterBar, useUrlFilters } from "./FilterBar";
import { type FilterDef, pairsDef } from "./filterLogic";

const Where = () => {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
};

const DEFS: FilterDef[] = [
  pairsDef("status", "Status", [["open", "Open"], ["closed", "Closed"], ["all", "All"]], "open", { open: 5, closed: 2 }),
  { key: "kind", label: "Kind", kind: "multi", options: [{ value: "tyre", label: "Tyre" }, { value: "engine", label: "Engine" }] },
];

function FilterPage() {
  const f = useUrlFilters(DEFS);
  const [sort, setSort] = useState("newest");
  return (
    <>
      <FilterBar filters={DEFS} values={f.values} onChange={f.apply}
        sort={{ value: sort, options: [{ value: "newest", label: "Newest" }, { value: "oldest", label: "Oldest" }], onChange: setSort }} />
      <output data-testid="sort">{sort}</output>
      <Where />
    </>
  );
}

const mountAt = (ui: React.ReactNode, path: string) => render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>);
const where = () => screen.getByTestId("where").textContent;

describe("FilterBar", () => {
  it("opens the panel with the counts; nothing changes until Apply; the chips and the count follow; the URL keeps the rest", () => {
    mountAt(<FilterPage />, "/issues?q=van");
    expect(screen.getByTestId("filter-button").textContent).toBe("Filter");
    fireEvent.click(screen.getByTestId("filter-button"));
    const panel = screen.getByTestId("filter-panel");
    expect(within(panel).getByLabelText("Open · 5")).toHaveProperty("checked", true);
    fireEvent.click(within(panel).getByLabelText("Closed · 2"));
    fireEvent.click(within(panel).getByLabelText("Tyre"));
    fireEvent.click(within(panel).getByLabelText("Engine"));
    expect(where()).toBe("/issues?q=van"); // not yet
    fireEvent.click(within(panel).getByTestId("filter-apply"));
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    expect(where()).toBe("/issues?q=van&status=closed&kind=tyre%2Cengine");
    expect(screen.getByTestId("filter-button").textContent).toBe("Filter2");
    const chips = screen.getByTestId("filter-chips");
    expect(within(chips).getAllByRole("listitem").map((c) => c.textContent)).toEqual(["Status: Closed", "Kind: Tyre", "Kind: Engine"]);
    // One chip's ✕ drops that value only.
    fireEvent.click(screen.getByRole("button", { name: "Remove Kind: Tyre" }));
    expect(where()).toBe("/issues?q=van&status=closed&kind=engine");
    // Clear all (two or more in use).
    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));
    expect(where()).toBe("/issues?q=van");
    expect(screen.queryByTestId("filter-chips")).toBeNull();
  });

  it("a reload (the URL) shows the same filters; Clear empties the draft only until Apply", () => {
    mountAt(<FilterPage />, "/issues?status=all&kind=engine");
    expect(within(screen.getByTestId("filter-chips")).getByText("Status: All")).toBeTruthy();
    fireEvent.click(screen.getByTestId("filter-button"));
    const panel = screen.getByTestId("filter-panel");
    expect(within(panel).getByLabelText("Engine")).toHaveProperty("checked", true);
    fireEvent.click(within(panel).getByTestId("filter-clear"));
    expect(within(panel).getByLabelText("Open · 5")).toHaveProperty("checked", true);
    expect(within(panel).getByLabelText("Engine")).toHaveProperty("checked", false);
    expect(where()).toBe("/issues?status=all&kind=engine");
    fireEvent.click(within(panel).getByTestId("filter-apply"));
    expect(where()).toBe("/issues");
  });

  it("Esc or a click outside closes the panel without applying", () => {
    mountAt(<FilterPage />, "/issues");
    fireEvent.click(screen.getByTestId("filter-button"));
    fireEvent.click(within(screen.getByTestId("filter-panel")).getByLabelText("Closed · 2"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    expect(where()).toBe("/issues");
    fireEvent.click(screen.getByTestId("filter-button"));
    // It opens with the values in use, not the abandoned draft.
    expect(within(screen.getByTestId("filter-panel")).getByLabelText("Open · 5")).toHaveProperty("checked", true);
    fireEvent.click(within(screen.getByTestId("filter-panel")).getByLabelText("Closed · 2"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId("filter-panel")).toBeNull();
    expect(where()).toBe("/issues");
  });

  it("Sort is its own menu beside the Filter button", () => {
    mountAt(<FilterPage />, "/issues");
    expect(screen.getByTestId("sort-button").textContent).toContain("Newest");
    fireEvent.click(screen.getByTestId("sort-button"));
    fireEvent.click(within(screen.getByTestId("sort-menu")).getByRole("radio", { name: "Oldest" }));
    expect(screen.getByTestId("sort").textContent).toBe("oldest");
    expect(screen.queryByTestId("sort-menu")).toBeNull();
  });
});

function RangePage({ maxDays }: { maxDays?: number }) {
  const d = useDateRange("month", { maxDays });
  return (
    <>
      <DateRangePicker value={d} label="Opened" />
      <output data-testid="range">{`${d.from}..${d.to}`}</output>
      <Where />
    </>
  );
}

describe("DateRangePicker", () => {
  const today = colomboDay();

  it("one button in words; a preset applies at once; the URL keeps the other parameters", () => {
    mountAt(<RangePage />, "/x?driver=kamal");
    expect(screen.getByTestId("date-range-button").textContent).toMatch(/^This month · /);
    fireEvent.click(screen.getByTestId("date-range-button"));
    fireEvent.click(within(screen.getByTestId("date-range-sheet")).getByRole("button", { name: "Last 7 days" }));
    expect(screen.queryByTestId("date-range-sheet")).toBeNull();
    expect(where()).toBe("/x?driver=kamal&range=last7");
    expect(screen.getByTestId("range").textContent).toBe(`${addDays(today, -6)}..${today}`);
  });

  it("tap the start, then the end, Apply: a custom range; one day tapped twice is that day", () => {
    mountAt(<RangePage />, "/x");
    const from = addDays(today, -10);
    const to = addDays(today, -3);
    pickRange(from, to);
    expect(where()).toBe(`/x?range=custom&from=${from}&to=${to}`);
    pickRange(from, from);
    expect(where()).toBe(`/x?range=custom&from=${from}&to=${from}`);
  });

  it("the page's limit greys the days past it and says why", () => {
    mountAt(<RangePage maxDays={7} />, "/x?range=today");
    fireEvent.click(screen.getByTestId("date-range-button"));
    const sheet = screen.getByTestId("date-range-sheet");
    expect(within(sheet).getByTestId("date-range-limit").textContent).toContain("At most 7 days at a time.");
    tapCalendarDay(sheet, today);
    const far = sheet.querySelector<HTMLButtonElement>(`[data-day="${addDays(today, -7)}"]`);
    const near = sheet.querySelector<HTMLButtonElement>(`[data-day="${addDays(today, -6)}"]`);
    if (far) expect(far.disabled).toBe(true);
    if (near) expect(near.disabled).toBe(false);
  });
});

describe("DayStrip, TripDayPicker and DateField", () => {
  const today = colomboDay();

  function Strip({ pastOnly }: { pastOnly?: boolean }) {
    const [d, setD] = useState(today);
    return <><DayStrip value={d} onChange={setD} pastOnly={pastOnly} /><output data-testid="d">{d}</output></>;
  }

  it("the week strip: seven days, today marked and chosen; ‹ › by a week; Today comes back; past only greys tomorrow", () => {
    render(<Strip pastOnly />);
    const strip = screen.getByTestId("day-strip");
    expect(strip.querySelectorAll(".daystrip-day")).toHaveLength(7);
    expect(strip.querySelector(`[data-day="${today}"]`)?.getAttribute("aria-current")).toBe("date");
    expect(strip.querySelector(`[data-day="${today}"]`)?.getAttribute("aria-pressed")).toBe("true");
    const tomorrow = strip.querySelector<HTMLButtonElement>(`[data-day="${addDays(today, 1)}"]`);
    if (tomorrow) expect(tomorrow.disabled).toBe(true);
    expect(within(strip).getByRole("button", { name: "Next week" })).toHaveProperty("disabled", true);
    fireEvent.click(within(strip).getByRole("button", { name: "Previous week" }));
    const lastWeek = addDays(today, -7);
    fireEvent.click(strip.querySelector(`[data-day="${lastWeek}"]`)!);
    expect(screen.getByTestId("d").textContent).toBe(lastWeek);
    fireEvent.click(within(strip).getByRole("button", { name: "Today" }));
    expect(screen.getByTestId("d").textContent).toBe(today);
    // The calendar jumps to any past date.
    fireEvent.click(within(strip).getByRole("button", { name: "Pick a date" }));
    tapCalendarDay(screen.getByTestId("day-sheet"), addDays(today, -40));
    expect(screen.getByTestId("d").textContent).toBe(addDays(today, -40));
    expect(screen.queryByTestId("day-sheet")).toBeNull();
  });

  function Trip() {
    const [d, setD] = useState("");
    return <><TripDayPicker value={d} onChange={setD} label="Day" /><output data-testid="d">{d}</output></>;
  }

  it("a trip's day: Today, Tomorrow, Pick a date (from today); another day shows on its chip", () => {
    render(<Trip />);
    const g = screen.getByRole("group", { name: "Day" });
    fireEvent.click(within(g).getByRole("button", { name: "Tomorrow" }));
    expect(screen.getByTestId("d").textContent).toBe(addDays(today, 1));
    fireEvent.click(within(g).getByRole("button", { name: "Pick a date" }));
    const sheet = screen.getByTestId("day-sheet");
    const yesterday = sheet.querySelector<HTMLButtonElement>(`[data-day="${addDays(today, -1)}"]`);
    if (yesterday) expect(yesterday.disabled).toBe(true);
    tapCalendarDay(sheet, addDays(today, 9));
    expect(screen.getByTestId("d").textContent).toBe(addDays(today, 9));
    expect(g.getAttribute("data-value")).toBe(addDays(today, 9));
    expect(within(g).getByRole("button", { name: /pick another date/ }).getAttribute("aria-pressed")).toBe("true");
  });

  it("a plain date: one field, the calendar, Clear", () => {
    function F() {
      const [d, setD] = useState("2027-01-31");
      return <><label htmlFor="exp">Expires</label><DateField id="exp" label="Expires" value={d} onChange={setD} /><output data-testid="d">{d}</output></>;
    }
    render(<F />);
    const field = screen.getByLabelText("Expires");
    expect(field.textContent).toContain("Sun 31 Jan 2027");
    fireEvent.click(field);
    fireEvent.click(within(screen.getByTestId("date-field-sheet")).getByRole("button", { name: "Clear" }));
    expect(screen.getByTestId("d").textContent).toBe("");
  });
});
