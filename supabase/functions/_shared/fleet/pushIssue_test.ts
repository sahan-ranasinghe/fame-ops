// Round 53, from the review (2 November 2026): a push to an app driver whose phone has no token left names the driver in
// the office's push issue instead of going quiet; a skipped push for someone who is not an app driver, or archived, does not.
import { assertEquals } from "@std/assert";
import { pushIssueRows } from "./issues.ts";

Deno.test("pushIssueRows: failed sends counted; no_token drivers named once each; not_a_driver and driver_inactive left out", () => {
  const out = pushIssueRows([
    { employee_id: "e1", failed: 1, tokens: 2, errors: [{ token_id: "t", error: "MessageRateExceeded" }] },
    { employee_id: "e2", failed: 0, tokens: 0, errors: [{ error: "no_token" }] },
    { employee_id: "e2", failed: 0, tokens: 0, errors: [{ error: "no_token" }] },
    { employee_id: "e3", failed: 0, tokens: 0, errors: [{ error: "not_a_driver" }] },
    { employee_id: "e4", failed: 0, tokens: 0, errors: [{ error: "driver_inactive" }] },
    { employee_id: "e5", failed: 0, tokens: 0, errors: null },
  ]);
  assertEquals(out, { failed: 1, noPhone: ["e2"], noPhoneSends: 2 });
});
