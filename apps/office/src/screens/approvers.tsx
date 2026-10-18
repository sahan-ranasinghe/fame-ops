// Several fleet admins (Hotfix 2, K) on the pages: "Approved by Palitha ·
// 10:42" with their photo and Call / WhatsApp (Call office when they have no
// number), "Declined by …" and "Cancelled by …" with the reason; "Palitha is
// reviewing" on the queue and the decide page, the decide page saying every
// 20 s that it is open (reviewing); and the card asked again after a decision
// the server refused ("Already approved by Palitha at 10:42").
import { useEffect, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { PersonAt, PhoneLinks, RequestCard, RequestsList } from "../data/types";
import type { Transport } from "../transport/types";
import { Avatar } from "../ui/basics";
import { ContactButtons } from "../ui/ContactButtons";
import { callWho, type Decision, decidedText, REVIEWING_EVERY_MS, reviewingText } from "./approversLogic";

type Reviewer = { name: string; since: string };

/**
 * The decide page is open: reviewing(request_id) now and every 20 s while `active` (a request still to decide), answering
 * the other approvers on it. Nothing when the person may not call it (an older server's refusal is ignored).
 */
export function useReviewing(requestId: string, active: boolean): Reviewer[] {
  const { transport, me } = useFleet();
  const on = active && !!requestId && me.tools.includes("reviewing");
  const [others, setOthers] = useState<Reviewer[]>([]);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const ping = () => {
      void transport.call<{ reviewing?: Reviewer[] }>("reviewing", { request_id: requestId }).then((r) => {
        if (!alive) return;
        const next = r?.reviewing ?? [];
        // The same people: no new render (nothing moves on the page).
        setOthers((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      }, () => undefined);
    };
    ping();
    const timer = setInterval(ping, REVIEWING_EVERY_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [transport, requestId, on]);
  return on ? others : [];
}

/** "Palitha is reviewing" (the others with the decide page open); nothing when nobody is. */
export function ReviewingLine({ list, block }: { list: Reviewer[] | null | undefined; block?: boolean }) {
  const { me } = useFleet();
  const text = reviewingText(list, me.name);
  if (!text) return null;
  return <span className="status warn" style={block ? { display: "block", marginTop: 4 } : undefined} data-testid="reviewing">{text}</span>;
}

/** The request again as list_requests answers it now (after a refused decision); the lists are asked again too. */
export async function refreshRequest(transport: Transport, id: string, setQ: (q: RequestCard) => void, invalidate?: () => Promise<void>): Promise<void> {
  void invalidate?.();
  try {
    const p = await transport.call<RequestsList>("list_requests", { status: "all", id });
    const card = p.requests.find((r) => r.id === id);
    if (card) setQ(card);
  } catch {
    // The page keeps the card it has; the message already says what happened.
  }
}

/** One decision: the person's photo, "Approved by Palitha · 10:42", and Call / WhatsApp (or Call office). */
export function DecisionRow({ kind, who, reason, office, testId }: {
  kind: Decision;
  who: PersonAt;
  reason?: string | null;
  /** The office's number: Call office when the person has none. */
  office?: PhoneLinks | null;
  testId?: string;
}) {
  const call = kind === "approved" ? callWho(who, office) : null;
  const first = who.name.trim().split(/\s+/)[0] || who.name;
  return (
    <div className="row" style={{ padding: 0, alignItems: "center", flexWrap: "wrap" }} data-testid={testId ?? `${kind}-by`}>
      <Avatar name={who.name} src={who.photo_url} small />
      <span className="grow">{decidedText(kind, who, reason)}</span>
      {call && <ContactButtons phone={call.links} label={call.office ? "Call office" : `Call ${first}`} testId={call.office ? "call-office" : "call-approver"} />}
    </div>
  );
}

/** Who decided a request (approved, declined, cancelled), as rows; nothing when the card names nobody. */
export function DecidedBy({ q, office }: { q: Pick<RequestCard, "approved_by" | "declined_by" | "cancelled_by" | "office_phone">; office?: PhoneLinks | null }) {
  const officeLinks = q.office_phone ?? office ?? null;
  if (!q.approved_by && !q.declined_by && !q.cancelled_by) return null;
  return (
    <div className="stack" style={{ gap: 8 }} data-testid="decided-by">
      {q.approved_by && <DecisionRow kind="approved" who={q.approved_by} office={officeLinks} />}
      {q.declined_by && <DecisionRow kind="declined" who={q.declined_by} reason={q.declined_by.reason} />}
      {q.cancelled_by && <DecisionRow kind="cancelled" who={q.cancelled_by} reason={q.cancelled_by.reason} />}
    </div>
  );
}
