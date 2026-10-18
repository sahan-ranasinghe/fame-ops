import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { FleetSettings as Values, SettingsResult } from "../../data/types";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { FleetSettings } from "./FleetSettings";

const base: Values = {
  dwell_min: { pickup: 5, drop: 5, visit: 60, default: 5 }, buffer_min: 15, base_place_id: null, avg_speed_kmh: 35, road_factor: 1.3,
  accept_within_min: 15, accept_before_leave_min: 30, accept_reminder_min: 5,
  rush_hour: { factor: 1.3, centre: { lat: 6.92, lng: 79.86 }, radius_km: 15, bands: [] },
  self_drive_allowed: true, shift_start: "08:00", shift_days: [1, 2, 3, 4, 5],
  fuel_video_checklist: [
    { key: "plate", en: "Number plate", si: "අංක තහඩුව", short: "Plate" },
    { key: "zero", en: "Pump display at zero", si: "පොම්පය 0", short: "Zero" },
    { key: "pumping", en: "Pumping", si: "පුරවමින්", short: "Pumping" },
    { key: "final", en: "Final display", si: "අවසන් ගණන", short: "Final" },
  ],
  fuel_video_quality: "480p", fuel_video_keep_months: 12, ors_autocomplete_daily_cap: 2500, ors_autocomplete_per_minute: 90,
};

/** get_settings answers the stored values; with `hold`, answers after the first wait until released. */
class Settings implements Transport {
  readonly kind = "api" as const;
  stored: Values;
  saves: { key: string; value: unknown }[] = [];
  gets = 0;
  private waiting: (() => void)[] = [];
  constructor(private hold = false, stored: Partial<Values> = {}) {
    this.stored = { ...structuredClone(base), ...stored };
  }
  releaseAll() { for (const r of this.waiting.splice(0)) r(); }
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view", "users"], tools: ["get_settings", "update_settings", "routing_usage"] });
  }
  async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    if (tool === "get_settings") {
      const answer: SettingsResult = { settings: structuredClone(this.stored), defaults: base, about: {}, base_place: null, routing_provider: "estimate" };
      if (this.hold && this.gets++ > 0) await new Promise<void>((r) => this.waiting.push(r));
      return answer as T;
    }
    if (tool === "update_settings") {
      this.saves.push({ key: String(args.key), value: args.value });
      Object.assign(this.stored, { [String(args.key)]: args.value });
      return { ok: true } as T;
    }
    if (tool === "routing_usage") return { provider: "estimate", daily_budget: { ors: 2000 }, days: [] } as T;
    return { places: [] } as T;
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(transport: Settings, strict = false) {
  const me = await transport.me();
  const page = (
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter><FleetSettings /></MemoryRouter>
    </FleetProvider>
  );
  render(strict ? <StrictMode>{page}</StrictMode> : page);
  await waitFor(() => expect(screen.getAllByTestId("checklist-row")).toHaveLength(4));
  return within(screen.getByTestId("checklist-settings"));
}

