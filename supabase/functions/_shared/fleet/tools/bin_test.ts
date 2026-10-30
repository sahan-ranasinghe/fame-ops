// Round 52 (docs/phase8-plan.md §40): the rules of delete, the bin and archive that need no database. Who may call what
// (by permission: archive with the record's, a wrong entry with approve, a record and the bin with users), that the
// connector never offers a delete, the words a refusal says, and the type-to-confirm comparison. The moving itself is the
// database's (supabase/tests/database/round52_bin.test.sql).
import { assert, assertEquals } from "@std/assert";
import { allows, PRESETS, permissionsForRole, TOOL_PERMISSION } from "../permissions.ts";
import { TOOLS } from "../index.ts";
import { WEB_ONLY_TOOLS } from "./media.ts";
import { binErrorText, confirmMatches, ENTRY_KINDS, hasHistoryText, historyWords, RECORD_KINDS } from "./bin.ts";

const DELETES = ["can_delete", "delete_record", "delete_entry", "list_bin", "restore_bin_item"];
const ARCHIVES = ["set_driver_active", "set_vehicle_active", "remove_place", "restore_place", "set_project_archived", "set_rental_company_archived"];

Deno.test("who: archive with the record's permission, a wrong entry with approve, a record and the bin with users", () => {
  const admin = permissionsForRole("admin");
  const fleetAdmin = PRESETS.fleet_admin.permissions;
  const coordinator = PRESETS.coordinator.permissions;
  const dispatcher = PRESETS.dispatcher.permissions;
  for (const t of ARCHIVES) assert(allows(fleetAdmin, t) && allows(coordinator, t) && !allows(dispatcher, t), `archive: ${t}`);
  assert(allows(admin, "delete_entry") && allows(fleetAdmin, "delete_entry"), "a wrong entry: admins and fleet admins");
  assert(!allows(coordinator, "delete_entry") && !allows(dispatcher, "delete_entry"), "never the Coordinator or a dispatcher");
  for (const t of ["delete_record", "can_delete", "list_bin", "restore_bin_item"]) {
    assert(allows(admin, t), `admin: ${t}`);
    assert(!allows(fleetAdmin, t) && !allows(coordinator, t), `only an admin: ${t}`);
  }
  for (const t of [...DELETES, ...ARCHIVES, "list_projects", "list_rental_companies"]) assert(TOOL_PERMISSION[t], `a permission for ${t}`);
});

Deno.test("the connector keeps no delete: every delete and bin tool is web only; archive and restore stay on it", () => {
  for (const t of DELETES) assert(WEB_ONLY_TOOLS.has(t), t);
  for (const t of ARCHIVES) assert(!WEB_ONLY_TOOLS.has(t), t);
  const names = new Set(TOOLS.map((t) => t.name));
  for (const t of [...DELETES, ...ARCHIVES, "list_projects", "list_rental_companies"]) assert(names.has(t), `registered: ${t}`);
  // The deletes are never read-only (the retry rule re-asks only reads).
  for (const t of TOOLS.filter((x) => ["delete_record", "delete_entry", "restore_bin_item"].includes(x.name))) assertEquals(t.readOnly, false);
  assertEquals([...RECORD_KINDS].length + [...ENTRY_KINDS].length, 12);
});

Deno.test("the words: history counted, a refusal says what to do", () => {
  assertEquals(historyWords({ tasks: 3, fuel: 1, odometer: 12 }), "3 tasks, 1 fill, 12 odometer readings");
  assertEquals(historyWords({ vehicles: 1 }), "1 vehicle");
  assertEquals(hasHistoryText("WP CAB-4521", { tasks: 2 }), "WP CAB-4521 has history (2 tasks): archive it instead. Nothing was deleted.");
  assertEquals(binErrorText("taken: duplicate key value", "BIN-1"),
    "Something with the same name, plate or username exists now. Rename or archive it first, then restore this.");
  assertEquals(binErrorText("gone: public.rental_companies", "BIN-1"), "It belongs to a rental company that is gone now: it cannot come back.");
  assertEquals(binErrorText("task_running", "Task · X"), "That task is under way: it can be deleted once it is finished or cancelled.");
  assertEquals(binErrorText("base_place", "Head office"), "Head office is the base place: choose another one in Settings → Fleet first.");
});

Deno.test("type to confirm: a plate whatever its spaces, dashes and case; a name whatever its case and spacing; nothing else", () => {
  assert(confirmMatches("vehicle", "wp cab 4521", "WP CAB-4521"));
  assert(confirmMatches("vehicle", "WPCAB4521", "WP CAB-4521"));
  assert(!confirmMatches("vehicle", "WP CAB-452", "WP CAB-4521"));
  assert(confirmMatches("driver", "  kamal   perera ", "Kamal Perera"));
  assert(!confirmMatches("driver", "Kamal", "Kamal Perera"));
  assert(!confirmMatches("office_person", undefined, "Dilini"));
});
