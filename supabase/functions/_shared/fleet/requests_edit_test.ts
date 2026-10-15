// Editing a request and deciding it again (Phase 6, Part 2): the diff in words,
// the status machine, the version check. Pure.
import { assertEquals, assertThrows } from "@std/assert";
import { ToolError } from "./db.ts";
import {
  canRedecide,
  checkVersion,
  diffText,
  requestDiff,
  type RequestFields,
  snapshot,
  statusAfterEdit,
} from "./requests_rules.ts";

const base: RequestFields = {
  needed_at: "2026-10-15T03:30:00.000Z", // Thu 15 Oct 09:00 Colombo
  back_by: "2026-10-15T06:30:00.000Z",
  route_from: "Head office",
  route_to: "Galle",
  need_type: "van",
  pax: 4,
  tools: false,
  note: null,
  driver_required: true,
};

Deno.test("the diff names each changed field in the office's words", () => {
  const after = {
    ...base,
    needed_at: "2026-10-15T04:00:00.000Z",
    route_to: "Matara",
    pax: 6,
    tools: true,
    back_by: null,
    driver_required: false,
  };
  const changes = requestDiff(base, after);
  assertEquals(changes, {
    time: { from: "Thu 15 Oct 09:00", to: "Thu 15 Oct 09:30" },
    "back by": { from: "12:00", to: null },
    to: { from: "Galle", to: "Matara" },
    passengers: { from: "4", to: "6" },
    tools: { from: "no", to: "yes" },
    driver: { from: "a driver", to: "the custodian drives" },
  });
  assertEquals(
    diffText(changes),
    "time Thu 15 Oct 09:00 → Thu 15 Oct 09:30, back by 12:00 → —, to Galle → Matara, passengers 4 → 6, tools no → yes, driver a driver → the custodian drives",
  );
});

Deno.test("nothing changed: an empty diff; a back-by on another day shows its day", () => {
  assertEquals(requestDiff(base, { ...base }), {});
  const d = requestDiff(base, { ...base, back_by: "2026-10-16T03:30:00.000Z" });
  assertEquals(d["back by"], { from: "12:00", to: "Fri 16 Oct 09:00" });
  assertEquals(requestDiff(base, { ...base, need_type: "car" }).vehicle, {
    from: "Van",
    to: "Car",
  });
});

Deno.test("the snapshot keeps only the editable fields", () => {
  const row = {
    ...base,
    id: "x",
    status: "waiting",
    extra: 1,
  } as unknown as RequestFields;
  assertEquals(Object.keys(snapshot(row)).sort(), [
    "back_by",
    "driver_required",
    "need_type",
    "needed_at",
    "note",
    "pax",
    "route_from",
    "route_to",
    "tools",
  ]);
});

Deno.test("an edit keeps a waiting request waiting; an approved one becomes changed and needs re-approval", () => {
  assertEquals(statusAfterEdit("waiting"), {
    status: "waiting",
    event: "edited",
    needs_reapproval: false,
  });
  assertEquals(statusAfterEdit("approved"), {
    status: "changed",
    event: "changed",
    needs_reapproval: true,
  });
  assertEquals(statusAfterEdit("changed"), {
    status: "changed",
    event: "edited",
    needs_reapproval: true,
  });
  assertThrows(() => statusAfterEdit("declined"), ToolError, "declined");
  assertThrows(() => statusAfterEdit("cancelled"), ToolError, "cancelled");
});

Deno.test("a stale version is refused with both numbers", () => {
  checkVersion(3, 3);
  assertThrows(() => checkVersion(3, 2), ToolError, "version 3, you have 2");
});

Deno.test("redecide works on approved and changed requests only", () => {
  canRedecide("approved");
  canRedecide("changed");
  assertThrows(() => canRedecide("waiting"), ToolError, "decide_request");
  assertThrows(
    () => canRedecide("declined"),
    ToolError,
    "nothing to decide again",
  );
});
