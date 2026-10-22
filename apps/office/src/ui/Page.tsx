// The pieces every page shares: the top with a back arrow (a detail panel on a
// desktop, a full screen on a phone), a sticky row of actions above the phone's
// tab bar, and the list-plus-detail layout (the list on the left and the detail
// in a panel on a desktop; only the detail, full screen, on a phone).
import { type ReactNode, useEffect } from "react";
import { useLocation, useNavigate, useOutlet } from "react-router";
import { useIsPhone } from "./phone";
import { Icon } from "./icons";

/**
 * Back means back (Hotfix 4 b): one step in the history, like the phone's own back, to wherever the person came from
 * (Overview, Tasks, a list). `backTo` is only where a page opened straight (a push, a typed or shared link: the router's
 * first entry) goes, replacing itself, so back never moves forward to a page the person was not on.
 */
export function useBack(backTo?: string): () => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return () => {
    if (hasAppPageBefore(typeof window === "undefined" ? null : window.history.state, key)) navigate(-1);
    else navigate(backTo ?? "/", { replace: true });
  };
}

/**
 * Is there a page of this visit before this one? The browser router keeps each entry's place in history.state.idx (0 = the
 * first, also after a save replaced it); a memory router (tests, the artifact) has only its location key ("default" = the
 * first). Pure.
 */
export function hasAppPageBefore(historyState: unknown, key: string): boolean {
  const idx = (historyState as { idx?: unknown } | null)?.idx;
  return typeof idx === "number" ? idx > 0 : key !== "default";
}

/**
 * After a save: back to wherever the person came from (one step in the history), so the page saved from is not in the
 * history twice; opened straight (a push, a link), to `fallback`, replacing the form.
 */
export function useAfterSave(): (fallback: string, state?: unknown) => void {
  const navigate = useNavigate();
  const { key } = useLocation();
  return (fallback, state) => {
    if (hasAppPageBefore(typeof window === "undefined" ? null : window.history.state, key)) navigate(-1);
    else navigate(fallback, { replace: true, state });
  };
}

/** The navigation state of a link from a task's page to its change pages: a save there goes back to that page. */
export const FROM_TASK = { fromTask: true } as const;
export const cameFromTask = (state: unknown): boolean => (state as { fromTask?: unknown } | null)?.fromTask === true;

/** Cancel or Back on a page: the same as the back arrow (Hotfix 4 b), never a link forward to a fixed page. */
export function BackButton({ fallback, className = "btn", children, testId }: { fallback?: string; className?: string; children: ReactNode; testId?: string }) {
  const back = useBack(fallback);
  return <button type="button" className={className} onClick={back} data-testid={testId}>{children}</button>;
}

/**
 * The top of a detail or form page: the back arrow, the eyebrow and the title.
 * Esc goes back too (a detail panel on a desktop closes like a dialog did).
 */
export function PageTop({ title, sub, backTo, actions }: { title: ReactNode; sub?: ReactNode; backTo?: string; actions?: ReactNode }) {
  const back = useBack(backTo);
  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || ev.defaultPrevented) return;
      // An open dialog (the Ask drivers sheet) takes Esc for itself.
      if (document.querySelector('[aria-modal="true"]')) return;
      const t = ev.target as HTMLElement | null;
      if (t && (t.tagName === "SELECT" || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      back();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });
  return (
    <div className="page-top">
      <button type="button" className="btn icon-btn back" onClick={back} aria-label="Back"><Icon name="back" /></button>
      <div className="grow">
        {sub && <div className="eyebrow">{sub}</div>}
        <h2 className="page-title">{title}</h2>
      </div>
      {actions && <div className="acts">{actions}</div>}
    </div>
  );
}

/** The primary button row: sticky above the tab bar on a phone, a plain row on a desktop. */
export function StickyActions({ children }: { children: ReactNode }) {
  return <div className="sticky-acts">{children}</div>;
}

/**
 * A list page with a routed detail: the detail route renders in the panel on
 * a desktop (the list stays), and alone, full screen, on a phone.
 * The detail is the same element in the same place on both (the <aside>, after the list's place), so a switch between the
 * layouts never remounts it (ui/phone.ts: a window made narrower, or Chromium's full-page capture); before, the phone's
 * page was another element and the detail was made again (a task page back to "Loading the task…").
 */
export function ListWithDetail({ children }: { children: ReactNode }) {
  const outlet = useOutlet();
  const phone = useIsPhone();
  const detailOnly = !!outlet && phone;
  return (
    <div className={detailOnly ? "split detail-only" : outlet ? "split has-detail" : "split"}>
      {detailOnly ? null : <div className="split-list">{children}</div>}
      {outlet && <aside className={detailOnly ? "detail-page" : "split-detail"} aria-label="Detail" data-testid="detail">{outlet}</aside>}
    </div>
  );
}
