// Log mileage (designed: design/png/Driver · Log mileage.png). One screen, four uses:
//   finish  end of a task: odometer photo + number, fuel yes/no, "Save & finish task"
//   start   start of a task: confirm or correct the start odometer, "Start task"
//   manual  a reading outside a task (from the Mileage tab)
//   fuel    fuel outside the end-of-task flow (from the Mileage tab)

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Camera, ChevronLeft } from '@/components/icons';
import { useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Field, Mono, Notice, Segmented, Txt } from '@/components/ui';
import { parseDecimal, parseWhole, thousands } from '@/lib/format';
import { discardPhoto, type LocalPhoto, readOdometer, takePhoto } from '@/lib/photos';
import { type FuelEntry, useApp } from '@/state/app';
import { colors, fonts } from '@/theme';

type Mode = 'finish' | 'start' | 'manual' | 'fuel';

const TITLE: Record<Mode, string> = { finish: 'log.title', start: 'log.titleStart', manual: 'log.title', fuel: 'log.titleFuel' };
const SUBTITLE: Record<Mode, string> = { finish: 'log.endOfTask', start: 'log.startOfTask', manual: 'log.reading', fuel: 'log.fuelEntry' };
const SAVE: Record<Mode, string> = { finish: 'log.saveFinish', start: 'log.startTask', manual: 'log.saveReading', fuel: 'log.saveFuel' };

