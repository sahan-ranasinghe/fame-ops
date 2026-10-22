// Round 4–7, feature 7 (22 October 2026): someone else has that driver or vehicle. Google Calendar's room booking (who
// booked the room, their photo, the time, a way to ask them) on every busy warning:
//   - HolderLine: a conflict card's holder: the photo (initials until there is one), "Anoja Perera · Staff", "Asked for it ·
//     08:00–11:00", Call and WhatsApp (ui/ContactButtons), and "Ask for it" (the tool ask_for_it, never on a garage).
//   - HolderStrip: under a busy row of Who's available or the vehicle groups (never a button inside a pick row, ui-patterns
//     §11): the small photo, "Anoja's · 08:00–11:00" and Ask.
//   - AskForItSheet: the one sheet (ui/Sheet): what is asked in a sentence, an optional note, Send; the server's `next` in a
//     toast after it is sent; an error stays in the sheet with Try again.
// The holder is the person looking: "You", no Call, WhatsApp or Ask. With holder_contact off there is no holder and none of
// this shows.
import { useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { AskedForIt, Holder } from "../data/types";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Avatar, Notice } from "./basics";
import { ContactButtons } from "./ContactButtons";
import { firstName } from "./driverRowLogic";
import {
  askArgs,
  askSentence,
  busyWords,
  byLine,
  canAskFor,
  type HolderResource,
  holderPhone,
  holderTitle,
  isMe,
  markAsked,
  type Wanted,
  wasAsked,
} from "./holderLogic";
import { Sheet } from "./Sheet";
import { useToast } from "./Toast";

/** The note's limit (ask_for_it takes 300 characters). */
export const ASK_NOTE_MAX = 300;

/** Ask for it: the sentence, a note, Send. Closes itself once the server took it, with its `next` in a toast. */
export function AskForItSheet({ holder, resource, what, wanted, onClose, onAsked }: {
  holder: Holder;
  resource: HolderResource;
  /** The plate or the driver's name, when the screen knows it. */
  what?: string;
  wanted?: Wanted | null;
  onClose: () => void;
  onAsked?: () => void;
}) {
  const { transport } = useFleet();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FleetError | null>(null);
  async function send() {
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await transport.call<AskedForIt>("ask_for_it", askArgs(holder.task_id, resource, note, wanted));
      markAsked(holder.task_id, resource);
      onAsked?.();
      onClose();
      toast(r?.next || `Asked ${firstName(holder.name)}`);
    } catch (e) {
      setErr(e as FleetError);
      setBusy(false);
    }
  }
  return (
    <Sheet
      open
      onClose={() => { if (!busy) onClose(); }}
      title="Ask for it"
      testId="ask-for-it"
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn primary" onClick={() => void send()} disabled={busy} data-testid="ask-for-it-send">{busy ? "Sending…" : "Send"}</button>
        </>
      )}
    >
      <div className="form" style={{ gap: 12 }}>
        <div className="holder-line" style={{ padding: 0, border: 0 }}>
          <Avatar name={holder.name} src={holder.photo_url} small />
          <span className="grow"><b>{holderTitle(holder)}</b><span className="sub">{byLine(holder)}</span></span>
        </div>
        <p style={{ margin: 0 }} data-testid="ask-for-it-text">{askSentence(holder, resource, what)}</p>
        <div className="field">
          <label htmlFor="ask-for-it-note">A note (optional)</label>
          <textarea id="ask-for-it-note" maxLength={ASK_NOTE_MAX} rows={3} placeholder="Why, in a few words" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {err && (
          <Notice tone="bad" action={<button type="button" className="btn small" onClick={() => void send()} disabled={busy}>Try again</button>}>
            {errText(err)[0]}
          </Notice>
        )}
      </div>
    </Sheet>
  );
}

/** The Ask button and its sheet (Asked once sent from this tab, so nobody asks twice by mistake). */
function AskButton({ holder, resource, what, wanted, label, testId }: {
  holder: Holder;
  resource: HolderResource;
  what?: string;
  wanted?: Wanted | null;
  label: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);
  const [asked, setAsked] = useState(() => wasAsked(holder.task_id, resource));
  return (
    <>
      <button type="button" className="btn small" onClick={() => setOpen(true)} disabled={asked} data-testid={testId}
        aria-label={asked ? `Asked ${holder.name}` : `${label}: ask ${holder.name}`}>
        {asked ? "Asked" : label}
      </button>
      {open && <AskForItSheet holder={holder} resource={resource} what={what} wanted={wanted} onClose={() => setOpen(false)} onAsked={() => setAsked(true)} />}
    </>
  );
}

/** A conflict card's holder: who has it, how, when; Call, WhatsApp and Ask for it. */
export function HolderLine({ holder, resource, what, wanted, ask = true, testId = "holder-line" }: {
  holder: Holder;
  resource: HolderResource;
  what?: string;
  wanted?: Wanted | null;
  /** false: no Ask (a vehicle in the garage). */
  ask?: boolean;
  testId?: string;
}) {
  const { me } = useFleet();
  const mine = isMe(holder, me.name);
  const phone = mine ? null : holderPhone(holder);
  return (
    <div className="holder-line" data-testid={testId}>
      <Avatar name={holder.name} src={holder.photo_url} small />
      <span className="grow">
        <b data-testid="holder-name">{holderTitle(holder, me.name)}</b>
        <span className="sub" data-testid="holder-when">{byLine(holder)}</span>
      </span>
      <span className="acts holder-acts">
        {phone && <ContactButtons phone={phone} label={`Call ${firstName(holder.name)}`} testId="holder-contact" />}
        {ask && canAskFor(me.tools, holder, me.name) && (
          <AskButton holder={holder} resource={resource} what={what} wanted={wanted} label="Ask for it" testId="holder-ask" />
        )}
      </span>
    </div>
  );
}

/** Under a busy row (a driver or a vehicle): "Anoja's · 08:00–11:00" with Ask. */
export function HolderStrip({ holder, resource, what, wanted, testId = "holder-strip" }: {
  holder: Holder;
  resource: HolderResource;
  what?: string;
  wanted?: Wanted | null;
  testId?: string;
}) {
  const { me } = useFleet();
  return (
    <div className="holder-strip" data-testid={testId}>
      <Avatar name={holder.name} src={holder.photo_url} small />
      <span className="grow" title={byLine(holder)}>{busyWords(holder, me.name)}</span>
      {canAskFor(me.tools, holder, me.name) && <AskButton holder={holder} resource={resource} what={what} wanted={wanted} label="Ask" testId="holder-strip-ask" />}
    </div>
  );
}
