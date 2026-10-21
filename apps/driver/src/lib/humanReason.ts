// A server's refusal shown to a driver only when it is a sentence for people (Round 1, 21 October 2026: nothing internal
// is ever shown). An error code ("not_on_duty"), "HTTP 500", JSON, a key ("trip.failed") or an id is replaced by the
// plain "try again" words. Pure: scripts/test-status-words.ts checks it.

const INTERNAL = [
  /^HTTP \d+/i,
  /^[{[]/, // JSON
  /\b[a-z]+_[a-z_]+\b/, // an enum or code: not_on_duty
  /\b[a-z][A-Za-z]+\.[A-Za-z_]\w*\b/, // a key: trip.failed
  /[0-9a-f]{8}-[0-9a-f]{4}-/i, // an id
  /(?:PGRST\d*|JWT|23505|42501|SQLSTATE|TypeError|undefined|null)\b/,
];

/** The server's words when they are a sentence for people; else null. */
export function humanReason(text: string | null | undefined): string | null {
  const s = (text ?? '').trim();
  if (!s || !/\s/.test(s) || s.length > 200) return null;
  return INTERNAL.some((re) => re.test(s)) ? null : s;
}

/** "Couldn't save: <the reason>", or with the plain words when the reason is not for people. */
export function failedText(t: (key: string, vars?: Record<string, string | number>) => string, key: string, message: string | null | undefined): string {
  return t(key, { reason: humanReason(message) ?? t('common.tryAgainLater') });
}
