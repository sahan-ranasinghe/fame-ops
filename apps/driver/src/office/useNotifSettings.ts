// Hotfix O2-H2, Part 2: the person's notification settings for the Notifications screen and its group screens. A switch
// flips at once and is saved in the background (set_my_notification_settings, only the events that change); a failed
// save turns it back and says so in the snackbar with Try again (Instagram). No Save button.
//
// Pause all: every shown event off, and what each one was kept (office/notificationGroups.ts pauseChanges / resumeChanges).
// The record is kept with the person's preferences (my_prefs notifications_paused), so Resume on any phone or on the site
// puts them back, and on this phone too (lib/kv, per person): until the server keeps it (an older office-api refuses the
// key), the phone's copy is the one read. "Paused" itself is worked out from the events (every shown one off).

import { useCallback, useRef } from 'react';

import { showSnackbar } from '@/components/patterns/Snackbar';
import { getJson, remove, setJson } from '@/lib/kv';
import { useApp } from '@/state/app';
import {
  applyChanges,
  groupsFor,
  notifState,
  pauseChanges,
  type PauseRecord,
  resumeChanges,
  undoChanges,
} from './notificationGroups';
import { pauseKey } from './notifLogic';
import { useOffice, useTool } from './state';
import { errorText } from './text';
import type { FleetError, NotificationSettings } from './types';

export function useNotifSettings() {
  const { t } = useApp();
  const { me, api } = useOffice();
  const tool = useTool<NotificationSettings>('my_notification_settings', {});
  const { patch } = tool;
  const events = tool.data?.events ?? [];
  const latest = useRef(events);
  latest.current = events;
  const perms = me.permissions;

  const failed = useCallback((e: unknown, retry: () => void) => {
    const err = errorText(e as FleetError);
    showSnackbar(err.fix === 'retry'
      ? { text: t('office.notif.notSaved'), tone: 'error', action: { label: t('office.notif.tryAgain'), onPress: retry } }
      : { text: err.words ? t(err.key, { words: err.words }) : t(err.key), tone: 'error' });
  }, [t]);

  /** Flips the events at once, saves them, and puts them back when the save fails. True when saved. */
  const save = useCallback(async (changes: Record<string, boolean>): Promise<boolean> => {
    if (Object.keys(changes).length === 0) return true;
    const back = undoChanges(latest.current, changes);
    patch((p) => ({ ...p, events: applyChanges(p.events, changes) }));
    try {
      await api.call('set_my_notification_settings', { events: changes });
      return true;
    } catch (e) {
      patch((p) => ({ ...p, events: applyChanges(p.events, back) }));
      failed(e, () => void save(changes));
      return false;
    }
  }, [api, patch, failed]);

  const setEvent = useCallback((event: string, on: boolean) => save({ [event]: on }), [save]);

  const key = pauseKey(me);
  const prefs = useTool<{ prefs?: Record<string, unknown> }>('my_prefs', {}, { enabled: me.tools.includes('my_prefs') });
  const kept = prefs.data?.prefs && 'notifications_paused' in prefs.data.prefs ? (prefs.data.prefs.notifications_paused as PauseRecord | null) : undefined;
  const keptRef = useRef(kept);
  keptRef.current = kept;
  const prefsPatch = prefs.patch;
  /** The record as kept: the server's when it has one (null = none), else this phone's. */
  const recordNow = useCallback((): PauseRecord | null => (keptRef.current !== undefined ? keptRef.current : getJson<PauseRecord>(key)), [key]);
  const keepRecord = useCallback((record: PauseRecord | null) => {
    if (record) setJson(key, record);
    else remove(key);
    if (!me.tools.includes('set_my_prefs')) return;
    api.call('set_my_prefs', { prefs: { notifications_paused: record } }).then(
      () => prefsPatch((p) => ({ ...p, prefs: { ...(p.prefs ?? {}), notifications_paused: record } })),
      () => undefined, // an office-api without the key: the phone's copy stands
    );
  }, [key, me.tools, api, prefsPatch]);

  const pause = useCallback(async () => {
    const { record, changes } = pauseChanges(latest.current, perms, new Date().toISOString());
    if (await save(changes)) keepRecord(record);
  }, [perms, save, keepRecord]);

  const resume = useCallback(async () => {
    if (await save(resumeChanges(recordNow(), latest.current, perms))) keepRecord(null);
  }, [perms, save, recordNow, keepRecord]);

  const state = notifState(events, perms);
  return {
    tool,
    events,
    groups: groupsFor(events, perms),
    state,
    paused: state === 'paused',
    setEvent,
    pause,
    resume,
  };
}
