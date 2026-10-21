// Round 3: the driver picker (the driver-first cards with a search, in the shared sheet) and the one-line driver card.
import { fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import type { AvailableDriver } from "../data/types";
import { DriverPicker } from "./DriverPicker";
import { driverOptions, filterOptions } from "./driverPickerLogic";
import { DriverLine } from "./DriverRow";
import { vehicleChipWords } from "./driverRowLogic";

const row = (name: string, username: string, extra: Partial<AvailableDriver> = {}): AvailableDriver => ({
  name, username, state: "on_duty", status_text: "On duty since 07:12", accepted_today: 0, declined_today: 0, licence: { chip: "ok" }, free: true, ...extra,
});

describe("the picker's list (Round 3)", () => {
  it("Who's available's rows first in the best-match order, then the list's others, the free drivers, the one picked", () => {
    const opts = driverOptions({
      avail: [row("Kamal Perera", "kamal.p", { rank: 2 }), row("Ruwan Jaya", "ruwan.j", { free: false }), row("Nuwan Silva", "nuwan.s", { rank: 1, vehicle: { reg_no: "WP KL-1234", source: "regular" } })],
      list: [{ name: "Kamal Perera", username: "kamal.p" }, { name: "Sunil Fernando", username: "sunil.f", current_vehicle: "WP PH-2087 · Toyota Axio" }, { name: "Old", username: "old", active: false }],
      free: [{ name: "Ama Silva", username: "ama.s", photo_url: "https://x/ama.jpg" }],
      picked: "linked.d",
      pickedName: "Linked Driver",
    });
    expect(opts.map((o) => o.username)).toEqual(["nuwan.s", "kamal.p", "ruwan.j", "sunil.f", "ama.s", "linked.d"]);
    expect(opts[0]).toMatchObject({ vehicle: { reg_no: "WP KL-1234", source: "regular" }, fit: { text: "Free", free: true } });
    expect(opts[2].fit).toEqual({ text: "Busy", free: false });
    expect(opts[3].vehicle).toEqual({ reg_no: "WP PH-2087", source: "on_duty" });
    expect(opts[5]).toEqual({ username: "linked.d", name: "Linked Driver" });
  });

  it("the search: name, username or plate (spaces and dashes ignored)", () => {
    const opts = driverOptions({ list: [{ name: "Kamal Perera", username: "kamal.p", current_vehicle: "WP CAB-4521" }, { name: "Nuwan Silva", username: "nuwan.s" }] });
    expect(filterOptions(opts, "nuw").map((o) => o.username)).toEqual(["nuwan.s"]);
    expect(filterOptions(opts, "cab4521").map((o) => o.username)).toEqual(["kamal.p"]);
    expect(filterOptions(opts, "kamal.p").map((o) => o.username)).toEqual(["kamal.p"]);
    expect(filterOptions(opts, " ")).toHaveLength(2);
  });
});

function Picker({ start = "", emptyChoice, onTheDay }: { start?: string; emptyChoice?: string; onTheDay?: boolean }) {
  const [v, setV] = useState(start);
  const options = driverOptions({
    avail: [row("Kamal Perera", "kamal.p", { vehicle: { reg_no: "WP CAB-4521", source: "on_duty" } }), row("Nuwan Silva", "nuwan.s", { free: false })],
  });
  return <DriverPicker id="p" value={v} options={options} onChange={setV} emptyLabel="Choose a driver" emptyChoice={emptyChoice} onTheDay={onTheDay} />;
}

describe("the driver picker (Round 3)", () => {
  it("the field shows the driver picked as the card; a click opens the cards with a search; a card picks and closes", () => {
    render(<Picker />);
    const field = screen.getByLabelText("Driver");
    expect(field.tagName).toBe("BUTTON");
    expect(field.getAttribute("data-value")).toBe("");
    expect(field.textContent).toContain("Choose a driver");

    fireEvent.click(field);
    const sheet = screen.getByTestId("driver-sheet");
    const cards = within(sheet).getAllByTestId("driver-option");
    expect(cards.map((c) => c.querySelector(".name")?.textContent)).toEqual(["Kamal Perera", "Nuwan Silva"]);
    // Each card: the status, the vehicle chip under the name, Free or Busy.
    expect(within(cards[0]).getByTestId("vehicle-chip").textContent).toBe("WP CAB-4521");
    expect(within(cards[1]).getByTestId("vehicle-chip").textContent).toBe("No vehicle yet");
    expect(cards[1].textContent).toContain("Busy");

    fireEvent.change(within(sheet).getByLabelText("Search drivers"), { target: { value: "nuw" } });
    fireEvent.keyDown(within(sheet).getByLabelText("Search drivers"), { key: "Enter" });
    expect(within(sheet).getAllByTestId("driver-option")).toHaveLength(1);
    fireEvent.click(within(sheet).getByTestId("driver-option"));
    expect(screen.queryByTestId("driver-sheet")).toBeNull();
    expect(field.getAttribute("data-value")).toBe("nuwan.s");
    expect(within(field).getByTestId("driver-picked").textContent).toContain("Nuwan Silva");
  });

  it("Keep goes back to none; with vehicle_on_the_day on a driver with none known reads Vehicle: on the day", () => {
    render(<Picker start="kamal.p" emptyChoice="Keep (Kamal Perera)" onTheDay />);
    const field = screen.getByLabelText("Driver");
    fireEvent.click(field);
    const sheet = screen.getByTestId("driver-sheet");
    expect(within(within(sheet).getAllByTestId("driver-option")[1]).getByTestId("vehicle-chip").textContent).toBe("Vehicle: on the day");
    fireEvent.click(within(sheet).getByRole("button", { name: "Keep (Kamal Perera)" }));
    expect(field.getAttribute("data-value")).toBe("");
  });

  it("the one-line card: someone else has no photo and says so; the vehicle chip under the name", () => {
    render(
      <>
        <DriverLine name="Nimal Silva" photo="https://x/n.jpg" drivenBy="other" vehicle={vehicleChipWords("WP CAB-4521")} testId="a" />
        <DriverLine name="Sahan Ranasinghe" drivenBy="self" vehicle={vehicleChipWords(null, { text: "Vehicle: on the day" })} testId="b" />
      </>,
    );
    const a = screen.getByTestId("a");
    expect(a.querySelector("img")).toBeNull();
    expect(within(a).getByTestId("driven-by").textContent).toBe("Someone else");
    expect(within(a).getByTestId("vehicle-chip").textContent).toBe("WP CAB-4521");
    expect(within(screen.getByTestId("b")).getByTestId("driven-by").textContent).toBe("Drives themselves");
    expect(within(screen.getByTestId("b")).getByTestId("vehicle-chip").textContent).toBe("Vehicle: on the day");
  });
});
