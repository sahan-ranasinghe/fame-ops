// Round 52 (docs/phase8-plan.md §40) on the pages: Archive with the trips from today on (needs_confirm lists them, each a link
// to its task, Archive anyway sends confirm true, Keep closes), Delete permanently (can_delete first: history = the words and
// no button; a person or a vehicle only after typing the name or plate; one confirm for the others), "Delete…" for a wrong
// entry (the preview's label and what goes with it, a required reason), Recently deleted (the rows, Restore, a refusal in
// the server's words), Rental companies and the projects list. Every control only with its tool.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { applyFilter } from "../../test/controls";
import { ToastProvider } from "../../ui/Toast";
import { DriverManage } from "../DriverManage";
import IssuePage from "../IssuePage";
import { Projects } from "../Projects";
import RentalCompaniesPage from "../settings/RentalCompanies";
import { UserManage } from "../settings/UserManage";
import { VehicleDetail } from "../VehicleDetail";
import { DeleteEntryButton, DeleteRecordCard } from "./BinParts";
import RecentlyDeleted from "./RecentlyDeleted";

type Answer = (args: Record<string, unknown>, n: number) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(private answers: Record<string, Answer>, private person: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.person);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    try {
      return Promise.resolve(structuredClone(a(args, this.argsOf(tool).length)) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

/** A refusal as the server sends it (409, the tool said no). */
const refuse = (message: string) => {
  throw { code: "tool_error", message };
};

const ADMIN_TOOLS = [
  "list_drivers", "set_driver_active", "list_office_users", "set_office_user_active", "update_office_user", "can_delete", "delete_record",
  "delete_entry", "list_bin", "restore_bin_item", "list_rental_companies", "set_rental_company_archived", "add_rental_company",
  "list_projects", "set_project_archived", "find_project", "issue_history", "update_issue",
];
const admin: Me = {
  name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: ["view", "request", "vehicles", "users", "office_users", "approve", "assign_tasks", "issues"], tools: ADMIN_TOOLS,
};

function Where() {
  const { pathname, search } = useLocation();
  return <div data-testid="where">{pathname + search}</div>;
}

const settle = () => act(async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); });

async function mount(t: FakeTransport, me: Me, routes: ReactNode, url: string) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>{routes}<Route path="*" element={<Where />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
}

const toastText = () => document.getElementById("toast")?.textContent ?? "";

