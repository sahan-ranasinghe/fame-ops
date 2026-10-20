// Office mode in the mobile website (Phase 8, O4): check a pasted pin before it is used, as the phones' PinAdjust.tsx. The
// sheet shows the map centred on it with a pin fixed in the middle; moving the map moves the point (the same on a phone's
// browser and a desktop's), and "Use this point" takes the centre. The browser's engines (components/web: Google's map
// under the google package, its load counted; else the free map with its credit). The positions are the person's own, so
// either map may show them. A map that cannot load says so; "Use this point" still takes the pasted point.

import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { MapPin } from '@/components/icons';
import { mapStyles } from '@/components/mapPins';
import { Sheet } from '@/components/patterns/Sheet';
import { OSM_CREDIT } from '@/components/taskMapLogic';
import { Button, Mono, Txt } from '@/components/ui';
import { BrowserMap, useMapMount } from '@/components/web/BrowserMap';
import type { MapPackage } from '@/lib/mapEngine';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

export interface PinPoint {
  lat: number;
  lng: number;
}

/** The centre the map reports, rounded to 6 decimals (about 10 cm): what "Use this point" sends. */
export const roundPin = (p: PinPoint): PinPoint => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });

/** The pin's zoom: a building or two around it. */
const PIN_ZOOM = 17;
const NO_PADDING = { top: 0, right: 0, bottom: 0, left: 0 };

export function PinAdjust({ visible, pin, name, mapPackage, onUse, onClose }: {
  visible: boolean;
  pin: PinPoint | null;
  name: string;
  mapPackage?: MapPackage;
  onUse: (p: PinPoint) => void;
  onClose: () => void;
}) {
  const { t } = useApp();
  const [centre, setCentre] = useState<PinPoint | null>(pin);
  const shown = centre ?? pin;
  if (!pin) return null;

  return (
    <Sheet visible={visible} title={t('office.pin.title')} onClose={onClose} scroll={false} testID="pin-adjust"
      actions={<Button label={t('office.pin.use')} onPress={() => onUse(roundPin(shown ?? pin))} style={{ flex: 1, minHeight: 56 }} testID="pin-use" />}>
      <Txt variant="muted" size={15}>{name}</Txt>
      <View style={styles.map}>
        {/* The map only while the sheet is open: a closed sheet never waits for (or judges) a map. */}
        {visible ? <PinMap pin={pin} mapPackage={mapPackage} onCentre={setCentre} /> : null}
      </View>
      {shown && <Mono size={14} color={colors.muted}>{`${shown.lat.toFixed(6)}, ${shown.lng.toFixed(6)}`}</Mono>}
      <Txt variant="small">{t('office.pin.hint')}</Txt>
    </Sheet>
  );
}

function PinMap({ pin, mapPackage, onCentre }: { pin: PinPoint; mapPackage?: MapPackage; onCentre: (p: PinPoint) => void }) {
  const { t } = useApp();
  const mapMount = useMapMount(mapPackage);
  if (mapMount.mount.status === 'unavailable') {
    return <View style={styles.failed}><Txt variant="small">{t('office.pin.mapFailed')}</Txt></View>;
  }
  return (
    <>
      <BrowserMap
        mapMount={mapMount}
        start={{ kind: 'center', center: pin, zoom: PIN_ZOOM }}
        padding={NO_PADDING}
        onAdapter={() => undefined}
        events={{ moved: onCentre }}
      />
      {mapMount.mount.engine === 'open' && (
        <View style={styles.credit} pointerEvents="none"><Text style={mapStyles.credit} accessibilityLanguage="en">{OSM_CREDIT}</Text></View>
      )}
      {/* The pin fixed in the middle: its point is the map's centre. */}
      <View style={styles.centre} pointerEvents="none" testID="pin-centre">
        <MapPin size={36} color={colors.red} strokeWidth={2.6} />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  map: { height: 320, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.mapLand, marginVertical: 8 },
  centre: { position: 'absolute', left: '50%', top: '50%', marginLeft: -18, marginTop: -34 },
  credit: { position: 'absolute', left: 8, bottom: 6 },
  failed: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
