// Hotfix O2-H2, Part 3: the site's selection controls (ui/Select.tsx) say their state with a mark and the right ARIA, the
// whole row is the control, a disabled one is not clickable and says why; the CSS draws the tint, the 2 px border and the
// check for every picked thing; the audited screens use the shared controls.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Checkbox, ChoiceCard, ChoiceChip, ChoiceRow, Radio, SelectableRow } from "./Select";

describe("SelectableRow (pick many)", () => {
  it("picked: the check mark, the 'on' row, a checked checkbox named for screen readers", () => {
    render(<SelectableRow selected onToggle={() => undefined} label="Ask Kamal Perera" testId="row"><span>Kamal Perera</span></SelectableRow>);
    const row = screen.getByTestId("row");
    expect(row.className).toContain("on");
    expect(within(row).getByTestId("sel-mark-on").className).toBe("sel-mark check on");
    const box = screen.getByRole("checkbox", { name: "Ask Kamal Perera" }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it("not picked: the empty circle in the same place; a click anywhere on the row toggles it", () => {
    const onToggle = vi.fn();
    render(<SelectableRow selected={false} onToggle={onToggle} label="Ask Nuwan" testId="row"><span>Nuwan Perera</span></SelectableRow>);
    const row = screen.getByTestId("row");
    expect(row.className).not.toMatch(/\bon\b/);
    expect(within(row).getByTestId("sel-mark-off")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByText("Nuwan Perera"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disabled: greyed ('off'), not clickable, says why", () => {
    const onToggle = vi.fn();
    render(<SelectableRow selected={false} onToggle={onToggle} disabled disabledReason="On a task" label="Ask Sunil" testId="row"><span>Sunil Silva</span></SelectableRow>);
    const row = screen.getByTestId("row");
    expect(row.className).toContain("off");
    expect(screen.getByText("On a task")).toBeTruthy();
    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Sunil Silva"));
    expect(onToggle).not.toHaveBeenCalled();
  });
});

describe("ChoiceRow, ChoiceCard, ChoiceChip, Checkbox, Radio", () => {
  it("ChoiceRow is a radio of its group with the radio mark", () => {
    const onPick = vi.fn();
    render(<>
      <ChoiceRow name="veh" value="A" selected onPick={() => undefined} label="WP CAB-4521" testId="a"><span>WP CAB-4521</span></ChoiceRow>
      <ChoiceRow name="veh" value="B" selected={false} onPick={onPick} label="WP KL-1234" testId="b"><span>WP KL-1234</span></ChoiceRow>
    </>);
    expect((screen.getByRole("radio", { name: "WP CAB-4521" }) as HTMLInputElement).checked).toBe(true);
    expect(within(screen.getByTestId("a")).getByTestId("sel-mark-on").className).toBe("sel-mark radio on");
    expect(within(screen.getByTestId("b")).getByTestId("sel-mark-off")).toBeTruthy();
    fireEvent.click(screen.getByText("WP KL-1234"));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("ChoiceCard: role radio with aria-checked and the radio mark", () => {
    render(<div role="radiogroup" aria-label="Question"><ChoiceCard selected onPick={() => undefined} testId="k1"><b>Free for a trip?</b></ChoiceCard><ChoiceCard selected={false} onPick={() => undefined} testId="k2"><b>Where are you?</b></ChoiceCard></div>);
    expect(screen.getByTestId("k1").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("k2").getAttribute("aria-checked")).toBe("false");
    expect(screen.getAllByRole("radio")).toHaveLength(2);
    expect(within(screen.getByTestId("k1")).getByTestId("sel-mark-on")).toBeTruthy();
  });

  it("ChoiceChip: a chip with aria-pressed (the CSS draws its check); Checkbox and Radio are named native controls", () => {
    const onChange = vi.fn();
    render(<>
      <ChoiceChip selected onClick={() => undefined}>Today</ChoiceChip>
      <Checkbox checked={false} onChange={onChange}>Approve requests</Checkbox>
      <Radio checked name="trips" value="allowed" onPick={() => undefined}>Allowed</Radio>
    </>);
    const chip = screen.getByRole("button", { name: "Today" });
    expect(chip.className).toBe("chip");
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("checkbox", { name: "Approve requests" }));
    expect(onChange).toHaveBeenCalledWith(true);
    expect((screen.getByRole("radio", { name: "Allowed" }) as HTMLInputElement).checked).toBe(true);
  });
});

describe("the Selection CSS and the screens", () => {
  const css = readFileSync(join(process.cwd(), "src/styles.css"), "utf8");
  const src = (f: string) => readFileSync(join(process.cwd(), "src", f), "utf8");

  it("picked = the blue tint, a 2 px blue border and a mark, for rows, cards, chips and every native box and radio", () => {
    expect(css).toMatch(/\.sel-row\.on, \.sel-row\.on:hover \{ background: var\(--live-bg\); border-color: var\(--live\) \}/);
    expect(css).toMatch(/\.sel-row \{[^}]*border: 2px solid var\(--line\)/);
    expect(css).toMatch(/\.sel-card\[aria-checked="true"\][^{]*\{ border-color: var\(--live\); background: var\(--live-bg\)/);
    expect(css).toMatch(/\.chip\[aria-pressed="true"\], \.chip\[aria-selected="true"\] \{ background: var\(--live-bg\); color: var\(--live\); border: 2px solid var\(--live\)/);
    expect(css).toMatch(/\.chip\[aria-pressed="true"\]::before/);
    expect(css).toMatch(/\.sel-mark\.check\.on::after/);
    expect(css).toMatch(/\.sel-mark\.radio\.on::after/);
    expect(css).toMatch(/input\[type="checkbox"\]:not\(\[role="switch"\]\):not\(\.sel-input\):checked::before/);
    expect(css).toMatch(/input\[type="radio"\]:not\(\.sel-input\):checked::before/);
    expect(css).toMatch(/\.opt:has\(input:checked\) \{ border-color: var\(--live\)[^}]*background: var\(--live-bg\)/);
    expect(css).toMatch(/\.sel-row\.off \{ opacity: \.5; cursor: not-allowed \}/);
    // No picked look that is only a dark fill.
    expect(css).not.toMatch(/\.chip\[aria-pressed="true"\][^{]*\{ background: var\(--ink\)/);
  });

  it("the audited screens use the shared controls", () => {
    expect(src("screens/asks/AskSheet.tsx")).toMatch(/<SelectableRow key=\{c\.username\} selected=/);
    expect(src("screens/asks/AskSheet.tsx")).toMatch(/<ChoiceCard key=\{k\.kind\}/);
    expect(src("screens/asks/AskDrivers.tsx")).toMatch(/<SelectableRow key=\{id\} selected=\{on\}/);
    expect(src("screens/asks/AskDrivers.tsx")).toMatch(/<ChoiceCard key=\{k\.kind\}/);
    expect(src("ui/DriverRow.tsx")).toMatch(/\{onPick && <SelectMark kind="radio" on=\{!!picked\} \/>\}/);
    expect(src("ui/basics.tsx")).toMatch(/<ChoiceChip key=\{k\} selected=\{value === k\}/);
    expect(src("screens/settings/userParts.tsx")).toMatch(/<ChoiceChip key=\{k\} selected=\{current === k\}/);
    expect(src("screens/DwellPicker.tsx")).toMatch(/<ChoiceChip key=\{x\} selected=/); // the Stay sheet's presets
    expect(src("screens/TaskEdit.tsx")).toMatch(/<ChoiceChip key=\{d\.username \?\? d\.name\}/);
    expect(src("screens/TripPurpose.tsx")).toMatch(/<ChoiceChip key=\{p\} selected=\{choice === p\}/);
  });
});