export default function LogMileageScreen() {
  const app = useApp();
  const { t, tasks, vehicles } = app;
  const params = useLocalSearchParams<{ mode?: string; taskId?: string }>();
  const mode: Mode = params.mode === 'start' || params.mode === 'manual' || params.mode === 'fuel' ? params.mode : 'finish';
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const task = params.taskId ? tasks.find((item) => item.id === params.taskId) : undefined;
  const vehicle = task ? vehicles.find((item) => item.id === task.vehicle_id) ?? null : app.vehicle;
  const lastKm = vehicle?.current_odometer_km ?? null;
  const startKm = task?.start_odometer_km ?? null;

  // Starting a task: the last known reading is filled in for the driver to confirm or correct.
  const [odometer, setOdometer] = useState(mode === 'start' && lastKm !== null ? thousands(lastKm) : '');
  const [photo, setPhoto] = useState<LocalPhoto | null>(null);
  const [ocrKm, setOcrKm] = useState<number | null>(null);
  const [reading, setReading] = useState(false);
  const [photoNote, setPhotoNote] = useState<{ text: string; tone: 'info' | 'warn' } | null>(null);
  const [addedFuel, setAddedFuel] = useState<'yes' | 'no'>(mode === 'fuel' ? 'yes' : 'no');
  const [litres, setLitres] = useState('');
  const [amount, setAmount] = useState('');
  const [receipt, setReceipt] = useState<LocalPhoto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!app.me) return <Redirect href="/login" />;
  if ((mode === 'finish' || mode === 'start') && !task) return <Redirect href="/" />;

  const km = parseWhole(odometer);
  const showFuel = mode === 'finish' || mode === 'fuel';
  const needsOdometer = mode !== 'fuel';

  async function photographOdometer() {
    const shot = await takePhoto();
    if (shot === 'denied') return setProblem(t('common.cameraDenied'));
    if (!shot) return;
    if (photo) discardPhoto(photo);
    setPhoto(shot);
    setProblem(null);
    setReading(true);
    const found = await readOdometer(shot.uri, startKm ?? lastKm);
    setReading(false);
    setOcrKm(found);
    if (found !== null) {
      setOdometer(thousands(found));
      setPhotoNote({ text: t('log.readFromPhoto', { km: thousands(found) }), tone: 'info' });
    } else {
      setPhotoNote({ text: t('log.couldNotRead'), tone: 'warn' });
    }
  }

  async function photographReceipt() {
    const shot = await takePhoto();
    if (shot === 'denied') return setProblem(t('common.cameraDenied'));
    if (!shot) return;
    if (receipt) discardPhoto(receipt);
    setReceipt(shot);
  }

  function fuelEntry(): FuelEntry | null | 'invalid' {
    if (!showFuel || addedFuel === 'no') return null;
    const litresValue = litres.trim() === '' ? null : parseDecimal(litres);
    const amountValue = amount.trim() === '' ? null : parseDecimal(amount);
    const bad = (litres.trim() !== '' && (litresValue === null || litresValue <= 0)) || (amount.trim() !== '' && amountValue === null);
    if (bad || (litresValue === null && amountValue === null)) return 'invalid';
    return { litres: litresValue, amountCents: amountValue === null ? null : Math.round(amountValue * 100), receipt };
  }

  async function save() {
    if (saving) return;
    if (needsOdometer && km === null) return setProblem(t('log.needOdometer'));
    if (mode === 'finish' && km !== null && startKm !== null && km < startKm) {
      return setProblem(t('log.lowerThanStart', { km: thousands(startKm) }));
    }
    if ((mode === 'manual' || mode === 'fuel') && !vehicle) return setProblem(t('log.needVehicle'));
    const fuel = fuelEntry();
    if (fuel === 'invalid') return setProblem(t('log.needFuel'));

    setSaving(true);
    if (mode === 'start' && task && km !== null) {
      await app.startTask(task, km, ocrKm, photo);
      router.replace({ pathname: '/task/[id]', params: { id: task.id } });
    } else if (mode === 'finish' && task && km !== null) {
      app.completeTask(task, km, ocrKm, photo, fuel);
      router.dismissAll();
    } else if (mode === 'manual' && km !== null) {
      app.logOdometer(km, ocrKm, photo);
      router.back();
    } else if (mode === 'fuel' && fuel) {
      app.logFuel(fuel, km);
      router.back();
    }
  }

  // A start reading that does not match the last one is allowed, but the driver is told the office will see it.
  const gap = mode === 'start' && km !== null && lastKm !== null ? km - lastKm : 0;

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 16 }}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <View style={{ flex: 1 }}>
            <Txt variant="title" size={28}>{t(TITLE[mode])}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {vehicle && <Mono size={16} bold>{vehicle.reg_no}</Mono>}
              <Txt variant="muted">{`${vehicle ? '· ' : ''}${t(SUBTITLE[mode])}`}</Txt>
            </View>
          </View>
        </View>

        {needsOdometer && (
          <Pressable accessibilityRole="button" onPress={photographOdometer} style={styles.photoCard}>
            {photo ? (
              <Image source={{ uri: photo.uri }} style={styles.thumb} />
            ) : (
              <View style={styles.cameraTile}>
                <Camera size={30} color={colors.amber} />
              </View>
            )}
            <View style={{ flex: 1 }}>
              <Txt variant="big">{t('log.photoTitle')}</Txt>
              <Txt variant="muted">{t(reading ? 'log.reading_' : photo ? 'log.photoAdded' : 'log.photoHint')}</Txt>
            </View>
            {reading && <ActivityIndicator color={colors.ink} />}
          </Pressable>
        )}
        {needsOdometer && photoNote && !reading && <Notice tone={photoNote.tone} text={photoNote.text} />}

        <Card style={{ gap: 12 }}>
          <Txt variant="big">{t(needsOdometer ? 'log.odometerNow' : 'log.odometerOptional')}</Txt>
          <TextInput
            value={odometer}
            onChangeText={(text) => {
              const value = parseWhole(text);
              setOdometer(value === null ? '' : thousands(value));
              setProblem(null);
            }}
            keyboardType="number-pad"
            maxLength={9}
            placeholder="0"
            placeholderTextColor="#c4c0b8"
            style={styles.odometer}
          />
          <View style={styles.underOdometer}>
            {mode === 'finish' && startKm !== null && <Txt variant="muted">{t('log.start', { km: thousands(startKm) })}</Txt>}
            {mode !== 'finish' && lastKm !== null && <Txt variant="muted">{t('log.lastReading', { km: thousands(lastKm) })}</Txt>}
            {mode === 'finish' && km !== null && startKm !== null && km >= startKm && (
              <Txt variant="strong" color={colors.blue}>{t('log.thisTask', { km: thousands(km - startKm) })}</Txt>
            )}
          </View>
          {gap > 2 && <Notice tone="warn" text={t('log.moreThanLast', { km: thousands(gap) })} />}
          {gap < -2 && lastKm !== null && <Notice tone="warn" text={t('log.lowerThanLast', { km: thousands(lastKm) })} />}
        </Card>

        {showFuel && (
          <Card style={{ gap: 14 }}>
            {mode === 'finish' && (
              <>
                <Txt variant="big">{t('log.addedFuel')}</Txt>
                <Segmented
                  value={addedFuel}
                  onChange={setAddedFuel}
                  options={[{ value: 'yes', label: t('common.yes') }, { value: 'no', label: t('common.no') }]}
                />
              </>
            )}
            {addedFuel === 'yes' && (
              <>
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <Field label={t('log.litres')} mono value={litres} onChangeText={setLitres} keyboardType="decimal-pad" maxLength={7} />
                  <Field label={t('log.amount')} mono value={amount} onChangeText={setAmount} keyboardType="decimal-pad" maxLength={10} />
                </View>
                <Button kind="outline" label={t(receipt ? 'log.receiptAdded' : 'log.addReceipt')} onPress={photographReceipt} />
              </>
            )}
          </Card>
        )}

        {problem && <Notice tone="danger" text={problem} />}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16 }}>
        <Button label={t(SAVE[mode])} onPress={save} busy={saving} disabled={reading} />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  photoCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 16,
    borderRadius: 18,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: '#b8b2a6',
  },
  cameraTile: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 56, height: 56, borderRadius: 14, backgroundColor: colors.line },
  odometer: {
    minHeight: 68,
    borderWidth: 2.5,
    borderColor: colors.ink,
    borderRadius: 14,
    paddingHorizontal: 16,
    fontFamily: fonts.monoSemiBold,
    fontSize: 32,
    color: colors.ink,
  },
  underOdometer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
});
