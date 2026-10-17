// Choose today's vehicle (Phase 7, docs/phase7-plan.md §1 and §2). Two uses:
//   start   Start work on Today: pick the vehicle (or "No vehicle today"), then Start
//   change  Change vehicle while on duty
// The list comes from the server with who holds each vehicle now ("With Kamal now"); without
// a connection it falls back to the vehicles saved on the phone. A vehicle another driver holds
// can be picked: that is a hand-over, and the server tells the other driver.
// Part 3 (§6): each vehicle shows its photo beside the plate; one without a photo has "Add a photo"
// (the camera only). The photo is queued like every other photo, so it works offline; when another
// photo got there first the driver is told and the server's photo stays.

import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Camera, Check, ChevronLeft, Play } from '@/components/icons';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useLeaveGuard } from '@/components/navigation';
import { Thumb, useNeedsVehiclePhoto, useVehicleThumbs } from '@/components/Photos';
import { Button, Card, Mono, Notice, Txt } from '@/components/ui';
import type { VehicleChoice } from '@/lib/api';
import { takeVehiclePhoto } from '@/lib/photos';
import type { Vehicle } from '@/lib/types';
import { useApp } from '@/state/app';
import { onVehiclePhotoAnswer } from '@/sync';
import { colors } from '@/theme';

/** A line under one vehicle after "Add a photo": added, waiting for the connection, someone was first, no camera. */
interface PhotoNote {
  vehicleId: string;
  key: 'vehiclePhoto.added' | 'vehiclePhoto.queued' | 'vehiclePhoto.hasOne' | 'common.cameraDenied';
}

type Mode = 'start' | 'change';
/** The vehicle picked: an id, null = "No vehicle today", undefined = nothing picked yet. */
type Picked = string | null | undefined;

/**
 * The vehicle to preselect: the one I hold now, else my last one, else my regular one; never one another driver
 * holds now (one tap on Start would take it from them; picking it stays possible).
 */
function preselect(list: VehicleChoice[]): Picked {
  const free = (v: VehicleChoice) => !v.held_by;
  return (list.find((v) => v.mine_now) ?? list.find((v) => v.my_last && free(v)) ?? list.find((v) => v.my_regular && free(v)))?.id;
}

