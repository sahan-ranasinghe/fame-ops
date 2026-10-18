// One list pattern for every list page (Hotfix 3, L3): a sensible default filter, the most urgent or newest first, 25 rows
// at a time, the count in the header, a search box once a list can pass a page, the filters in the URL and an empty-state
// line; on a phone cards with "Load more", on a desktop table page numbers.
//
// The tools page the same way (@fleet/paging): asked with `limit` (and `cursor`) they answer the page with `total` and
// `next`. usePagedList keeps ONE query per list, so the store's refresh (`every`) and its refetch after a write work as
// for any other screen: "Load more" grows the limit by a page (the rows already shown stay, more come under them); page
// numbers ask one page by its cursor.
import { cursorAt } from "@fleet/paging";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { argsKey, type Query, type QueryOptions, useQuery } from "../data/useQuery";
import { useIsPhone } from "./phone";

/** Rows per page everywhere. */
export const PAGE_SIZE = 25;

export type PagingMode = "more" | "pages";

export interface PagedList<T, A> {
  /** The rows to show (every page loaded so far with "more"; the page asked with "pages"). */
  items: T[];
  /** Every row the filters match (the tool's `total`), or the rows shown when the tool does not page. */
  total: number;
  mode: PagingMode;
  /** "more": another page can be loaded. */
  hasMore: boolean;
  loadMore: () => void;
  /** "pages": the page shown (1 = the first) and how many there are. */
  page: number;
  pages: number;
  setPage: (page: number) => void;
  /** The whole answer of the last load (its other fields: counts, totals). */
  answer: A | undefined;
  query: Query<A>;
}

/**
 * A tool's list, a page at a time. `args` are the filters (null = nothing to ask yet); `itemsOf` reads the rows from the
 * answer. The page goes back to the first whenever the filters change. `mode` defaults to "more" on a phone and "pages" on
 * a desktop.
 */
export function usePagedList<T, A extends { total?: number; next?: string }>(
  key: string,
  tool: string,
  args: Record<string, unknown> | null,
  itemsOf: (answer: A) => T[],
  opts: QueryOptions<A> & { mode?: PagingMode; pageSize?: number } = {},
): PagedList<T, A> {
  const isPhone = useIsPhone();
  const { mode = isPhone ? "more" : "pages", pageSize = PAGE_SIZE, ...query } = opts;
  const filtersKey = argsKey(args);
  const [shown, setShown] = useState(1);
  const [page, setPageState] = useState(1);
  // New filters: back to the first page.
  useEffect(() => {
    setShown(1);
    setPageState(1);
  }, [filtersKey, mode]);

  const asked = useMemo(() => {
    if (args === null) return null;
    return mode === "more"
      ? { ...args, limit: pageSize * shown }
      : { ...args, limit: pageSize, cursor: page > 1 ? cursorAt((page - 1) * pageSize) : undefined };
    // filtersKey stands for args.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtersKey, mode, pageSize, shown, page]);

  const q = useQuery<A>(key, tool, asked, { keep: true, ...query });
  const items = q.data ? itemsOf(q.data) : [];
  const total = q.data?.total ?? items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    total,
    mode,
    hasMore: mode === "more" && items.length < total,
    loadMore: () => setShown((n) => n + 1),
    page,
    pages,
    setPage: (p: number) => setPageState(Math.min(Math.max(1, p), pages)),
    answer: q.data,
    query: q,
  };
}

/** The list's title with its count: "Issues · 132". `right` holds the filters or an action. */
export function ListHeader({ title, count, right, updating }: { title: ReactNode; count?: number; right?: ReactNode; updating?: boolean }) {
  return (
    <div className="card-h list-h">
      <h2>
        {title}
        {count !== undefined && <span className="muted" data-testid="list-count"> · {count}</span>}
        {updating && <span className="updated"> · Updating…</span>}
      </h2>
      {right}
    </div>
  );
}

/** "Load more" under the rows (a phone, the board's columns): "Showing 25 of 132". */
export function LoadMore<T, A>({ list }: { list: PagedList<T, A> }) {
  if (list.mode !== "more" || list.total <= list.items.length) return null;
  return (
    <div className="load-more" data-testid="load-more">
      <span className="muted">Showing {list.items.length} of {list.total}</span>
      <button type="button" className="btn small" disabled={list.query.fetching} onClick={list.loadMore}>
        {list.query.fetching ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}

/** Page numbers under a desktop table: ‹ 1 2 3 … 9 ›. */
export function Pager<T, A>({ list }: { list: PagedList<T, A> }) {
  if (list.mode !== "pages" || list.pages <= 1) return null;
  const { page, pages } = list;
  const near = new Set([1, pages, page - 1, page, page + 1].filter((p) => p >= 1 && p <= pages));
  const shown = [...near].sort((a, b) => a - b);
  const out: (number | "gap")[] = [];
  shown.forEach((p, i) => {
    if (i > 0 && p - shown[i - 1] > 1) out.push("gap");
    out.push(p);
  });
  return (
    <nav className="pager" aria-label="Pages" data-testid="pager">
      <button type="button" className="btn small" disabled={page <= 1} onClick={() => list.setPage(page - 1)} aria-label="Previous page">‹</button>
      {out.map((p, i) =>
        p === "gap"
          ? <span key={`g${i}`} className="muted">…</span>
          : (
            <button key={p} type="button" className={`btn small${p === page ? " dark" : ""}`} aria-current={p === page ? "page" : undefined}
              onClick={() => list.setPage(p)}>{p}</button>
          )
      )}
      <button type="button" className="btn small" disabled={page >= pages} onClick={() => list.setPage(page + 1)} aria-label="Next page">›</button>
    </nav>
  );
}

/** The empty state in words: what the filter and the days mean ("No open issues this week"). */
export function EmptyLine({ children }: { children: ReactNode }) {
  return <div className="card-b muted" data-testid="empty-line">{children}</div>;
}

/**
 * A filter kept in the URL (?name=value; the default leaves no trace), so a reload, Back or a shared link shows the same
 * list.
 */
export function useUrlFilter<V extends string>(name: string, fallback: V, allowed?: readonly V[]): [V, (value: V) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(name);
  const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as V) : fallback;
  const set = (next: V) => {
    setParams((old) => {
      const out = new URLSearchParams(old);
      if (next === fallback || next === "") out.delete(name);
      else out.set(name, next);
      return out;
    }, { replace: true });
  };
  return [value, set];
}
