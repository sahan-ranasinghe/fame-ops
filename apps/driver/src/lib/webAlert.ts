// The mobile website (Phase 8, O4): Alert.alert does nothing in react-native-web, so every confirmation in Office mode
// (Sign out, Remove, Discard changes, Resume draft) would be a dead button in a browser. The web root installs this
// instead: no or one button = the browser's alert, then that button; two or more = the browser's confirm, where Cancel
// (and Esc) is always the safe choice (the cancel button, else the one that destroys nothing) and OK the other, named in
// the text because a browser's buttons only say OK and Cancel. The rules are pure (pickButtons), tested by test:web.

export interface AlertButtonLike {
  text?: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

/** OK and Cancel from an alert's buttons: Cancel is the cancel button, else the non-destructive one; OK the other. */
export function pickButtons(buttons: readonly AlertButtonLike[]): { ok: AlertButtonLike | null; cancel: AlertButtonLike | null } {
  if (buttons.length === 0) return { ok: null, cancel: null };
  if (buttons.length === 1) return { ok: buttons[0], cancel: null };
  const cancel = buttons.find((b) => b.style === 'cancel') ?? buttons.find((b) => b.style !== 'destructive') ?? buttons[0];
  const ok = buttons.find((b) => b !== cancel && b.style === 'destructive') ?? buttons.find((b) => b !== cancel) ?? null;
  return { ok, cancel };
}

/** The text the browser shows: the title, the message and, for a choice, what OK and Cancel do. */
export function promptText(title: string, message: string | undefined, picked: ReturnType<typeof pickButtons>, words: { ok: string; cancel: string }): string {
  const lines = [title, message ?? ''].filter(Boolean);
  if (picked.ok && picked.cancel) lines.push('', `${words.ok}: ${picked.ok.text ?? ''} · ${words.cancel}: ${picked.cancel.text ?? ''}`);
  return lines.join('\n');
}

/** Alert.alert for a browser (installed by src/web-app/_layout.tsx). */
export function installWebAlert(alertApi: { alert: unknown }, words: () => { ok: string; cancel: string }): void {
  alertApi.alert = (title: string, message?: string, buttons?: AlertButtonLike[]) => {
    const picked = pickButtons(buttons ?? []);
    const text = promptText(title, message, picked, words());
    if (!picked.cancel) {
      window.alert(text);
      picked.ok?.onPress?.();
      return;
    }
    if (window.confirm(text)) picked.ok?.onPress?.();
    else picked.cancel.onPress?.();
  };
}
