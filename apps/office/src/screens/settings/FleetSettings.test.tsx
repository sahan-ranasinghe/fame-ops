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
  dwell_min: { default: 10 }, buffer_min: 15, base_place_id: null, avg_speed_kmh: 35, road_factor: 1.3,
  accept_within_min: 15, accept_before_leave_min: 30,
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
  stored: Values = structuredClone(base);
  saves: { key: string; value: unknown }[] = [];
  gets = 0;
  private waiting: (() => void)[] = [];
  constructor(private hold = false) {}
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
});
