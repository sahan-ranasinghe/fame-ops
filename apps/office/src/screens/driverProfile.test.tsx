// Part 3b (G, H1): the driver's profile on the manage page. Every section from driver_profile (Contact with Call and
// WhatsApp, Emergency contact, Driving licence with its photos, This month and the app version, Not available, Changes with
// "changed by the driver"), the banner for what is missing, Edit saving only what changed through update_driver, the phone
// never emptied, Replace on a licence photo (web only), and the private part's muted line for people without it.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { pickDate } from "../test/controls";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { DriverProfile } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { FULL_PROFILE, LIMITED_PROFILE } from "./__fixtures__/driverProfile";
import { DriverManage, PROFILE_REFRESH_MS } from "./DriverManage";

vi.mock("./imageCanvas", () => ({
  profilePhoto: () => Promise.resolve(new Blob(["p"], { type: "image/jpeg" })),
  vehiclePhoto: () => Promise.resolve({ photo: new Blob(["v"], { type: "image/jpeg" }), thumb: new Blob(["t"], { type: "image/jpeg" }) }),
  documentPhoto: () => Promise.resolve(new Blob(["d"], { type: "image/jpeg" })),
  licencePhoto: () => Promise.resolve(new Blob(["l"], { type: "image/jpeg" })),
}));

type Args = Record<string, unknown>;
type Answer = (args: Args) => unknown;

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  calls: { tool: string; args: Args }[] = [];
  constructor(private answers: Record<string, Answer>) {}
  me(): Promise<Me> {
    return Promise.resolve(officer);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  count(tool: string) {
    return this.calls.filter((c) => c.tool === tool).length;
  }
  call<T>(tool: string, args: Args = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: `No answer for ${tool}` });
    try {
      return Promise.resolve(structuredClone(a(args)) as T);
    } catch (e) {
      return Promise.reject(e);
    }
  }
  watch<T>(tool: string, args: Args, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }));
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const officer: Me = {
  name: "Palitha", email: "palitha@fame.test", role: "fleet_admin", permissions: ["view", "approve", "assign_tasks", "vehicles"],
  tools: ["list_drivers", "driver_profile", "update_driver", "set_driver_licence_photo", "photo_upload_url", "set_unavailability", "remove_unavailability", "get_settings", "reset_pin"],
};

function transport(profile: DriverProfile = FULL_PROFILE) {
  return new FakeTransport({
    list_drivers: () => ({ drivers: [{ name: "Kamal Perera", username: "kamal.p", code: "D-07", phone: "077 111 2222", active: true }] }),
    driver_profile: () => profile,
    update_driver: (a) => ({ updated: { name: "Kamal Perera", username: a.username } }),
    get_settings: () => ({ settings: {}, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
    photo_upload_url: () => ({ upload: { bucket: "driver-photos", path: "e1/licence/x.jpg", token: "tok" } }),
    set_driver_licence_photo: (a) => ({ driver: "Kamal Perera", side: a.side, photo_url: "https://files.test/new-back.jpg" }),
    set_unavailability: (a) => ({ saved: "changed", entry: { ...FULL_PROFILE.not_available[0], id: a.id ?? "u9" } }),
  });
}

const settle = async (ms = 0) => {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

async function mount(t: FakeTransport, me: Me = officer, extra: Partial<Fleet> = {}) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false, ...extra }}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/drivers/kamal.p/edit"]}>
          <Routes><Route path="/drivers/:username/edit" element={<DriverManage />} /></Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await settle();
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2026-10-20T03:00:00Z") });
  localStorage.clear();
});
afterEach(() => vi.useRealTimers());

