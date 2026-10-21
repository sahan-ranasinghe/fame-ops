import { IMPLIES_VIEW, type Permission, PRESETS } from "@fleet/permissions";
import { fireEvent, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { PermissionPicker } from "./userParts";
import { emptyUser, presetOf, SELF_LOCKOUT, togglePermission, updateInput, validateNewUser, viewLocked } from "./usersLogic";

describe("Users page rules", () => {
  it("toggles permissions in the table's order and recognises the presets", () => {
    expect(togglePermission(["view"], "users")).toEqual(["view", "users"]);
    expect(togglePermission(["view", "users"], "users")).toEqual(["view"]);
    expect(togglePermission(["view"], "view")).toEqual([]);
    expect(PRESETS.requester.permissions).toEqual(["view", "request"]);
    expect(presetOf(["view", "request"])).toBe("requester");
    expect(presetOf(["request"])).toBe("requester");
    expect(presetOf(["assign_tasks", "view", "request"])).toBe("dispatcher");
    expect(presetOf(PRESETS.fleet_admin.permissions)).toBe("fleet_admin");
    expect(presetOf(["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"])).toBe("admin");
    expect(presetOf(["view", "users"])).toBeNull();
    // Round 2b: the Coordinator, and an admin with office_users is still the Admin chip.
    expect(presetOf(["view", "request", "assign_tasks", "vehicles", "issues", "office_users"])).toBe("coordinator");
    expect(presetOf(["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users", "office_users"])).toBe("admin");
  });

  it("the picker offers the Coordinator preset and the Office accounts permission (Round 2b)", () => {
    let picked: Permission[] = [];
    render(createElement(PermissionPicker, { value: [], onChange: (p: Permission[]) => { picked = p; }, idPrefix: "t" }));
    fireEvent.click(screen.getByRole("button", { name: "Coordinator" }));
    expect(picked).toEqual(["view", "request", "assign_tasks", "vehicles", "issues", "office_users"]);
    expect(screen.getByRole("checkbox", { name: /^Office accounts/ })).toBeTruthy();
  });

  it("view is ticked with any other permission and locked while one is ticked; unticking them all frees it", () => {
    expect(IMPLIES_VIEW.every((p) => togglePermission([], p).includes("view"))).toBe(true);
    expect(togglePermission([], "request")).toEqual(["view", "request"]);
    expect(viewLocked(["view", "request"])).toBe(true);
    expect(viewLocked(["view"])).toBe(false);
    expect(viewLocked([])).toBe(false);
    // Locked: unticking view changes nothing.
    expect(togglePermission(["view", "users"], "view")).toEqual(["view", "users"]);
    expect(togglePermission(["users"], "view")).toEqual(["view", "users"]);
    // The last one unticked: view stays ticked, and is free again.
    const after = togglePermission(["view", "request"], "request");
    expect(after).toEqual(["view"]);
    expect(viewLocked(after)).toBe(false);
    expect(togglePermission(after, "view")).toEqual([]);
  });

  it("a new user needs a name, an e-mail and a permission; the e-mail is lower-cased", () => {
    expect(validateNewUser(emptyUser())).toEqual({ error: "Add the name and the e-mail." });
    expect(validateNewUser({ ...emptyUser(), name: "A", email: "nope" })).toEqual({ error: "That e-mail does not look right." });
    expect(validateNewUser({ name: "A", email: "a@fame.test", phone: "", permissions: [] })).toEqual({ error: "Tick at least one permission." });
    expect(validateNewUser({ name: " Palitha ", email: "Palitha@Fame.test", phone: " 0771 ", permissions: ["request", "view"] })).toEqual({
      input: { name: "Palitha", email: "palitha@fame.test", phone: "0771", permissions: ["view", "request"] },
    });
  });

  it("an update sends only what changed, and an admin cannot lock themselves out", () => {
    const before = { email: "a@fame.test", name: "Ann", phone: null, permissions: ["view", "users"] as const };
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "", permissions: ["view", "users"] })).toEqual({ nothing: true });
    expect(updateInput(before, { name: "Ann B", email: "a@fame.test", phone: "077", permissions: ["users", "view"] })).toEqual({
      input: { email: "a@fame.test", name: "Ann B", phone: "077" },
    });
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "", permissions: ["view"] }, "A@fame.test")).toEqual({ error: SELF_LOCKOUT });
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "", permissions: ["view"] }, "other@fame.test")).toEqual({
      input: { email: "a@fame.test", permissions: ["view"] },
    });
    expect(updateInput(before, { name: "Ann", email: "a@fame.test", phone: "", permissions: [] })).toEqual({
      error: "Tick at least one permission, or switch the account off instead.",
    });
  });
});

describe("the permission picker", () => {
  it("greys and locks view while another permission is ticked, with the hint; ticking one ticks view", () => {
    let value: Permission[] = ["view", "request"];
    const onChange = (p: Permission[]) => { value = p; };
    const { rerender } = render(createElement(PermissionPicker, { value, onChange, idPrefix: "t" }));
    const view = screen.getByLabelText<HTMLInputElement>(/^View/);
    expect(view.checked).toBe(true);
    expect(view.disabled).toBe(true);
    expect(screen.getByTestId("view-locked").textContent).toBe("Needed by the other permissions");
    // The Requester preset is view + request.
    expect(screen.getByRole("button", { name: "Requester" }).getAttribute("aria-pressed")).toBe("true");

    rerender(createElement(PermissionPicker, { value: ["view"], onChange, idPrefix: "t" }));
    expect(screen.getByLabelText<HTMLInputElement>(/^View/).disabled).toBe(false);
    expect(screen.queryByTestId("view-locked")).toBeNull();
    fireEvent.click(screen.getByLabelText(/^Issues/));
    expect(value).toEqual(["view", "issues"]);
  });
});
