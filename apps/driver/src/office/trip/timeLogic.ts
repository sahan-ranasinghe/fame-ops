// Office mode (Phase 8, O2): the time field's rules, pure (scripts/test-trip.ts).

/** "0930" → "09:30"; "9:3" stays as typed until complete. */
export function formatTyped(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 4);
  if (d.length <= 2) return d;
  return `${d.slice(0, 2)}:${d.slice(2)}`;
}

export const isTime = (v: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
