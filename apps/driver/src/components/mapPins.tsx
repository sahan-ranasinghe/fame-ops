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
  mapNote: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: SHEET_OVERLAP + 10,
    backgroundColor: colors.ink,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
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
