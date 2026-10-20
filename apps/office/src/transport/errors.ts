import type { FleetError } from "./types";

/** Errors that mean "the page cannot reach Fame Fleet as this person": the data is dropped, not shown stale. */
export const AUTHZ = new Set([
  "needs_reauth", "server_not_connected", "server_not_found", "blocked_by_policy", "approval_required", "not_in_manifest",
  "selection_required", "not_granted", "capability_disabled", "capability_removed", "consent_required", "user_changed",
  "not_signed_in", "mfa_required", "not_an_office_user", "switched_off",
]);

export function asFleetError(e: unknown): FleetError {
  if (e && typeof e === "object") {
    const o = e as { code?: unknown; message?: unknown; status?: unknown };
    return {
      code: typeof o.code === "string" ? o.code : "unknown",
      message: typeof o.message === "string" ? o.message : String(e),
      status: typeof o.status === "number" ? o.status : undefined,
    };
  }
  return { code: "unknown", message: String(e) };
}

export function cleanMsg(m: unknown): string {
  if (!m) return "";
  const s = String(m);
  try {
    const j = JSON.parse(s) as { error?: { message?: string; code?: string } | string; message?: string };
    if (j && typeof j === "object") {
      if (typeof j.error === "string") return j.error;
      if (j.error) return j.error.message || j.error.code || s;
      return j.message || s;
    }
    return s;
  } catch {
    return s.replace(/^Error:\s*/, "");
  }
}

export type Fix = "perms" | "approve" | "retry" | "signin" | null;

/** A sentence for the person, and what would fix it. */
export function errText(e: FleetError | undefined): [string, Fix] {
  switch (e?.code) {
    case "server_not_connected":
    case "server_not_found":
      return ["Fame Fleet isn’t connected to your Claude account. Add it in Settings → Connectors, then reload this page.", null];
    case "needs_reauth":
      return ["Fame Fleet needs to be reconnected. Open Settings → Connectors → Fame Fleet → Connect, then reload.", null];
    case "not_in_manifest":
    case "consent_required":
      return ["Fame Fleet is turned off for this page. Allow it in the page’s permissions.", "perms"];
    case "approval_required":
      return ["Claude needs your approval before this page can use Fame Fleet.", "approve"];
    case "selection_required":
      return ["You have more than one connector called Fame Fleet. Keep one, then reload.", null];
    case "blocked_by_policy":
      return ["Your organisation’s settings block this Fame Fleet tool.", null];
    case "server_unavailable":
    case "rate_limited":
    case "upstream_error":
    case "network":
      // A write is never repeated on its own (transport/retryRule.ts): the person is told, and Try again repeats it.
      if (e.write) return ["Fame Fleet didn’t answer, so this may not have been saved. Try again.", "retry"];
      return ["Fame Fleet didn’t answer. The page tries again by itself.", "retry"];
    case "timeout":
      // No call waits forever (retryRule.ts timeoutFor).
      if (e.write) return ["Fame Fleet didn’t answer in time, so this may not have been saved. Try again.", "retry"];
      return ["Fame Fleet didn’t answer in time. Try again.", "retry"];
    case "not_granted":
    case "capability_disabled":
    case "capability_removed":
      return ["Open this page in Claude to use Fame Fleet.", null];
    case "not_signed_in":
      return ["Your sign-in has ended. Sign in again.", "signin"];
    case "mfa_required":
      return ["Finish the second sign-in step to continue.", "signin"];
    case "not_an_office_user":
      return ["This account has no office role in Fame Fleet.", null];
    case "switched_off":
      return ["This account is switched off.", null];
    case "forbidden":
      return [cleanMsg(e.message) || "Your role cannot do this.", null];
    case "bad_input":
      return [cleanMsg(e.message) || "Something in the form is not right.", null];
    case "tool_error":
      return [cleanMsg(e.message) || "Fame Fleet refused the request.", null];
    default:
      return [cleanMsg(e?.message) || "Something went wrong talking to Fame Fleet.", "retry"];
  }
}

