// Round 53, from the review (2 November 2026): the server now removes a phone token Expo says is dead, but the phone keeps
// its copy and registered again only at app start or sign-in, which the foreground service can put off for days. So the
// token is registered again when the app comes to the front, at most every REREGISTER_MS: a token the server dropped comes
// back (or the phone's new one goes up), and the office's push issue stops naming the driver. Pure (scripts and jest).

/** The phone registers its push token again at most this often when the app comes to the front. */
export const REREGISTER_MS = 6 * 3600_000;

/** Is a new registration due? Never registered in this process (0) = due. */
export function reregisterDue(now: number, lastRegisteredAt: number): boolean {
  return lastRegisteredAt === 0 || now - lastRegisteredAt >= REREGISTER_MS;
}
