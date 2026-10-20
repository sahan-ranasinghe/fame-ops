// The browser maps' pins that the phones keep inside their native map files (RouteMap.tsx, DriversMap.tsx), drawn the
// same: those files bring react-native-maps and MapLibre's native module with them, which the web build never loads. The
// task map's pins and the driver pin are shared as they are (mapPins.tsx).

import { StyleSheet, View } from 'react-native';

import { Mono, Txt } from '@/components/ui';
import { BAND_COLORS, type StopMark as DayStop } from '@/office/driversLogic';
import { type Cursor, ESTIMATED_COLOR, HOLE_COLOR, STOP_PIN, type StopMark as LiveStop } from '@/office/liveRouteLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

/** A driver's day: the stop pin's sizes (the circle over its time label). */
export const ROUTE_PIN = { circle: 18, gap: 2, label: 18 } as const;
/** The playback marker's size. */
export const PLAYBACK_PIN = 26;

export interface PlaybackMarker {
  lat: number;
  lng: number;
  heading: number | null;
  estimated: boolean;
}

/** A stop over 10 minutes on a driver's day: a dark circle with the time it began under it. */
export function RouteStopPin({ stop }: { stop: DayStop }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.circle} />
      <View style={styles.dayLabel}>
        <Mono size={11} bold>{stop.time}</Mono>
      </View>
    </View>
  );
}

/** The playback marker: a blue circle with an arrow to the path's direction (hollow inside a gap), turned by its view. */
export function PlaybackPin({ marker }: { marker: PlaybackMarker }) {
  const deg = marker.heading ?? 0;
  return (
    <View style={[styles.play, marker.estimated && styles.playHollow, marker.heading != null ? { transform: [{ rotate: `${deg}deg` }] } : null]} testID="playback-marker">
      {marker.heading != null ? <View style={[styles.arrow, marker.estimated && { borderBottomColor: colors.blue }]} /> : null}
    </View>
  );
}

/** Live: a stop over 10 minutes, a small white circle with a grey ring; tapped, its times and length sit above it. */
export function StopDot({ stop, open }: { stop: LiveStop; open: boolean }) {
  return (
    <View style={{ alignItems: 'center' }}>
      {open && (
        <View style={[styles.label, { height: STOP_PIN.labelHeight, marginBottom: STOP_PIN.gap }]}>
          <Mono size={12} bold>{stop.label}</Mono>
        </View>
      )}
      <View style={[styles.stop, open && { borderColor: colors.ink }]} />
    </View>
  );
}

/** Live: the playback marker, "09:12:05 · 62 km/h" (or "· estimated") above a blue dot, hollow while estimated. */
export function CursorPin({ cursor }: { cursor: Cursor }) {
  const { t } = useApp();
  const words = cursor.estimated ? t('office.live.estimated') : cursor.kmh === null ? null : t('office.live.kmh', { n: cursor.kmh });
  return (
    <View style={{ alignItems: 'center' }}>
      <View style={[styles.label, { height: STOP_PIN.labelHeight, marginBottom: STOP_PIN.gap, flexDirection: 'row', gap: 6 }]}>
        <Mono size={12} bold>{cursor.time}</Mono>
        {words ? <Txt variant="strong" size={12} color={cursor.estimated ? colors.muted : colors.ink}>{words}</Txt> : null}
      </View>
      <View style={[styles.cursor, cursor.estimated && { backgroundColor: colors.card, borderColor: ESTIMATED_COLOR }]} />
    </View>
  );
}

const SHADOW = { boxShadow: '0 1px 3px rgba(0,0,0,0.3)' } as const;

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: ROUTE_PIN.gap },
  circle: { width: ROUTE_PIN.circle, height: ROUTE_PIN.circle, borderRadius: ROUTE_PIN.circle / 2, backgroundColor: BAND_COLORS.standing, borderWidth: 3, borderColor: '#ffffff', ...SHADOW },
  dayLabel: { height: ROUTE_PIN.label, justifyContent: 'center', backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 5, ...SHADOW },
  play: { width: PLAYBACK_PIN, height: PLAYBACK_PIN, borderRadius: PLAYBACK_PIN / 2, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 2, ...SHADOW },
  playHollow: { backgroundColor: '#ffffff', borderColor: colors.blue },
  arrow: { width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderBottomWidth: 8, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: '#ffffff' },
  label: { backgroundColor: colors.card, borderRadius: 8, paddingHorizontal: 8, justifyContent: 'center', alignItems: 'center', ...SHADOW },
  stop: { width: STOP_PIN.size, height: STOP_PIN.size, borderRadius: STOP_PIN.size / 2, backgroundColor: colors.card, borderWidth: 2.5, borderColor: HOLE_COLOR, ...SHADOW },
  cursor: { width: 18, height: 18, borderRadius: 9, backgroundColor: colors.blue, borderWidth: 3, borderColor: colors.card, ...SHADOW },
});
