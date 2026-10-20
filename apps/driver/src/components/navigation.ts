// Back behaviour of the forms (Log mileage, Report a problem).
//
// A form with unsaved input asks "Discard changes?" when the driver goes
// back: the Android back button, our own back arrow and the back gesture
// all raise the navigator's beforeRemove event, so one listener covers the
// three. The question is never asked after a successful save (the screen
// calls allowLeave() before it navigates), while a save is running (back
// then does nothing), or when the session ends and the app moves to Login.
//
// The root layout asks anyFormDirty() when a task notification is tapped:
// with unsaved input on screen the task is pushed on top, so back returns
// to the form with its data; otherwise Today is put underneath the task.
//
// In a browser (the mobile website, O4 step 5) a reload or closing the tab cannot be stopped by the router: while any
// form holds unsaved input the browser asks its own "Leave site?" (beforeunload, as Gmail and Google Forms do), and the
// browser's own Back inside the site asks "Discard changes?" like our back arrow (installBrowserBackGuard).

import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';

import { translate } from '@/i18n';
import type { Language } from '@/lib/types';
import { getJson, KEYS } from '@/lib/kv';
import { useOfficeMe } from '@/office/store';
import { useApp } from '@/state/app';

const dirtyForms = new Set<string>();
let nextKey = 0;

let webGuardsOn = false;

/** The browser's guards for unsaved forms (the mobile website's root calls this at start, before the router listens). */
export function installWebFormGuards(): void {
  if (webGuardsOn || Platform.OS !== 'web' || typeof window === 'undefined') return;
  webGuardsOn = true;
  window.addEventListener('beforeunload', (event) => {
    if (dirtyForms.size === 0) return;
    event.preventDefault();
    event.returnValue = '';
  });
  installBrowserBackGuard();
}

/**
 * The browser's own Back (and an installed web app's back gesture) inside the site: the router hears it as popstate and
 * goes back without its beforeRemove, so a form would be dropped without a word. This listener is added at start (the web
 * root) and listens in the capture phase, so it runs before the router's: while a form holds unsaved input it stops the
 * router from hearing that Back, puts the page forward again and, once that has landed, asks "Discard changes?". Cancel
 * keeps the form; Discard goes back for real (the router then hears it).
 */
function installBrowserBackGuard(): void {
  let letThrough = false;
  let returning = false;
  const ask = () => {
    const language = getJson<Language>(KEYS.language) ?? 'en';
    Alert.alert(translate(language, 'common.discardTitle'), translate(language, 'common.discardBody'), [
      { text: translate(language, 'common.cancel'), style: 'cancel' },
      {
        text: translate(language, 'common.discard'),
        style: 'destructive',
        onPress: () => {
          letThrough = true;
          window.history.back();
        },
      },
    ]);
  };
  // Capture: at the window, Chrome and Safari run capturing listeners before the router's own.
  window.addEventListener('popstate', (event) => {
    if (returning) {
      // Our own step forward again has landed (the router's state never left the form): now ask.
      returning = false;
      event.stopImmediatePropagation();
      setTimeout(ask, 0);
      return;
    }
    if (letThrough || dirtyForms.size === 0) {
      letThrough = false;
      return;
    }
    event.stopImmediatePropagation();
    returning = true;
    window.history.go(1);
  }, { capture: true });
}

/** true while any form on screen holds unsaved input. */
export function anyFormDirty(): boolean {
  return dirtyForms.size > 0;
}

export function useLeaveGuard(dirty: boolean, busy: boolean): { allowLeave: () => void } {
  const navigation = useNavigation();
  const { t, me } = useApp();
  // Office mode (Phase 8, O2): an office sign-in counts too (the vehicle, driver and office-user forms use the guard).
  const officeMe = useOfficeMe();
  const signedIn = me !== null || officeMe !== null;
  const leaving = useRef(false);
  const [key] = useState(() => `form-${++nextKey}`);

  useEffect(() => {
    if (dirty && !busy) dirtyForms.add(key);
    else dirtyForms.delete(key);
    return () => {
      dirtyForms.delete(key);
    };
  }, [key, dirty, busy]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current || !signedIn) return;
        if (busy) {
          event.preventDefault();
          return;
        }
        if (!dirty) return;
        event.preventDefault();
        Alert.alert(t('common.discardTitle'), t('common.discardBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          {
            text: t('common.discard'),
            style: 'destructive',
            onPress: () => {
              leaving.current = true;
              navigation.dispatch(event.data.action);
            },
          },
        ]);
      }),
    [navigation, dirty, busy, signedIn, t],
  );

  return {
    allowLeave: () => {
      leaving.current = true;
    },
  };
}
