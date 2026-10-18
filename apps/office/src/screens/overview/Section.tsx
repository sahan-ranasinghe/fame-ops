// One section of the Overview (Hotfix 3, L1): a card whose title is a button that collapses it (the count stays in the
// title, and a collapsed section can show a one-line summary), with "View all (N)" on the right that opens its page or
// the item-16 side panel. The body is kept in the page while collapsed (hidden), so its data stays fresh.
import type { ReactNode } from "react";
import { Link } from "react-router";

export interface ViewAllLink {
  to: string;
  label: string;
  replace?: boolean;
  state?: unknown;
}

export function Section({ id, title, count, tone, collapsed, onToggle, viewAll, summary, testid, children }: {
  id: string;
  title: string;
  /** Shown beside the title, collapsed or not. */
  count?: number;
  /** The red block (Needs a driver, Critical issues) or the amber one (Requests to approve). */
  tone?: "bad" | "warn";
  collapsed: boolean;
  onToggle: () => void;
  viewAll?: ViewAllLink | null;
  /** One line under the title while collapsed. */
  summary?: ReactNode;
  testid?: string;
  children: ReactNode;
}) {
  const body = `ov-${id}`;
  return (
    <section className={`card ov-sec${tone ? ` ${tone}` : ""}`} data-testid={testid ?? `ov-${id}`} data-section={id} data-collapsed={collapsed ? "true" : undefined}>
      <div className="ov-sec-h">
        <h2>
          <button type="button" className="ov-toggle" aria-expanded={!collapsed} aria-controls={body} onClick={onToggle}>
            <span className="chev" aria-hidden="true" />
            <span className="ov-title">{title}</span>
            {typeof count === "number" && <span className="ov-count" data-testid="ov-count">{count}</span>}
          </button>
        </h2>
        {viewAll && (
          <Link className="ov-all" to={viewAll.to} replace={viewAll.replace} state={viewAll.state} data-testid="view-all">{viewAll.label}</Link>
        )}
      </div>
      {collapsed && summary ? <div className="ov-summary">{summary}</div> : null}
      <div id={body} className="ov-body" hidden={collapsed}>{children}</div>
    </section>
  );
}
