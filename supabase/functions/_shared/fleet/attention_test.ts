import { assertEquals } from "@std/assert";
import { attentionGroups, type AttentionItem, criticalItems } from "./attention.ts";

const item = (kind: string, severity: string, extra: Partial<AttentionItem> = {}): AttentionItem => ({
  what: `${kind} item`,
  subject: "",
  due: "",
  level: severity === "critical" ? "red" : "amber",
  issue_id: `${kind}-${Math.random().toString(36).slice(2, 7)}`,
  kind,
  severity,
  ...extra,
});
const approver = { requests: true, needsDriver: true, critical: true };
const dispatcher = { requests: false, needsDriver: true, critical: true };
// Someone whose Overview has neither Needs a driver nor Critical issues (a sections rule with both off).
const noSections = { requests: false, needsDriver: false, critical: false };
const TEXT = { odometer_flag: "Odometer check", app_stopped: "App stopped" };

Deno.test("no repeats: requests waiting and needs-a-driver kinds are in their own sections; critical in Critical issues", () => {
  const items = [
    item("request_waiting", "warning"),
    item("not_accepted", "critical"),
    item("declined", "critical"),
    item("signal", "critical"),
    item("app_stopped", "warning"),
  ];
  const a = attentionGroups(items, approver, TEXT);
  assertEquals(a.groups.map((g) => g.kind), ["app_stopped"]);
  assertEquals(criticalItems(items, approver).items.map((i) => i.kind), ["signal"]);
  // A dispatcher's Overview has Needs a driver and Critical issues, not Requests to approve.
  assertEquals(attentionGroups(items, dispatcher, TEXT).groups.map((g) => g.kind), ["request_waiting", "app_stopped"]);
  assertEquals(criticalItems(items, dispatcher).items.map((i) => i.kind), ["signal"]);
  // With neither section every item stays in Needs attention, once.
  assertEquals(attentionGroups(items, noSections, TEXT).groups.map((g) => g.kind), [
    "request_waiting",
    "not_accepted",
    "declined",
    "signal",
    "app_stopped",
  ]);
});

Deno.test("groups: one row per kind with the count, the items inside; one item stays its own words; info stays off", () => {
  const odo = [1, 2, 3].map((n) => item("odometer_flag", "warning", { what: "Odometer check: Typed by the driver", vehicle: `V${n}` }));
  const docs = [1, 2].map((n) => item("documents_missing", "info", { vehicle: `V${n}` }));
  const one = item("allowance", "warning", { what: "Over monthly km allowance" });
  const a = attentionGroups([...odo, ...docs, one], approver, TEXT);
  assertEquals(a.count, 4);
  assertEquals(a.groups.map((g) => [g.title, g.count]), [["Odometer typed by hand · 3", 3], ["Over monthly km allowance", 1]]);
  assertEquals(a.groups[0].issue_ids.length, 3);
});
