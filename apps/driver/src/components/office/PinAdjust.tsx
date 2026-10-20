// Office mode (Stage 1, O3 row 8): check a pasted pin before it is used (the website's map/PinMap.tsx). A pasted
// "lat, lng" or Google Maps link lands a few metres off more often than not: the sheet shows the map centred on it with a
// pin fixed in the middle; moving the map moves the point (no dragging on a small screen), and "Use this point" takes the
// centre. Both engines (the route map's choice, lib/mapEngine.ts): Google's map (react-native-maps) or the free map
// (MapLibre, OpenFreeMap, with its credit). The positions are the person's own, so either map may show them.

import { Camera, Map } from '@maplibre/maplibre-react-native';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import GoogleMapView, { PROVIDER_GOOGLE } from 'react-native-maps';

import { MapPin } from '@/components/icons';
import { mapStyles } from '@/components/mapPins';
import { Sheet } from '@/components/patterns/Sheet';
import { useRouteMapEngine } from '@/components/RouteMap';
import { OSM_CREDIT } from '@/components/taskMapLogic';
import { Button, Mono, Txt } from '@/components/ui';
import { type MapPackage, mapSession, waitFor } from '@/lib/mapEngine';
import { useApp } from '@/state/app';
import { colors } from '@/theme';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export interface PinPoint {
  lat: number;
  lng: number;
}

/** The centre the map reports, rounded to 6 decimals (about 10 cm): what "Use this point" sends. */
export const roundPin = (p: PinPoint): PinPoint => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });

export function PinAdjust({ visible, pin, name, mapPackage, onUse, onClose }: {
  visible: boolean;
  pin: PinPoint | null;
  name: string;
  mapPackage?: MapPackage;
  onUse: (p: PinPoint) => void;
  onClose: () => void;
}) {
  const { t, settings } = useApp();
  const chosen = useRouteMapEngine(mapPackage);
  // Google's map that has not said it is ready within phone_map_wait_s is judged failed (lib/mapEngine.ts): the free map.
  const [googleDown, setGoogleDown] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const engine = chosen === 'google' && !googleDown ? 'google' : 'open';
  useEffect(() => {
    if (!visible || engine !== 'google' || googleReady) return;
    const timer = setTimeout(() => {
      mapSession.markGoogleFailed(Date.now());
      setGoogleDown(true);
    }, waitFor('google', settings.phone_map_wait_s) * 1000);
    return () => clearTimeout(timer);
  }, [visible, engine, googleReady, settings.phone_map_wait_s]);
  const [centre, setCentre] = useState<PinPoint | null>(pin);
  const [failed, setFailed] = useState(false);
  const shown = centre ?? pin;
  if (!pin) return null;

  return (
    <Sheet visible={visible} title={t('office.pin.title')} onClose={onClose} scroll={false} testID="pin-adjust"
      actions={<Button label={t('office.pin.use')} onPress={() => onUse(roundPin(shown ?? pin))} style={{ flex: 1, minHeight: 56 }} testID="pin-use" />}>
      <Txt variant="muted" size={15}>{name}</Txt>
      <View style={styles.map}>
        {failed ? (
          <View style={styles.failed}><Txt variant="small">{t('office.pin.mapFailed')}</Txt></View>
        ) : engine === 'google' ? (
          <GoogleMapView
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={{ latitude: pin.lat, longitude: pin.lng, latitudeDelta: 0.004, longitudeDelta: 0.004 }}
            toolbarEnabled={false}
            onMapReady={() => setGoogleReady(true)}
            onRegionChangeComplete={(r) => setCentre({ lat: r.latitude, lng: r.longitude })}
          />
        ) : (
          <>
            <Map style={StyleSheet.absoluteFill} mapStyle={MAP_STYLE} logo={false} compass={false}
              onDidFailLoadingMap={() => setFailed(true)}
              onRegionDidChange={(e) => {
                const c = e.nativeEvent.center as unknown as [number, number] | undefined;
                if (Array.isArray(c) && c.length === 2) setCentre({ lat: c[1], lng: c[0] });
              }}>
              <Camera center={[pin.lng, pin.lat]} zoom={17} />
            </Map>
            <View style={styles.credit} pointerEvents="none"><Text style={mapStyles.credit} accessibilityLanguage="en">{OSM_CREDIT}</Text></View>
          </>
        )}
        {!failed && (
          // The pin fixed in the middle: its point is the map's centre.
          <View style={styles.centre} pointerEvents="none" testID="pin-centre">
            <MapPin size={36} color={colors.red} strokeWidth={2.6} />
          </View>
        )}
      </View>
      {shown && <Mono size={14} color={colors.muted}>{`${shown.lat.toFixed(6)}, ${shown.lng.toFixed(6)}`}</Mono>}
      <Txt variant="small">{t('office.pin.hint')}</Txt>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  map: { height: 320, borderRadius: 14, overflow: 'hidden', backgroundColor: colors.mapLand, marginVertical: 8 },
  centre: { position: 'absolute', left: '50%', top: '50%', marginLeft: -18, marginTop: -34 },
  credit: { position: 'absolute', left: 8, bottom: 6 },
  failed: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 },
});
