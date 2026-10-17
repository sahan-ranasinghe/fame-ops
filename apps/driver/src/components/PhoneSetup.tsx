// Phone setup (Phase 7 item 7): the brand's battery and auto-start steps. Today no longer shows them; they
// show once in the first-run Permissions flow (after the battery step) and on Me → Phone setup
// (app/phone-setup.tsx), which says at the top when the phone stopped Fame Driver on one of the last 3 days.
// The rules and the settings pages: lib/phoneSetup.ts; the gaps the phone notes: lib/heartbeat.ts (noteGap).

import * as Device from 'expo-device';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { useDateLabel } from '@/components/task';
import { Button, Txt } from '@/components/ui';
import { getJson, KEYS } from '@/lib/kv';
import { openBrandSettings } from '@/lib/location';
import { brandName, type Gap, openSettingsLabel, setupBrand, type StoppedNote, stepsKey, stoppedNote } from '@/lib/phoneSetup';
import { colomboDate, colomboTime } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** This phone: whose steps apply, and the brand as the phone shows it ("OPPO", "Redmi"), or null. */
export function phoneSetupBrand() {
  return { brand: setupBrand(Device.brand, Device.manufacturer), name: brandName(Device.brand, Device.manufacturer) };
}

/** "Change these settings once:", the brand's numbered steps and the button that opens the brand's settings (App info when none opens). */
export function PhoneSetupSteps() {
  const { t, tList } = useApp();
  const { brand, name } = phoneSetupBrand();
  const label = openSettingsLabel(brand, name);
  return (
    <View style={{ gap: 10 }} testID="phone-setup-steps">
      <Txt variant="strong" size={15} color={colors.ink}>{t('phoneSetup.doOnce')}</Txt>
      <View style={{ gap: 6 }}>
        {tList(stepsKey(brand)).map((step, i) => (
          <View key={i} style={styles.step}>
            <Txt variant="strong" size={15} color={colors.amberText}>{`${i + 1}.`}</Txt>
            <Txt variant="body" size={15} color={colors.ink} style={{ flex: 1 }}>{step}</Txt>
          </View>
        ))}
      </View>
      <Button
        kind="dark"
        label={label.key === 'phoneSetup.open' ? t(label.key, { brand: label.brand }) : t(label.key)}
        onPress={() => void openBrandSettings(brand)}
      />
    </View>
  );
}

/** Did the phone stop the app on one of the last 3 days (after the last Done)? Read again whenever the screen is focused. */
export function useStoppedNote(): { note: StoppedNote | null; reload: () => void } {
  const [note, setNote] = useState<StoppedNote | null>(null);
  const reload = useCallback(() => {
    setNote(stoppedNote(getJson<Gap[]>(KEYS.phoneGaps) ?? [], getJson<number>(KEYS.phoneSetupDoneAt), Date.now()));
  }, []);
  useFocusEffect(reload);
  return { note, reload };
}

/** The note as a sentence: "Your OPPO phone stopped Fame Driver for 7 min (06:12). No trip is recorded while it is stopped." */
export function useStoppedText(): (note: StoppedNote) => string {
  const { t } = useApp();
  const dateLabel = useDateLabel();
  return (note) => {
    const { name } = phoneSetupBrand();
    const phone = name ? t('phoneSetup.yourBrand', { brand: name }) : t('phoneSetup.yourPhone');
    const at = new Date(note.at);
    const when = colomboDate(at) === colomboDate(new Date()) ? colomboTime(at) : `${dateLabel(at)} ${colomboTime(at)}`;
    return note.key === 'phoneSetup.stoppedOnce'
      ? t(note.key, { phone, minutes: note.minutes, when })
      : t(note.key, { phone, count: note.count, minutes: note.minutes, when });
  };
}

const styles = StyleSheet.create({
  step: { flexDirection: 'row', gap: 8 },
});
