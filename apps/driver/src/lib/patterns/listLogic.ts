// The list pattern's rules (docs/ui-patterns.md §5), pure: a promise with a timeout (every call ends: an answer or an
// error with Try again, never a spinner forever) and what a list shows from its state.

export const SUGGEST_TIMEOUT_MS = 15_000;
export const POSITION_TIMEOUT_MS = 3_000;

export class TimeoutError extends Error {
  code = 'timeout';
  constructor(message = 'Fame Fleet did not answer in time.') {
    super(message);
  }
}

/** The promise, or a TimeoutError after `ms`. */
export function withTimeout<T>(p: Promise<T>, ms: number, message?: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(message)), ms);
    p.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
}

/**
 * What a list shows: skeleton rows while the first answer is on its way, the error with Try again when it failed with
 * nothing to show, the empty state, or the rows (with "Couldn't refresh" over them when a refresh failed).
 */
export type ListView = 'skeleton' | 'error' | 'empty' | 'rows' | 'rows_stale';
export function listView(s: { loading: boolean; hasData: boolean; count: number; error: boolean }): ListView {
  if (!s.hasData) return s.error ? 'error' : s.loading ? 'skeleton' : 'empty';
  if (s.count === 0) return s.error ? 'error' : 'empty';
  return s.error ? 'rows_stale' : 'rows';
}
