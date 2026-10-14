// Who hears about what (docs/dispatch-plan.md, section 9), pure.
import { assertEquals } from "@std/assert";
import { deviceLabel, EVENTS, type Person, recipientsFor, relevantEvents } from "./notifications.ts";

const people: Person[] = [
  { id: "boss", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues", "users"] },
  { id: "fleet", permissions: ["view", "request", "approve", "assign_tasks", "vehicles", "issues"] },
  { id: "dispatcher", permissions: ["view", "request", "assign_tasks"] },
  { id: "staff", permissions: ["view", "request"] },
  { id: "viewer", permissions: ["view"] },
];

Deno.test("a new request goes to everyone who approves, never to the person who made it", () => {
  assertEquals(recipientsFor("request.created", people), ["boss", "fleet"]);
  assertEquals(recipientsFor("request.created", people, { actor: "fleet" }), ["boss"]);
});

Deno.test("a decided request goes to the requester only, unless they decided it themselves", () => {
  assertEquals(recipientsFor("request.decided", people, { requester: "staff", actor: "boss" }), ["staff"]);
  assertEquals(recipientsFor("request.decided", people, { requester: "boss", actor: "boss" }), []);
  assertEquals(recipientsFor("request.decided", people, { requester: null }), []);
  // A requester who is not an active office person (a name typed by the office) gets nothing.
  assertEquals(recipientsFor("request.decided", people, { requester: "someone-else" }), []);
});

Deno.test("a declined or unaccepted task goes to approve and assign_tasks holders, once each", () => {
  assertEquals(recipientsFor("task.declined", people), ["boss", "fleet", "dispatcher"]);
  assertEquals(recipientsFor("task.not_accepted", people), ["boss", "fleet", "dispatcher"]);
});

Deno.test("a critical issue goes to the issues permission; an assigned issue to the assignee, not when they took it themselves", () => {
  assertEquals(recipientsFor("issue.opened", people), ["boss", "fleet"]);
  assertEquals(recipientsFor("issue.assigned", people, { assignee: "fleet", actor: "boss" }), ["fleet"]);
  assertEquals(recipientsFor("issue.assigned", people, { assignee: "fleet", actor: "fleet" }), []);
});

Deno.test("a booking goes to the custodian, not when they booked it", () => {
  assertEquals(recipientsFor("vehicle.booked", people, { custodian: "staff", actor: "fleet" }), ["staff"]);
  assertEquals(recipientsFor("vehicle.booking_cancelled", people, { custodian: "staff", actor: "staff" }), []);
});

Deno.test("the Settings page shows a person the events their permissions can bring", () => {
  assertEquals(relevantEvents(["view"]).map((e) => e.event), []);
  assertEquals(relevantEvents(["request"]).map((e) => e.event), ["request.decided"]);
  assertEquals(relevantEvents(["view", "request", "assign_tasks"]).map((e) => e.event), [
    "request.decided",
    "task.declined",
    "task.not_accepted",
  ]);
  assertEquals(relevantEvents(["view", "request", "approve", "assign_tasks", "vehicles", "issues"]).length, EVENTS.length);
});

Deno.test("a device is named by its browser and system", () => {
  assertEquals(
    deviceLabel("Mozilla/5.0 (Linux; Android 13; CPH2119) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36"),
    "Chrome on Android",
  );
  assertEquals(
    deviceLabel(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    ),
    "Edge on Windows",
  );
  assertEquals(
    deviceLabel(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    ),
    "Safari on iPhone",
  );
  assertEquals(deviceLabel("Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0"), "Firefox on Linux");
  assertEquals(deviceLabel(null), "A browser");
});
