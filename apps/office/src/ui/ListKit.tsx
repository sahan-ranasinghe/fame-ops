// One list pattern for every list page (Hotfix 3, L3): a sensible default filter, the most urgent or newest first, 25 rows
// at a time, the count in the header, a search box once a list can pass a page, the filters in the URL and an empty-state
// line; on a phone cards with "Load more", on a desktop table page numbers.
//
// The tools page the same way (@fleet/paging): asked with `limit` (and `cursor`) they answer the page with `total` and
// `next`. usePagedList keeps ONE query per list, so the store's refresh (`every`) and its refetch after a write work as
// for any other screen: "Load more" grows the limit by a page (the rows already shown stay, more come under them); page
// numbers ask one page by its cursor. useWatchedPagedList does the same on a fixed store entry (a list whose entry other
// pages read or patch: the request page finds its card in "reqs", the issue panel patches "issuesAll"), and
// useLocalPagedList pages rows already in memory (Reminders) with the same look.
import { cursorAt, MAX_LIMIT } from "@fleet/paging";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useEntry } from "../data/hooks";
import type { Entry } from "../data/store";
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
  /** The arguments asked (the filters with limit and cursor; null = nothing asked): a Realtime reload asks the same. */
  asked?: Record<string, unknown> | null;
}

interface PagingState {
  key: string;
  shown: number;
  page: number;
}

/**
 * The paging of one list: how many pages are shown ("more") or which page ("pages"). Back to the first page whenever the
 * filters (`resetKey`) or the mode change; the reset happens in the same render, so a new filter never asks a later page.
 */
function usePaging(resetKey: string, mode: PagingMode) {
  const key = `${mode}|${resetKey}`;
  const [st, setSt] = useState<PagingState>({ key, shown: 1, page: 1 });
  const cur = st.key === key ? st : { key, shown: 1, page: 1 };
  // New filters: the first page (React re-renders at once with it; nothing is fetched for the old page).
  if (st.key !== key) setSt(cur);
  return {
    shown: cur.shown,
    page: cur.page,
    loadMore: () => setSt((s) => (s.key === key ? { ...s, shown: s.shown + 1 } : { key, shown: 2, page: 1 })),
    setPage: (p: number) => setSt((s) => ({ key, shown: s.key === key ? s.shown : 1, page: p })),
  };
}

function useMode(opts: { mode?: PagingMode; pageSize?: number }): { mode: PagingMode; pageSize: number } {
  const isPhone = useIsPhone();
  return { mode: opts.mode ?? (isPhone ? "more" : "pages"), pageSize: opts.pageSize ?? PAGE_SIZE };
}

/** The tool's arguments for the page(s) shown: the filters with limit, and the cursor of a later page. */
function pageArgs(args: Record<string, unknown> | null, mode: PagingMode, pageSize: number, shown: number, page: number): Record<string, unknown> | null {
  if (args === null) return null;
  // "more" asks every page shown in one call, up to the most a tool answers at once (then the search or a filter narrows).
  return mode === "more"
    ? { ...args, limit: Math.min(MAX_LIMIT, pageSize * shown) }
    : { ...args, limit: pageSize, cursor: page > 1 ? cursorAt((page - 1) * pageSize) : undefined };
}

function listOf<T, A extends { total?: number }>(
  items: T[],
  answer: A | undefined,
  query: Query<A>,
  mode: PagingMode,
  pageSize: number,
  paging: ReturnType<typeof usePaging>,
  asked: Record<string, unknown> | null,
): PagedList<T, A> {
  const total = answer?.total ?? items.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return {
    items,
    total,
    mode,
    hasMore: mode === "more" && items.length < total && items.length < MAX_LIMIT,
    loadMore: paging.loadMore,
    page: paging.page,
    pages,
    setPage: (p: number) => paging.setPage(Math.min(Math.max(1, p), pages)),
    answer,
    query,
    asked,
  };
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
  const { mode, pageSize } = useMode(opts);
  const { mode: _m, pageSize: _p, ...query } = opts;
  const paging = usePaging(argsKey(args), mode);
  const asked = pageArgs(args, mode, pageSize, paging.shown, paging.page);
  const q = useQuery<A>(key, tool, asked, { keep: true, ...query });
  const items = q.data ? itemsOf(q.data) : [];
  return listOf(items, q.data, q, mode, pageSize, paging, asked);
}

/** Marks an answer on screen as another filter's or page's until the one asked lands (see useWatchedPagedList). */
const STALE = "__otherArgs";

/**
 * usePagedList on a fixed store entry, watched every `every` ms (the store's watch: the artifact's watchTool, the web's
 * polling, refetched after a write). For a list whose entry other pages read or patch by its key. While new filters or
 * another page load, the rows on screen stay, marked stale (dimmed, "Updating…"): the entry's answer carries a mark that
 * the next answer, even an equal one, replaces.
 */
