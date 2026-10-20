// The one toast at the bottom (docs/ui-patterns.md §10; Gmail's "Message sent · View"): one line, one at a time, 4 s, 6 s
// when it carries an action (Hotfix O2-H2, Part 1b: the same rule as the app's Snackbar). The action is a link (View,
// WhatsApp the driver) or a button: Undo for a reversible change is `{ label: "Undo", onClick }` (Gmail's "Conversation
// archived · Undo"). A form's error stays on the form with Try again; only a switch saved in the background that failed (it
// flips back) says so here, with Try again (Instagram).
import { createContext, type ReactNode, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Link } from "react-router";

export type ToastAction = { label: string; to: string } | { label: string; href: string } | { label: string; onClick: () => void };
type ToastFn = (msg: string, action?: ToastAction) => void;

export const TOAST_MS = 4000;
export const TOAST_ACTION_MS = 6000;

const Ctx = createContext<ToastFn>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState<{ msg: string; action?: ToastAction } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hide = useCallback(() => setShown(null), []);
  const toast = useCallback<ToastFn>((msg, action) => {
    setShown({ msg, action });
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(hide, action ? TOAST_ACTION_MS : TOAST_MS);
  }, [hide]);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const a = shown?.action;
  return (
    <Ctx.Provider value={toast}>
      {children}
      <div id="toast" role="status" hidden={shown === null}>
        {shown?.msg}
        {a && "to" in a && <Link className="toast-act" to={a.to} onClick={hide} data-testid="toast-action">{a.label}</Link>}
        {a && "href" in a && <a className="toast-act" href={a.href} target="_blank" rel="noopener" onClick={hide} data-testid="toast-action">{a.label}</a>}
        {a && "onClick" in a && <button type="button" className="toast-act" onClick={() => { hide(); a.onClick(); }} data-testid="toast-action">{a.label}</button>}
      </div>
    </Ctx.Provider>
  );
}
