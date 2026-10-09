// One task. In progress it is the designed screen (design/png/Driver · Task in
// progress.png): map, destination, distance left, Navigate, Call contact,
// Complete task. Before it starts it shows the details and "Start task".

import { Camera, GeoJSONSource, Layer, Map, Marker } from '@maplibre/maplibre-react-native';
import * as Location from 'expo-location';
import { Redirect, useLocalSearchParams, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Check, ChevronLeft, Navigation, Phone, Play } from '@/components/icons';
import { useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { nextStop, StopTimeline, useDateLabel, usePeopleLine } from '@/components/task';
import { TrackingNotice } from '@/components/tracking';
import { Button, Mono, Notice, Txt } from '@/components/ui';
import { distanceKm, navigateLink, telLink, thousands } from '@/lib/format';
import { colomboTime } from '@/lib/time';
import type { TaskWithStops } from '@/lib/types';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
const SRI_LANKA: [number, number] = [80.7, 7.75];

type LngLat = [number, number];

/** The phone's position while this screen is open (for the map only; nothing is recorded here). */
function useMyPosition(enabled: boolean): LngLat | null {
  const [position, setPosition] = useState<LngLat | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    (async () => {
      try {
        if (!(await Location.getForegroundPermissionsAsync()).granted) return;
        const last = await Location.getLastKnownPositionAsync();
        if (last && !cancelled) setPosition([last.coords.longitude, last.coords.latitude]);
        const watcher = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 10_000, distanceInterval: 25 },
          (update) => setPosition([update.coords.longitude, update.coords.latitude]),
        );
        if (cancelled) watcher.remove();
        else subscription = watcher;
      } catch {
        // No position: the map simply shows the destination.
      }
    })();
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [enabled]);
  return position;
}

function TaskMap({ me, destination, label }: { me: LngLat | null; destination: LngLat | null; label: string }) {
  // Re-frame only when a position moves noticeably (about 1 km), not on every GPS update.
  const round = (p: LngLat | null) => (p ? `${p[0].toFixed(2)},${p[1].toFixed(2)}` : '');
  const frameKey = `${round(me)}|${round(destination)}`;
  const camera = useMemo(() => {
    if (me && destination) {
      return {
        bounds: [
          Math.min(me[0], destination[0]), Math.min(me[1], destination[1]),
          Math.max(me[0], destination[0]), Math.max(me[1], destination[1]),
        ] as [number, number, number, number],
        padding: { top: 110, right: 70, bottom: 70, left: 70 },
      };
    }
    const only = me ?? destination;
    return only ? { center: only, zoom: 12 } : { center: SRI_LANKA, zoom: 6.4 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameKey]);

  const line = useMemo((): GeoJSON.Feature | null => {
    if (!me || !destination) return null;
    return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [me, destination] } };
  }, [me, destination]);

  return (
    <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass={false} touchPitch={false} touchRotate={false}>
      <Camera {...camera} duration={600} easing="ease" />
      {line && (
        <GeoJSONSource id="to-destination" data={line}>
          <Layer id="to-destination-line" type="line" paint={{ 'line-color': colors.blue, 'line-width': 6 }} layout={{ 'line-cap': 'round' }} />
        </GeoJSONSource>
      )}
      {destination && (
        <Marker id="destination" lngLat={destination} anchor="bottom">
          <View style={{ alignItems: 'center', gap: 6 }}>
            <View style={styles.mapLabel}>
              <Txt variant="strong" size={14} color="#ffffff" numberOfLines={1}>{label}</Txt>
            </View>
            <View style={styles.destinationDot} />
          </View>
        </Marker>
      )}
      {me && (
        <Marker id="me" lngLat={me} anchor="center">
          <View style={styles.meHalo}>
            <View style={styles.meDot} />
          </View>
        </Marker>
      )}
    </Map>
  );
}

