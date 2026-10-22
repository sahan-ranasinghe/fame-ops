// Round 4–7, item 9: Settings → Data retention. The table of periods (the minimum shown and checked before Save, the whole
// setting sent with the one change), fuel videos' months on the same page, "Never removed", and Run now: the preview first
// (counts, nothing removed), the second press runs run_retention {confirm: true} and shows its line.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { StrictMode } from "react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { RetentionDays, RetentionPreview, RetentionRun } from "../../data/types";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import DataRetention from "./DataRetention";
import SettingsHome from "./SettingsHome";
import { daysInput, MINIMUMS_FALLBACK, minimumOf, nightlyTime, periodsOf, previewLines, RETENTION_DEFAULTS, RETENTION_ROWS, removeLabel, withPeriod } from "./retentionLogic";

const admin: Me = {
  name: "Sahan Ranasinghe", email: "sahan@fame.test", role: "admin", permissions: ["view", "users"],
  tools: ["get_settings", "update_settings", "retention_preview", "run_retention"],
};

const NEVER = ["tasks and their stops", "requests", "odometer and fuel logs and their photos", "vehicle reports", "vehicle documents", "employees", "vehicles", "places", "projects", "duty sessions (attendance)"];

function preview(stored: RetentionDays, counts: Record<string, number>): RetentionPreview {
  const rules = [
    { key: "inbox_read", what: "read notifications", days: stored.inbox_read_days },
    { key: "location_points", what: "location points (each day kept as a summary)", days: stored.location_days },
    { key: "heartbeats", what: "phone heartbeats", days: stored.heartbeats_days },
  ].map((r) => ({ ...r, before: "2026-09-22", count: counts[r.key] ?? 0 }));
  return { periods: stored, minimums: { location_days: 30, audit_changes_days: 183 }, rules, would_remove: rules.reduce((s, r) => s + r.count, 0), never: NEVER, nightly: "02:45 Colombo", kinds: 14 };
}

