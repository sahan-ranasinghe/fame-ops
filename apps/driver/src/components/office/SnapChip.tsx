// Snap to roads on a route map (Round 48 item 5; office/snapLogic.ts has the rules): one chip over the map, in its control
// cluster, that switches between the road-aligned line and the recorded GPS points (Strava's "snap to roads" toggle;
// Google Maps Timeline's line), and the hook a screen uses to know whether it may ask the server for the snapped line on
// the map it shows now (Google's map, or the open package; never the free map standing in for Google's: rule 10). The
// choice is the screen's own state: nothing is stored.

import { useState } from 'react';
import { Pressable, StyleSheet } from 'react-native';

import { Check } from '@/components/icons';
import { useRouteMapEngine } from '@/components/RouteMap';
import { Txt } from '@/components/ui';
import type { MapPackage } from '@/lib/mapEngine';
import { snapAllowed } from '@/office/snapLogic';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export interface SnapState {
  /** This map may draw a snapped line (the engine now, the office's package): the request carries snap only then. */
  allowed: boolean;
  /** The chip's wish (default on). */
  wanted: boolean;
  /** Asked of the server and drawn: allowed and wanted. */
  on: boolean;
  setWanted: (on: boolean) => void;
}

/** The screen's snap state: allowed follows the engine (Google's map failing mid-screen moves it to the free map: the snapped line goes at once). */
export function useSnap(mapPackage: MapPackage | undefined): SnapState {
  const engine = useRouteMapEngine(mapPackage);
  const allowed = snapAllowed(engine, mapPackage);
  const [wanted, setWanted] = useState(true);
  return { allowed, wanted, on: allowed && wanted, setWanted };
}

/** The chip: a white pill with a check while on ("Snapped to roads"), plain while off ("GPS line"); a switch, not a selection. */
export function SnapChip({ on, onChange, testID = 'snap-chip' }: { on: boolean; onChange: (on: boolean) => void; testID?: string }) {
  const { t } = useApp();
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={t('office.live.snapToggle')}
      onPress={() => onChange(!on)}
      testID={testID}
      style={({ pressed }) => [styles.pill, on && styles.pillOn, pressed && { opacity: 0.8 }]}
    >
      {on ? <Check size={16} color={colors.blue} strokeWidth={3} /> : null}
      <Txt variant="strong" size={13} color={on ? colors.blue : colors.ink} numberOfLines={1}>{on ? t('office.live.snapOn') : t('office.live.snapOff')}</Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 36, backgroundColor: 'rgba(255,255,255,0.92)', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6, borderWidth: 1.5, borderColor: 'transparent' },
  pillOn: { backgroundColor: colors.blueChip, borderColor: colors.blue },
});
