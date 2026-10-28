// Round 48 (item 3): the pins of a driven route, one picture on every engine (Google's native map and MapLibre's in
// RouteMap.tsx and DriversMap.tsx, both browser maps in the .web.tsx files), kept apart from the map modules so the web
// build can share them (Google Maps Timeline: the start and the end are pins, a stop is a small dot that shows its time
// when tapped or when the Layers filter says so, a "no GPS" / "app not running" event is a red marker, several markers
// together are one numbered circle until zoomed in: lib/cluster.ts). The sizes are exported so Google's anchor (a
// fraction of the view) lands on the dot's centre under a label.

import PowerOff from 'lucide-react-native/icons/power-off';
import SignalZero from 'lucide-react-native/icons/signal-zero';
import { StyleSheet, View } from 'react-native';

import { Flag, Square } from '@/components/icons';
import { Mono } from '@/components/ui';
import type { EndMark, GapMark } from '@/office/routeMarks';
import { colors, shadow } from '@/theme';

/** The stop dot (small: the line reads through it), its label above it, the gap between. */
export const ROUTE_DOT = { size: 12, label: 18, gap: 2 } as const;
/** The start and end pins, the gap marker, the cluster circle. */
export const END_PIN = 24;
export const GAP_PIN = 22;
export const CLUSTER_PIN = 36;

/** Google's anchor y for a stop dot: its centre, under the label when one is shown. */
export function stopDotAnchorY(labelled: boolean): number {
  if (!labelled) return 0.5;
  const total = ROUTE_DOT.label + ROUTE_DOT.gap + ROUTE_DOT.size;
  return (ROUTE_DOT.label + ROUTE_DOT.gap + ROUTE_DOT.size / 2) / total;
}

/** A stop over 10 minutes: a grey dot with a white ring; its time above it when asked (tapped, or the Stop times layer). */
export function RouteStopDot({ time, labelled, open = false }: { time: string; labelled: boolean; open?: boolean }) {
  return (
    <View style={styles.wrap}>
      {labelled && (
        <View style={[styles.label, { height: ROUTE_DOT.label, marginBottom: ROUTE_DOT.gap }]}>
          <Mono size={11} bold>{time}</Mono>
        </View>
      )}
      <View style={[styles.dot, open && styles.dotOpen]} />
    </View>
  );
}

/** The start (a flag) or the end (a square) of the route: an ink circle, centred on the point. */
export function RouteEndPin({ end }: { end: Pick<EndMark, 'kind'> }) {
  return (
    <View style={styles.end}>
      {end.kind === 'start' ? <Flag size={13} color="#ffffff" strokeWidth={2.6} /> : <Square size={11} color="#ffffff" fill="#ffffff" strokeWidth={2.6} />}
    </View>
  );
}

/** A gap: where the GPS signal went (no fix) or the app stopped running; red, centred on the point; ringed in ink while its card is open. */
export function GapPin({ gap, open = false }: { gap: Pick<GapMark, 'kind'>; open?: boolean }) {
  return (
    <View style={[styles.gapPin, open && { borderColor: colors.ink }]}>
      {gap.kind === 'no_data' ? <PowerOff size={12} color="#ffffff" strokeWidth={2.8} /> : <SignalZero size={13} color="#ffffff" strokeWidth={2.8} />}
    </View>
  );
}

/** Several markers together: one blue circle with the count (a tap zooms in two steps). */
export function ClusterPin({ count }: { count: number }) {
  return (
    <View style={styles.cluster}>
      <Mono size={14} bold color="#ffffff">{String(count)}</Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center' },
  label: { justifyContent: 'center', backgroundColor: colors.card, borderRadius: 6, paddingHorizontal: 5, ...shadow(2) },
  dot: { width: ROUTE_DOT.size, height: ROUTE_DOT.size, borderRadius: ROUTE_DOT.size / 2, backgroundColor: '#8d9096', borderWidth: 2, borderColor: '#ffffff', ...shadow(2) },
  dotOpen: { borderColor: colors.ink, backgroundColor: colors.card },
  end: { width: END_PIN, height: END_PIN, borderRadius: END_PIN / 2, backgroundColor: colors.ink, borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', ...shadow(3) },
  gapPin: { width: GAP_PIN, height: GAP_PIN, borderRadius: GAP_PIN / 2, backgroundColor: colors.red, borderWidth: 2, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', ...shadow(3) },
  cluster: { width: CLUSTER_PIN, height: CLUSTER_PIN, borderRadius: CLUSTER_PIN / 2, backgroundColor: colors.blue, borderWidth: 3, borderColor: '#ffffff', alignItems: 'center', justifyContent: 'center', ...shadow(4) },
});
