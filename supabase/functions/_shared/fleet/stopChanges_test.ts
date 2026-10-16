// The driver's push names what changed in the stops (Phase 7, §11).
import { assertEquals } from "@std/assert";
import { stopChanges, type StopForChange } from "./stopChanges.ts";

const s = (key: string, detail = ""): StopForChange => ({ key, place: key, detail });

Deno.test("a stop added, one moved, one removed, one changed: named by their place in the order", () => {
  assertEquals(stopChanges([s("A"), s("B"), s("C")], [s("A"), s("D"), s("B")]).list, [
    { n: 2, place: "D", change: "added" },
    { n: 3, place: "B", change: "moved" },
    { n: 3, place: "C", change: "removed" },
  ]);
  assertEquals(stopChanges([s("A"), s("B")], [s("A"), s("B", "15 min")]).list, [{ n: 2, place: "B", change: "changed" }]);
  assertEquals(stopChanges([s("A")], [s("A")]), { list: [], more: 0 });
});

Deno.test("at most three, with how many more", () => {
  const r = stopChanges([], [s("A"), s("B"), s("C"), s("D"), s("E")]);
  assertEquals(r.list.length, 3);
  assertEquals(r.more, 2);
});
