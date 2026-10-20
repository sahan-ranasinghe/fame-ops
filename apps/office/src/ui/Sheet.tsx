// One sheet for the site (docs/ui-patterns.md §6): a bottom sheet under 768 px (a grab handle, the title, the content
// scrolling inside, the actions fixed at the bottom, at most 85 % of the screen; the dimmed area, Esc or a swipe down
// closes it), on a desktop a popover under the control that opened it (`anchor`), or a centred dialog when there is none.
// Used by the filters, the date range, the day pickers and the time field. Drawn on document.body (a portal): a sheet
// opened inside a form never submits it. Esc closes only the top sheet and nothing behind it (a page's own Esc, a
// detail panel, the Ask drivers sheet).
import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./icons";
import { useIsPhone } from "./phone";

/** The open sheets, the newest last: Esc and a click outside belong to the top one. */
const stack: object[] = [];

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  /** The heading (and the dialog's name). */
  title: string;
  children: ReactNode;
  /** The actions, fixed at the bottom (Clear · Apply, Done). */
  footer?: ReactNode;
  /** A desktop popover sits under this element (the button that opened it); none = a centred dialog. */
  anchor?: RefObject<HTMLElement | null>;
  /** The popover's width on a desktop (px). */
  width?: number;
  /** Shown as a bottom sheet on a desktop too (none use it yet; tests may). */
  forcePhone?: boolean;
  /** The element focused when it opens (else the first control inside). */
  initialFocus?: RefObject<HTMLElement | null>;
  /** Hide the heading on a desktop popover (the button already says what it is). */
  quietTitle?: boolean;
  testId?: string;
  className?: string;
}

const FOCUSABLE = "button:not([disabled]), input:not([disabled]), [href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

interface Place {
  top: number;
  left: number;
  maxHeight: number;
}

/** Where a popover goes: under the anchor, kept inside the window; above it when there is more room there. Pure. */
export function popoverPlace(rect: { top: number; bottom: number; left: number }, width: number, view: { width: number; height: number }): Place {
  const margin = 8;
  const left = Math.max(margin, Math.min(rect.left, view.width - width - margin));
  const below = view.height - rect.bottom - margin - 6;
  const above = rect.top - margin - 6;
  if (below < 320 && above > below) {
    const maxHeight = Math.max(200, above);
    return { top: Math.max(margin, rect.top - 6 - maxHeight), left, maxHeight };
  }
  return { top: rect.bottom + 6, left, maxHeight: Math.max(200, below) };
}

export function Sheet({ open, onClose, title, children, footer, anchor, width = 340, forcePhone, initialFocus, quietTitle, testId, className = "" }: SheetProps) {
  const isPhone = useIsPhone();
  const phone = isPhone || !!forcePhone;
  const popover = !phone && !!anchor;
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const [place, setPlace] = useState<Place | null>(null);
  const downOnShade = useRef(false);
  const drag = useRef<number | null>(null);
  const [dy, setDy] = useState(0);

  // Esc, the stack, the focus: once per opening.
  useEffect(() => {
    if (!open) return;
    const me = {};
    stack.push(me);
    const opener = document.activeElement as HTMLElement | null;
    const first = initialFocus?.current ?? box.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== "Escape" || stack[stack.length - 1] !== me) return;
      ev.preventDefault();
      ev.stopPropagation();
      close.current();
    };
    // A click outside a popover closes it (without applying); the anchor toggles it itself.
    const onDown = (ev: MouseEvent) => {
      if (stack[stack.length - 1] !== me) return;
      const t = ev.target as Node | null;
      if (!t || box.current?.contains(t) || anchor?.current?.contains(t)) return;
      // A click on another sheet drawn over this one (its portal) is not outside.
      if ((t as Element).closest?.("[data-sheet]")) return;
      close.current();
    };
    window.addEventListener("keydown", onKey, true);
    if (popover) document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      if (opener && document.contains(opener)) opener.focus?.();
    };
    // The anchor and the focus target are read once when it opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, popover]);

  // The popover follows its anchor (a scroll, a resize).
  useLayoutEffect(() => {
    if (!open || !popover) return;
    const measure = () => {
      const r = anchor?.current?.getBoundingClientRect();
      if (r) setPlace(popoverPlace(r, width, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, popover, anchor, width]);

  if (!open) return null;

  /** Tab stays inside the sheet. */
  const trap = (ev: ReactKeyboardEvent<HTMLDivElement>) => {
    if (ev.key !== "Tab" || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
    if (!items.length) return;
    const [head, tail] = [items[0], items[items.length - 1]];
    if (ev.shiftKey && document.activeElement === head) {
      ev.preventDefault();
      tail.focus();
    } else if (!ev.shiftKey && document.activeElement === tail) {
      ev.preventDefault();
      head.focus();
    }
  };

  const head = (
    <div className={`usheet-h${popover && quietTitle ? " sr-only" : ""}`}>
      <h2>{title}</h2>
      {!popover && <button type="button" className="btn icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button>}
    </div>
  );
  const panel = (
    <div
      ref={box}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-sheet=""
      data-testid={testId}
      className={`usheet ${phone ? "bottom" : popover ? "popover" : "dialog"} ${className}`}
      style={popover
        ? { position: "fixed", top: place?.top ?? 0, left: place?.left ?? 0, width, maxHeight: place?.maxHeight, visibility: place ? undefined : "hidden" }
        : phone && dy > 0 ? { transform: `translateY(${dy}px)` } : undefined}
      onKeyDown={trap}
      // A press inside never reaches a form or a row under the portal's React parent.
      onClick={(e) => e.stopPropagation()}
    >
      {phone && (
        <div className="usheet-grab" aria-hidden="true"
          onTouchStart={(e) => { drag.current = e.touches[0].clientY; }}
          onTouchMove={(e) => { if (drag.current !== null) setDy(Math.max(0, e.touches[0].clientY - drag.current)); }}
          onTouchEnd={() => { drag.current = null; if (dy > 80) onClose(); setDy(0); }}>
          <i />
        </div>
      )}
      {head}
      <div className="usheet-b">{children}</div>
      {footer && <div className="usheet-f">{footer}</div>}
    </div>
  );
  if (popover) return createPortal(panel, document.body);
  return createPortal(
    <div className="usheet-shade" data-sheet=""
      onMouseDown={(e) => { downOnShade.current = e.target === e.currentTarget; }}
      onClick={(e) => { e.stopPropagation(); if (downOnShade.current && e.target === e.currentTarget) onClose(); }}>
      {panel}
    </div>,
    document.body,
  );
}
