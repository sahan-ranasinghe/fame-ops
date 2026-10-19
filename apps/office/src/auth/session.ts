// Signed in or not (Sahan, 19 October 2026): a server or network error never signs anyone out; only a 401 or 403 does.
// supabase-js answers getSession() with no session both when there is none and when an expired token could not be
// refreshed for want of a connection (AuthRetryableFetchError; the session stays stored and is refreshed later). Only the
// first is "signed out"; the second is a call that did not get through.
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { FleetError } from "../transport/types";

/** What getSession() answered: a session, none, or none for now (the refresh did not get through). */
export type SessionKind = "ok" | "offline" | "none";

type SessionAnswer = { data: { session: { access_token: string } | null }; error?: unknown };

export function sessionKind(answer: SessionAnswer): SessionKind {
  if (answer.data.session) return "ok";
  return answer.error && isAuthRetryableFetchError(answer.error) ? "offline" : "none";
}

/** The token for office-api: null only when there is no session; a refresh that did not get through is a dropped call. */
export function tokenOf(answer: SessionAnswer): string | null {
  const kind = sessionKind(answer);
  if (kind === "offline") throw { code: "network", message: "No connection to Fame Fleet." } satisfies FleetError;
  return kind === "ok" ? answer.data.session!.access_token : null;
}
