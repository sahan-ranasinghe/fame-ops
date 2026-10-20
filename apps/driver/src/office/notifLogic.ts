// Hotfix O2-H2, Part 2: Office mode's notification settings in the app's words. The groups, who sees which event, the
// summaries and Pause all are the shared rules (office/notificationGroups.ts, the same file as the site's); this file
// only turns them into en.json / si.json keys (office.notif.*). Pure: test-notif checks it without a phone.

import {
  eventDef,
  eventId,
  groupSummary,
  NOTIF_GROUPS,
  type NotifState,
  OTHER_GROUP,
  type ServerEvent,
} from './notificationGroups';

type T = (key: string, vars?: Record<string, string | number>) => string;

/** The group keys a URL may name (the sub-screen's [group]). */
export const GROUP_KEYS: readonly string[] = [...NOTIF_GROUPS.map((g) => g.key), OTHER_GROUP.key];
export const isGroupKey = (key: unknown): key is string => typeof key === 'string' && GROUP_KEYS.includes(key);

/** An event's short title: our words when a group knows it, the server's label otherwise. */
export function eventTitle(t: T, e: ServerEvent): string {
  return eventDef(e.event) ? t(`office.notif.ev.${eventId(e.event)}.title`) : e.label;
}

/** An event's one line, or nothing. */
export function eventText(t: T, e: ServerEvent): string | undefined {
  const def = eventDef(e.event);
  if (!def) return e.text || undefined;
  return def.text ? t(`office.notif.ev.${eventId(e.event)}.text`) : undefined;
}

export const groupTitle = (t: T, key: string): string => t(`office.notif.group.${key}.title`);

export function groupSub(t: T, key: string): string | undefined {
  return NOTIF_GROUPS.find((g) => g.key === key)?.sub ? t(`office.notif.group.${key}.sub`) : undefined;
}

/** "All on", "Off" or "4 of 5 on". */
export function groupSummaryLine(t: T, on: number, total: number): string {
  const s = groupSummary(on, total);
  if (s.kind === 'all_on') return t('office.notif.allOn');
  if (s.kind === 'off') return t('office.notif.allOff');
  return t('office.notif.nOfM', { on: s.on, total: s.total });
}

export const STATE_KEY: Record<NotifState, string> = {
  on: 'office.notif.stateOn',
  paused: 'office.notif.statePaused',
  some_off: 'office.notif.stateSomeOff',
  none: 'office.notif.stateNone',
};

/** Where the pause record is kept on this phone (per person: two office people may share a phone). */
export const pauseKey = (who: { email?: string; name: string }): string => `office.notifPause.${(who.email ?? who.name).toLowerCase()}`;
