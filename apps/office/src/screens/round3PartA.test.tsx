// Round 3 Part A on the website: the driver's day timeline's icons (A1), the self-drive licence (A5: My profile's
// Driving licence card and the approver's line) and expired requests (A6: the badge, the filters, Request again with
// everything copied but the day). The dates in words (A4) are lib/when.test.ts; the light maps (A3) are
// map/google/googleMaps.test.ts and themeContrast.test.ts.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../app/FleetContext";
import { FleetStore } from "../data/store";
import type { RequestCard } from "../data/types";
import type { Me, Transport, WatchEvent } from "../transport/types";
import { ToastProvider } from "../ui/Toast";
import { selfDriveLicenceLine } from "../ui/whoDrivesLogic";
import { GapsList } from "./GapsList";
import type { GapRow } from "./gapsLogic";
import { liveOf, liveTone, liveWord, TRIP_STATUS_OPTIONS, tripsArgs } from "./myTripsLogic";
import { NewRequest } from "./NewRequest";
import { RequestDetail } from "./RequestDetail";
import { RequestDetailCard } from "./RequestDetailCard";
import { againFields, timelineSteps } from "./requestLogic";
import { RequestStatusPill } from "./requestParts";
import { REQUEST_FILTERS, requestsArgs, requestsEmptyText } from "./requestsListLogic";
import { licenceInput, licenceStateText } from "./settings/profileLogic";
import { LICENCE_PHOTO_WORDS, MyLicenceCard } from "./settings/MyProfile";
import { timelineIconOf } from "./TimelineIcon";

vi.mock("../map/MapView", () => ({ MapView: () => <div data-testid="map" /> }));
vi.mock("../map/google/useGoogleMap", () => ({ useGoogleMap: () => ({ kind: "open" }) }));
vi.mock("./imageCanvas", () => ({
  profilePhoto: () => Promise.resolve(new Blob(["p"], { type: "image/jpeg" })),
  licencePhoto: () => Promise.resolve(new Blob(["l"], { type: "image/jpeg" })),
}));

