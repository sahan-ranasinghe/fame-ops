// Round 4–7, feature 7 (22 October 2026): an item's buttons in the notification centre (Gmail's and Slack's actionable
// notifications: an Ask for it's Yes / No in one tap). A tap calls the item's tool with its arguments as they are (the
// server checks who may), then the item is marked read and the buttons become the answer ("You said Yes"). While the call
// runs the buttons are disabled (never two answers); a write is never sent again by itself: an error says so in words
// (errText: "may not have been saved" for a dropped write) with Try again, which presses the same button again.
import { useState } from "react";
import type { InboxAction, InboxItem } from "../data/types";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Icon } from "../ui/icons";
import { useFleet } from "./FleetContext";
import { actionsOf, answeredLabel, keepAnswered, saidText } from "./inboxActionsLogic";

export function InboxActions({ item, onDone }: {
  item: InboxItem;
  /** After the tool answered: mark the item read (and, on a banner, say it). */
  onDone?: (label: string) => void;
}) {
  const { transport } = useFleet();
  const [said, setSaid] = useState<string | null>(() => answeredLabel(item.id) ?? null);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<{ action: InboxAction; error: FleetError } | null>(null);
  const actions = actionsOf(item);
  if (!actions.length) return null;
  if (said) {
    return <span className="inbox-said" data-testid="inbox-said"><Icon name="check" />{saidText(said)}</span>;
  }
  async function run(a: InboxAction) {
    if (busy) return;
    setBusy(a.label);
    setErr(null);
    try {
      await transport.call(a.tool, { ...a.args });
      keepAnswered(item.id, a.label);
      setSaid(a.label);
      onDone?.(a.label);
    } catch (e) {
      setErr({ action: a, error: e as FleetError });
    }
    setBusy(null);
  }
  return (
    <div className="inbox-acts" role="group" aria-label={`Answer: ${item.title}`} data-testid="inbox-actions">
      {actions.map((a, i) => (
        <button key={`${a.label}-${i}`} type="button" className={`btn small${i === 0 ? " primary" : ""}`} disabled={!!busy}
          onClick={() => void run(a)} data-testid="inbox-action">
          {busy === a.label ? "Sending…" : a.label}
        </button>
      ))}
      {err && (
        <span className="inbox-act-err" role="alert" data-testid="inbox-action-error">
          {errText(err.error)[0]}{" "}
          <button type="button" className="linkish" disabled={!!busy} onClick={() => void run(err.action)}>Try again</button>
        </span>
      )}
    </div>
  );
}
