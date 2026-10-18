// The OpenFreeMap map of the task screen (MapLibre): the stops that are not Google places, and the phone. Never Google's
// line or a Google place's pin (rule 10, lib/mapRule.ts). Its own module (Part 6): the Google-map build leaves MapLibre out,
// so only a build without the Google map requires this file (TaskMap.tsx).

import { Camera, Map, Marker, type CameraRef, type CameraStop } from '@maplibre/maplibre-react-native';
import { useMemo, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Txt } from '@/components/ui';
import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { type MapParts, mapStyles, MePin, nextTurn, ONE_PLACE_ZOOM, PADDING, SHEET_OVERLAP, SRI_LANKA, StartPin, StopPin, type Turn } from './mapPins';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** The OpenFreeMap map (MapLibre): the stops that are not Google places, and the phone. No line (rule 10). */
export function OpenTaskMap({ stops, start, me, fit, note }: MapParts & { note?: string | null }) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });

  const stop = useMemo((): Partial<CameraStop> => {
    const f = fit.frame;
    if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: { ...PADDING, bottom: PADDING.bottom + SHEET_OVERLAP } };
    if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM };
    return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
  }, [fit]);

  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    void camera.current?.setStop({ bearing: 0, pitch: 0, duration: 400, easing: 'ease' });
  };

  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        onRegionDidChange={(e) => setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch))}
      >
        <Camera ref={camera} {...stop} duration={600} easing="ease" />
        {start && (
          <Marker id="start" lngLat={[start.lng, start.lat]} anchor="center">
            <StartPin />
          </Marker>
        )}
        {stops.map((s) => (
          <Marker key={`${s.id}:${s.state}:${s.time ?? ''}`} id={`stop-${s.id}`} lngLat={[s.lng, s.lat]} anchor="bottom">
            <StopPin stop={s} />
          </Marker>
        ))}
        {me && (
          <Marker id="me" lngLat={[me.lng, me.lat]} anchor="center">
            <MePin />
          </Marker>
        )}
      </Map>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: insets.top + 68, right: 16 }} />
      {note ? (
        <View style={mapStyles.mapNote} pointerEvents="none">
          <Txt variant="strong" size={14} color="#ffffff">{note}</Txt>
        </View>
      ) : null}
    </>
  );
}
