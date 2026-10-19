// Signed in or not (Sahan, 19 October 2026): supabase-js gives no session both when there is none and when an expired token
// could not be refreshed for want of a connection; only the first is signed out.
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { sessionKind, tokenOf } from "./session";

const session = { access_token: "tok" };

describe("the session from getSession()", () => {
  it("a session is signed in, with its token", () => {
    expect(sessionKind({ data: { session }, error: null })).toBe("ok");
    expect(tokenOf({ data: { session }, error: null })).toBe("tok");
  });

  it("no session and no error, or the server refused the refresh: signed out (no token)", () => {
    expect(sessionKind({ data: { session: null }, error: null })).toBe("none");
    expect(tokenOf({ data: { session: null }, error: null })).toBeNull();
    const refused = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found");
    expect(sessionKind({ data: { session: null }, error: refused })).toBe("none");
    expect(tokenOf({ data: { session: null }, error: refused })).toBeNull();
  });

  it("the refresh did not get through (no connection, or Auth's 502–504): still signed in, the call counts as dropped", () => {
    const offline = new AuthRetryableFetchError("Failed to fetch", 0);
    expect(sessionKind({ data: { session: null }, error: offline })).toBe("offline");
    expect(() => tokenOf({ data: { session: null }, error: offline })).toThrow(expect.objectContaining({ code: "network" }));
  });
});