describe("FleetSettings", () => {
  it("a second answer that lands after Add step (the dev server mounts twice) keeps the new step", async () => {
    const transport = new Settings(true);
    const checklist = await mount(transport, true);
    expect(transport.gets).toBe(2);
    fireEvent.click(checklist.getByRole("button", { name: "Add step" }));
    expect(checklist.getAllByTestId("checklist-row")).toHaveLength(5);
    await act(async () => { transport.releaseAll(); await new Promise((r) => setTimeout(r, 0)); });
    expect(checklist.getAllByTestId("checklist-row")).toHaveLength(5);
  });

  it("saving another setting keeps the unsaved steps; the saved one takes the server's value", async () => {
    const transport = new Settings();
    const checklist = await mount(transport);
    fireEvent.click(checklist.getByRole("button", { name: "Add step" }));
    fireEvent.change(checklist.getByLabelText("Step 5 · English"), { target: { value: "Fuel cap closed" } });
    const buffer = screen.getByLabelText<HTMLInputElement>("Buffer before a deadline (min)");
    fireEvent.change(buffer, { target: { value: "20" } });
    fireEvent.submit(buffer.closest("form")!);
    await waitFor(() => expect(transport.saves).toEqual([{ key: "buffer_min", value: 20 }]));
    await waitFor(() => expect(within(buffer.closest("form")!).getByRole("button", { name: "Save" })).toHaveProperty("disabled", true));
    expect(checklist.getAllByTestId("checklist-row")).toHaveLength(5);
    expect(checklist.getByLabelText<HTMLInputElement>("Step 5 · English").value).toBe("Fuel cap closed");
    expect(checklist.getByRole("button", { name: "Save" })).toHaveProperty("disabled", false);
  });

  it("the accept window card has the reminder beside the two fields and says when a task needs a driver", async () => {
    const transport = new Settings();
    await mount(transport);
    const card = within(screen.getByTestId("accept-settings"));
    expect(card.getByText(/15 min after sending or 30 min before leaving, whichever comes first/)).toBeTruthy();
    expect(card.getByText(/the task needs a driver/)).toBeTruthy();
    expect(card.getByLabelText<HTMLInputElement>("Accept within (min after sending)").value).toBe("15");
    expect(card.getByLabelText<HTMLInputElement>("Accept at the latest (min before leaving)").value).toBe("30");
    const reminder = card.getByLabelText<HTMLInputElement>("Reminder to the driver (min after sending)");
    expect(reminder.value).toBe("5");
    fireEvent.change(reminder, { target: { value: "7" } });
    fireEvent.submit(reminder.closest("form")!);
    await waitFor(() => expect(transport.saves).toEqual([{ key: "accept_reminder_min", value: 7 }]));
  });

  it("driver-started trips (Phase 7, §13): the four values in plain words, saved when one is picked", async () => {
    const transport = new Settings(false, { driver_personal_trips: "allowed" });
    await mount(transport);
    const card = within(screen.getByTestId("personal-trips-settings"));
    const radios = card.getAllByRole<HTMLInputElement>("radio");
    expect(radios.map((r) => r.closest("label")?.textContent?.trim())).toEqual([
      "Allowed: Company work preselected, Personal offered",
      "Personal preselected",
      "Off: no Personal choice",
      "Ask first (not built yet: works as Allowed)",
    ]);
    expect(radios.map((r) => r.checked)).toEqual([true, false, false, false]);
    fireEvent.click(card.getByLabelText("Off: no Personal choice"));
    await waitFor(() => expect(transport.saves).toEqual([{ key: "driver_personal_trips", value: "off" }]));
    await waitFor(() => expect(card.getByLabelText<HTMLInputElement>("Off: no Personal choice").checked).toBe(true));
  });

  it("driver-started trips: an older server with no value shows its default", async () => {
    const transport = new Settings();
    await mount(transport);
    expect(within(screen.getByTestId("personal-trips-settings")).getByLabelText<HTMLInputElement>("Allowed: Company work preselected, Personal offered").checked).toBe(true);
  });

  it("the time at a stop by type, with plain labels; an older kind still stored is named", async () => {
    const transport = new Settings(false, { dwell_min: { pickup: 5, drop: 5, visit: 60, default: 5, "pickup.goods": 15 } });
    await mount(transport);
    const card = within(screen.getByTestId("dwell-settings"));
    expect(card.getByText("A place's usual time and a stop's own time come first", { exact: false })).toBeTruthy();
    expect(["Pickup (min)", "Drop (min)", "Visit (min)", "Any other (min)"].map((l) => card.getByLabelText<HTMLInputElement>(l).value)).toEqual(["5", "5", "60", "5"]);
    expect(card.queryByLabelText("pickup.people")).toBeNull();
    expect(card.getByTestId("dwell-other").textContent).toContain("pickup.goods 15 min");
    fireEvent.change(card.getByLabelText("Visit (min)"), { target: { value: "90" } });
    fireEvent.submit(card.getByLabelText("Visit (min)").closest("form")!);
    await waitFor(() => expect(transport.saves).toEqual([{ key: "dwell_min", value: { pickup: 5, drop: 5, visit: 90, default: 5, "pickup.goods": 15 } }]));
  });

  it("Hotfix 2: the office's number is saved as +94… (refused in words otherwise), and the vehicle on the day is a switch, off by default", async () => {
    const transport = new Settings(false);
    await mount(transport);
    const phone = within(screen.getByTestId("office-phone-settings"));
    expect(phone.getByText("None saved: Call office is not shown.")).toBeTruthy();
    fireEvent.change(phone.getByLabelText("Office phone number"), { target: { value: "011 23" } });
    fireEvent.submit(phone.getByLabelText("Office phone number").closest("form")!);
    expect(phone.getByText("Type a Sri Lankan number, e.g. 077 123 4567.")).toBeTruthy();
    expect(transport.saves).toEqual([]);
    fireEvent.change(phone.getByLabelText("Office phone number"), { target: { value: "011 234 5678" } });
    fireEvent.submit(phone.getByLabelText("Office phone number").closest("form")!);
    await waitFor(() => expect(transport.saves).toEqual([{ key: "office_phone", value: "+94112345678" }]));
    await waitFor(() => expect(phone.getByText("Saved: 011 234 5678")).toBeTruthy());
    expect(phone.getByLabelText<HTMLInputElement>("Office phone number").value).toBe("011 234 5678");

    const day = within(screen.getByTestId("vehicle-on-the-day-settings"));
    const box = day.getByRole("checkbox");
    expect((box as HTMLInputElement).checked).toBe(false);
    expect(day.getByText(/Switch it on only after every driver's phone has the app update/)).toBeTruthy();
    fireEvent.click(box);
    await waitFor(() => expect(transport.saves).toContainEqual({ key: "vehicle_on_the_day", value: true }));
  });
});
