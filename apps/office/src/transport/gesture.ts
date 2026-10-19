// What the person pressed just now (the retry rule's Try again, transport/retryRule.ts): a write they started with a click,
// a tap or Enter may be repeated by them, by pressing the same thing again. Web only (ApiTransport); the artifact repeats
// nothing. A write the page makes by itself is never attributed (BACKGROUND_WRITES), nor one long after a press.

/** A press counts for a write that starts this soon after it. */
export const GESTURE_MS = 1_500;

export interface GestureOrigin {
  /** The button pressed (or the link), if any. */
  button: HTMLElement | null;
  /** The form it submitted: Try again submits it again (its own handler, with what is in it now). */
  form: HTMLFormElement | null;
}

let last: { el: Element; at: number; key: boolean } | null = null;

/** Starts listening for presses on the page (once, at the app's start). */
export function trackGestures(doc: Document = document): () => void {
  const onPointer = (e: Event) => { if (e.target instanceof Element) last = { el: e.target, at: Date.now(), key: false }; };
  const onKey = (e: KeyboardEvent) => {
    if ((e.key === "Enter" || e.key === " ") && e.target instanceof Element) last = { el: e.target, at: Date.now(), key: true };
  };
  doc.addEventListener("pointerdown", onPointer, true);
  doc.addEventListener("keydown", onKey, true);
  return () => {
    doc.removeEventListener("pointerdown", onPointer, true);
    doc.removeEventListener("keydown", onKey, true);
  };
}

/** The press that started a call now, or null (none within GESTURE_MS, or not on a button or in a form). */
export function gestureOrigin(now = Date.now()): GestureOrigin | null {
  if (!last || now - last.at > GESTURE_MS) return null;
  const button = last.el.closest<HTMLElement>("button, [role=button], a[href]");
  const form = last.el.closest("form");
  if (!button && !(form && last.key)) return null;
  const submits = !!form && (button ? button instanceof HTMLButtonElement && button.type === "submit" : last.key);
  return { button, form: submits ? form : null };
}

/** Presses it again: the form submitted again (its own handler), else the button clicked again. False when it is gone. */
export function pressAgain(o: GestureOrigin): boolean {
  if (o.form?.isConnected) {
    const submitter = o.button instanceof HTMLButtonElement && o.button.isConnected && o.button.form === o.form ? o.button : undefined;
    o.form.requestSubmit(submitter);
    return true;
  }
  if (o.button?.isConnected) {
    o.button.click();
    return true;
  }
  return false;
}

// A write that was dropped, for ui/WriteRetry: the tool and what to press again.
type Listener = (tool: string, origin: GestureOrigin) => void;
const listeners = new Set<Listener>();
export function onWriteDropped(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function emitWriteDropped(tool: string, origin: GestureOrigin) {
  for (const fn of listeners) fn(tool, origin);
}

/** Tests only. */
export function resetGesturesForTests() {
  last = null;
  listeners.clear();
}