class FakeTransport implements Transport {
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(readonly kind: "api" | "claude", private answers: Record<string, (args: Record<string, unknown>) => unknown>, private who: Me) {}
  me(): Promise<Me> {
    return Promise.resolve(this.who);
  }
  argsOf(tool: string) {
    return this.calls.filter((c) => c.tool === tool).map((c) => c.args);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    this.calls.push({ tool, args });
    const a = this.answers[tool];
    if (!a) return Promise.reject({ code: "not_found", message: tool });
    return Promise.resolve(structuredClone(a(args)) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => undefined;
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

const settle = async (ms = 0) => {
  for (let i = 0; i < 3; i++) await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

function Where() {
  const l = useLocation();
  return <p data-testid="where">{l.pathname}</p>;
}

function mount(t: FakeTransport, me: Me, entry: string | { pathname: string; state?: unknown }, routes: React.ReactNode, extra: Partial<Fleet> = {}) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false, ...extra }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>{routes}</Routes>
          <Where />
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T08:00:00+05:30"));
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => vi.useRealTimers());

// ---- A1: the timeline's icons ----------------------------------------------------------------------------------------

describe("a driver's day: one icon per row, no coloured bar (A1)", () => {
  it("a car for driving, a pin for stopped, a warning for app not running or no GPS, a cloud for offline", () => {
    expect(timelineIconOf("driving").icon).toBe("car");
    expect(timelineIconOf("stopped").icon).toBe("pin");
    expect(timelineIconOf("no_data").icon).toBe("alert");
    expect(timelineIconOf("no_gps").icon).toBe("alert");
    expect(timelineIconOf("late").icon).toBe("upload");
  });

  it("the Gaps list draws the icon (with the words beside it), never a bar", () => {
    const row = (kind: GapRow["kind"], what: string): GapRow => ({ id: `${kind}-1`, kind, fromAt: 0, toAt: 60000, when: "14:00–14:56", what, minutes: 56, lat: 6.9, lng: 79.8, text: what, focus: [] });
    render(<GapsList rows={[row("no_data", "App not running"), row("late", "Offline here · uploaded 10:20")]} open={null} onOpen={() => undefined} />);
    const rows = screen.getAllByTestId("gap-row");
    expect(rows[0].querySelector("[data-testid=tl-icon]")?.getAttribute("data-icon")).toBe("alert");
    expect(rows[0].textContent).toContain("App not running");
    expect(rows[1].querySelector("[data-testid=tl-icon]")?.getAttribute("data-icon")).toBe("upload");
    expect(document.querySelectorAll(".tl-row .bar")).toHaveLength(0);
    // The icon is decoration: the row's words say what it is.
    expect(rows[0].querySelector("[data-testid=tl-icon]")?.getAttribute("aria-hidden")).toBe("true");
  });
});

// ---- A5: my driving licence and the approver's line -----------------------------------------------------------------

const officer: Me = {
  name: "Dilini Jayasinghe", email: "dilini@fame.test", role: "staff", permissions: ["view", "request"],
  tools: ["update_my_profile", "create_request", "list_requests", "my_trips", "get_settings"],
};

describe("My profile: the driving licence (A5)", () => {
  it("only what changed is sent; an emptied field clears it; a bad date or a long number is refused in words", () => {
    expect(licenceInput({ number: " B 1234567 ", expiry: "2027-04-02" }, undefined)).toEqual({ input: { licence_no: "B 1234567", licence_expiry: "2027-04-02" } });
    expect(licenceInput({ number: "B1234567", expiry: "2027-04-02" }, { number: "B1234567", expiry: "2027-04-02" })).toEqual({ nothing: true });
    expect(licenceInput({ number: "", expiry: "2027-04-02" }, { number: "B1234567", expiry: "2027-04-02" })).toEqual({ input: { licence_no: null } });
    expect(licenceInput({ number: "B1234567", expiry: "" }, { number: "B1234567", expiry: "2027-04-02" })).toEqual({ input: { licence_expiry: null } });
    expect(licenceInput({ number: "x".repeat(41), expiry: "" }, undefined)).toEqual({ error: "The licence number is at most 40 characters." });
    expect(licenceInput({ number: "", expiry: "2 April" }, undefined)).toEqual({ error: "Pick the expiry date on the calendar." });
    expect(licenceStateText("on_file")).toEqual({ text: "On file ✓", tone: "ok" });
    expect(licenceStateText("expired").tone).toBe("warn");
    expect(licenceStateText("none")).toEqual({ text: "Not on file", tone: "warn" });
  });

  it("shows the licence from /me, saves the number with update_my_profile and asks /me again", async () => {
    const t = new FakeTransport("api", { update_my_profile: (a) => ({ name: officer.name, licence_no: a.licence_no ?? undefined, licence_expiry: "2027-04-02" }) }, officer);
    const refreshMe = vi.fn(() => Promise.resolve());
    const me: Me = { ...officer, licence: { expiry: "2027-04-02", state: "none" } };
    mount(t, me, "/settings/profile", <Route path="/settings/profile" element={<MyLicenceCard />} />, { refreshMe });
    const card = screen.getByTestId("my-licence");
    expect(within(card).getByTestId("my-licence-state").textContent).toBe("Not on file");
    expect((within(card).getByLabelText("Expires") as HTMLButtonElement).getAttribute("data-value")).toBe("2027-04-02");
    expect(card.textContent).toContain("No photo of the front yet");
    // No photo buttons without the web's licence saver.
    expect(within(card).queryByRole("button", { name: "Add front" })).toBeNull();
    fireEvent.change(within(card).getByLabelText("Licence number"), { target: { value: "B1234567" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save licence" }));
    await settle();
    expect(t.argsOf("update_my_profile")).toEqual([{ licence_no: "B1234567" }]);
    expect(refreshMe).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("Driving licence saved");
  });

  it("takes or chooses the front and the back on the web (my own folder, set_my_licence_photo); none in the artifact", async () => {
    const savePhoto = vi.fn((_side: "front" | "back", _jpeg: Blob) => Promise.resolve("ok" as const));
    const t = new FakeTransport("api", {}, officer);
    const me: Me = { ...officer, licence: { number: "B1234567", state: "on_file", front_url: "https://files.test/front.jpg" } };
    mount(t, me, "/settings/profile", <Route path="/settings/profile" element={<MyLicenceCard />} />, { myLicence: { savePhoto }, refreshMe: () => Promise.resolve() });
    const card = screen.getByTestId("my-licence");
    expect(within(card).getByTestId("my-licence-state").textContent).toBe("On file ✓");
    expect(within(card).getByRole("img", { name: "Driving licence, front" }).getAttribute("src")).toBe("https://files.test/front.jpg");
    const back = within(card).getByLabelText("Add back") as HTMLInputElement;
    expect(back.accept).toBe("image/*");
    fireEvent.change(back, { target: { files: [new File(["x"], "back.jpg", { type: "image/jpeg" })] } });
    await settle();
    expect(savePhoto).toHaveBeenCalledTimes(1);
    expect(savePhoto.mock.calls[0][0]).toBe("back");
    expect(card.textContent).toContain(LICENCE_PHOTO_WORDS.ok.text);
  });

  it("I'll drive myself is offered to anyone who asks; under it, my licence as /me knows it with the link to add it", async () => {
    const t = new FakeTransport("api", { get_settings: () => ({ settings: { dwell_min: {}, self_drive_allowed: true }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }) }, officer);
    const me: Me = { ...officer, licence: { state: "none" } };
    mount(t, me, "/requests/new", <Route path="/requests/new" element={<NewRequest />} />);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "I'll drive myself" }));
    const note = screen.getByTestId("my-licence-note");
    expect(note.textContent).toContain("No driving licence on file yet.");
    expect(within(note).getByRole("link", { name: "Add it on My profile" }).getAttribute("href")).toBe("/settings/profile");
    fireEvent.click(screen.getByRole("button", { name: "A driver" }));
    expect(screen.queryByTestId("my-licence-note")).toBeNull();
  });

  it("the artifact (no /me licence) shows no licence card", () => {
    const t = new FakeTransport("claude", {}, officer);
    mount(t, officer, "/settings/profile", <Route path="/settings/profile" element={<MyLicenceCard />} />);
    expect(screen.queryByTestId("my-licence")).toBeNull();
  });
});

const expiredCard = (over: Partial<RequestCard> = {}): RequestCard => ({
  id: "r9", kind: "request", requested_by: "Dilini Jayasinghe", project: "13021 · TRKAN1", when: "Mon 19 Oct 09:30",
  route: "Head office → Galle", need: "Van · 3 people", status: "expired", expired: "2026-10-20 00:05", asked: "Sun 18 Oct 16:10",
  version: 3, on_behalf_of: "Nimal Perera", note: "Bring the banners", driven_by: "other", driver_name: "Ruwan Silva", driver_phone: "+94771234567",
  fields: {
    date: "2026-10-19", time: "09:30", back_by: "17:00", route_from: "Head office", route_to: "Galle", need_type: "van", pax: 3, tools: true,
    note: "Bring the banners", driven_by: "other", driver_name: "Ruwan Silva", driver_phone: "+94771234567", on_behalf_of: "Nimal Perera",
  },
  timeline: { sent: "2026-10-18 16:10", expired: "2026-10-20 00:05" },
  events: [
    { at: "2026-10-18 16:10", action: "created", actor: "Dilini Jayasinghe" },
    { at: "2026-10-20 00:05", action: "expired", actor: "Fame Fleet", note: "Nobody decided it before its day was over" },
  ],
  live: { state: "expired", text: "Expired · nobody decided it in time", at: "Tue 20 Oct 00:05" },
  ...over,
});

describe("the approver's self-drive licence line (A5)", () => {
  const approver: Me = { name: "Palitha", role: "fleet_admin", permissions: ["view", "approve"], tools: ["decide_request", "list_requests"] };

  it("on file ✓, none or expired in words (amber for the last two); nothing for a trip a driver drives", () => {
    expect(selfDriveLicenceLine("on_file")).toEqual({ text: "Self-drive · licence on file ✓", tone: "ok" });
    expect(selfDriveLicenceLine("none")).toEqual({ text: "Self-drive · no licence on file", tone: "warn" });
    expect(selfDriveLicenceLine("expired")).toEqual({ text: "Self-drive · licence expired", tone: "warn" });
    expect(selfDriveLicenceLine(undefined)).toBeNull();
  });

  it("the decide pages' card shows it, never a block", () => {
    const t = new FakeTransport("api", {}, approver);
    const q = expiredCard({ status: "waiting", driven_by: "self", self_drive_licence: "none", events: undefined, live: undefined, expired: undefined });
    mount(t, approver, "/requests/r9/decide", <Route path="/requests/:id/decide" element={<RequestDetailCard q={q} compact />} />);
    const line = screen.getByTestId("self-drive-licence");
    expect(line.textContent).toBe("Self-drive · no licence on file");
    expect(line.className).toContain("warn");
    expect(line.querySelector("svg")).toBeTruthy();
  });

  it("the request's page shows it to the approver; on file is green with its check", async () => {
    const q = expiredCard({ status: "waiting", driven_by: "self", self_drive_licence: "on_file", events: undefined, live: undefined, expired: undefined });
    const t = new FakeTransport("api", { list_requests: () => ({ requests: [q] }) }, approver);
    mount(t, approver, "/requests/r9", <Route path="/requests/:id" element={<RequestDetail />} />);
    await settle();
    const line = screen.getByTestId("self-drive-licence");
    expect(line.textContent).toBe("Self-drive · licence on file ✓");
    expect(line.className).toContain("ok");
  });
});

// ---- A6: expired requests ------------------------------------------------------------------------------------------------

describe("expired requests (A6)", () => {
  it("its own badge with an icon; the other statuses keep their pills", () => {
    render(<><RequestStatusPill status="expired" /><RequestStatusPill status="waiting" /></>);
    const badge = screen.getByTestId("expired-badge");
    expect(badge.textContent).toBe("Expired");
    expect(badge.querySelector("svg")).toBeTruthy();
    expect(screen.getByText("Waiting").className).toContain("warn");
  });

  it("Expired is a status filter on Requests and on My trips, and never counts as waiting", () => {
    expect(REQUEST_FILTERS.map(([k]) => k)).toEqual(["waiting", "changed", "approved", "declined", "cancelled", "expired", "all"]);
    expect(requestsArgs("expired", "")).toEqual({ status: "expired" });
    expect(requestsEmptyText("expired", "", false)).toBe("No request expired: each was decided before its day.");
    expect(TRIP_STATUS_OPTIONS.map(([k]) => k)).toContain("expired");
    expect(tripsArgs("2026-10-01", "2026-10-31", "expired", "requests")).toEqual({ from: "2026-10-01", to: "2026-10-31", status: "expired", include: "requests" });
    const q = expiredCard({ live: undefined });
    expect(liveOf(q)).toEqual({ state: "expired", text: "Expired · nobody decided it in time", at: "2026-10-20 00:05" });
    expect(liveWord("expired")).toBe("Expired");
    expect(liveTone("expired")).toBe("muted");
    // The timeline says it expired, not "by Fame Fleet"; nothing waits for a decision any more.
    const steps = timelineSteps(q);
    expect(steps.at(-1)).toEqual({ label: "Expired · nobody decided it in time", at: "2026-10-20 00:05", done: true, lines: undefined });
    expect(steps.some((s) => !s.done)).toBe(false);
    expect(timelineSteps({ ...q, events: undefined }).at(-1)).toEqual({ label: "Expired · nobody decided it in time", at: "2026-10-20 00:05", done: true });
  });

  it("Request again copies everything but the day, which starts as tomorrow; someone else's is on their behalf", () => {
    const f = againFields(expiredCard(), { tomorrow: "2026-10-22", me: "Dilini Jayasinghe" });
    expect(f.date).toBe("2026-10-22");
    expect(f.leaveBy).toBe("09:30");
    expect(f.end).toBe("17:00");
    expect(f.stops.map((s) => [s.type, s.place])).toEqual([["pickup", "Head office"], ["drop", "Galle"]]);
    expect(f).toMatchObject({ project: "13021 · TRKAN1", behalf: "Nimal Perera", need: "van", pax: "3", tools: true, note: "Bring the banners" });
    expect(f.who).toEqual({ by: "other", name: "Ruwan Silva", phone: "+94771234567" });
    // The office asking again for a request someone made with no "on behalf of": on that person's behalf.
    const theirs = againFields(expiredCard({ on_behalf_of: undefined, fields: { ...expiredCard().fields!, on_behalf_of: undefined } }), { tomorrow: "2026-10-22", me: "Palitha" });
    expect(theirs.behalf).toBe("Dilini Jayasinghe");
  });

  it("the expired request's page: the badge, when it expired in words, Request again opens New request filled in", async () => {
    const t = new FakeTransport("api", {
      list_requests: () => ({ requests: [expiredCard()] }),
      get_settings: () => ({ settings: { dwell_min: {}, self_drive_allowed: true }, defaults: {}, about: {}, base_place: null, routing_provider: "estimate" }),
      create_request: () => ({ request: { id: "r10" }, next: "Sent to the fleet admin · you'll be notified." }),
    }, officer);
    mount(t, officer, "/requests/r9", <>
      <Route path="/requests/:id" element={<RequestDetail />} />
      <Route path="/requests/new" element={<NewRequest />} />
      <Route path="/requests" element={<p data-testid="requests">requests</p>} />
    </>);
    await settle();
    expect(screen.getByTestId("expired-badge")).toBeTruthy();
    expect(screen.getByTestId("expired-line").textContent).toBe("Nobody decided it before its day was over · Yesterday 00:05.");
    // No waiting actions on an expired request.
    expect(screen.queryByRole("link", { name: "Edit request" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Withdraw" })).toBeNull();
    // The timeline in words: never "2026-10-18 16:10".
    expect(screen.getByTestId("request-timeline").textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    fireEvent.click(screen.getByTestId("request-again"));
    await settle();
    expect(screen.getByTestId("where").textContent).toBe("/requests/new");
    expect(screen.getByTestId("again-note").textContent).toContain("Head office → Galle");
    expect((screen.getByLabelText("Project or team") as HTMLInputElement).value).toBe("13021 · TRKAN1");
    expect((screen.getByLabelText("On behalf of") as HTMLInputElement).value).toBe("Nimal Perera");
    expect((screen.getByLabelText("Passengers") as HTMLInputElement).value).toBe("3");
    expect((screen.getByLabelText("Note") as HTMLTextAreaElement).value).toBe("Bring the banners");
    expect((screen.getByLabelText("Their name") as HTMLInputElement).value).toBe("Ruwan Silva");
    // The day starts as tomorrow (the Today / Tomorrow chips), editable.
    expect(screen.getByRole("button", { name: "Tomorrow" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Save request" }));
    await settle();
    expect(t.argsOf("create_request")[0]).toMatchObject({
      date: "2026-10-22", project: "13021 · TRKAN1", on_behalf_of: "Nimal Perera", need_type: "van", pax: 3, tools: true,
      note: "Bring the banners", driven_by: "other", driver_name: "Ruwan Silva",
    });
    expect(JSON.stringify(t.argsOf("create_request")[0])).toContain("Galle");
  });
});