describe("Delete permanently (DeleteRecordCard)", () => {
  const page = (kind: "vehicle" | "project", ref: string) => <Route path="/x" element={<DeleteRecordCard kind={kind} refValue={ref} fallback="/vehicles" />} />;

  it("a record with history shows the words and no Delete button", async () => {
    const t = new FakeTransport({
      can_delete: () => ({ kind: "vehicle", id: "v1", label: "WP CAB-4521", deletable: false, history: { tasks: 3, fuel: 2 }, history_words: "3 tasks, 2 fills" }),
    }, admin);
    await mount(t, admin, page("vehicle", "WP CAB-4521"), "/x");
    expect(t.argsOf("can_delete")).toEqual([{ kind: "vehicle", ref: "WP CAB-4521" }]);
    expect(screen.getByTestId("delete-blocked").textContent).toBe("Has history (3 tasks, 2 fills): archive instead");
    expect(screen.queryByTestId("delete-permanently")).toBeNull();
  });

  it("a vehicle: Delete permanently waits until the plate is typed, then deletes, says so and goes back", async () => {
    const t = new FakeTransport({
      can_delete: () => ({ kind: "vehicle", id: "v1", label: "WP CAB-4521", deletable: true, confirm_with: "WP CAB-4521" }),
      delete_record: () => ({ deleted: "WP CAB-4521", kind: "vehicle", bin_id: "b1", until: "2025-12-30" }),
    }, admin);
    await mount(t, admin, page("vehicle", "WP CAB-4521"), "/x");
    fireEvent.click(screen.getByTestId("delete-permanently"));
    const sheet = screen.getByTestId("delete-record-sheet");
    expect(within(sheet).getByLabelText("Type the plate WP CAB-4521 to confirm")).toBeTruthy();
    const confirm = within(sheet).getByTestId("delete-record-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(sheet).getByTestId("delete-type"), { target: { value: "WP CAB-452" } });
    expect(confirm.disabled).toBe(true);
    expect(within(sheet).getByTestId("delete-type-why").textContent).toBe("That is not the plate yet.");
    fireEvent.change(within(sheet).getByTestId("delete-type"), { target: { value: "wp cab4521" } });
    expect(confirm.disabled).toBe(false);
    await act(async () => { fireEvent.click(confirm); });
    await settle();
    expect(t.argsOf("delete_record")).toEqual([{ kind: "vehicle", ref: "WP CAB-4521", confirm_text: "wp cab4521" }]);
    expect(toastText()).toBe("Deleted · in Recently deleted until Tue 30 Dec 2025");
    expect(screen.getByTestId("where").textContent).toBe("/vehicles");
  });

  it("a row's Delete asks can_delete only when pressed; one with history says why in the sheet, with no Delete", async () => {
    const t = new FakeTransport({
      can_delete: () => ({ kind: "project", id: "p1", label: "TRKAN1", deletable: false, history: { tasks: 1 }, history_words: "1 task" }),
    }, admin);
    await mount(t, admin, <Route path="/x" element={<DeleteRecordCard compact kind="project" refValue="p1" fallback="/projects" />} />, "/x");
    expect(t.argsOf("can_delete")).toEqual([]);
    fireEvent.click(screen.getByTestId("delete-permanently"));
    await settle();
    const sheet = screen.getByTestId("delete-record-sheet");
    expect(within(sheet).getByTestId("delete-blocked").textContent).toBe("Has history (1 task): archive instead");
    expect(within(sheet).queryByTestId("delete-record-confirm")).toBeNull();
  });

  it("a place or a project: one confirm, nothing to type", async () => {
    const t = new FakeTransport({
      can_delete: () => ({ kind: "project", id: "p1", label: "TRKAN1", deletable: true }),
      delete_record: () => ({ deleted: "TRKAN1", kind: "project", bin_id: "b1", until: "2025-12-30" }),
    }, admin);
    await mount(t, admin, page("project", "p1"), "/x");
    fireEvent.click(screen.getByTestId("delete-permanently"));
    const sheet = screen.getByTestId("delete-record-sheet");
    expect(within(sheet).queryByTestId("delete-type")).toBeNull();
    await act(async () => { fireEvent.click(within(sheet).getByTestId("delete-record-confirm")); });
    expect(t.argsOf("delete_record")).toEqual([{ kind: "project", ref: "p1" }]);
  });

  it("nothing without can_delete (a fleet admin never deletes a record)", async () => {
    const fleetAdmin = { ...admin, permissions: ["view", "vehicles", "approve"], tools: ["delete_entry"] } as Me;
    const t = new FakeTransport({}, fleetAdmin);
    await mount(t, fleetAdmin, page("vehicle", "WP CAB-4521"), "/x");
    expect(screen.queryByTestId("delete-record")).toBeNull();
    expect(t.calls).toEqual([]);
  });
});

describe("Delete… on a wrong entry (DeleteEntryButton)", () => {
  const mountButton = (t: FakeTransport, me = admin) =>
    mount(t, me, <Route path="/fuel/f1" element={<DeleteEntryButton kind="fuel" id="f1" fallback="/fuel" />} />, "/fuel/f1");

  it("shows what it is and what goes with it, needs a reason, then deletes and goes back", async () => {
    const t = new FakeTransport({
      delete_entry: (a) => a.preview
        ? { kind: "fuel", id: "f1", label: "Fill · WP CAB-4521 · 40 L · 2025-12-29 08:10", affects: ["its receipt photo", "its video", "the month's fuel totals change"] }
        : { deleted: "Fill", kind: "fuel", bin_id: "b1", until: "2025-12-30", affects: [] },
    }, admin);
    await mountButton(t);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete…" })); });
    await settle();
    const sheet = screen.getByTestId("delete-entry-sheet");
    expect(t.argsOf("delete_entry")[0]).toEqual({ kind: "fuel", id: "f1", preview: true });
    expect(within(sheet).getByTestId("delete-entry-label").textContent).toContain("Fill · WP CAB-4521 · 40 L");
    expect(within(sheet).getByTestId("delete-entry-affects").textContent).toContain("its receipt photo");
    expect(within(sheet).getByTestId("delete-entry-affects").textContent).toContain("the month's fuel totals change");
    const del = within(sheet).getByTestId("delete-entry-confirm") as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    fireEvent.change(within(sheet).getByTestId("delete-entry-reason"), { target: { value: "ab" } });
    expect(del.disabled).toBe(true);
    expect(within(sheet).getByTestId("delete-entry-why")).toBeTruthy();
    fireEvent.change(within(sheet).getByTestId("delete-entry-reason"), { target: { value: " Logged twice " } });
    expect(del.disabled).toBe(false);
    await act(async () => { fireEvent.click(del); });
    await settle();
    expect(t.argsOf("delete_entry").at(-1)).toEqual({ kind: "fuel", id: "f1", reason: "Logged twice" });
    expect(toastText()).toBe("Deleted · in Recently deleted until Tue 30 Dec 2025");
    expect(screen.getByTestId("where").textContent).toBe("/fuel");
  });

  it("a refused preview (a task under way) says the server's sentence and Delete stays off", async () => {
    const t = new FakeTransport({ delete_entry: () => refuse("That task is under way: it can be deleted once it is finished or cancelled.") }, admin);
    await mountButton(t);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete…" })); });
    await settle();
    const sheet = screen.getByTestId("delete-entry-sheet");
    expect(sheet.textContent).toContain("That task is under way");
    expect((within(sheet).getByTestId("delete-entry-confirm") as HTMLButtonElement).disabled).toBe(true);
  });

  it("no Delete… without delete_entry (the Coordinator)", async () => {
    const coordinator = { ...admin, permissions: ["view", "assign_tasks"], tools: [] } as Me;
    await mountButton(new FakeTransport({}, coordinator), coordinator);
    expect(screen.queryByRole("button", { name: "Delete…" })).toBeNull();
  });
});

describe("a driver's Archive (DriverManage)", () => {
  const KAMAL = { name: "Kamal Perera", username: "kamal", code: "D01", active: true };
  const TRIPS = [{ task_id: "t1", title: "Team drop · Kandy", when: "2025-12-30 09:00" }];

  it("lists the trips from today on, each opening its task; Archive anyway sends confirm; then back with the toast", async () => {
    const t = new FakeTransport({
      list_drivers: () => ({ count: 1, drivers: [KAMAL] }),
      set_driver_active: (a) => a.confirm ? { driver: "Kamal Perera", active: false } : { needs_confirm: true, driver: "Kamal Perera", username: "kamal", trips: TRIPS, note: "…" },
      can_delete: () => ({ kind: "driver", id: "e1", label: "Kamal Perera", deletable: false, history_words: "3 tasks" }),
    }, admin);
    await mount(t, admin, <Route path="/drivers/:username/edit" element={<DriverManage />} />, "/drivers/kamal/edit");
    const box = screen.getByTestId("driver-archive");
    fireEvent.click(within(box).getByRole("button", { name: "Archive" }));
    expect(box.textContent).toContain("Archive Kamal Perera?");
    expect(box.textContent).toContain("They can no longer sign in");
    expect(t.argsOf("set_driver_active")).toEqual([]);
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Yes, archive" })); });
    await settle();
    expect(t.argsOf("set_driver_active")).toEqual([{ username: "kamal", active: false }]);
    const trips = screen.getByTestId("archive-trips");
    expect(within(trips).getByRole("link").getAttribute("href")).toBe("/tasks/t1");
    expect(trips.textContent).toBe("Tue 30 Dec 2025 09:00 · Team drop · Kandy");
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Archive anyway" })); });
    await settle();
    expect(t.argsOf("set_driver_active").at(-1)).toEqual({ username: "kamal", active: false, confirm: true });
    expect(toastText()).toBe("Kamal Perera archived");
    expect(screen.getByTestId("where").textContent).toBe("/drivers");
  });

  it("Keep closes the trips step without archiving; a driver with history has no Delete permanently", async () => {
    const t = new FakeTransport({
      list_drivers: () => ({ count: 1, drivers: [KAMAL] }),
      set_driver_active: () => ({ needs_confirm: true, trips: TRIPS }),
      can_delete: () => ({ kind: "driver", id: "e1", label: "Kamal Perera", deletable: false, history_words: "3 tasks" }),
    }, admin);
    await mount(t, admin, <Route path="/drivers/:username/edit" element={<DriverManage />} />, "/drivers/kamal/edit");
    const box = screen.getByTestId("driver-archive");
    fireEvent.click(within(box).getByRole("button", { name: "Archive" }));
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Yes, archive" })); });
    await settle();
    fireEvent.click(within(box).getByRole("button", { name: "Keep" }));
    expect(screen.queryByTestId("archive-trips")).toBeNull();
    expect(within(box).getByRole("button", { name: "Archive" })).toBeTruthy();
    expect(t.argsOf("set_driver_active")).toHaveLength(1);
    expect(screen.getByTestId("delete-blocked").textContent).toBe("Has history (3 tasks): archive instead");
    expect(screen.queryByTestId("delete-permanently")).toBeNull();
  });

  it("an archived driver: Restore, and Delete permanently after typing the name", async () => {
    const t = new FakeTransport({
      list_drivers: () => ({ count: 1, drivers: [{ ...KAMAL, active: false }] }),
      set_driver_active: () => ({ driver: "Kamal Perera", active: true }),
      can_delete: () => ({ kind: "driver", id: "e1", label: "Kamal Perera", deletable: true, confirm_with: "Kamal Perera" }),
      delete_record: () => ({ deleted: "Kamal Perera", kind: "driver", bin_id: "b1", until: "2025-12-30" }),
    }, admin);
    await mount(t, admin, <Route path="/drivers/:username/edit" element={<DriverManage />} />, "/drivers/kamal/edit");
    expect(within(screen.getByTestId("driver-archive")).getByRole("button", { name: "Restore" })).toBeTruthy();
    fireEvent.click(screen.getByTestId("delete-permanently"));
    const sheet = screen.getByTestId("delete-record-sheet");
    fireEvent.change(within(sheet).getByTestId("delete-type"), { target: { value: "kamal  perera" } });
    await act(async () => { fireEvent.click(within(sheet).getByTestId("delete-record-confirm")); });
    await settle();
    expect(t.argsOf("delete_record")).toEqual([{ kind: "driver", ref: "kamal", confirm_text: "kamal  perera" }]);
    expect(screen.getByTestId("where").textContent).toBe("/drivers");
  });
});

describe("a vehicle's Archive (the vehicle page)", () => {
  const VAN = { reg_no: "WP CAB-4521", make_model: "Toyota HiAce", status: "Available", km_this_month: 0, documents: {} };
  it("booked from today on: the trips, Archive anyway with confirm, then back to the list; history = no Delete", async () => {
    const vehicleAdmin = { ...admin, tools: [...ADMIN_TOOLS, "list_vehicles", "set_vehicle_active"] } as Me;
    let active = true;
    const t = new FakeTransport({
      list_vehicles: (a) => ({ vehicles: a.filter === "inactive" ? (active ? [] : [{ ...VAN, active: false }]) : active ? [VAN] : [], counts: {} }),
      set_vehicle_active: (a) => {
        if (!a.active && !a.confirm) return { needs_confirm: true, vehicle: "WP CAB-4521", trips: [{ task_id: "t9", title: "Site visit · Galle", when: "2025-12-31 07:30" }] };
        active = a.active as boolean;
        return { vehicle: "WP CAB-4521", active };
      },
      can_delete: () => ({ kind: "vehicle", id: "v1", label: "WP CAB-4521", deletable: false, history_words: "12 tasks" }),
    }, vehicleAdmin);
    await mount(t, vehicleAdmin, <Route path="/vehicles/:reg" element={<VehicleDetail />} />, `/vehicles/${encodeURIComponent("WP CAB-4521")}`);
    expect(screen.getByTestId("delete-blocked").textContent).toBe("Has history (12 tasks): archive instead");
    const box = screen.getByTestId("vehicle-archive");
    fireEvent.click(within(box).getByRole("button", { name: "Archive" }));
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Yes, archive" })); });
    await settle();
    expect(within(screen.getByTestId("archive-trips")).getByRole("link").getAttribute("href")).toBe("/tasks/t9");
    expect(box.textContent).toContain("booked for 1 trip from today on");
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Archive anyway" })); });
    await settle();
    expect(t.argsOf("set_vehicle_active")).toEqual([{ reg_no: "WP CAB-4521", active: false }, { reg_no: "WP CAB-4521", active: false, confirm: true }]);
    expect(toastText()).toBe("WP CAB-4521 archived");
    expect(screen.getByTestId("where").textContent).toBe("/vehicles");
  });
});

describe("an office person's Archive and Delete (UserManage)", () => {
  const NIMAL = { name: "Nimal Silva", email: "nimal@fame.test", role: "staff", permissions: ["view", "request"], active: true, since: "2025-12-01 10:00" };
  it("Archive in two clicks; the server's account rule shows instead of Delete permanently", async () => {
    const t = new FakeTransport({
      list_office_users: () => ({ count: 1, total: 1, users: [NIMAL] }),
      set_office_user_active: () => ({ email: "nimal@fame.test", active: false }),
      can_delete: () => ({ kind: "office_person", id: "e2", label: "Nimal Silva", deletable: false, problem: "Only an admin can switch off an account that holds Approve." }),
    }, admin);
    await mount(t, admin, <Route path="/settings/users/:email/edit" element={<UserManage />} />, `/settings/users/${encodeURIComponent("nimal@fame.test")}/edit`);
    await settle();
    expect(screen.getByTestId("delete-blocked").textContent).toBe("Only an admin can switch off an account that holds Approve.");
    expect(screen.queryByTestId("delete-permanently")).toBeNull();
    const box = screen.getByTestId("user-archive");
    fireEvent.click(within(box).getByRole("button", { name: "Archive" }));
    await act(async () => { fireEvent.click(within(box).getByRole("button", { name: "Yes, archive" })); });
    await settle();
    expect(t.argsOf("set_office_user_active")).toEqual([{ email: "nimal@fame.test", active: false }]);
    expect(toastText()).toBe("Account archived");
  });
});

describe("Recently deleted", () => {
  const ITEMS = [
    { id: "b1", kind: "vehicle", record_id: "v1", label: "WP CAB-4521", detail: "Toyota HiAce", deleted_by: "Sahan", deleted_at: "2025-12-01 10:05", until: "2025-12-31", days_left: 12 },
    { id: "b2", kind: "task", record_id: "t1", label: "Task · Team drop · Kandy", reason: "Made twice", deleted_by: "Palitha", deleted_at: "2025-12-02 09:00", until: "2026-01-01", days_left: 13 },
  ];
  it("each row: what, the kind in words, who and when, the reason, until when; Restore asks nothing; a refusal on its row", async () => {
    let items = [...ITEMS];
    const t = new FakeTransport({
      list_bin: (a) => ({ items: items.filter((i) => !a.kind || i.kind === a.kind), total: items.length }),
      restore_bin_item: (a) => {
        if (a.id === "b1") refuse("Something with the same name, plate or username exists now. Rename or archive it first, then restore this.");
        items = items.filter((i) => i.id !== a.id);
        return { restored: "Task · Team drop · Kandy", kind: "task", record_id: "t1" };
      },
    }, admin);
    await mount(t, admin, <Route path="/settings/recently-deleted" element={<RecentlyDeleted />} />, "/settings/recently-deleted");
    const rows = screen.getAllByTestId("bin-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("WP CAB-4521");
    expect(rows[0].textContent).toContain("Vehicle");
    expect(rows[0].textContent).toContain("Deleted by Sahan · Mon 1 Dec 2025 10:05");
    expect(rows[0].textContent).toContain("Restore until Wed 31 Dec 2025 (12 days)");
    expect(within(rows[1]).getByTestId("bin-reason").textContent).toBe("Reason: Made twice");
    await act(async () => { fireEvent.click(within(rows[1]).getByRole("button", { name: "Restore" })); });
    await settle();
    expect(t.argsOf("restore_bin_item")).toEqual([{ id: "b2" }]);
    expect(toastText()).toBe("Restored Task · Team drop · Kandy");
    expect(screen.getAllByTestId("bin-row")).toHaveLength(1);
    await act(async () => { fireEvent.click(within(screen.getAllByTestId("bin-row")[0]).getByRole("button", { name: "Restore" })); });
    await settle();
    expect(screen.getAllByTestId("bin-row")[0].textContent).toContain("Something with the same name, plate or username exists now.");
  });
  it("the kind is the one Filter, sent to list_bin; an empty list says what it means", async () => {
    const t = new FakeTransport({ list_bin: () => ({ items: [], total: 0 }) }, admin);
    await mount(t, admin, <Route path="/settings/recently-deleted" element={<RecentlyDeleted />} />, "/settings/recently-deleted");
    expect(screen.getByText(/Nothing was deleted in the last 30 days/)).toBeTruthy();
    applyFilter("Kind", "Fill");
    await settle();
    expect(t.argsOf("list_bin").at(-1)).toMatchObject({ kind: "fuel" });
  });
});

describe("Settings → Rental companies", () => {
  it("lists them with their vehicles; Show archived asks for the archived; Archive; + Add uses the vehicle form's flow", async () => {
    const t = new FakeTransport({
      list_rental_companies: (a) => a.archived
        ? { companies: [{ id: "r2", name: "Old Rentals", vehicles: 0, archived: "2025-12-01 by Sahan" }] }
        : { companies: [{ id: "r1", name: "Lanka Rent", phone: "0771234567", vehicles: 3 }] },
      set_rental_company_archived: () => ({ company: "Lanka Rent", archived: true }),
      add_rental_company: () => ({ added: "New Co" }),
    }, admin);
    await mount(t, admin, <Route path="/settings/rental-companies" element={<RentalCompaniesPage />} />, "/settings/rental-companies");
    const row = screen.getByTestId("rental-row");
    expect(row.textContent).toContain("Lanka Rent");
    expect(row.textContent).toContain("3 vehicles");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Archive" })); });
    expect(t.argsOf("set_rental_company_archived")).toEqual([{ company: "r1", archived: true }]);
    fireEvent.click(screen.getByTestId("rental-add"));
    fireEvent.change(screen.getByLabelText("Rental company"), { target: { value: "New Co" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Add company" })); });
    expect(t.argsOf("add_rental_company")).toEqual([{ name: "New Co" }]);
    applyFilter("Rental companies", "Show archived");
    await settle();
    expect(t.argsOf("list_rental_companies").at(-1)).toEqual({ archived: true });
    expect(screen.getByTestId("rental-row").textContent).toContain("Old Rentals");
    expect(within(screen.getByTestId("rental-row")).getByRole("button", { name: "Restore" })).toBeTruthy();
  });
});

describe("Projects: the list", () => {
  it("lists them with search and Show archived; Archive per row; the find box and the Zoho message stay", async () => {
    const t = new FakeTransport({
      list_projects: (a) => ({ projects: a.archived ? [] : [{ id: "p1", job_no: "13021", short_name: "TRKAN1", name: "Kandy tower", customer: "Dialog" }], total: a.archived ? 0 : 1 }),
      set_project_archived: () => ({ project: "Kandy tower", archived: true }),
    }, admin);
    await mount(t, admin, <Route path="/projects" element={<Projects />} />, "/projects");
    const row = screen.getByTestId("project-row");
    expect(row.textContent).toContain("TRKAN1");
    await act(async () => { fireEvent.click(within(row).getByRole("button", { name: "Archive" })); });
    expect(t.argsOf("set_project_archived")).toEqual([{ project: "p1", archived: true }]);
    expect(screen.getByLabelText("Find a project")).toBeTruthy();
    expect(screen.getByText("Bring projects in from Zoho Books")).toBeTruthy();
    applyFilter("Projects", "Show archived");
    await settle();
    expect(t.argsOf("list_projects").at(-1)).toMatchObject({ archived: true });
    expect(screen.getByText("No project is archived.")).toBeTruthy();
  });
});

describe("the issue page's Delete…", () => {
  const ISSUE = { id: "i1", kind: "km_gap", kind_text: "Km gap", severity: "warning", status: "open", title: "Km gap WP CAB-4521", detail: "40 km between tasks", opened: "2025-12-01 10:00" };
  it("needs a reason and closes the page after", async () => {
    const t = new FakeTransport({
      issue_history: () => ({ issue: ISSUE, events: [] }),
      delete_entry: (a) => a.preview ? { kind: "issue", id: "i1", label: "Issue · Km gap WP CAB-4521", affects: ["its notes and history"] } : { deleted: "x", kind: "issue", bin_id: "b", until: "2025-12-30" },
    }, admin);
    await mount(t, admin, <Route path="/issues/:id" element={<IssuePage />} />, "/issues/i1");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Delete…" })); });
    await settle();
    const sheet = screen.getByTestId("delete-entry-sheet");
    expect(sheet.textContent).toContain("its notes and history");
    fireEvent.change(within(sheet).getByTestId("delete-entry-reason"), { target: { value: "Not a real gap" } });
    await act(async () => { fireEvent.click(within(sheet).getByTestId("delete-entry-confirm")); });
    await settle();
    expect(t.argsOf("delete_entry").at(-1)).toEqual({ kind: "issue", id: "i1", reason: "Not a real gap" });
    expect(screen.getByTestId("where").textContent).toBe("/issues");
  });
});
