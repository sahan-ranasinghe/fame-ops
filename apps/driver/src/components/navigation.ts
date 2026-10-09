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

import { useNavigation } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { useApp } from '@/state/app';

const dirtyForms = new Set<string>();
let nextKey = 0;

/** true while any form on screen holds unsaved input. */
export function anyFormDirty(): boolean {
  return dirtyForms.size > 0;
}

export function useLeaveGuard(dirty: boolean, busy: boolean): { allowLeave: () => void } {
  const navigation = useNavigation();
  const { t, me } = useApp();
  const signedIn = me !== null;
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