class Fake implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  stored: RetentionDays;
  fuel: 6 | 12 = 12;
  counts: Record<string, number>;
  constructor(stored: Partial<RetentionDays> = {}, counts: Record<string, number> = { inbox_read: 312, location_points: 4210 }) {
    this.stored = { ...RETENTION_DEFAULTS, ...stored };
    this.counts = counts;
  }
  me(): Promise<Me> {
    return Promise.resolve(admin);
  }
  of(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  async call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    if (tool === "get_settings") return structuredClone({ settings: { retention: this.stored, fuel_video_keep_months: this.fuel }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }) as T;
    if (tool === "retention_preview") return structuredClone(preview(this.stored, this.counts)) as T;
    if (tool === "run_retention") {
      const p = preview(this.stored, this.counts);
      const run: RetentionRun = { line: "Removed 312 read notifications older than 30 days; 4,210 location points (each day kept as a summary) older than 183 days", counts: p.rules, summarised: 12 };
      this.counts = {};
      return run as T;
    }
    if (tool === "update_settings") {
      if (args.key === "retention") this.stored = args.value as RetentionDays;
      if (args.key === "fuel_video_keep_months") this.fuel = args.value as 6 | 12;
      return { key: args.key, value: args.value } as T;
    }
    throw { code: "not_found", message: tool };
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => undefined;
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function mount(t: Fake, me: Me = admin, strict = false) {
  const page = (
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider><MemoryRouter initialEntries={["/settings/retention"]}><Routes><Route path="/settings/retention" element={<DataRetention />} /></Routes></MemoryRouter></ToastProvider>
    </FleetProvider>
  );
  render(strict ? <StrictMode>{page}</StrictMode> : page);
}

const row = (key: string) => within(screen.getByTestId(`retention-row-${key}`));

describe("retention rules", () => {
  it("the minimums: shown, and nothing under them is saved", () => {
    expect(minimumOf("location_days", null)).toBe(30);
    expect(minimumOf("audit_changes_days", { audit_changes_days: 183 })).toBe(183);
    expect(minimumOf("inbox_read_days", MINIMUMS_FALLBACK)).toBe(1);
    expect(daysInput("20", 30)).toEqual({ error: "At least 30 days." });
    expect(daysInput("", 1)).toEqual({ error: "Type a number of days." });
    expect(daysInput("4000", 1)).toEqual({ error: "At most 3,650 days." });
    expect(daysInput(" 45 ", 30)).toEqual({ days: 45 });
  });
  it("one change keeps every other period as saved (the server stores what it is sent over its defaults)", () => {
    const saved = periodsOf({ inbox_read_days: 60 });
    expect(withPeriod(saved, "location_days", 90)).toEqual({ ...RETENTION_DEFAULTS, inbox_read_days: 60, location_days: 90 });
    expect(Object.keys(withPeriod(saved, "location_days", 90)).sort()).toEqual(RETENTION_ROWS.map((r) => r.key).sort());
  });
  it("the preview's lines and the second press's words; the nightly time", () => {
    const p = preview(RETENTION_DEFAULTS, { inbox_read: 312, location_points: 4210 });
    expect(previewLines(p).lines.map((l) => l.key)).toEqual(["inbox_read", "location_points"]);
    expect(removeLabel(previewLines(p).total)).toBe("Remove 4,522 now");
    expect(nightlyTime("02:45 Colombo")).toBe("02:45");
    expect(nightlyTime(undefined)).toBe("02:45");
  });
});

describe("Settings → Data retention", () => {
  it("the table: each kind kept, its minimum, what the next run removes; fuel videos; never removed; the nightly time", async () => {
    const t = new Fake({ inbox_read_days: 60 });
    mount(t);
    await screen.findByTestId("retention-table");
    await waitFor(() => expect(screen.getByText(/Never removed:/)).toBeTruthy());
    expect(screen.getAllByRole("row")).toHaveLength(RETENTION_ROWS.length + 2);
    expect((row("inbox_read_days").getByLabelText("Read notifications: days kept") as HTMLInputElement).value).toBe("60");
    expect(row("location_days").getByText("At least 30 days")).toBeTruthy();
    expect(row("audit_changes_days").getByText("At least 183 days")).toBeTruthy();
    expect(row("inbox_read_days").queryByText(/At least/)).toBeNull();
    expect(row("location_days").getByText(/Each driver's day stays as a summary/)).toBeTruthy();
    expect(row("inbox_read_days").getByText(/^Before /)).toBeTruthy();
    expect((row("fuel").getByLabelText("Fuel videos: months kept") as HTMLSelectElement).value).toBe("12");
    expect(screen.getByText(/tasks and their stops, requests/)).toBeTruthy();
    expect(screen.getByTestId("data-retention").textContent).toContain("every night at 02:45");
    // Opening the page removes nothing.
    expect(t.of("run_retention")).toHaveLength(0);
  });

  it("a period under its minimum is not saved; a valid one sends the whole setting with the one change", async () => {
    const t = new Fake({ inbox_read_days: 60 });
    mount(t);
    await screen.findByTestId("retention-table");
    const input = row("location_days").getByLabelText("Location points: days kept");
    fireEvent.change(input, { target: { value: "20" } });
    expect(row("location_days").getByRole("alert").textContent).toBe("At least 30 days.");
    expect((row("location_days").getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input, { target: { value: "90" } });
    expect(row("location_days").queryByRole("alert")).toBeNull();
    fireEvent.click(row("location_days").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(t.of("update_settings")).toHaveLength(1));
    expect(t.of("update_settings")[0]).toEqual({ key: "retention", value: { location_days: 90 } });
    await waitFor(() => expect(row("location_days").queryByRole("button", { name: "Save" })).toBeNull());
    expect((row("location_days").getByLabelText("Location points: days kept") as HTMLInputElement).value).toBe("90");
  });

  it("fuel videos' months are saved as their own setting", async () => {
    const t = new Fake();
    mount(t);
    await screen.findByTestId("retention-table");
    await waitFor(() => expect((row("fuel").getByLabelText("Fuel videos: months kept") as HTMLSelectElement).disabled).toBe(false));
    fireEvent.change(row("fuel").getByLabelText("Fuel videos: months kept"), { target: { value: "6" } });
    await waitFor(() => expect(t.of("update_settings")).toEqual([{ key: "fuel_video_keep_months", value: 6 }]));
  });

  it("Run now: the preview first (nothing removed), then Remove N now runs it and shows the line", async () => {
    const t = new Fake();
    mount(t);
    await screen.findByTestId("retention-table");
    const card = within(screen.getByTestId("retention-run"));
    const previewsBefore = t.of("retention_preview").length;
    fireEvent.click(card.getByRole("button", { name: "Run now" }));
    await card.findByTestId("retention-preview");
    expect(t.of("retention_preview").length).toBe(previewsBefore + 1);
    expect(t.of("run_retention")).toHaveLength(0);
    expect(card.getAllByTestId("retention-preview-line").map((l) => l.textContent)).toEqual([
      "312 read notifications older than 30 days",
      "4,210 location points (each day kept as a summary) older than 183 days",
    ]);
    fireEvent.click(card.getByRole("button", { name: "Remove 4,522 now" }));
    await card.findByTestId("retention-result");
    expect(t.of("run_retention")).toEqual([{ confirm: true }]);
    expect(card.getByTestId("retention-result").textContent).toContain("Removed 312 read notifications older than 30 days");
    expect(card.getByText(/12 driver days kept as summaries/)).toBeTruthy();
  });

  it("Run now with nothing old enough: says so, and offers no Remove", async () => {
    const t = new Fake({}, {});
    mount(t);
    await screen.findByTestId("retention-table");
    const card = within(screen.getByTestId("retention-run"));
    fireEvent.click(card.getByRole("button", { name: "Run now" }));
    await card.findByTestId("retention-nothing");
    expect(card.queryByTestId("retention-remove")).toBeNull();
    expect(t.of("run_retention")).toHaveLength(0);
  });

  // The fresh reviewer (22 October 2026): React's StrictMode (npm run dev, Playwright's web server) mounts the page, unmounts
  // it and mounts it again; the "still mounted" flag must be true again after that, or every answer is dropped.
  it("under StrictMode: Run now comes back from Checking…, Remove from Removing…, and Save from Saving…", async () => {
    const t = new Fake({ inbox_read_days: 60 });
    mount(t, admin, true);
    await screen.findByTestId("retention-table");
    const card = within(screen.getByTestId("retention-run"));
    fireEvent.click(card.getByRole("button", { name: "Run now" }));
    await card.findByTestId("retention-preview");
    expect(card.queryByText("Checking…")).toBeNull();
    fireEvent.click(card.getByRole("button", { name: "Remove 4,522 now" }));
    await card.findByTestId("retention-result");
    expect(card.queryByText("Removing…")).toBeNull();
    expect(t.of("run_retention")).toEqual([{ confirm: true }]);
    fireEvent.change(row("location_days").getByLabelText("Location points: days kept"), { target: { value: "90" } });
    fireEvent.click(row("location_days").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(t.of("update_settings")).toEqual([{ key: "retention", value: { location_days: 90 } }]));
    await waitFor(() => expect(row("location_days").queryByRole("button", { name: /Sav/ })).toBeNull());
    expect(screen.queryByText("Saving…")).toBeNull();
    expect((row("location_days").getByLabelText("Location points: days kept") as HTMLInputElement).value).toBe("90");
  });

  it("without update_settings the periods are read; without the run tools there is no Run now", async () => {
    const t = new Fake();
    mount(t, { ...admin, tools: ["get_settings"] });
    await screen.findByTestId("retention-table");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(row("location_days").getByText("183 days")).toBeTruthy();
    expect(screen.queryByTestId("retention-run")).toBeNull();
  });
});

describe("Settings home: the Data retention row (users only), every other row kept", () => {
  const links = () => screen.getAllByRole("link").map((a) => [a.textContent?.replace(/(Data retention|Users|Fleet|App errors|Activity log|My profile|Import sites|Notifications).*/, "$1"), a.getAttribute("href")]);
  function home(me: Me) {
    const t = new Fake();
    render(
      <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
        <MemoryRouter><SettingsHome /></MemoryRouter>
      </FleetProvider>,
    );
  }
  it("with users: Data retention beside My profile, Users, Fleet, App errors, Activity log and Notifications", () => {
    home(admin);
    expect(links()).toEqual([
      ["My profile", "/settings/profile"], ["Users", "/settings/users"], ["Fleet", "/settings/fleet"], ["App errors", "/settings/app-errors"],
      ["Activity log", "/settings/activity"], ["Data retention", "/settings/retention"], ["Notifications", "/settings/notifications"],
    ]);
    expect(screen.getByText(/How long notifications, the activity log, locations/)).toBeTruthy();
  });
  it("without users: no Data retention", () => {
    home({ ...admin, permissions: ["view", "approve"], tools: [] });
    expect(links().map(([, href]) => href)).toEqual(["/settings/profile", "/settings/notifications"]);
  });
});
