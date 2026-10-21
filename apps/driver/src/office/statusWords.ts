// A task's status in words, never internal text (Sahan, 21 October 2026). Pure: scripts/test-status-words.ts.
//
// The server says a task card's state as an English sentence (task_board's `status`, task_detail's `status_line`:
// supabase/functions/_shared/fleet/tools/tasks.ts statusLine): "Sent · not opened yet", "Seen by driver 16:06",
// "Accepted 16:10", "Started 07:06 · sharing location", "Done 11:40 · 42 km logged", "Declined (Vehicle problem) · note",
// "Cancelled: reason", "Driven by Nimal (custodian · no app)". Office mode shows it in the person's language: each sentence
// is read back into a key with its values; one it does not know is shown as the server said it (English words, never a
// key). A driver's presence sentences (status_text) are read the same way (presenceWords). The short chip at the right of a row (Gmail's label: "Sent", "Seen", "Accepted", "Under way", "Late", "Done",
// "Needs driver") comes from the card's column and that sentence.

import type { Tone } from './ui';

export interface Words {
  key: string;
  vars?: Record<string, string | number>;
  /** The driver's own words after the reason (a decline's note), shown as they wrote them. */
  tail?: string;
}

/** The decline reasons as the server words them (tools/tasks.ts DECLINE_TEXT) → our keys. */
const REASONS: Record<string, string> = {
  'Vehicle problem': 'vehicle_problem',
  'Not available': 'not_available',
  Unwell: 'unwell',
  Other: 'other',
  'no reason given': 'none',
};

/** The server's status sentence as a key with its values, or null for a sentence this app does not know. */
export function sentenceWords(line: string | undefined | null): Words | null {
  if (!line) return null;
  const s = line.trim();
  let m: RegExpMatchArray | null;
  if (s === 'Sent · not opened yet') return { key: 'office.line.sent' };
  if ((m = s.match(/^Seen by driver (\d{2}:\d{2})$/))) return { key: 'office.line.seen', vars: { time: m[1] } };
  if ((m = s.match(/^Accepted (\d{2}:\d{2})$/))) return { key: 'office.line.accepted', vars: { time: m[1] } };
  if ((m = s.match(/^Driven by (.+) \(custodian · no app\)$/))) return { key: 'office.line.custodian', vars: { name: m[1] } };
  if ((m = s.match(/^Started (\S+) · (sharing location|not sharing location|location (.+) old)$/))) {
    const where = m[2] === 'sharing location' ? 'Sharing' : m[2] === 'not sharing location' ? 'NotSharing' : 'Old';
    return { key: `office.line.started${where}`, vars: { time: m[1], age: m[3] ?? '' } };
  }
  if ((m = s.match(/^Done (\S+) · (\d+(?:\.\d+)?) km logged$/))) return { key: 'office.line.done', vars: { time: m[1], km: m[2] } };
  if ((m = s.match(/^Declined( after accepting)? \((.+?)\)(?: · (.+))?$/))) {
    const reason = REASONS[m[2]];
    if (!reason) return null;
    return { key: m[1] ? 'office.line.declinedAfter' : 'office.line.declined', vars: { reason }, tail: m[3] };
  }
  if ((m = s.match(/^Cancelled:?\s*(.*)$/))) return { key: m[1] ? 'office.line.cancelledWhy' : 'office.line.cancelled', vars: { why: m[1] } };
  return presenceWords(s);
}

/**
 * A driver's presence as the server words it (status.ts statusText, availability.ts): "Live · 2 min ago", "Location off
 * since 09:10", "Location permission removed since 09:10", "No signal since 09:10", "Off duty", "On duty since 07:12",
 * "Off duty since 07:40", "On a task until ~10:40 (live)", "On a task · end time not set"; "· 3 points refused" after any.
 */
function presenceWords(line: string): Words | null {
  let m: RegExpMatchArray | null;
  let s = line;
  let refused: number | null = null;
  if ((m = s.match(/^(.*) · (\d+) points? refused$/))) {
    s = m[1];
    refused = Number(m[2]);
  }
  const w = presenceCore(s);
  if (!w) return null;
  return refused === null ? w : { ...w, vars: { ...w.vars, refused } };
}

