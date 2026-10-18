// Hotfix 3 (L3): every list tool pages the same way. Asked with `limit` (and `cursor` for a later page) it answers that
// page, `total` (every row the filters match) and `next` (the cursor of the page after, absent on the last one). Asked
// without `limit` it answers as before (the Teams artifact and Claude keep their whole lists). The cursor is opaque to the
// caller; the web's page numbers make one with cursorAt (the web imports this file as @fleet/paging). Pure: no imports.

/** The most a page may hold (the web's "Load more" grows one list up to this). */
export const MAX_LIMIT = 500;

function toBase64Url(text: string): string {
  return btoa(text).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  return atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
}

/** The cursor of the page that starts at this row (0 = the first). */
export function cursorAt(offset: number): string {
  return toBase64Url(`o:${Math.max(0, Math.floor(offset))}`);
}

/** The row a cursor starts at; a missing or unreadable cursor is the first page. */
export function offsetOf(cursor: string | null | undefined): number {
  if (!cursor) return 0;
  try {
    const m = /^o:(\d{1,7})$/.exec(fromBase64Url(cursor));
    return m ? Number(m[1]) : 0;
  } catch {
    return 0;
  }
}

/** The page's place in the list: the rows to take, and what the answer says about the rest. */
export interface PageWindow {
  offset: number;
  /** null = no paging asked: the whole list, as before. */
  limit: number | null;
}

export function pageWindow(limit: number | null | undefined, cursor: string | null | undefined): PageWindow {
  return limit == null ? { offset: 0, limit: null } : { offset: offsetOf(cursor), limit: Math.min(MAX_LIMIT, Math.max(1, limit)) };
}

/** One page of rows already in memory (sorted), with total and next. */
export function pageOf<T>(rows: readonly T[], w: PageWindow): { rows: T[]; total?: number; next?: string } {
  if (w.limit === null) return { rows: [...rows] };
  const slice = rows.slice(w.offset, w.offset + w.limit);
  const end = w.offset + slice.length;
  return { rows: slice, total: rows.length, next: end < rows.length ? cursorAt(end) : undefined };
}

/** The paging part of an answer for a page the database cut (`total` from a count). */
export function pageInfo(w: PageWindow, shown: number, total: number): { total?: number; next?: string } {
  if (w.limit === null) return {};
  const end = w.offset + shown;
  return { total, next: end < total ? cursorAt(end) : undefined };
}