describe("the driver's profile (G)", () => {
  it("shows every section from driver_profile, and the banner for what is missing", async () => {
    const t = transport();
    await mount(t);
    expect(t.argsOf("driver_profile")).toEqual([{ driver: "kamal.p" }]);
    expect(screen.getByRole("heading", { name: "Kamal Perera" })).toBeTruthy();
    expect(screen.getByTestId("pf-missing").textContent).toBe("Missing: emergency contact.");
    const contact = screen.getByTestId("pf-contact");
    expect(within(contact).getByTestId("pf-phone").textContent).toBe("077 111 2222");
    expect(within(contact).getByTestId("pf-whatsapp").textContent).toBe("077 999 8888");
    // Call and WhatsApp (on a computer: the number, Copy and WhatsApp web to their WhatsApp number).
    expect(within(contact).getByTestId("pf-call").textContent).toContain("077 111 2222");
    expect(within(contact).getByRole("link", { name: "WhatsApp" }).getAttribute("href")).toBe("https://web.whatsapp.com/send?phone=94779998888");
    const emergency = screen.getByTestId("pf-emergency");
    expect(emergency.textContent).toContain("Nimali Perera");
    expect(emergency.textContent).toContain("wife");
    expect(emergency.textContent).toContain("071 222 3333");
    const licence = screen.getByTestId("pf-licence");
    expect(within(licence).getByTestId("pf-licence-no").textContent).toBe("B1234567");
    expect(within(licence).getByTestId("pf-licence-expiry").querySelector(".doc")?.className).toBe("doc warn");
    expect(within(licence).getByRole("img", { name: "Driving licence, front" }).getAttribute("src")).toBe("https://files.test/front.jpg");
    expect(licence.textContent).toContain("No photo of the back yet");
    expect(screen.getByTestId("pf-this-month").textContent).toBe("12 tasks · 840 km");
    expect(screen.getByTestId("pf-app").textContent).toBe("1.2.0+abc123");
    expect(screen.getByTestId("pf-unavailable").textContent).toContain("Thu 22 Oct · Not available · half day, back 13:00");
    const changes = screen.getAllByTestId("pf-change");
    expect(changes[0].textContent).toBe("Phone: 077 000 0000 → 077 111 2222 · changed by the driver · 2026-10-18 09:12");
    expect(changes[0].querySelector("b.pf-by-driver")?.textContent).toBe("changed by the driver");
    expect(changes[1].querySelector("b")).toBeNull();
  });

  it("is watched while the page is open", async () => {
    const t = transport();
    await mount(t);
    await settle(PROFILE_REFRESH_MS);
    expect(t.count("driver_profile")).toBe(2);
  });

  it("Edit contact saves only what changed: an emptied WhatsApp sends null; the phone cannot be emptied", async () => {
    const t = transport();
    await mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact" }));
    const form = screen.getByTestId("pf-edit-contact");
    expect((within(form).getByLabelText("Mobile") as HTMLInputElement).value).toBe("077 111 2222");
    fireEvent.change(within(form).getByLabelText("Mobile"), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await settle();
    expect(form.textContent).toContain("A driver always has a mobile number");
    expect(t.count("update_driver")).toBe(0);
    fireEvent.change(within(form).getByLabelText("Mobile"), { target: { value: "077 111 2222" } });
    fireEvent.change(within(form).getByLabelText(/WhatsApp/), { target: { value: "" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await settle();
    expect(t.argsOf("update_driver")).toEqual([{ username: "kamal.p", whatsapp: null }]);
    expect(screen.queryByTestId("pf-edit-contact")).toBeNull();
    // The profile is asked again after the write.
    expect(t.count("driver_profile")).toBeGreaterThanOrEqual(2);
  });

  it("Edit emergency contact and licence: their own fields only", async () => {
    const t = transport();
    await mount(t);
    fireEvent.click(screen.getByRole("button", { name: "Edit emergency contact" }));
    const em = screen.getByTestId("pf-edit-emergency");
    fireEvent.change(within(em).getByLabelText("Relationship"), { target: { value: "sister" } });
    fireEvent.click(within(em).getByRole("button", { name: "Save" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Edit driving licence" }));
    const lic = screen.getByTestId("pf-edit-licence");
    fireEvent.change(within(lic).getByLabelText("Licence number"), { target: { value: "B7654321" } });
    pickDate(within(lic).getByLabelText("Expires"), "2027-11-10");
    fireEvent.click(within(lic).getByRole("button", { name: "Save" }));
    await settle();
    expect(t.argsOf("update_driver")).toEqual([
      { username: "kamal.p", emergency_relation: "sister" },
      { username: "kamal.p", licence_no: "B7654321", licence_expiry: "2027-11-10" },
    ]);
  });

  it("Replace a licence photo (the web app): photo_upload_url driver_licence, the upload, set_driver_licence_photo with the side", async () => {
    const t = transport();
    const upload = vi.fn(() => Promise.resolve());
    await mount(t, officer, { files: { upload } });
    fireEvent.change(screen.getByLabelText("Add back"), { target: { files: [new File(["x"], "back.jpg", { type: "image/jpeg" })] } });
    await settle();
    await settle();
    expect(t.argsOf("photo_upload_url")).toEqual([{ kind: "driver_licence", target: "kamal.p" }]);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(t.argsOf("set_driver_licence_photo")).toEqual([{ driver: "kamal.p", side: "back", path: "e1/licence/x.jpg" }]);
    expect(screen.getByRole("img", { name: "Driving licence, back" }).getAttribute("src")).toBe("https://files.test/new-back.jpg");
  });

  it("no Replace in the artifact (no files) and no Edit without update_driver", async () => {
    const viewer: Me = { ...officer, tools: ["list_drivers", "driver_profile"] };
    await mount(transport(), viewer);
    expect(screen.queryByLabelText("Replace front")).toBeNull();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add" })).toBeNull();
  });

  it("people without the private part: the server's muted line, no emergency contact, no licence number or photos, no changes", async () => {
    await mount(transport(LIMITED_PROFILE));
    expect(screen.getByTestId("pf-private-hidden").textContent).toBe("The emergency contact and the licence are shown to people with users or vehicles.");
    expect(screen.queryByTestId("pf-emergency")).toBeNull();
    expect(screen.queryByTestId("pf-licence-no")).toBeNull();
    expect(screen.queryByTestId("pf-licence-photos")).toBeNull();
    expect(screen.queryByTestId("pf-changes")).toBeNull();
    expect(screen.getByTestId("pf-licence-expiry").textContent).toBe("2026-11-10");
    expect(screen.getByTestId("pf-unavailable").textContent).toContain("Available every day in the next 30 days.");
  });

  it("Not available: Change opens the editor in the page; Save sends the entry's id", async () => {
    const t = transport();
    await mount(t);
    const section = screen.getByTestId("pf-unavailable");
    fireEvent.click(within(section).getByRole("button", { name: "Change" }));
    const editor = within(section).getByTestId("unav-editor");
    expect(within(editor).getByRole("button", { name: "Morning until 13:00" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(editor).getByRole("button", { name: "Afternoon from 13:00" }));
    fireEvent.click(within(editor).getByRole("button", { name: "Save changes" }));
    await settle();
    expect(t.argsOf("set_unavailability")).toEqual([{ driver: "kamal.p", date: "2026-10-22", part: "afternoon", reason: "half_day", id: "u2" }]);
    expect(within(section).queryByTestId("unav-editor")).toBeNull();
  });
});