function presenceCore(s: string): Words | null {
  let m: RegExpMatchArray | null;
  if (s === 'Live · now') return { key: 'office.line.liveNow' };
  if ((m = s.match(/^Live · (\d+) (min|h|d) ago$/))) return { key: `office.line.live_${m[2]}`, vars: { n: Number(m[1]) } };
  if ((m = s.match(/^(Location off|Location permission removed|No signal)(?: since (\d{2}:\d{2}))?$/))) {
    const k = m[1] === 'Location off' ? 'locationOff' : m[1] === 'No signal' ? 'noSignal' : 'permissionGone';
    return m[2] ? { key: `office.line.${k}Since`, vars: { time: m[2] } } : { key: `office.line.${k}` };
  }
  if (s === 'Off duty') return { key: 'office.line.offDuty' };
  if ((m = s.match(/^(On|Off) duty since (\d{2}:\d{2})$/))) return { key: m[1] === 'On' ? 'office.line.onDutySince' : 'office.line.offDutySince', vars: { time: m[2] } };
  if ((m = s.match(/^On a task until ~(\d{2}:\d{2})(?: \((live|planned)\))?$/))) return { key: m[2] ? `office.line.onTaskUntil_${m[2]}` : 'office.line.onTaskUntil', vars: { time: m[1] } };
  if (s === 'On a task · end time not set') return { key: 'office.line.onTaskNoEnd' };
  return null;
}

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The status sentence in the person's language (the server's own words when this app does not know the sentence). */
export function sentenceText(t: T, line: string | undefined | null): string {
  const w = sentenceWords(line);
  if (!w) return line ?? '';
  const vars = { ...w.vars };
  if (typeof vars.reason === 'string') vars.reason = t(`office.line.reason_${vars.reason}`);
  const text = t(w.key, vars) + (typeof vars.refused === 'number' ? ` · ${t('office.line.refused', { n: vars.refused })}` : '');
  return w.tail ? `${text} · ${w.tail}` : text;
}

export type BoardColumn = 'assigned' | 'in_progress' | 'completed' | 'declined';

/** The short chip of a task card, by its column and its sentence (a short word; the sentence is the row's second line). */
export function taskChip(column: BoardColumn, card: { status?: string; accepted?: string; late_min?: number }): { key: string; tone: Tone; min?: number } {
  if (column === 'in_progress') return card.late_min && card.late_min > 0 ? { key: 'late', tone: 'red', min: card.late_min } : { key: 'underWay', tone: 'blue' };
  if (column === 'completed') return { key: 'done', tone: 'green' };
  if (column === 'declined') return { key: 'needsDriver', tone: 'red' };
  if (card.accepted) return { key: 'accepted', tone: 'green' };
  const w = sentenceWords(card.status);
  if (w?.key === 'office.line.seen') return { key: 'seen', tone: 'amber' };
  if (w?.key === 'office.line.custodian') return { key: 'selfDrive', tone: 'muted' };
  return { key: 'sent', tone: 'amber' };
}

/** A chip's words ("Late 12 min"). */
export function chipText(t: T, chip: { key: string; min?: number }): string {
  return chip.key === 'late' ? t('office.chip.late', { min: chip.min ?? 0 }) : t(`office.chip.${chip.key}`);
}

/** A trip's live state (My trips: tools/requests.ts liveOf / taskLive) as a short chip; an unknown one reads "Waiting". */
const TRIP_CHIP: Record<string, { key: string; tone: Tone }> = {
  waiting: { key: 'waiting', tone: 'amber' },
  approved: { key: 'approved', tone: 'green' },
  accepted: { key: 'accepted', tone: 'green' },
  sent: { key: 'sent', tone: 'amber' },
  on_the_way: { key: 'onTheWay', tone: 'blue' },
  arrived: { key: 'arrived', tone: 'blue' },
  completed: { key: 'done', tone: 'green' },
  declined: { key: 'declined', tone: 'red' },
  cancelled: { key: 'cancelled', tone: 'muted' },
  missed: { key: 'missed', tone: 'red' },
  changed: { key: 'changed', tone: 'amber' },
};

export function tripChip(state: string | undefined): { key: string; tone: Tone } {
  return TRIP_CHIP[state ?? ''] ?? TRIP_CHIP.waiting;
}

/** A task's status (the enum) as a chip word key: Task history, a task's own page. */
export function taskStatusChip(status: string | undefined): string {
  switch (status) {
    case 'in_progress': return 'underWay';
    case 'completed': return 'done';
    case 'cancelled': return 'cancelled';
    case 'declined': return 'needsDriver';
    case 'missed': return 'missed';
    default: return 'sent';
  }
}
