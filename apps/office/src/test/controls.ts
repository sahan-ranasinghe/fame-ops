// Test helpers that drive the standard controls (docs/ui-patterns.md) the way a person does: the Filter button and its
// panel, the date-range picker, the week strip, the trip day and a plain date field. Every sheet is drawn on
// document.body, so the helpers look for it there.
import { fireEvent, screen, within } from "@testing-library/react";

/** The sheet open now (the top one). */
export function openSheet(testId?: string): HTMLElement {
  if (testId) return screen.getByTestId(testId);
  const all = screen.getAllByRole("dialog");
  return all[all.length - 1];
}

/**
 * Opens the Filter panel (of `scope`, else the only one on the page), picks `choice` in the section `section` (its
 * heading, e.g. "Status"), and applies. A multi section ticks the box (several: call once per value before Apply with
 * `apply: false`).
 */
export function applyFilter(section: string, choice: string | RegExp, opts: { scope?: HTMLElement; apply?: boolean; open?: boolean } = {}): void {
  const root = opts.scope ? within(opts.scope) : screen;
  if (opts.open !== false) fireEvent.click(root.getByTestId("filter-button"));
  const panel = screen.getByTestId("filter-panel");
  const group = within(panel).getByRole("group", { name: section });
  fireEvent.click(within(group).getByLabelText(choice));
  if (opts.apply !== false) fireEvent.click(within(panel).getByTestId("filter-apply"));
}

/** Removes the chip of a filter in use ("Status: Approved"). */
export function removeChip(text: string | RegExp): void {
  const name = typeof text === "string" ? `Remove ${text}` : new RegExp(`Remove ${text.source}`);
  fireEvent.click(screen.getByRole("button", { name }));
}

/** The date-range picker: a preset ("Yesterday", "Last month"). */
export function pickPreset(preset: string, scope?: HTMLElement): void {
  fireEvent.click((scope ? within(scope) : screen).getByTestId("date-range-button"));
  fireEvent.click(within(screen.getByTestId("date-range-sheet")).getByRole("button", { name: preset }));
}

/** Clicks a day in the open calendar, moving month by month until it shows. */
export function tapCalendarDay(sheet: HTMLElement, day: string): void {
  for (let i = 0; i < 240; i++) {
    const cell = sheet.querySelector<HTMLButtonElement>(`[data-day="${day}"]`);
    if (cell) {
      fireEvent.click(cell);
      return;
    }
    const first = sheet.querySelector<HTMLElement>("[data-day]")?.dataset.day ?? "";
    fireEvent.click(within(sheet).getByRole("button", { name: day < first ? "Previous month" : "Next month" }));
  }
  throw new Error(`no day ${day} on the calendar`);
}

/** The date-range picker: tap the start day, then the end day (the same day twice = one day), Apply. */
export function pickRange(from: string, to: string, scope?: HTMLElement): void {
  fireEvent.click((scope ? within(scope) : screen).getByTestId("date-range-button"));
  const sheet = screen.getByTestId("date-range-sheet");
  tapCalendarDay(sheet, from);
  tapCalendarDay(sheet, to);
  fireEvent.click(within(sheet).getByTestId("date-range-apply"));
}

/** The week strip (a day of history): the day's cell when its week shows, else the calendar. */
export function pickStripDay(day: string, testId = "day-strip"): void {
  const strip = screen.getByTestId(testId);
  const cell = strip.querySelector<HTMLButtonElement>(`[data-day="${day}"]`);
  if (cell) {
    fireEvent.click(cell);
    return;
  }
  fireEvent.click(within(strip).getByRole("button", { name: "Pick a date" }));
  tapCalendarDay(screen.getByTestId("day-sheet"), day);
}

/** A trip's day: Today, Tomorrow, else Pick a date and the calendar. `group` is the field's label ("Day", "Date"). */
export function pickTripDay(group: string, day: string, todayIs: string, tomorrowIs: string): void {
  const g = screen.getByRole("group", { name: group });
  if (day === todayIs) return void fireEvent.click(within(g).getByRole("button", { name: "Today" }));
  if (day === tomorrowIs) return void fireEvent.click(within(g).getByRole("button", { name: "Tomorrow" }));
  fireEvent.click(within(g).getByRole("button", { name: /Pick a date|pick another date/ }));
  tapCalendarDay(screen.getByTestId("day-sheet"), day);
}

/** A plain date field (an expiry): opens its calendar and taps the day. */
export function pickDate(field: HTMLElement, day: string): void {
  fireEvent.click(field);
  tapCalendarDay(screen.getByTestId("date-field-sheet"), day);
}