export default function VehicleScreen() {
  const app = useApp();
  const { t, me, vehicles, loadVehicleChoices } = app;
  const params = useLocalSearchParams<{ mode?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  // Already on duty: always a change. Fixed when the screen opens (Start work turns duty on before the screen goes back).
  const [mode] = useState<Mode>(() => (app.sharing || params.mode === 'change' ? 'change' : 'start'));
  // The server's list (null = no connection: the vehicles saved on the phone instead).
  const [choices, setChoices] = useState<VehicleChoice[] | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [picked, setPicked] = useState<Picked>(undefined);
  const [busy, setBusy] = useState(false);
  const [needLocation, setNeedLocation] = useState(false);
  // "Add a photo": the vehicle whose photo is being made, and the line shown under a vehicle after it.
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const [photoNote, setPhotoNote] = useState<PhotoNote | null>(null);
  const [pulls, setPulls] = useState(0);
  // Back does nothing while Start work runs (the Location cover may be up) or a photo is being made.
  const { allowLeave } = useLeaveGuard(false, busy || photoBusy !== null);

  const current = me?.current_vehicle_id ?? null;
  const load = useCallback(async () => {
    const rows = await loadVehicleChoices();
    setChoices(rows);
    setLoaded(true);
    return rows;
  }, [loadVehicleChoices]);

  useEffect(() => {
    void load().then((rows) => {
      const list = rows ?? offlineChoices(vehicles, current, app.workVehicle?.id ?? null);
      setPicked((old) => (old === undefined ? preselect(list) : old));
    });
    // Once, when the screen opens; pull to refresh loads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pull = useCallback(async () => {
    setRefreshing(true);
    setPulls((n) => n + 1);
    await load();
    setRefreshing(false);
  }, [load]);

  // A photo from this phone found another one there first: the driver is told; the server's photo is shown.
  useEffect(() => onVehiclePhotoAnswer((vehicleId, answer) => {
    if (answer === 'has_photo') setPhotoNote({ vehicleId, key: 'vehiclePhoto.hasOne' });
  }), []);

  const list = choices ?? offlineChoices(vehicles, current, app.workVehicle?.id ?? null);
  const thumbs = useVehicleThumbs(list.map((v) => v.id), pulls);
  const needsPhoto = useNeedsVehiclePhoto();

  if (!me) return <Redirect href="/login" />;

  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));

  async function addPhoto(vehicleId: string) {
    if (photoBusy) return;
    setPhotoNote(null);
    setPhotoBusy(vehicleId);
    let made: Awaited<ReturnType<typeof takeVehiclePhoto>>;
    try {
      made = await takeVehiclePhoto(vehicleId);
    } catch {
      made = null;
    }
    setPhotoBusy(null);
    if (made === 'denied') {
      setPhotoNote({ vehicleId, key: 'common.cameraDenied' });
      return;
    }
    if (!made) return;
    app.addVehiclePhoto(made);
    setPhotoNote({ vehicleId, key: app.offline || !app.dataAvailable ? 'vehiclePhoto.queued' : 'vehiclePhoto.added' });
  }

  async function confirm() {
    if (picked === undefined || busy) return;
    if (mode === 'change') {
      app.changeVehicle(picked);
      goBack();
      return;
    }
    setNeedLocation(false);
    setBusy(true);
    const outcome = await app.startWork(picked);
    if (outcome === 'on') {
      allowLeave();
      goBack();
      return;
    }
    setBusy(false);
    if (outcome === 'no_permission') {
      setNeedLocation(true);
      router.push('/permissions');
    }
    // 'cancelled': the driver chose "Not now" on the Location cover; the choice stays on screen.
  }

  const unchanged = mode === 'change' && picked === current;

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <ScrollView
        contentContainerStyle={{ padding: 16, paddingTop: insets.top + 18, paddingBottom: 24, gap: 12 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void pull()} colors={[colors.ink]} />}
      >
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={() => router.back()} style={styles.back}>
            <ChevronLeft size={28} color={colors.ink} strokeWidth={2.6} />
          </Pressable>
          <Txt variant="title" size={26} style={{ flex: 1 }}>{t(mode === 'start' ? 'vehicle.pickTitle' : 'vehicle.title')}</Txt>
        </View>

        {!loaded ? (
          <ActivityIndicator size="large" color={colors.ink} style={{ marginTop: 32 }} />
        ) : (
          <>
            {choices === null && <Notice tone="warn" text={t('vehicle.listOffline')} />}
            {list.length === 0 && <Txt variant="muted" style={{ padding: 8 }}>{t('vehicle.none')}</Txt>}
            {list.map((item) => (
              <Choice
                key={item.id}
                item={item}
                selected={picked === item.id}
                onPress={() => setPicked(item.id)}
                thumb={thumbs[item.id] ?? null}
                onAddPhoto={needsPhoto(item.id) ? () => void addPhoto(item.id) : undefined}
                photoBusy={photoBusy === item.id}
                note={photoNote?.vehicleId === item.id ? photoNote.key : null}
              />
            ))}
            <Pressable accessibilityRole="radio" accessibilityState={{ checked: picked === null }} onPress={() => setPicked(null)}>
              <Card style={[styles.row, picked === null && styles.selected]}>
                <Txt variant="big" style={{ flex: 1 }}>{t('vehicle.noVehicleToday')}</Txt>
                {picked === null && <Check size={26} color={colors.ink} strokeWidth={3} />}
              </Card>
            </Pressable>
          </>
        )}
      </ScrollView>

      <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 16, gap: 10 }}>
        {needLocation && <Notice tone="warn" text={t('today.needLocation')} />}
        <Button
          label={t(mode === 'start' ? 'vehicle.start' : 'vehicle.change')}
          icon={mode === 'start' ? Play : undefined}
          disabled={picked === undefined || unchanged}
          busy={busy}
          onPress={() => void confirm()}
        />
      </View>
    </View>
  );
}

/**
 * One vehicle: its photo, plate, make/model and seats, and what it is to me (mine now, my last, my regular, with
 * someone else); "Add a photo" when it has none.
 */
