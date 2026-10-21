// Round 2b (Checkpoint 2b review): a Coordinator opens Settings → Users and a person's page without a crash (their
// answer has no connector keys), sees no keys column or card, may change a requester (offered only what they may give),
// and sees a Fleet admin's and another Coordinator's account locked with the reason (the server refuses it too:
// accountGuards.ts, the help-desk rule).
import { PRESETS } from "@fleet/permissions";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import { FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { OfficeUser } from "../../data/types";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import { ToastProvider } from "../../ui/Toast";
import { UserManage } from "./UserManage";
import { Users } from "./Users";

const coordinator: Me = {
  name: "Achini Coordinator", email: "achini@fame.test", role: "coordinator", permissions: [...PRESETS.coordinator.permissions],
  tools: ["list_office_users", "create_office_user", "update_office_user", "reset_office_password", "set_office_user_active"],
} as Me;

const users: OfficeUser[] = [
  { name: "Ruwan Requester", email: "ruwan@fame.test", role: "staff", permissions: ["view", "request"], active: true, since: "2026-10-21 10:00" },
  { name: "Palitha Fleet", email: "palitha@fame.test", role: "fleet_admin", permissions: [...PRESETS.fleet_admin.permissions], active: true, since: "2026-10-21 10:00" },
  { name: "Githmi Coordinator", email: "githmi@fame.test", role: "coordinator", permissions: [...PRESETS.coordinator.permissions], active: true, since: "2026-10-21 10:00" },
] as OfficeUser[];

class FakeTransport implements Transport {
  readonly kind = "api" as const;
  me(): Promise<Me> {
    return Promise.resolve(coordinator);
  }
  call<T>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
    if (tool !== "list_office_users") return Promise.reject({ code: "not_found", message: tool });
    const found = users.filter((u) => !args.search || u.email?.includes(String(args.search)));
    // As the server answers a Coordinator: no connector_keys at all.
    return Promise.resolve(structuredClone({ count: found.length, total: found.length, users: found }) as T);
  }
  watch<T>(tool: string, args: Record<string, unknown>, cb: (ev: WatchEvent<T>) => void): () => void {
    void this.call<T>(tool, args).then((data) => cb({ type: "data", data, at: Date.now() }), (error) => cb({ type: "error", error }));
    return () => undefined;
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

async function mount(url: string) {
  const t = new FakeTransport();
  render(
    <FleetProvider value={{ store: new FleetStore(t), transport: t, me: coordinator, noConnector: false }}>
      <ToastProvider>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/settings/users" element={<Users />} />
            <Route path="/settings/users/:email/edit" element={<UserManage />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </FleetProvider>,
  );
  await act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });
}

describe("a Coordinator on Settings → Users", () => {
  it("the list opens with no keys column", async () => {
    await mount("/settings/users");
    expect(await screen.findByText("Ruwan Requester")).toBeTruthy();
    expect(screen.queryByText("Claude keys")).toBeNull();
  });

  it("a requester's page opens to be changed, with no keys card", async () => {
    await mount(`/settings/users/${encodeURIComponent("ruwan@fame.test")}/edit`);
    expect(await screen.findByText("Name, phone and permissions")).toBeTruthy();
    expect(screen.queryByText("Claude connector keys")).toBeNull();
  });

  it("a Fleet admin's page is shown locked, with the reason", async () => {
    await mount(`/settings/users/${encodeURIComponent("palitha@fame.test")}/edit`);
    expect(await screen.findByText("Only an admin can change this account: it holds Approve.")).toBeTruthy();
    expect(screen.queryByText("New set-password link")).toBeNull();
    expect(screen.queryByText("Switch off")).toBeNull();
  });

  it("another Coordinator's page is shown locked too (the help-desk rule)", async () => {
    await mount(`/settings/users/${encodeURIComponent("githmi@fame.test")}/edit`);
    expect(await screen.findByText("Only an admin can change this account: it holds Office accounts.")).toBeTruthy();
    expect(screen.queryByText("New set-password link")).toBeNull();
    expect(screen.queryByText("Switch off")).toBeNull();
  });

  it("on a requester's page, Approve, Users and Office accounts are greyed and the Coordinator, Fleet admin and Admin quick picks are not offered", async () => {
    await mount(`/settings/users/${encodeURIComponent("ruwan@fame.test")}/edit`);
    expect(await screen.findByText("Name, phone and permissions")).toBeTruthy();
    for (const p of ["approve", "users", "office_users"]) {
      expect((document.getElementById(`eu-${p}`) as HTMLInputElement).disabled).toBe(true);
      expect(screen.getByTestId(`perm-barred-${p}`).textContent).toBe("Only an admin can give this.");
    }
    expect((document.getElementById("eu-issues") as HTMLInputElement).disabled).toBe(false);
    const presets = screen.getByRole("group", { name: "Presets" }).textContent ?? "";
    expect(presets).toContain(PRESETS.requester.label);
    expect(presets).not.toContain(PRESETS.coordinator.label);
    expect(presets).not.toContain(PRESETS.fleet_admin.label);
    expect(presets).not.toContain("Admin (everything)");
  });
});
