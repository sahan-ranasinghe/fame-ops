// "Phone setup" on Today (15 October 2026): shown when the phone stopped Fame
// Driver for over 3 minutes on one of the last 3 days (lib/phoneSetup.ts). It
// names the brand, opens that brand's battery or startup settings, lists the
// steps, and goes away on Done until the phone stops the app again.

import * as Device from 'expo-device';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { BatteryCharging } from '@/components/icons';
import { useDateLabel } from '@/components/task';
import { Button, Txt } from '@/components/ui';
import { getJson, KEYS, setJson } from '@/lib/kv';
import { openBrandSettings } from '@/lib/location';
import { brandName, type Gap, gapMinutes, gapsToShow, setupBrand } from '@/lib/phoneSetup';
import { colomboDate, colomboTime } from '@/lib/time';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export function PhoneSetupCard() {
  const { t, tList } = useApp();
  const dateLabel = useDateLabel();
  const [shown, setShown] = useState<Gap[]>([]);
  const reload = useCallback(() => {
    setShown(gapsToShow(getJson<Gap[]>(KEYS.phoneGaps) ?? [], getJson<number>(KEYS.phoneSetupDoneAt), Date.now()));
  }, []);
  useFocusEffect(reload);
  if (shown.length === 0) return null;

  const brand = setupBrand(Device.brand, Device.manufacturer);
  const name = brandName(Device.brand, Device.manufacturer);
  const phone = name ? t('phoneSetup.yourBrand', { brand: name }) : t('phoneSetup.yourPhone');
  const newest = shown[0];
  const oldest = shown[shown.length - 1];
  const when = (at: number) => (colomboDate(new Date(at)) === colomboDate(new Date()) ? colomboTime(new Date(at)) : `${dateLabel(new Date(at))} ${colomboTime(new Date(at))}`);
  const summary = shown.length === 1
    ? t('phoneSetup.stoppedOnce', { phone, minutes: gapMinutes(newest), when: when(newest.from) })
    : t('phoneSetup.stoppedMany', { phone, count: shown.length, minutes: shown.reduce((s, g) => s + gapMinutes(g), 0), when: when(oldest.from) });
  const steps = tList(`phoneSetup.steps.${brand}`);

  return (
    <View style={styles.box} testID="phone-setup">
      <View style={styles.head}>
        <BatteryCharging size={22} color={colors.amberText} />
        <Txt variant="strong" size={17} color={colors.amberText}>{t('phoneSetup.title')}</Txt>
      </View>
      <Txt variant="body" color={colors.ink}>{summary}</Txt>
      <Txt variant="strong" size={15} color={colors.ink}>{t('phoneSetup.doOnce')}</Txt>
      <View style={{ gap: 6 }}>
        {steps.map((step, i) => (
          <View key={i} style={styles.step}>
            <Txt variant="strong" size={15} color={colors.amberText}>{`${i + 1}.`}</Txt>
            <Txt variant="body" size={15} color={colors.ink} style={{ flex: 1 }}>{step}</Txt>
          </View>
        ))}
      </View>
      <Button kind="dark" label={name && brand !== 'other' ? t('phoneSetup.open', { brand: name }) : t('phoneSetup.openApp')} onPress={() => void openBrandSettings(brand)} />
      <Button kind="outline" label={t('phoneSetup.done')} onPress={() => { setJson(KEYS.phoneSetupDoneAt, Date.now()); reload(); }} />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderRadius: 14, padding: 14, gap: 10, backgroundColor: '#fdf1d6' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  step: { flexDirection: 'row', gap: 8 },
});
