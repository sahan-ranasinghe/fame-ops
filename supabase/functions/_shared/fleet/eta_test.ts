// The running task's ETA and Google (Phase 7, §35 20): Google is asked only when someone opens the task.
import { assertEquals } from "@std/assert";
import { cachedEtaServes, ETA_CACHE_MS, GOOGLE_ETA_MS } from "./eta.ts";

Deno.test("a Google ETA serves everyone for 15 minutes; an open one for 2, except to a person opening the task", () => {
  const min = 60000;
  // The board, Live, Who's available and the issue check (askGoogle false): any fresh ETA, never a new Google call.
  assertEquals(cachedEtaServes("google", 14 * min, false), true);
  assertEquals(cachedEtaServes("google", GOOGLE_ETA_MS, false), false);
  assertEquals(cachedEtaServes("ors", 1 * min, false), true);
  assertEquals(cachedEtaServes("ors", ETA_CACHE_MS, false), false);
  // Someone opens the running task (askGoogle true): a Google ETA under 15 minutes still answers; an open one does not.
  assertEquals(cachedEtaServes("google", 14 * min, true), true);
  assertEquals(cachedEtaServes("ors", 1 * min, true), false);
  assertEquals(cachedEtaServes("estimate", 30 * 1000, true), false);
});
