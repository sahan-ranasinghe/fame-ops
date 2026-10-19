// Signed in or not (Sahan, 19 October 2026): only a 401 or 403 from /me goes to the sign-in page. A dropped /me (no
// connection, a 5xx) is asked again once after 2 s; if it still fails the page says "Fame Fleet did not answer" with Try
// again and the person stays signed in. The same when the stored token could not be refreshed for want of a connection.
import { AuthRetryableFetchError } from "@supabase/supabase-js";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth/AuthProvider";
import { Gate } from "./WebApp";

const auth = vi.hoisted(() => ({
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: () => undefined } } })),
  mfa: {
    getAuthenticatorAssuranceLevel: vi.fn(async () => ({ data: { currentLevel: "aal1", nextLevel: "aal1" }, error: null })),
    listFactors: vi.fn(async () => ({ data: { totp: [] }, error: null })),
  },
  signOut: vi.fn(async () => ({ error: null })),
}));

vi.mock("../auth/supabase", async () => {
  const { tokenOf } = await import("../auth/session");
  return {
    supabase: { auth },
    configured: true,
    recoveryLink: false,
    apiBase: "https://x.test/functions/v1/office-api",
    accessToken: async () => tokenOf(await auth.getSession()),
  };
});
vi.mock("./routes", async () => {
  const { createElement } = await import("react");
  return { routes: [{ path: "*", Component: () => createElement("h1", null, "Overview") }] };
});
vi.mock("../push", () => ({ registerServiceWorker: () => () => undefined }));

const ME = { name: "Sahan", email: "sahan@fame.test", role: "admin", permissions: ["view"], tools: [] };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** office-api's answers to GET /me, in order. */
function meAnswers(...answers: Response[]) {
  const fetchFn = vi.fn(async (url: RequestInfo | URL) => {
    expect(String(url)).toBe("https://x.test/functions/v1/office-api/me");
    return answers.shift() ?? reply(200, ME);
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

const WAIT = { timeout: 6_000 };

describe("the web app's gate: a dropped /me never signs anyone out", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "tok" } }, error: null });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("/me 503 once: asked again after 2 s and the page loads", async () => {
    const fetchFn = meAnswers(reply(503, {}), reply(200, ME));
    render(<AuthProvider><Gate /></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Overview" }, WAIT)).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("/me 503 twice: 'Fame Fleet did not answer' with Try again, still signed in; Try again loads the page", async () => {
    const fetchFn = meAnswers(reply(503, {}), reply(503, {}), reply(200, ME));
    render(<AuthProvider><Gate /></AuthProvider>);
    expect(await screen.findByText("Fame Fleet did not answer.", undefined, WAIT)).toBeTruthy();
    expect(screen.getByText("You are still signed in. Check the connection, then try again.")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(auth.signOut).not.toHaveBeenCalled();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: "Overview" }, WAIT)).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(3);
  });

  it("/me 401 (the session expired or was revoked): the sign-in page at once", async () => {
    const fetchFn = meAnswers(reply(401, { error: "not_signed_in" }));
    render(<AuthProvider><Gate /></AuthProvider>);
    expect(await screen.findByRole("heading", { name: "Sign in" }, WAIT)).toBeTruthy();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("the stored token could not be refreshed (no connection): 'did not answer', not the sign-in page", async () => {
    auth.getSession.mockResolvedValue({ data: { session: null }, error: new AuthRetryableFetchError("Failed to fetch", 0) });
    const fetchFn = meAnswers();
    render(<AuthProvider><Gate /></AuthProvider>);
    expect(await screen.findByText("Fame Fleet did not answer.", undefined, WAIT)).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Sign in" })).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});
