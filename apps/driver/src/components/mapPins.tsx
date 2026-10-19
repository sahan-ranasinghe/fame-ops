// The task map's shared parts: the pins, the framing constants, the turn and what both engines are given (Part 6: Google's
// map in GoogleTaskMap.tsx and the free map in OpenTaskMap.tsx, chosen by TaskMap.tsx).

import Flag from 'lucide-react-native/icons/flag';
import { StyleSheet, View } from 'react-native';

import { Mono } from '@/components/ui';
import { colors } from '@/theme';
import type { Frame, LatLng, MapStop, RouteLeg } from './taskMapLogic';

export const SRI_LANKA: LatLng = { lat: 7.75, lng: 80.7 };
/** Room for the back button and the duty pill above, the sheet's rounded top below, and the pins' labels. */
export const PADDING = { top: 120, right: 60, bottom: 60, left: 60 };
/** The sheet covers the map's bottom edge: Google's logo and the framing stay above it. */
export const SHEET_OVERLAP = 24;
export const ONE_PLACE_ZOOM = 14;
/** Follow me: the zoom when it is turned on (a street or two around the phone). */
export const FOLLOW_ZOOM = 16;

export interface Fit {
  key: string;
  frame: Frame;
}

export interface Turn {
  heading: number;
  pitch: number;
}

export interface MapParts {
  stops: MapStop[];
  start: LatLng | null;
  me: LatLng | null;
  fit: Fit;
}

/** What each engine is given (TaskMap.tsx): the same parts, Follow me, and how it says it loaded or failed. */
export interface EngineProps extends MapParts {
  lines: RouteLeg[];
  /** Keep the phone in the middle on every new position. */
  follow: boolean;
  /** The person moved the map (a pan or a pinch): Follow me turns off. */
  onUserMove: () => void;
  /** The map finished loading (Google: onMapLoaded; MapLibre: onDidFinishLoadingMap). */
  onLoaded: () => void;
  /** The map said it failed (MapLibre: onDidFailLoadingMap). */
  onFailed: () => void;
}

/** Only the changes a person can see: a re-render per pan would be wasted. */
export function nextTurn(prev: Turn, heading: number, pitch: number): Turn {
  return Math.abs(prev.heading - heading) < 0.5 && Math.abs(prev.pitch - pitch) < 0.5 ? prev : { heading, pitch };
}

/** A stop: its number (a flag on the start stop) and its time, on a stem to the point. */
export function StopPin({ stop }: { stop: MapStop }) {
  const current = stop.state === 'current';
  const done = stop.state === 'done';
  const fill = current ? colors.blue : done ? colors.card : colors.ink;
  const ink = done ? colors.muted : '#ffffff';
  const size = current ? 16 : 14;
  return (
    <View style={{ alignItems: 'center', opacity: done ? 0.75 : 1 }}>
      <View style={[mapStyles.pin, { backgroundColor: fill, borderColor: done ? colors.line : '#ffffff' }, current && mapStyles.pinCurrent]}>
        <View style={[mapStyles.pinNumber, current && mapStyles.pinNumberCurrent, done && { backgroundColor: colors.page }]}>
          <Mono size={size} bold color={current ? colors.blue : colors.ink}>{String(stop.n)}</Mono>
        </View>
        {stop.isStart && <Flag size={size} color={ink} strokeWidth={2.6} />}
        {stop.time !== null && <Mono size={size} bold color={ink}>{stop.time}</Mono>}
      </View>
      <View style={[mapStyles.stem, { backgroundColor: current ? colors.blue : done ? colors.muted : colors.ink }]} />
    </View>
  );
}

/** Where the trip starts when it is not a stop: a small flag, muted (the driver has left it). */
export function StartPin() {
  return (
    <View style={mapStyles.start}>
      <Flag size={14} color="#ffffff" strokeWidth={2.6} />
    </View>
  );
}

/** The phone. */
export function MePin() {
  return (
    <View style={mapStyles.meHalo}>
      <View style={mapStyles.meDot} />
    </View>
  );
}

