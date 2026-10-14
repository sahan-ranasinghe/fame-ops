// The pieces every page shares: the top with a back arrow (a detail panel on a
// desktop, a full screen on a phone), a sticky row of actions above the phone's
// tab bar, and the list-plus-detail layout (the list on the left and the detail
// in a panel on a desktop; only the detail, full screen, on a phone).
import { type ReactNode, useEffect } from "react";
import { useNavigate, useOutlet } from "react-router";
import { useIsPhone } from "./phone";
import { Icon } from "./icons";

/** Back: to `backTo` when given, else one step in the history (a page opened by a link). */
export function useBack(backTo?: string): () => void {
  const navigate = useNavigate();
  return () => {
    if (backTo) navigate(backTo);
    else if (window.history.length > 1) navigate(-1);
    else navigate("/");
  };
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
 */
export function ListWithDetail({ children }: { children: ReactNode }) {
  const outlet = useOutlet();
  const phone = useIsPhone();
  if (outlet && phone) return <div className="detail-page" data-testid="detail">{outlet}</div>;
  return (
    <div className={outlet ? "split has-detail" : "split"}>
      <div className="split-list">{children}</div>
      {outlet && <aside className="split-detail" aria-label="Detail" data-testid="detail">{outlet}</aside>}
    </div>
  );
}
