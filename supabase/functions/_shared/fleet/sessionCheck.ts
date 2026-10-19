// A session check that failed (Sahan, 19 October 2026): "signed out" (401) only when Auth refused the token. When Auth did
// not answer (no connection from the function, a 5xx), the caller gets 503 and asks again (the office app's retry rule, the
// driver app's queue); a 401 would send a signed-in person to the sign-in page. Used by office-api and driver-api.

/** What auth.getUser(token) gave back as its error: supabase-js's AuthError (name, status). */
export interface AuthCheckError {
  name?: string;
  status?: number;
}

/** The answer for a failed check: 503 when Auth did not answer, 401 when it refused the token (or knew no user). */
export function sessionFailure(error: AuthCheckError | null | undefined): { status: 401 | 503; error: string } {
  const unanswered = !!error && (error.name === "AuthRetryableFetchError" || (error.status ?? 0) >= 500);
  return unanswered ? { status: 503, error: "auth_unavailable" } : { status: 401, error: "not_signed_in" };
}