function Choice({ item, selected, onPress, thumb, onAddPhoto, photoBusy, note }: {
  item: VehicleChoice;
  selected: boolean;
  onPress: () => void;
  thumb: string | null;
  onAddPhoto?: () => void;
  photoBusy: boolean;
  note: PhotoNote['key'] | null;
}) {
  const { t } = useApp();
  const tags: { text: string; tone: 'blue' | 'plain' | 'amber' }[] = [];
  if (item.mine_now) tags.push({ text: t('vehicle.yours'), tone: 'blue' });
  else if (item.held_by) tags.push({ text: t('vehicle.withDriver', { name: item.held_by }), tone: 'amber' });
  if (item.my_last && !item.mine_now) tags.push({ text: t('vehicle.yourLast'), tone: 'plain' });
  if (item.my_regular) tags.push({ text: t('vehicle.yourRegular'), tone: 'plain' });
  if (item.in_garage) tags.push({ text: t('vehicle.inGarage'), tone: 'amber' });
  return (
    <Pressable accessibilityRole="radio" accessibilityState={{ checked: selected }} onPress={onPress}>
      <Card style={[styles.row, selected && styles.selected]}>
        <Thumb uri={thumb} size={64} />
        <View style={{ flex: 1, gap: 6 }}>
          <View style={styles.plate}>
            <Mono size={20} bold>{item.reg_no}</Mono>
          </View>
          <Txt variant="muted">
            {[item.make_model, item.seats ? t('common.seats', { n: item.seats }) : null].filter(Boolean).join(' · ')}
          </Txt>
          {tags.length > 0 && (
            <View style={styles.tags}>
              {tags.map((tag) => (
                <View key={tag.text} style={[styles.tag, TAG[tag.tone].box]}>
                  <Txt variant="strong" size={14} color={TAG[tag.tone].text}>{tag.text}</Txt>
                </View>
              ))}
            </View>
          )}
          {onAddPhoto && (
            <Pressable accessibilityRole="button" disabled={photoBusy} onPress={onAddPhoto} style={[styles.addPhoto, photoBusy && { opacity: 0.5 }]}>
              {photoBusy ? <ActivityIndicator color={colors.ink} /> : <Camera size={20} color={colors.ink} />}
              <Txt variant="strong" size={16}>{t(photoBusy ? 'vehiclePhoto.saving' : 'vehiclePhoto.add')}</Txt>
            </Pressable>
          )}
          {note && (
            <Txt variant="small" color={note === 'vehiclePhoto.added' ? colors.blue : note === 'common.cameraDenied' ? colors.red : colors.amberText}>
              {t(note)}
            </Txt>
          )}
        </View>
        {selected && <Check size={26} color={colors.ink} strokeWidth={3} />}
      </Card>
    </Pressable>
  );
}

const TAG = {
  blue: { box: { backgroundColor: colors.blueChip }, text: colors.blue },
  plain: { box: { backgroundColor: colors.page }, text: colors.ink },
  amber: { box: { backgroundColor: '#fdf1d6' }, text: colors.amberText },
} as const;

/** The saved vehicles as choices (no connection): who holds each is not known, mine is the phone's own record. */
/** Without a connection: the vehicles saved on the phone; the last vehicle held is known on the phone too. */
function offlineChoices(vehicles: Vehicle[], current: string | null, last: string | null): VehicleChoice[] {
  return vehicles.map((v) => ({
    id: v.id,
    reg_no: v.reg_no,
    make_model: v.make_model,
    vehicle_type: v.vehicle_type,
    seats: v.seats,
    in_garage: v.in_garage,
    current_odometer_km: v.current_odometer_km,
    held_by: null,
    held_since: null,
    mine_now: v.id === current,
    my_last: v.id === last,
    my_regular: false,
  }));
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  header: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  back: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 84 },
  selected: { borderColor: colors.ink, borderWidth: 2.5 },
  plate: { alignSelf: 'flex-start', borderWidth: 1.5, borderColor: colors.ink, borderRadius: 6, paddingHorizontal: 8, paddingVertical: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  tag: { borderRadius: 8, paddingHorizontal: 8, paddingVertical: 2 },
  addPhoto: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    alignSelf: 'flex-start',
    minHeight: 44,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
});
