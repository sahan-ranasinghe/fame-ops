// Signed in or not (Sahan, 19 October 2026): a server or network error never signs a driver out.
// supabase-js answers getSession() with no session both when there is none and when an expired token could not be
// refreshed for want of a connection (AuthRetryableFetchError; the session stays stored and is refreshed once the phone is
// back online). A phone opened in a no-signal area an hour after its last use is the second: the driver stays in the app.
import { isAuthRetryableFetchError } from '@supabase/supabase-js';

/** What getSession() answered: a session, none for now (the refresh did not get through), or none. */
export type SessionKind = 'ok' | 'offline' | 'none';

export function sessionKind(answer: { data: { session: unknown }; error?: unknown }): SessionKind {
  if (answer.data.session) return 'ok';
  return answer.error && isAuthRetryableFetchError(answer.error) ? 'offline' : 'none';
}