export default function TaskScreen() {
  const app = useApp();
  const { t, tasks, sharing, gpsKm } = app;
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const dateLabel = useDateLabel();
  const peopleLine = usePeopleLine();

  const task: TaskWithStops | undefined = tasks.find((item) => item.id === id);
  const running = task?.status === 'in_progress';
  const myPosition = useMyPosition(running);

  if (!app.me) return <Redirect href="/login" />;

  // The arrow and the system back return to where the task was opened; "Back to Today" always lands on Today.
  const goBack = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const goHome = () => {
    if (router.canGoBack()) router.dismissAll();
    router.navigate('/');
  };

  if (!task) {
    return (
      <View style={[styles.page, { padding: 20, paddingTop: insets.top + 40, gap: 16 }]}>
        <StatusBar style="dark" />
        <Notice tone="warn" text={t('task.gone')} />
        <Button kind="outline" label={t('task.backToToday')} onPress={goHome} />
      </View>
    );
  }

  const stop = nextStop(task);
  const destination: LngLat | null = stop?.lat != null && stop.lng != null ? [stop.lng, stop.lat] : null;
  const km = myPosition && destination
    ? distanceKm({ lat: myPosition[1], lng: myPosition[0] }, { lat: destination[1], lng: destination[0] })
    : null;
  const navigate = stop ? navigateLink({ lat: stop.lat, lng: stop.lng, text: stop.address ?? stop.place_name }) : null;
  const call = telLink(task.contact_phone);
  const people = peopleLine(task);
  const otherRunning = tasks.some((item) => item.status === 'in_progress' && item.id !== task.id);

  const overlay = (
    <>
      <Pressable accessibilityRole="button" accessibilityLabel={t('common.cancel')} onPress={goBack} style={[styles.back, { top: insets.top + 12 }]}>
        <ChevronLeft size={26} color={colors.ink} strokeWidth={2.6} />
      </Pressable>
      {running && (
        <Pressable
          accessibilityRole="button"
          onPress={() => { if (!sharing) void app.setSharing(true).then((r) => { if (r === 'no_permission') router.push('/permissions'); }); }}
          style={[styles.sharingPill, { top: insets.top + 16 }]}
        >
          <View style={[styles.pillDot, { backgroundColor: sharing ? colors.blue : colors.red }]} />
          <Txt variant="strong" size={15} color={sharing ? colors.ink : colors.red}>{t(sharing ? 'task.sharingLocation' : 'task.notSharing')}</Txt>
        </Pressable>
      )}
    </>
  );

  return (
    <View style={styles.page}>
      <StatusBar style="dark" />
      <View style={{ height: running ? Math.round(height * 0.4) : insets.top + 76, backgroundColor: colors.mapLand }}>
        {running && <TaskMap me={myPosition} destination={destination} label={stop?.place_name ?? ''} />}
        {overlay}
      </View>

      <ScrollView style={styles.sheet} contentContainerStyle={{ padding: 20, paddingBottom: insets.bottom + 24, gap: 16 }}>
        <View style={styles.grabber} />

        <View style={styles.topRow}>
          <Txt variant="label" color={running ? colors.blue : colors.amberText}>
            {t(running ? 'today.inProgress' : task.status === 'assigned' ? 'today.nextTask' : task.status === 'cancelled' ? 'task.cancelled' : 'task.completed')}
          </Txt>
          {running && task.started_at
            ? <Mono size={16} color={colors.muted}>{t('task.started', { time: colomboTime(task.started_at) })}</Mono>
            : <Mono size={18} bold>{`${dateLabel(task.start_at)} ${colomboTime(task.start_at)}`}</Mono>}
        </View>

        <View>
          <Txt variant="title" size={28}>{running ? stop?.place_name ?? task.title : task.title}</Txt>
          {running && <Txt variant="muted" size={18}>{[task.title, people].filter(Boolean).join(' · ')}</Txt>}
        </View>

        {running ? (
          <>
            <TrackingNotice />
            <View style={styles.stats}>
              <View style={{ flex: 1 }}>
                <Txt variant="muted" size={15}>{t('task.distanceLeft')}</Txt>
                <Txt variant="heading" size={24}>{km === null ? '–' : `≈ ${km < 10 ? km.toFixed(1) : Math.round(km)} ${t('common.km')}`}</Txt>
                {km !== null && <Txt variant="small">{t('task.straightLine')}</Txt>}
              </View>
              <View style={{ flex: 1 }}>
                <Txt variant="muted" size={15}>{t('task.startOdo')}</Txt>
                <Mono size={23} bold>{task.start_odometer_km === null ? '–' : thousands(task.start_odometer_km)}</Mono>
              </View>
            </View>
            {gpsKm.taskId === task.id && (
              <View style={styles.gpsLine}>
                <Txt variant="muted" size={15}>{t('tracking.gpsKm')}</Txt>
                <Txt variant="strong">{`≈ ${gpsKm.taskKm < 10 ? gpsKm.taskKm.toFixed(1) : Math.round(gpsKm.taskKm)} ${t('common.km')}`}</Txt>
                <Txt variant="small">{t('tracking.approx')}</Txt>
              </View>
            )}

            <View style={{ gap: 8 }}>
              {task.task_stops.map((item) => {
                const done = item.status === 'done' || item.status === 'skipped';
                return (
                  <View key={item.id} style={styles.stopRow}>
                    <View style={{ flex: 1 }}>
                      <Txt variant="muted" size={14}>{t(item.type === 'pickup' ? 'today.pickup' : item.type === 'drop' ? 'today.dropoff' : 'today.visit')}</Txt>
                      <Txt variant="strong">{item.place_name}</Txt>
                    </View>
                    {done ? (
                      <View style={styles.doneBadge}><Check size={18} color={colors.blue} strokeWidth={3} /></View>
                    ) : (
                      <Pressable accessibilityRole="button" onPress={() => app.markStopDone(item)} style={styles.doneButton}>
                        <Txt variant="strong" size={15}>{t('task.done')}</Txt>
                      </Pressable>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <Button kind="outline" icon={Navigation} label={t('task.navigate')} disabled={!navigate} onPress={() => navigate && Linking.openURL(navigate)} style={{ flex: 1 }} />
              <Button kind="outline" icon={Phone} label={t('task.callContact')} disabled={!call} onPress={() => call && Linking.openURL(call)} style={{ flex: 1 }} />
            </View>
            <Button
              kind="dark"
              icon={Check}
              label={t('task.complete')}
              onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'finish', taskId: task.id } })}
            />
            <Button
              kind="danger-text"
              label={t('task.reportProblem')}
              onPress={() => router.push({ pathname: '/report-problem', params: { taskId: task.id, vehicleId: task.vehicle_id } })}
            />
          </>
        ) : (
          <>
            <StopTimeline stops={task.task_stops} />
            {people && <Txt variant="muted">{people}</Txt>}
            {task.notes && <Txt variant="body">{task.notes}</Txt>}
            {task.status === 'completed' && task.km !== null && (
              <Mono size={20} bold>{`${thousands(task.km)} ${t('common.km')}`}</Mono>
            )}
            {task.status === 'cancelled' && task.cancelled_reason && <Notice tone="warn" text={task.cancelled_reason} />}
            {(task.status === 'completed' || task.status === 'cancelled') && (
              <Button label={t('task.backToToday')} onPress={goHome} style={{ marginTop: 8 }} />
            )}
            {task.status === 'assigned' && (
              <>
                {otherRunning && <Notice tone="warn" text={t('today.finishFirst')} />}
                <Button
                  icon={Play}
                  label={t('today.startTask')}
                  disabled={otherRunning}
                  onPress={() => router.push({ pathname: '/log-mileage', params: { mode: 'start', taskId: task.id, from: 'task' } })}
                />
                {call && <Button kind="outline" icon={Phone} label={t('task.callContact')} onPress={() => Linking.openURL(call)} />}
              </>
            )}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: colors.page },
  back: {
    position: 'absolute',
    left: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
  },
  sharingPill: {
    position: 'absolute',
    right: 16,
    height: 40,
    paddingHorizontal: 14,
    borderRadius: 20,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    elevation: 4,
  },
  pillDot: { width: 10, height: 10, borderRadius: 5 },
  mapLabel: { backgroundColor: colors.ink, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4, maxWidth: 220 },
  destinationDot: { width: 20, height: 20, borderRadius: 5, backgroundColor: colors.ink, borderWidth: 3, borderColor: '#ffffff' },
  meHalo: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(30,79,160,0.22)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 24, height: 24, borderRadius: 7, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff' },
  sheet: { flex: 1, marginTop: -22, backgroundColor: colors.card, borderTopLeftRadius: 26, borderTopRightRadius: 26 },
  grabber: { alignSelf: 'center', width: 44, height: 5, borderRadius: 3, backgroundColor: '#dcd9d0', marginTop: -6 },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  stats: { backgroundColor: colors.page, borderRadius: 14, padding: 16, flexDirection: 'row', gap: 12 },
  gpsLine: { flexDirection: 'row', alignItems: 'baseline', gap: 10, paddingHorizontal: 4, marginTop: -6 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: colors.line, borderRadius: 12, padding: 12 },
  doneButton: { minHeight: 44, paddingHorizontal: 16, borderRadius: 10, borderWidth: 1.5, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  doneBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.blueChip, alignItems: 'center', justifyContent: 'center' },
});
