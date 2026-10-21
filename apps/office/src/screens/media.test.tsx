// Photos and documents on the pages (Phase 7, §4, §5, §6, §28): a vehicle's Documents section (the rows, View, Upload
// with the expiry, Save date, Remove in two steps on the page, Restore; no upload in the artifact; nothing without
// vehicle_documents), Replace photo on a driver (the web only), the request's driver and vehicle once approved with Tell
// requester and the requester's phone, and the Overview's waiting block marking a proposed task and a late one.
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { pickDate } from "../test/controls";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { RequestCard, UploadTicket, VehicleDocuments } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { Overview } from "./Overview";
import { DriverPhotoCard } from "./PhotoUpload";
import { RequestDetail } from "./RequestDetail";
import { VehicleDocumentsSection } from "./VehicleDocs";
import { VehicleForm } from "./VehicleForm";

vi.mock("./imageCanvas", () => ({
  profilePhoto: () => Promise.resolve(new Blob(["p"], { type: "image/jpeg" })),
  vehiclePhoto: () => Promise.resolve({ photo: new Blob(["v"], { type: "image/jpeg" }), thumb: new Blob(["t"], { type: "image/jpeg" }) }),
  documentPhoto: () => Promise.resolve(new Blob(["0123456789"], { type: "image/jpeg" })),
}));
vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));

type Answer = (args: Record<string, unknown>) => unknown;

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
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function mount(transport: FakeTransport, me: Me, ui: React.ReactNode, extra: Partial<Fleet> = {}, url = "/") {
  const store = new FleetStore(transport);
  render(
    <FleetProvider value={{ store, transport, me, noConnector: false, ...extra }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}>{ui}</MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
  return store;
}

const DOC_TOOLS = ["vehicle_documents", "vehicle_document_upload_url", "save_vehicle_document", "remove_vehicle_document", "restore_vehicle_document", "update_vehicle"];
const officer: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "vehicles", "approve"], tools: [...DOC_TOOLS, "photo_upload_url", "set_driver_photo", "set_vehicle_photo"] };

const docs: VehicleDocuments = {
  vehicle: "WP CAB-4521",
  documents: [
    { id: "d1", kind: "insurance", kind_name: "Insurance", content_type: "application/pdf", bytes: 524288, expiry: "2027-03-12", uploaded: "2026-10-14 10:05 by Palitha", url: "https://files/ins.pdf" },
    { id: "o1", kind: "other", kind_name: "Fitness certificate", name: "Fitness certificate", content_type: "image/jpeg", uploaded: "2026-10-15 09:00 by Palitha", url: "https://files/fit.jpg" },
  ],
  missing: ["revenue_licence", "emission", "registration"],
  missing_text: "revenue licence, emission test, CR",
  removed: [
    { id: "d0", kind: "insurance", kind_name: "Insurance", content_type: "image/jpeg", uploaded: "2025-10-01 08:00 by Nimal", removed: "2026-10-14 10:05 by Palitha", removed_reason: "replaced", url: "https://files/old.jpg" },
  ],
};

function docsTransport() {
  const ticket: UploadTicket = { bucket: "vehicle-docs", path: "v1/revenue_licence/u1.jpg", token: "tok" };
  return new FakeTransport({
    vehicle_documents: () => docs,
    vehicle_document_upload_url: () => ({ upload: ticket }),
    save_vehicle_document: () => ({ vehicle: "WP CAB-4521" }),
    remove_vehicle_document: () => ({}),
    restore_vehicle_document: () => ({}),
    update_vehicle: () => ({}),
  }, officer);
}

