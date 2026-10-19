import { assertEquals } from "@std/assert";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { sessionFailure } from "./sessionCheck.ts";

Deno.test("Auth refused the token, or no user: 401 (signed out)", () => {
  assertEquals(sessionFailure(new AuthApiError("invalid JWT: token is expired", 403, "bad_jwt")).status, 401);
  assertEquals(sessionFailure(new AuthApiError("User from sub claim in JWT does not exist", 403, "user_not_found")).status, 401);
  assertEquals(sessionFailure(null), { status: 401, error: "not_signed_in" });
});

Deno.test("Auth did not answer (no connection, 502–504, any 5xx): 503, asked again, never signed out", () => {
  assertEquals(sessionFailure(new AuthRetryableFetchError("Failed to fetch", 0)), { status: 503, error: "auth_unavailable" });
  assertEquals(sessionFailure(new AuthRetryableFetchError("Bad Gateway", 502)).status, 503);
  assertEquals(sessionFailure(new AuthApiError("Internal Server Error", 500, "unexpected_failure")).status, 503);
});
