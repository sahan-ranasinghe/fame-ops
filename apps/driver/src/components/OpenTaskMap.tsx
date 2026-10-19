// The free map for the task map (TaskMap.tsx): MapLibre with OpenFreeMap's tiles, no key, in every build (Part 6). The stops
// that are not Google places, the dashed straight lines between them, where the trip starts and the phone; never Google's
// line or a Google place's pin (rule 10, lib/mapRule.ts). It says when it has loaded (onDidFinishLoadingMap) or failed
// (onDidFailLoadingMap: the style or the tiles could not be fetched).

import { Camera, GeoJSONSource, Layer, Map, Marker, type CameraRef, type CameraStop } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { MapCompass } from './MapCompass';
import { type EngineProps, FOLLOW_ZOOM, MePin, nextTurn, ONE_PLACE_ZOOM, PADDING, SHEET_OVERLAP, SRI_LANKA, StartPin, StopPin, type Turn } from './mapPins';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function OpenTaskMap({ stops, lines, start, me, fit, follow, onUserMove, onLoaded, onFailed }: EngineProps) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const followRef = useRef(follow);
  followRef.current = follow;

  const stop = useMemo((): Partial<CameraStop> => {
    const f = fit.frame;
    if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: { ...PADDING, bottom: PADDING.bottom + SHEET_OVERLAP } };
    if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM };
    return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
  }, [fit]);

  // Follow me: to the phone at a street's zoom when turned on, then the middle follows each new position.
  const followedOnce = useRef(false);
  useEffect(() => {
    if (!follow || !me) {
      if (!follow) followedOnce.current = false;
      return;
    }
    void camera.current?.setStop({
      center: [me.lng, me.lat],
      ...(followedOnce.current ? {} : { zoom: FOLLOW_ZOOM }),
      duration: 500,
      easing: 'ease',
    });
    followedOnce.current = true;
  }, [follow, me]);

  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    void camera.current?.setStop({ bearing: 0, pitch: 0, duration: 400, easing: 'ease' });
  };

  // The lines as one source: the driven ones muted under the ones still to drive. On this map they are always the dashed
  // straight lines (Google's road line is never drawn here); line-dasharray takes no per-line value, so it is the set's.
  const dashed = lines.some((l) => l.dashed);
  const data = useMemo((): GeoJSON.FeatureCollection => ({
    type: 'FeatureCollection',
    features: lines.map((l) => ({
      type: 'Feature',
      properties: { done: l.done },
      geometry: { type: 'LineString', coordinates: l.points.map((p) => [p.lng, p.lat]) },
    })),
  }), [lines]);

  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        onDidFinishLoadingMap={onLoaded}
        onDidFailLoadingMap={onFailed}
        onRegionWillChange={(e) => { if (e.nativeEvent.userInteraction && followRef.current) onUserMove(); }}
        onRegionDidChange={(e) => setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch))}
      >
        <Camera ref={camera} {...stop} duration={600} easing="ease" />
        {lines.length > 0 && (
          <GeoJSONSource id="task-lines" data={data}>
            <Layer id="task-lines-done" type="line" filter={['==', ['get', 'done'], true]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.muted, 'line-width': 4, ...(dashed ? { 'line-dasharray': [2, 1.5] } : {}) }} />
            <Layer id="task-lines-todo" type="line" filter={['==', ['get', 'done'], false]}
              layout={{ 'line-cap': 'round', 'line-join': 'round' }}
              paint={{ 'line-color': colors.blue, 'line-width': dashed ? 4 : 6, ...(dashed ? { 'line-dasharray': [2, 1.5] } : {}) }} />
          </GeoJSONSource>
        )}
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
    </>
  );
}
