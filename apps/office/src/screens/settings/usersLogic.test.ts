import { PRESETS } from "@fleet/permissions";
import { describe, expect, it } from "vitest";
import { emptyUser, presetOf, SELF_LOCKOUT, togglePermission, updateInput, validateNewUser } from "./usersLogic";

describe("Users page rules", () => {
  it("toggles permissions in the table's order and recognises the presets", () => {
    expect(togglePermission(["view"], "users")).toEqual(["view", "users"]);
    expect(togglePermission(["users", "view"], "view")).toEqual(["users"]);
    expect(presetOf(["request"])).toBe("requester");
    expect(presetOf(["assign_tasks", "view", "request"])).toBe("dispatcher");
    expect(presetOf(PRESETS.fleet_admin.permissions)).toBe("fleet_admin");
    expect(presetOf(["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"])).toBe("admin");
    expect(presetOf(["view", "users"])).toBeNull();
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