export const mapStyles = StyleSheet.create({
  /** Under the map, above the sheet's rounded top: the Google-place line and the credits. */
  mapBottom: { position: 'absolute', left: 16, right: 16, bottom: SHEET_OVERLAP + 6, gap: 6, alignItems: 'flex-start' },
  mapNote: {
    alignSelf: 'stretch',
    backgroundColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  credit: { backgroundColor: 'rgba(255,255,255,0.85)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1, fontSize: 10, color: colors.ink },
  pin: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 3,
    paddingRight: 9,
    paddingVertical: 3,
    borderRadius: 16,
    borderWidth: 2,
    elevation: 3,
  },
  pinCurrent: { paddingVertical: 4, paddingRight: 11, borderRadius: 18 },
  pinNumber: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 4, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  pinNumberCurrent: { minWidth: 28, height: 28, borderRadius: 14 },
  stem: { width: 10, height: 10, borderRadius: 5, marginTop: 2, borderWidth: 2, borderColor: '#ffffff' },
  start: { width: 26, height: 26, borderRadius: 7, backgroundColor: colors.ink, opacity: 0.8, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#ffffff' },
  meHalo: { width: 46, height: 46, borderRadius: 14, backgroundColor: 'rgba(30,79,160,0.22)', alignItems: 'center', justifyContent: 'center' },
  meDot: { width: 24, height: 24, borderRadius: 7, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff' },
});

// --- Office mode (Phase 8, O1): the Live tab's drivers map (DriversMap.tsx; GoogleDriversMap.tsx, OpenDriversMap.tsx) ----
// Appended for Live; nothing above changes. One marker per driver with a position: the initials in a dark ring coloured
// by duty (design 15: blue on a task, green free, grey off duty), the selected one with "Sunil · 62 km/h" above it.

import { Txt } from '@/components/ui';
import type { DriverMarker, Focus, LiveFit, LiveTone } from '../office/liveLogic';

/** The zoom when a driver is selected (a few streets around them). */
export const DRIVER_ZOOM = 15;
/** Room around the drivers when the map frames them all (the labels and the chips are not over this map). */
export const DRIVERS_PADDING = { top: 56, right: 48, bottom: 48, left: 48 };
/** The pin's sizes, so Google's anchor (a fraction of the view) lands on the ring's centre under the label. */
export const DRIVER_PIN = { size: 44, labelHeight: 24, gap: 4 } as const;

/** Google's anchor y: the ring's centre, under the label when there is one. */
export function driverPinAnchorY(labelled: boolean): number {
  if (!labelled) return 0.5;
  const total = DRIVER_PIN.labelHeight + DRIVER_PIN.gap + DRIVER_PIN.size;
  return (DRIVER_PIN.labelHeight + DRIVER_PIN.gap + DRIVER_PIN.size / 2) / total;
}

/** What each drivers engine is given (DriversMap.tsx): the markers, the frame around them, the selected driver, and how it says it loaded or failed. */
export interface DriversEngineProps {
  markers: DriverMarker[];
  fit: LiveFit;
  /** The selected driver with a position: the map moves to them once per selection (`nonce`: the same row tapped again). */
  focus: (Focus & { nonce: number }) | null;
  onPressMarker: (username: string) => void;
  /** The map finished loading (Google: onMapLoaded; MapLibre: onDidFinishLoadingMap). */
  onLoaded: () => void;
  /** The map said it failed (MapLibre: onDidFailLoadingMap). */
  onFailed: () => void;
}

const RING: Record<LiveTone, string> = { blue: colors.blue, green: colors.green, muted: colors.muted };

/** The initials in a dark ring coloured by duty; the row's avatar and the marker's body. */
export function DriverDot({ initials, tone, dim = false, selected = false, size = DRIVER_PIN.size }: {
  initials: string;
  tone: LiveTone;
  dim?: boolean;
  selected?: boolean;
  size?: number;
}) {
  return (
    <View
      style={[
        driverStyles.dot,
        { width: size, height: size, borderRadius: size / 2, borderColor: RING[tone], borderWidth: selected ? 4 : 3 },
        dim && { opacity: 0.7 },
      ]}
    >
      <Txt variant="strong" size={Math.round(size * 0.34)} color="#ffffff">{initials}</Txt>
    </View>
  );
}

/** A driver on the map: the label (the selected one) above the ring. */
export function DriverPin({ marker }: { marker: DriverMarker }) {
  return (
    <View style={{ alignItems: 'center' }}>
      {marker.label !== null && (
        <View style={[driverStyles.label, { height: DRIVER_PIN.labelHeight, marginBottom: DRIVER_PIN.gap }]}>
          <Txt variant="strong" size={12} numberOfLines={1}>{marker.label}</Txt>
        </View>
      )}
      <DriverDot initials={marker.initials} tone={marker.tone} dim={marker.dim} selected={marker.selected} />
    </View>
  );
}

const driverStyles = StyleSheet.create({
  dot: { backgroundColor: colors.darkSurface, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  label: { backgroundColor: colors.card, borderRadius: 8, paddingHorizontal: 8, justifyContent: 'center', elevation: 2 },
});
