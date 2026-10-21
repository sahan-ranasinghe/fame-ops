import { assertEquals } from "jsr:@std/assert";
import { outcomeOf, targetOf } from "./activity.ts";

Deno.test("the Activity log names what a change was about from its own arguments, never their internals", () => {
  assertEquals(targetOf('{"name":"Kasun Silva","username":"kasun.s","pin":"[hidden]"}'), "Kasun Silva · kasun.s");
  assertEquals(targetOf('{"reg_no":"WP CAB-4521","seats":12}'), "WP CAB-4521");
  assertEquals(targetOf('{"task_id":"3f2a9c1e-1234-4abc-9def-000000000000"}'), "");
  assertEquals(targetOf("not json"), "");
  assertEquals(targetOf(null), "");
});

Deno.test("done, refused with its sentence, failed, still running", () => {
  assertEquals(outcomeOf("created office user a@b"), { outcome: "done" });
  assertEquals(outcomeOf("refused: Only an admin can change an admin's account."), {
    outcome: "refused",
    reason: "Only an admin can change an admin's account.",
  });
  assertEquals(outcomeOf("error: TypeError: x is undefined"), { outcome: "failed" });
  assertEquals(outcomeOf("started"), { outcome: "running" });
});

Deno.test("Round 3: every routine action is a real tool that writes (so hiding it hides no read and no unknown name)", async () => {
  const { TOOLS } = await import("../index.ts");
  const { ROUTINE } = await import("./activity.ts");
  const byName = new Map(TOOLS.map((t) => [t.name, t]));
  for (const name of ROUTINE) {
    assertEquals(byName.has(name), true, `${name} is a tool`);
    assertEquals(byName.get(name)!.readOnly, false, `${name} writes`);
  }
  // The changes people care about are never routine.
  for (const name of ["create_task", "decide_request", "update_office_user", "set_office_user_active", "cancel_task"]) {
    assertEquals(ROUTINE.has(name), false, name);
  }
});
