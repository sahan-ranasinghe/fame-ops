// Round 4–7, item 12 (docs/phase8-plan.md §33.13, "Restyle, never rebuild"), the website: the approved mockups' patterns
// (ui/patterns.tsx) and the restyled pages keep their key actions.
//   - the pattern: StatusBanner (the state, its line, its chip, a link when it opens a place); the mockups' other patterns
//     are the site's existing components (docs/ui-patterns.md §17), tested with their screens;
//   - the task page on the way: the banner (on the way to the next stop, arrives about, back about, the late chip, a link
//     to Live with that task's driver), Call / WhatsApp the driver, the holder with Call, the ETA line, the stops, Change the task, Cancel task, Edit
//     stops; a task that needs a driver: the banner with Find a driver, Give it a driver;
//   - the decide page's banner: Waiting for your OK, when it leaves, Call / WhatsApp the person who asked;
//   - the Overview's stats row: each tile keeps its link (?open=…), with its icon.
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { RequestCard, TaskDetail as TaskDetailData } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { Tile } from "../ui/basics";
import { StatusBanner } from "../ui/patterns";
import { ToastProvider } from "../ui/Toast";
import { DecideBanner } from "./requestParts";
import { TaskDetail } from "./TaskDetail";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));

class Detail implements Transport {
  readonly kind = "api" as const;
  constructor(private answer: TaskDetailData, private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  call<T>(tool: string): Promise<T> {
    if (tool === "task_detail") return Promise.resolve(this.answer as T);
    return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
  }
  watch<T>(_t: string, _a: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const dispatcher: Me = {
  name: "Palitha Fernando", role: "office", permissions: ["view", "assign_tasks"],
  tools: ["task_detail", "update_task", "reassign_task", "cancel_task", "update_task_stops"],
};

const onTheWay: TaskDetailData = {
  task: {
    id: "t1", title: "Team drop · Wariyapola", status: "in_progress", start: "08:16", driver: "Kamal Fernando", vehicle: "CAP-2207 · Suzuki Alto",
    driver_phone: { phone: "+94771234567", phone_display: "077 123 4567", call: "tel:+94771234567", whatsapp: "https://wa.me/94771234567" },
    eta: { next_stop: "Wariyapola", next: "10:52", final: "14:30", late_min: 7, as_of: "10:31" },
    holder: { task_id: "t1", name: "Nimali Perera", label: "Office", by: "asked", window: "08:16–14:30", from: "08:16", to: "14:30", phone: "+94770000001", phone_display: "077 000 0001", call: "tel:+94770000001", whatsapp: "https://wa.me/94770000001" },
    started: "08:21",
  },
  stops: [{ seq: 1, type: "visit", place: "Wariyapola Divisional Hospital", status: "pending", progress: { planned_arrive: "10:45", estimate: { arrive: "10:52", updated: "10:31" }, current: true } }],
  projects: "Mobitel MS",
  odometer: [],
  fuel: [],
  vehicle_reports: [],
} as unknown as TaskDetailData;

async function mountTask(answer: TaskDetailData, who: Me = dispatcher) {
  const transport = new Detail(answer, who);
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me: who, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/tasks/t1"]}><Routes><Route path="/tasks/:id" element={<TaskDetail />} /></Routes></MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await screen.findByTestId("task-detail");
}

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

describe("the patterns (ui/patterns.tsx)", () => {
  it("StatusBanner: the state, its line, its chip; a link when it opens a place", () => {
    inRouter(<StatusBanner tone="live" icon="navigation" title="On the way to Wariyapola" line="Arrives about 10:52" chip={{ text: "7 min late", tone: "warn" }} to="/live" />);
    const banner = screen.getByTestId("status-banner");
    expect(banner.tagName).toBe("A");
    expect(banner.getAttribute("href")).toBe("/live");
    expect(banner.className).toContain("live");
    expect(screen.getByTestId("status-banner-title").textContent).toBe("On the way to Wariyapola");
    expect(screen.getByTestId("status-banner-line").textContent).toBe("Arrives about 10:52");
    expect(screen.getByTestId("status-banner-chip").className).toContain("warn");
  });
  it("the Overview's stats row: each tile keeps its link, with its icon and its tone", () => {
    inRouter(<div className="tiles"><Tile label="Vehicles on the road" icon="pin" kind="live" value={2} unit="of 6" sub="2 tasks in progress" link={{ to: "/?open=road" }} /></div>);
    const tile = screen.getByText("Vehicles on the road").closest(".tile") as HTMLElement;
    expect(tile.getAttribute("href")).toBe("/?open=road");
    expect(tile.className).toContain("tone-live");
    expect(tile.querySelector(".lbl svg")).toBeTruthy();
  });
});

describe("the task page on the way (the approved mockup 4)", () => {
  it("the banner, Call and WhatsApp the driver, the holder with Call, the ETA, the stops, Change the task, Cancel task, Edit stops", async () => {
    await mountTask(onTheWay);
    const banner = screen.getByTestId("task-banner");
    expect(within(banner).getByTestId("task-banner-title").textContent).toBe("On the way to Wariyapola");
    expect(within(banner).getByTestId("task-banner-line").textContent).toBe("Arrives about 10:52 · back about 14:30");
    expect(within(banner).getByTestId("task-banner-chip").textContent).toBe("7 min late");
    // Live with the driver on this task selected (the fresh reviewer: it opened /live, not that driver).
    expect(banner.getAttribute("href")).toBe("/live?task=t1");
    expect(screen.getByTestId("call-driver")).toBeTruthy();
    const holder = screen.getByTestId("task-holder");
    expect(holder.textContent).toContain("Asked for by");
    expect(within(holder).getByTestId("holder-name").textContent).toContain("Nimali Perera");
    expect(within(holder).queryByTestId("holder-ask")).toBeNull();
    expect(within(holder).getByTestId("holder-contact")).toBeTruthy();
    expect(screen.getByTestId("eta")).toBeTruthy();
    expect(screen.getAllByTestId("task-stop")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Change the task" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Cancel task" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Edit stops" })).toBeTruthy();
  });

  it("a task that needs a driver: the banner says so with Find a driver; Give it a driver", async () => {
    await mountTask({ ...onTheWay, task: { ...onTheWay.task, status: "declined", eta: undefined, needs_driver: { since: "Fri 16 Oct 08:40", reason: "declined", reason_text: "Vehicle problem" } } } as TaskDetailData);
    const banner = screen.getByTestId("task-banner");
    expect(banner.className).toContain("bad");
    expect(within(banner).getByTestId("needs-driver-line").textContent).toContain("Needs a driver since");
    expect(within(banner).getByRole("link", { name: "Find a driver" }).getAttribute("href")).toBe("/tasks/t1/edit?driver=1");
    expect(screen.getAllByRole("link", { name: "Give it a driver" }).length).toBeGreaterThan(0);
  });
});

describe("the decide page's banner (the approved mockup 3)", () => {
  it("Waiting for your OK, when it leaves, Call and WhatsApp the person who asked", () => {
    const q = { id: "r1", requested_by: "Requester Test", when: "Fri 23 Oct 09:29", status: "waiting", requester_phone: "+94771234567", fields: { date: "2026-10-23", time: "09:29" } } as RequestCard;
    render(<ToastProvider><MemoryRouter><DecideBanner q={q} /></MemoryRouter></ToastProvider>);
    const banner = screen.getByTestId("decide-banner");
    expect(banner.className).toContain("warn");
    expect(within(banner).getByTestId("decide-banner-title").textContent).toBe("Waiting for your OK");
    expect(within(banner).getByTestId("decide-banner-line").textContent).toContain("Leaves 09:29");
    expect(within(banner).getByTestId("requester-contact")).toBeTruthy();
  });
});
