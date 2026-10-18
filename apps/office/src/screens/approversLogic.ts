// Several fleet admins (Hotfix 2, K), in words: who decided a request or sent
// a task ("Approved by Palitha · 10:42", "Declined by Nimal · 10:50 · no van
// that day"), whom to call about it (their number, else the office's), and
// who else has the request's decide page open ("Palitha is reviewing"). Pure.
import type { PersonAt, PhoneLinks } from "../data/types";
import { linksOf, phoneDisplay } from "../ui/ContactButtons";

/** How often the decide page says it is open (reviewing), and how old a mark the server still shows (45 s). */
export const REVIEWING_EVERY_MS = 20_000;

/** "Palitha is reviewing", "Palitha and Nimal are reviewing", "Palitha, Nimal and Sahan are reviewing"; null for nobody. */
export function reviewingText(list: { name: string }[] | null | undefined, myName?: string): string | null {
  const names = [...new Set((list ?? []).map((r) => r.name.trim()).filter((n) => n && n !== myName))];
  if (names.length === 0) return null;
  if (names.length === 1) return `${names[0]} is reviewing`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]} are reviewing`;
}

export type Decision = "approved" | "declined" | "cancelled" | "changed";
const WORD: Record<Decision, string> = { approved: "Approved", declined: "Declined", cancelled: "Cancelled", changed: "Changed" };

/** "Approved by Palitha · 10:42"; a reason after it ("Declined by Nimal · 10:50 · no van that day"). */
export function decidedText(kind: Decision, p: Pick<PersonAt, "name" | "at">, reason?: string | null): string {
  return [`${WORD[kind]} by ${p.name}`, p.at, reason?.trim()].filter(Boolean).join(" · ");
}

/** The person's own number with its links, null when they have none. */
export function personLinks(p: Pick<PersonAt, "phone" | "phone_display" | "call" | "whatsapp"> | null | undefined): PhoneLinks | null {
  if (!p?.phone) return null;
  const base = linksOf(p.phone);
  if (!base) return null;
  return { phone: p.phone, phone_display: p.phone_display ?? phoneDisplay(p.phone), call: p.call ?? base.call, whatsapp: p.whatsapp ?? base.whatsapp };
}

/** Whom to call about a decision: the person who made it, else the office ("Call office"); nothing when neither has a number. */
export function callWho(p: PersonAt | null | undefined, office: PhoneLinks | null | undefined): { links: PhoneLinks; office: boolean } | null {
  const own = personLinks(p);
  if (own) return { links: own, office: false };
  return office?.call ? { links: office, office: true } : null;
}