describe("the Documents section", () => {
  it("shows one row per kind with what is missing, the file, who uploaded it, View, and the removed ones", async () => {
    const t = docsTransport();
    mount(t, officer, <VehicleDocumentsSection reg="WP CAB-4521" rented={false} dates={{ revenue_licence: "2027-01-01" }} />, { files: { upload: vi.fn() } });
    const ins = await screen.findByTestId("doc-insurance");
    expect(t.argsOf("vehicle_documents")[0]).toEqual({ vehicle: "WP CAB-4521", removed: true });
    expect(screen.getByTestId("docs-missing").textContent).toBe("Missing: revenue licence, emission test, CR");
    expect(within(screen.getByTestId("doc-revenue_licence")).getByText("No document")).toBeTruthy();
    expect(within(screen.getByTestId("doc-revenue_licence")).getByLabelText("Expires").getAttribute("data-value")).toBe("2027-01-01");
    expect(within(ins).getByText("PDF · 512 KB")).toBeTruthy();
    // Dates in words (Round 3 A4): the weekday, the day and the month; the year only when it is not this year's.
    expect(within(ins).getByText(/^Uploaded by Palitha Wed 14 Oct( 2026)? 10:05$/)).toBeTruthy();
    expect(within(ins).getByRole("link", { name: "View" }).getAttribute("href")).toBe("https://files/ins.pdf");
    expect(within(ins).getByRole("link", { name: "View" }).getAttribute("target")).toBe("_blank");
    expect(within(ins).getByRole("button", { name: "Replace" })).toBeTruthy();
    // Other: View and Remove, no Replace (another one is added in its own row); the lease is not shown for a vehicle not rented.
    const other = screen.getByTestId("doc-other:o1");
    expect(within(other).queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByTestId("doc-lease")).toBeNull();
    expect(screen.getByTestId("doc-other:new")).toBeTruthy();
    const removed = screen.getByTestId("removed-documents");
    expect(within(removed).getByText("Replaced")).toBeTruthy();
    expect(within(removed).getByText(/Uploaded by Nimal Wed 1 Oct 2025 08:00 · replaced by Palitha Wed 14 Oct( 2026)? 10:05/)).toBeTruthy();
  });

  it("uploads a photo with the expiry typed, then saves it as the vehicle's document", async () => {
    const t = docsTransport();
    const upload = vi.fn(() => Promise.resolve());
    mount(t, officer, <VehicleDocumentsSection reg="WP CAB-4521" rented={false} />, { files: { upload } });
    const row = await screen.findByTestId("doc-revenue_licence");
    pickDate(within(row).getByLabelText("Expires"), "2027-02-28");
    const file = new File(["x".repeat(50)], "licence.jpg", { type: "image/jpeg" });
    fireEvent.change(within(row).getByLabelText("Upload"), { target: { files: [file] } });
    await waitFor(() => expect(t.argsOf("save_vehicle_document")).toHaveLength(1));
    expect(t.argsOf("vehicle_document_upload_url")[0]).toEqual({ vehicle: "WP CAB-4521", kind: "revenue_licence", content_type: "image/jpeg", bytes: 10 });
    expect(upload).toHaveBeenCalledWith({ bucket: "vehicle-docs", path: "v1/revenue_licence/u1.jpg", token: "tok" }, expect.any(Blob), "image/jpeg");
    expect(t.argsOf("save_vehicle_document")[0]).toEqual({
      vehicle: "WP CAB-4521", kind: "revenue_licence", path: "v1/revenue_licence/u1.jpg", content_type: "image/jpeg", bytes: 10, expiry: "2027-02-28",
    });
    expect(await within(row).findByText("Saved.")).toBeTruthy();
  });

  it("refuses a file that is neither a photo nor a PDF, and an Other without its name", async () => {
    const t = docsTransport();
    mount(t, officer, <VehicleDocumentsSection reg="WP CAB-4521" rented={false} />, { files: { upload: vi.fn() } });
    const row = await screen.findByTestId("doc-registration");
    fireEvent.change(within(row).getByLabelText("Upload"), { target: { files: [new File(["x"], "cr.docx", { type: "application/msword" })] } });
    expect(within(row).getByText("Choose a photo or a PDF.")).toBeTruthy();
    const add = screen.getByTestId("doc-other:new");
    fireEvent.change(within(add).getByLabelText("Upload a document"), { target: { files: [new File(["x"], "fit.pdf", { type: "application/pdf" })] } });
    expect(within(add).getByText("Name the document first (e.g. Fitness certificate).")).toBeTruthy();
    expect(t.argsOf("vehicle_document_upload_url")).toHaveLength(0);
  });

  it("saves a changed expiry date on its own, removes in two steps on the page and restores", async () => {
    const t = docsTransport();
    mount(t, officer, <VehicleDocumentsSection reg="WP CAB-4521" rented={false} />, { files: { upload: vi.fn() } });
    const ins = await screen.findByTestId("doc-insurance");
    expect(within(ins).queryByRole("button", { name: "Save date" })).toBeNull();
    pickDate(within(ins).getByLabelText("Expires"), "2027-06-30");
    fireEvent.click(within(ins).getByRole("button", { name: "Save date" }));
    await waitFor(() => expect(t.argsOf("update_vehicle")).toEqual([{ reg_no: "WP CAB-4521", insurance_expiry: "2027-06-30" }]));

    fireEvent.click(within(ins).getByRole("button", { name: "Remove" }));
    const confirm = within(ins).getByTestId("doc-remove-confirm");
    expect(confirm.textContent).toContain("Remove the insurance?");
    expect(t.argsOf("remove_vehicle_document")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(t.argsOf("remove_vehicle_document")).toEqual([{ id: "d1" }]));

    fireEvent.click(within(screen.getByTestId("removed-documents")).getByRole("button", { name: "Restore" }));
    await waitFor(() => expect(t.argsOf("restore_vehicle_document")).toEqual([{ id: "d0" }]));
  });

  it("has no upload in the artifact (no files) but still View; nothing at all without vehicle_documents", async () => {
    const t = docsTransport();
    mount(t, officer, <VehicleDocumentsSection reg="WP CAB-4521" rented />);
    const ins = await screen.findByTestId("doc-insurance");
    expect(within(ins).getByRole("link", { name: "View" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Replace" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
    expect(screen.queryByTestId("doc-other:new")).toBeNull();
    expect(screen.getByTestId("doc-lease")).toBeTruthy(); // rented: the agreement is one of its papers

    document.body.innerHTML = "";
    const t2 = docsTransport();
    const viewer: Me = { name: "V", role: "viewer", permissions: ["view"], tools: ["list_vehicles"] };
    mount(t2, viewer, <VehicleDocumentsSection reg="WP CAB-4521" rented={false} />, { files: { upload: vi.fn() } });
    expect(screen.queryByTestId("vehicle-documents")).toBeNull();
    expect(t2.calls).toHaveLength(0);
  });
});

describe("Register vehicle", () => {
  it("opens the Documents section after the first save, for the plate as the server saved it", async () => {
    const t = new FakeTransport({
      register_vehicle: () => ({ registered: { reg_no: "WP CAB-4521" } }),
      list_vehicles: () => ({ filter: "all", counts: { all: 1, on_task: 0, available: 1, in_garage: 0, documents_expiring: 0 }, vehicles: [{ reg_no: "WP CAB-4521", rented_from: "Lanka Rent", rent_until: "2027-01-31" }] }),
      list_drivers: () => ({ count: 0, drivers: [] }),
      list_places: () => ({ places: [] }),
      vehicle_documents: () => ({ vehicle: "WP CAB-4521", documents: [], missing: ["revenue_licence", "insurance", "emission", "registration", "lease"] }),
    }, officer);
    mount(t, officer, <Routes><Route path="/vehicles/new" element={<VehicleForm />} /></Routes>, { files: { upload: vi.fn() } }, "/vehicles/new");
    expect(screen.getByTestId("documents-after-save").textContent).toContain("after Register vehicle");
    fireEvent.change(screen.getByLabelText("Number plate"), { target: { value: "wp cab 4521" } });
    fireEvent.click(screen.getByRole("button", { name: "Register vehicle" }));
    expect((await screen.findByTestId("vehicle-registered")).textContent).toContain("WP CAB-4521 is registered.");
    expect(t.argsOf("register_vehicle")[0]).toEqual({ reg_no: "wp cab 4521" });
    // Rented: the agreement is one of its papers, its date starts from the vehicle's rented-until.
    const lease = await screen.findByTestId("doc-lease");
    await waitFor(() => expect(within(lease).getByLabelText("Expires").getAttribute("data-value")).toBe("2027-01-31"));
    expect(screen.getByRole("link", { name: "Open the vehicle" }).getAttribute("href")).toBe("/vehicles/WP%20CAB-4521");
  });
});

describe("Replace photo on a driver", () => {
  it("makes the photo, uploads it through the signed upload and saves it", async () => {
    const t = new FakeTransport({
      photo_upload_url: () => ({ upload: { bucket: "driver-photos", path: "e1/profile/p1.jpg", token: "tk" } }),
      set_driver_photo: () => ({ driver: "Kamal Perera", photo_url: "https://files/new.jpg" }),
    }, officer);
    const upload = vi.fn(() => Promise.resolve());
    mount(t, officer, <DriverPhotoCard username="kamal" name="Kamal Perera" photoUrl="https://files/old.jpg" />, { files: { upload } });
    const card = screen.getByTestId("driver-photo");
    expect(card.querySelector("img")?.getAttribute("src")).toBe("https://files/old.jpg");
    fireEvent.change(within(card).getByLabelText("Replace photo"), { target: { files: [new File(["x"], "me.jpg", { type: "image/jpeg" })] } });
    await waitFor(() => expect(t.argsOf("set_driver_photo")).toEqual([{ driver: "kamal", path: "e1/profile/p1.jpg" }]));
    expect(t.argsOf("photo_upload_url")[0]).toEqual({ kind: "driver_profile", target: "kamal" });
    expect(upload).toHaveBeenCalledWith({ bucket: "driver-photos", path: "e1/profile/p1.jpg", token: "tk" }, expect.any(Blob), "image/jpeg");
    await waitFor(() => expect(card.querySelector("img")?.getAttribute("src")).toBe("https://files/new.jpg"));
  });

  it("is not there in the artifact (no files) or without the tools", () => {
    const t = new FakeTransport({}, officer);
    mount(t, officer, <DriverPhotoCard username="kamal" name="Kamal Perera" />);
    expect(screen.queryByTestId("driver-photo")).toBeNull();
    mount(t, { ...officer, tools: ["set_driver_photo"] }, <DriverPhotoCard username="kamal" name="Kamal Perera" />, { files: { upload: vi.fn() } });
    expect(screen.queryByTestId("driver-photo")).toBeNull();
  });
});

const approved: RequestCard = {
  id: "r1", requested_by: "Mr Silva", when: "Tue 20 Oct 08:00", route: "Head office → Matara", status: "approved", version: 4,
  requester_phone: "0771234567",
  assigned: {
    driver: "Kamal Perera", phone: "0779876543", call: "tel:0779876543", whatsapp: "https://wa.me/94779876543", photo_url: "https://files/kamal.jpg",
    vehicle: "WP CAB-4521", make_model: "Toyota HiAce", vehicle_photo_url: "https://files/van.jpg",
  },
  tell_requester: { moment: "approved", message: "Your vehicle is booked: WP CAB-4521 with Kamal Perera.", whatsapp: "https://wa.me/94771234567?text=Your%20vehicle" },
};

describe("the request once approved (§4)", () => {
  it("shows the driver and the vehicle with their photos, Tell requester, and lets an approver change the phone", async () => {
    const t = new FakeTransport({
      list_requests: () => ({ status: "all", count: 1, requests: [approved] }),
      update_request: () => ({ request: approved, needs_reapproval: false }),
    }, { ...officer, tools: ["list_requests", "update_request", "task_detail"] });
    mount(t, await t.me(), <Routes><Route path="/requests/:id" element={<RequestDetail />} /></Routes>, {}, "/requests/r1");
    const block = await screen.findByTestId("assigned");
    expect(block.textContent).toContain("Kamal Perera");
    expect(block.textContent).toContain("Toyota HiAce");
    // Hotfix 2 (F): on a computer the number with Copy and WhatsApp web (tel: and wa.me on a phone: ContactButtons).
    const call = within(block).getByTestId("call-driver");
    expect(call.textContent).toContain("077 987 6543");
    expect(within(call).getByRole("button", { name: "Copy" })).toBeTruthy();
    expect(within(call).getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe("https://web.whatsapp.com/send?phone=94779876543");
    expect([...block.querySelectorAll("img")].map((i) => i.getAttribute("src"))).toEqual(["https://files/kamal.jpg", "https://files/van.jpg"]);

    const tell = screen.getByTestId("tell-requester");
    expect(screen.getByTestId("tell-message").textContent).toBe("Your vehicle is booked: WP CAB-4521 with Kamal Perera.");
    const link = within(tell).getByRole("link", { name: "Tell requester" });
    expect(link.getAttribute("href")).toBe("https://wa.me/94771234567?text=Your%20vehicle");
    expect(link.getAttribute("target")).toBe("_blank");

    fireEvent.click(within(tell).getByRole("button", { name: "Change" }));
    fireEvent.change(within(tell).getByLabelText("Requester's phone"), { target: { value: "0711111111" } });
    fireEvent.click(within(tell).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(t.argsOf("update_request")).toEqual([{ request_id: "r1", version: 4, requester_phone: "0711111111" }]));
  });

  it("shows no phone button to someone who does not approve, and nothing when the asker has an account", async () => {
    const t = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [approved] }) }, { name: "Dilini", role: "staff", permissions: ["view", "request"], tools: ["list_requests", "update_request"] });
    mount(t, await t.me(), <Routes><Route path="/requests/:id" element={<RequestDetail />} /></Routes>, {}, "/requests/r1");
    const tell = await screen.findByTestId("tell-requester");
    expect(within(tell).queryByRole("button", { name: "Change" })).toBeNull();

    document.body.innerHTML = "";
    const own = { ...approved, tell_requester: undefined, requester_phone: undefined };
    const t2 = new FakeTransport({ list_requests: () => ({ status: "all", count: 1, requests: [own] }) }, officer);
    mount(t2, officer, <Routes><Route path="/requests/:id" element={<RequestDetail />} /></Routes>, {}, "/requests/r1");
    expect(await screen.findByTestId("assigned")).toBeTruthy();
    expect(screen.queryByTestId("tell-requester")).toBeNull();
  });
});