export function useWatchedPagedList<T, A extends { total?: number; next?: string }>(
  key: string,
  tool: string,
  args: Record<string, unknown> | null,
  itemsOf: (answer: A) => T[],
  opts: { every: number; enabled?: boolean; mode?: PagingMode; pageSize?: number },
): PagedList<T, A> & { entry: Entry<A> } {
  const { store } = useFleet();
  const { mode, pageSize } = useMode(opts);
  const paging = usePaging(argsKey(args), mode);
  const asked = pageArgs(args, mode, pageSize, paging.shown, paging.page);
  const on = (opts.enabled ?? true) && asked !== null;
  const ak = argsKey(asked);
  const every = opts.every;
  useEffect(() => {
    if (!on) return;
    store.patch<A>(key, (d) => ((d as Record<string, unknown>)[STALE] ? d : { ...d, [STALE]: true }));
    store.watch(key, tool, JSON.parse(ak) as Record<string, unknown>, every);
    return () => store.unwatch(key);
  }, [store, key, tool, ak, every, on]);
  const entry = useEntry<A>(key);
  const data = on ? entry.data : undefined;
  const stale = !!data && (data as Record<string, unknown>)[STALE] === true;
  const refetch = useCallback(() => {
    if (on) void store.load(key, tool, JSON.parse(ak) as Record<string, unknown>);
  }, [store, key, tool, ak, on]);
  const query: Query<A> = {
    data,
    err: on ? entry.err : undefined,
    loading: on && data === undefined && !entry.err,
    updating: on && data !== undefined && (stale || entry.loading),
    stale,
    fetching: on && (stale || entry.loading),
    refetch,
  };
  const items = data ? itemsOf(data) : [];
  return { ...listOf(items, data, query, mode, pageSize, paging, asked), entry };
}

const IDLE: Query<never> = { data: undefined, err: undefined, loading: false, updating: false, stale: false, fetching: false, refetch: () => {} };

/**
 * Rows already in memory, paged with the same look (25, "Load more" on a phone, page numbers on a desktop). Back to the
 * first page when `resetKey` changes (a filter).
 */
export function useLocalPagedList<T>(rows: T[], opts: { mode?: PagingMode; pageSize?: number; resetKey?: string } = {}): PagedList<T, undefined> {
  const { mode, pageSize } = useMode(opts);
  const paging = usePaging(opts.resetKey ?? "", mode);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(paging.page, pages);
  const items = mode === "more" ? rows.slice(0, pageSize * paging.shown) : rows.slice((page - 1) * pageSize, page * pageSize);
  return {
    items,
    total: rows.length,
    mode,
    hasMore: mode === "more" && items.length < rows.length,
    loadMore: paging.loadMore,
    page,
    pages,
    setPage: (p: number) => paging.setPage(Math.min(Math.max(1, p), pages)),
    answer: undefined,
    query: IDLE as Query<undefined>,
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
      <span className="muted">Showing {list.items.length} of {list.total}{list.hasMore ? "" : " · search or filter to see the rest"}</span>
      {list.hasMore && (
        <button type="button" className="btn small" disabled={list.query.fetching} onClick={list.loadMore}>
          {list.query.fetching ? "Loading…" : "Load more"}
        </button>
      )}
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
/** The app's router's current path (WebApp, ArtifactApp register it); none in tests. */
let routerPath: (() => string) | null = null;
export function watchRouterPath(get: (() => string) | null): void {
  routerPath = get;
}

export function useUrlFilter<V extends string>(name: string, fallback: V, allowed?: readonly V[]): [V, (value: V) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const raw = params.get(name);
  const value = raw !== null && (!allowed || (allowed as readonly string[]).includes(raw)) ? (raw as V) : fallback;
  const set = (next: V) => {
    // Hotfix 4: a write that comes after the page was left (a search settling as a link is followed) would land on the next
    // page's address ("?q=" goes with wherever the router is now): dropped.
    const now = routerPath?.();
    if (now && now !== pathname) return;
    setParams((old) => {
      const out = new URLSearchParams(old);
      if (next === fallback || next === "") out.delete(name);
      else out.set(name, next);
      return out;
    }, { replace: true });
  };
  return [value, set];
}

/** How long typing settles before a search is asked. */
export const SEARCH_DELAY_MS = 300;

/**
 * The list's search box: what is typed waits SEARCH_DELAY_MS for the typing to settle (Enter asks at once), then goes to
 * `onChange` (the URL's ?q=, so the server's `search`). A value changed from outside (Back, a link) shows in the box.
 */
export function SearchBox({ value, onChange, label = "Search", placeholder, delay = SEARCH_DELAY_MS }: {
  value: string;
  onChange: (text: string) => void;
  label?: string;
  placeholder?: string;
  delay?: number;
}) {
  const [draft, setDraft] = useState(value);
  const send = useRef(onChange);
  send.current = onChange;
  // The URL changed by itself: the box follows (a trailing space being typed is kept).
  useEffect(() => setDraft((d) => (d.trim() === value ? d : value)), [value]);
  useEffect(() => {
    const text = draft.trim();
    if (text === value) return;
    const timer = setTimeout(() => send.current(text), delay);
    return () => clearTimeout(timer);
  }, [draft, value, delay]);
  return (
    <label className="field list-search">
      <span>{label}</span>
      <input
        type="search"
        value={draft}
        placeholder={placeholder}
        aria-label={label}
        data-testid="list-search"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && draft.trim() !== value) send.current(draft.trim());
        }}
        // Leaving the box (a click on a link included) sends it at once: a late send would land on the next page's URL.
        onBlur={() => {
          if (draft.trim() !== value) send.current(draft.trim());
        }}
      />
    </label>
  );
}

/** ?q= as a search (useUrlFilter with no default). */
export const useUrlSearch = (name = "q") => useUrlFilter<string>(name, "");

