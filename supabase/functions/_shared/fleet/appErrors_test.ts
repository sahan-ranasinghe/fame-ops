// Hotfix O2-H2: the app's crash reports as the server takes them (appErrors.ts).
import { assert, assertEquals } from "@std/assert";
import { APP_ERROR_INPUT, appErrorRow, scrubText } from "./appErrors.ts";
import { TOOL_PERMISSION } from "./permissions.ts";

Deno.test("a report is cut to the columns and scrubbed again on the server", () => {
  const p = APP_ERROR_INPUT.safeParse({
    app_version: "1.3.0+ab12cd34",
    update_id: "ab12cd34-0000",
    runtime: "1.3.0-gmaps",
    screen: "/office/trip/review",
    message: "Rendered fewer hooks than expected (kamal@fame.lk 0771234567)",
    stack: "at WhoStep (index.bundle:1:2)",
    side: "office",
    fatal: true,
    at: "2026-10-20T06:00:00.000Z",
  });
  assert(p.success);
  const row = appErrorRow(p.data, "office", "11111111-1111-4111-8111-111111111111");
  assertEquals(row.side, "office");
  assertEquals(row.fatal, true);
  assertEquals(row.happened_at, "2026-10-20T06:00:00.000Z");
  assert(!/kamal@|0771234567/.test(row.message), row.message);
  assertEquals(row.screen, "/office/trip/review");
});

Deno.test("a report with no message, or a too long one, is refused", () => {
  assert(!APP_ERROR_INPUT.safeParse({ screen: "/x" }).success);
  assert(!APP_ERROR_INPUT.safeParse({ message: "x".repeat(601) }).success);
  assertEquals(appErrorRow({ message: "m", at: "not a date" }, "driver", null).happened_at, null);
});

Deno.test("scrubText: tokens, keys, e-mails, phones and long numbers", () => {
  const s = scrubText("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc sb_secret_abc AIzaSyA1234567890abcdefghijkl a@b.lk +94 77 123 4567 123456789012");
  assert(!/eyJhbGci|sb_secret_abc|AIzaSyA|a@b\.lk|77 123 4567|123456789012/.test(s), s);
});

Deno.test("list_app_errors is for the people who look after the accounts (users)", () => {
  assertEquals(TOOL_PERMISSION["list_app_errors"], ["users"]);
});