describe("the Overview's waiting requests", () => {
  it("marks a proposed task and one whose leave-by passed", async () => {
    const overview = {
      vehicles: { on_the_road: 0, total: 1, parked: 1, in_garage: 0 }, tasks: { total: 0, in_progress: 0, done: 0 }, requests: { waiting: 2 },
      reminders: { count: 0, window_days: 14 }, on_the_road: [], needs_attention: [],
    };
    const waiting: RequestCard[] = [
      { id: "r2", kind: "task", title: "Team drop · Galle", requested_by: "Nimal Fernando", when: "Tue 20 Oct 08:00", status: "waiting", late: true, proposed: { driver: "Kamal Perera", vehicle: "WP CAB-4521" } },
      { id: "r3", requested_by: "Isuru Bandara", when: "Wed 21 Oct 09:00", status: "waiting" },
    ];
    const t = new FakeTransport({ fleet_overview: () => overview, list_requests: () => ({ status: "waiting", count: 2, requests: waiting }) }, { ...officer, tools: ["fleet_overview", "list_requests", "decide_request"] });
    const store = mount(t, await t.me(), <Overview />);
    store.watch("overview", "fleet_overview", {}, 30000);
    const line = await screen.findByTestId("proposal-line");
    expect(line.textContent).toBe("Task for Kamal Perera · WP CAB-4521 · proposed by Nimal Fernando");
    // Hotfix 3 (L1): the section's compact rows (no table).
    const row = line.closest("[data-testid='request-row']")!;
    expect(row.textContent).toContain("Team drop · Galle");
    expect(row.textContent).toContain("Leave-by passed");
    const plain = screen.getByText("Isuru Bandara").closest("[data-testid='request-row']")!;
    expect(plain.textContent).not.toContain("Leave-by passed");
  });
});
