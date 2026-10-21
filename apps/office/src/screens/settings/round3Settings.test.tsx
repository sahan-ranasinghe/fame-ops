// Round 3 on Settings: the Activity log's "Show routine actions" (off by default; on sends include_routine and a routine
// row is quieter), My profile's photo with Change photo (the web build only: never without the web's photo saver or in
// the artifact), and office people's photos on Users.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Fleet, FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { ActivityEntry, OfficeUser } from "../../data/types";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import ActivityLogPage, { activityArgs } from "./ActivityLog";
import { MyProfile, PHOTO_WORDS } from "./MyProfile";
import { Users } from "./Users";

vi.mock("../imageCanvas", () => ({ profilePhoto: () => Promise.resolve(new Blob(["p"], { type: "image/jpeg" })) }));

const admin: Me = {
  name: "Sahan Ranasinghe", email: "sahan@fame.test", role: "admin", permissions: ["view", "users"],
  tools: ["activity_log", "list_office_users", "update_my_profile"],
};

class FakeTransport implements Transport {
  calls: { tool: string; args: Record<string, unknown> }[] = [];
  constructor(readonly kind: "api" | "claude", private answers: Record<string, (args: Record<string, unknown>) => unknown>) {}
  me(): Promise<Me> {
    return Promise.resolve(admin);
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
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
};

function mount(t: FakeTransport, url: string, element: React.ReactNode, extra: Partial<Fleet> = {}, me: Me = admin) {
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me, noConnector: false, ...extra }}>
      <ToastProvider><MemoryRouter initialEntries={[url]}><Routes><Route path={url.split("?")[0]} element={element} /></Routes></MemoryRouter></ToastProvider>
    </FleetProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-21T10:00:00+05:30"));
});
afterEach(() => vi.useRealTimers());

describe("the Activity log's routine actions (Round 3)", () => {
  const entries: ActivityEntry[] = [
    { id: 2, at: "2026-10-21 09:40", person: "Sahan", channel: "Website or app", action: "Watch drivers", about: "Kamal", outcome: "done", routine: true },
    { id: 1, at: "2026-10-21 09:30", person: "Sahan", channel: "Website or app", action: "Create a task", about: "Team drop", outcome: "done" },
  ];

  it("include_routine only when the switch is on", () => {
    expect(activityArgs("2026-10-15", "2026-10-21", "", false)).toEqual({ from: "2026-10-15", to: "2026-10-21" });
    expect(activityArgs("2026-10-15", "2026-10-21", " kamal ", true)).toEqual({ from: "2026-10-15", to: "2026-10-21", person: "kamal", include_routine: true });
  });

  it("off by default; on asks for the routine ones too and shows them quieter", async () => {
    const t = new FakeTransport("api", { activity_log: (a) => ({ from: a.from, to: a.to, count: 1, total: 1, entries: a.include_routine ? entries : entries.slice(1) }) });
    mount(t, "/settings/activity", <ActivityLogPage />);
    await settle();
    await settle();
    const sw = screen.getByRole("switch", { name: "Show routine actions" }) as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(t.argsOf("activity_log")[0]).not.toHaveProperty("include_routine");
    expect(screen.getAllByTestId("activity-row")).toHaveLength(1);

    fireEvent.click(sw);
    await settle();
    await settle();
    expect(t.argsOf("activity_log").at(-1)).toMatchObject({ include_routine: true });
    const rows = screen.getAllByTestId("activity-row");
    expect(rows).toHaveLength(2);
    expect(rows[0].className).toContain("routine");
    expect(rows[1].className).not.toContain("routine");
  });
});

describe("office people's photos (Round 3)", () => {
  it("My profile: the photo with Change photo on the web; saved through the web's saver, then /me again", async () => {
    const t = new FakeTransport("api", {});
    const save = vi.fn(() => Promise.resolve("ok" as const));
    const refreshMe = vi.fn(() => Promise.resolve());
    mount(t, "/settings/profile", <MyProfile />, { myPhoto: { save }, refreshMe }, { ...admin, photo_url: "https://files/sahan.jpg" });
    const card = screen.getByTestId("my-photo");
    expect(card.querySelector("img")?.getAttribute("src")).toBe("https://files/sahan.jpg");
    const input = within(card).getByLabelText("Change photo") as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "me.jpg", { type: "image/jpeg" })] } });
    await settle();
    await settle();
    expect(save).toHaveBeenCalledTimes(1);
    expect(refreshMe).toHaveBeenCalled();
    expect(within(card).getByText(PHOTO_WORDS.ok.text)).toBeTruthy();
  });

  it("no Change photo in the artifact or without the web's saver; the initials until there is a photo; a failed save says so", async () => {
    mount(new FakeTransport("claude", {}), "/settings/profile", <MyProfile />, { myPhoto: { save: () => Promise.resolve("ok") } });
    expect(within(screen.getByTestId("my-photo")).queryByRole("button", { name: /photo/ })).toBeNull();
    expect(screen.getByTestId("my-photo").querySelector(".avatar")?.textContent).toBe("SR");
    document.body.innerHTML = "";
    mount(new FakeTransport("api", {}), "/settings/profile", <MyProfile />);
    expect(within(screen.getByTestId("my-photo")).queryByRole("button", { name: /photo/ })).toBeNull();
    document.body.innerHTML = "";
    mount(new FakeTransport("api", {}), "/settings/profile", <MyProfile />, { myPhoto: { save: () => Promise.resolve("network") } });
    const card = screen.getByTestId("my-photo");
    fireEvent.change(within(card).getByLabelText("Add photo"), { target: { files: [new File(["x"], "me.jpg", { type: "image/jpeg" })] } });
    await settle();
    await settle();
    expect(within(card).getByText(PHOTO_WORDS.network.text)).toBeTruthy();
  });

  it("Users: each person's photo beside the name, the initials until there is one", async () => {
    const users: OfficeUser[] = [
      { name: "Palitha Fleet", email: "palitha@fame.test", role: "fleet_admin", permissions: ["view", "approve"], active: true, photo_url: "https://files/palitha.jpg" },
      { name: "Ruwan Requester", email: "ruwan@fame.test", role: "staff", permissions: ["view", "request"], active: true },
    ];
    const t = new FakeTransport("api", { list_office_users: () => ({ count: 2, total: 2, users }) });
    mount(t, "/settings/users", <Users />);
    await settle();
    await settle();
    const rows = screen.getAllByTestId("user-row");
    expect(rows[0].querySelector(".avatar img")?.getAttribute("src")).toBe("https://files/palitha.jpg");
    expect(rows[1].querySelector(".avatar")?.textContent).toBe("RR");
  });
});
