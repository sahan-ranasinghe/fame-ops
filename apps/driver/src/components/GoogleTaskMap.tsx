// Google's map for the task map (TaskMap.tsx): react-native-maps with PROVIDER_GOOGLE, the Maps SDK for Android (free on
// a phone; no map id, so Android's map loads stay free). The stops (Google places too), Google's planned road line from the
// plan's polylines (else the dashed straight lines) and the phone. It says when it has finished loading (onMapLoaded:
// Google's OnMapLoadedCallback, every tile drawn), which a refused key, billing, authorisation or Google Play services
// problem never does (lib/mapEngine.ts).

import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useApp } from '@/state/app';
import { colors } from '@/theme';
import { MapCompass } from './MapCompass';
import { type EngineProps, FOLLOW_ZOOM, MePin, nextTurn, ONE_PLACE_ZOOM, PADDING, SHEET_OVERLAP, SRI_LANKA, StartPin, StopPin, type Turn } from './mapPins';
import type { LatLng } from './taskMapLogic';

export function GoogleTaskMap({ stops, lines, start, me, fit, follow, onUserMove, onLoaded }: EngineProps) {
  const { t } = useApp();
  const insets = useSafeAreaInsets();
  const map = useRef<GoogleMapView>(null);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const followRef = useRef(follow);
  followRef.current = follow;

  useEffect(() => {
    if (!ready || followRef.current) return;
    const f = fit.frame;
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom: ONE_PLACE_ZOOM, heading: 0, pitch: 0 }, { duration: 600 });
  }, [fit, ready]);

  // Follow me: to the phone at a street's zoom when turned on, then the middle follows each new position.
  const followedOnce = useRef(false);
  useEffect(() => {
    if (!ready || !follow || !me) {
      if (!follow) followedOnce.current = false;
      return;
    }
    map.current?.animateCamera(followedOnce.current ? { center: at(me) } : { center: at(me), zoom: FOLLOW_ZOOM }, { duration: 500 });
    followedOnce.current = true;
  }, [follow, me, ready]);

  const readTurn = () => {
    map.current?.getCamera()
      .then((c) => setTurn((prev) => nextTurn(prev, c.heading ?? 0, c.pitch ?? 0)))
      .catch(() => undefined);
  };
  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  };

  // Driven legs first, so the line still to drive lies on top where they meet.
  const ordered = useMemo(() => [...lines].sort((a, b) => Number(b.done) - Number(a.done)).map((l) => ({ ...l, coords: l.points.map(at) })), [lines]);

  return (
    <>
      <GoogleMapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        // Always the light map, whatever the phone's dark mode (Round 3 Part A3; read once when the map is made: Android's
        // MapColorScheme.LIGHT through react-native-maps 1.27.2's initial props, no native change).
        userInterfaceStyle="light"
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: SRI_LANKA.lat, longitude: SRI_LANKA.lng, latitudeDelta: 3.5, longitudeDelta: 3.5 }}
        mapPadding={{ top: 0, right: 0, bottom: SHEET_OVERLAP, left: 0 }}
        toolbarEnabled={false}
        showsCompass={false}
        onMapReady={() => setReady(true)}
        onMapLoaded={onLoaded}
        onRegionChange={(_region, details) => { if (details?.isGesture && followRef.current) onUserMove(); }}
        onRegionChangeComplete={readTurn}
      >
        {ordered.map((l) => (
          <Polyline
            key={l.key}
            coordinates={l.coords}
            strokeColor={l.done ? colors.muted : colors.blue}
            strokeWidth={l.dashed ? 4 : l.done ? 4 : 6}
            lineDashPattern={l.dashed ? [14, 10] : undefined}
            lineCap="round"
            lineJoin="round"
            zIndex={l.done ? 1 : 2}
          />
        ))}
        {start && (
          <GoogleMarker coordinate={at(start)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={3}>
            <StartPin />
          </GoogleMarker>
        )}
        {stops.map((s) => (
          // A marker's picture is taken once (tracksViewChanges off): a new state or time makes a new marker.
          <GoogleMarker
            key={`${s.id}:${s.state}:${s.time ?? ''}`}
            coordinate={at(s)}
            anchor={{ x: 0.5, y: 1 }}
            tracksViewChanges={false}
            zIndex={s.state === 'current' ? 6 : s.state === 'todo' ? 5 : 4}
          >
            <StopPin stop={s} />
          </GoogleMarker>
        ))}
        {me && (
          <GoogleMarker coordinate={at(me)} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={7}>
            <MePin />
          </GoogleMarker>
        )}
      </GoogleMapView>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: insets.top + 68, right: 16 }} />
    </>
  );
}

function at(p: LatLng): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}
