// Hotfix 3 (L3), W3's local helpers beside the shared list kit (ui/ListKit.tsx, not changed here): a search box whose text
// is in the URL and reaches the server once typing settles, a list held in memory paged the same way as a tool's list
// (Mileage's tables, the site import's history), the paging controls in one place, and the states of a paged list with no
// rows yet (Loading, the error with its fix).
import { type ReactNode, useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { Entry } from "../data/store";
import type { Query } from "../data/useQuery";
import { errText } from "../transport/errors";
import { Loading, Notice } from "../ui/basics";
import { LoadMore, PAGE_SIZE, Pager, type PagedList, type PagingMode, useUrlFilter } from "../ui/ListKit";
import { useIsPhone } from "../ui/phone";

/** How long typing must pause before the search goes to the server. */
export const SEARCH_DEBOUNCE_MS = 300;

/** The value once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    if (Object.is(settled, value)) return;
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms, settled]);
  return settled;
}

/**
 * A list's search box: `text` is what is typed, `search` what the list asks the server for (trimmed, after typing pauses;
 * an emptied box at once). The search is kept in the URL (?q=), so a reload, Back or a shared link shows the same rows.
 */
export function useSearchBox(name = "q", ms = SEARCH_DEBOUNCE_MS): {
  text: string;
  setText: (text: string) => void;
  search: string;
  /** Leaving the box: the typed words go to the URL at once (a late write would land on the next page's URL). */
  flush: () => void;
} {
  const [inUrl, setInUrl] = useUrlFilter<string>(name, "");
  const [text, setText] = useState(inUrl);
  const typed = text.trim();
  const search = useDebounced(typed, typed ? ms : 0);
  // The settled search goes into the URL.
  useEffect(() => {
    if (search !== inUrl) setInUrl(search);
    // Only a new search writes the URL (the URL changing by itself is handled below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);
  // Back, Forward or a link changed the URL: the box follows it.
  useEffect(() => {
    if (inUrl !== search) setText(inUrl);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inUrl]);
  return {
    text,
    setText,
    search,
    flush: () => {
      if (typed !== inUrl) setInUrl(typed);
    },
  };
}

/** The search input itself (a search field: Esc clears it in the browser). */
export function SearchBox({ value, onChange, onBlur, label, placeholder }: {
  value: string;
  onChange: (text: string) => void;
  /** useSearchBox's flush. */
  onBlur?: () => void;
  label: string;
  placeholder?: string;
}) {
  return (
    <input type="search" className="list-search" aria-label={label} placeholder={placeholder ?? label} value={value}
      onChange={(e) => onChange(e.target.value)} onBlur={onBlur} data-testid="list-search" />
  );
}

const NO_REFETCH = () => {};

/**
 * Rows already in memory, shown like a tool's list: 25 at a time, "Load more" on a phone, page numbers on a desktop. The
 * page goes back to the first when `resetKey` changes (other days, another filter).
 */
export function useLocalPages<T>(rows: readonly T[], resetKey: string, opts: { mode?: PagingMode; pageSize?: number } = {}): PagedList<T, readonly T[]> {
  const isPhone = useIsPhone();
  const { mode = isPhone ? "more" : "pages", pageSize = PAGE_SIZE } = opts;
  const [shown, setShown] = useState(1);
  const [page, setPageState] = useState(1);
  useEffect(() => {
    setShown(1);
    setPageState(1);
  }, [resetKey, mode]);
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const at = Math.min(page, pages);
  const items = mode === "more" ? rows.slice(0, shown * pageSize) : rows.slice((at - 1) * pageSize, at * pageSize);
  const query: Query<readonly T[]> = { data: rows, err: undefined, loading: false, updating: false, stale: false, fetching: false, refetch: NO_REFETCH };
  return {
    items,
    total,
    mode,
    hasMore: mode === "more" && items.length < total,
    loadMore: () => setShown((n) => n + 1),
    page: at,
    pages,
    setPage: (p: number) => setPageState(Math.min(Math.max(1, p), pages)),
    answer: rows,
    query,
  };
}

/** Under the rows: "Load more" (a phone) or the page numbers (a desktop table); nothing when everything is shown. */
export function ListFooter<T, A>({ list }: { list: PagedList<T, A> }) {
  return (
    <>
      <LoadMore list={list} />
      <Pager list={list} />
    </>
  );
}

/** A query as a store entry (StaleNote and ErrBox read entries). */
export const asEntry = <T,>(q: Query<T>): Entry<T> => ({ data: q.data, err: q.err, loading: q.loading });

/**
 * A paged list with nothing to show yet: Loading, or the error with its fix (Open permissions in the artifact, else Try
 * again). Null once rows (or an empty answer) are there.
 */
export function ListWaiting<T>({ q, loading }: { q: Query<T>; loading: ReactNode }) {
  const { managePermissions } = useFleet();
  if (q.data !== undefined) return null;
  if (!q.err) return <Loading>{loading}</Loading>;
  const [text, fix] = errText(q.err);
  return (
    <Notice
      tone="bad"
      action={fix === "perms" && managePermissions
        ? <button type="button" className="btn small" onClick={() => void managePermissions()}>Open permissions</button>
        : <button type="button" className="btn small" onClick={q.refetch}>Try again</button>}
    >
      {text}
    </Notice>
  );
}

/** Rows on screen, but the last load failed: one line saying so (rows of other filters: dimmed by the caller). */
export function ListStale<T>({ q }: { q: Query<T> }) {
  if (q.data === undefined || !q.err) return null;
  return (
    <div className="stale" data-testid="list-stale">
      {errText(q.err)[0]} <button type="button" className="btn small" onClick={q.refetch}>Try again</button>
    </div>
  );
}
