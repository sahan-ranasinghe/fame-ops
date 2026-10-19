// Google's map for the Live tab's drivers (DriversMap.tsx; Office mode, Phase 8 O1): react-native-maps with PROVIDER_GOOGLE,
// as GoogleTaskMap.tsx (the Maps SDK for Android, free on a phone; no map id). One marker per driver with a position (the
// initials in a ring coloured by duty, the selected one labelled), the frame around them all, and the move to a selected
// driver. It says when it has finished loading (onMapLoaded: every tile drawn), which a refused key, billing, authorisation
// or Google Play services problem never does (lib/mapEngine.ts). Driver positions are ours: both engines draw the same.

import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import GoogleMapView, { Marker as GoogleMarker, PROVIDER_GOOGLE } from 'react-native-maps';

import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { DRIVER_ZOOM, DriverPin, driverPinAnchorY, DRIVERS_PADDING, type DriversEngineProps, nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';
import type { LatLng } from './taskMapLogic';

export function GoogleDriversMap({ markers, fit, focus, onPressMarker, onLoaded }: DriversEngineProps) {
  const { t } = useApp();
  const map = useRef<GoogleMapView>(null);
  const [ready, setReady] = useState(false);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const focused = focus !== null;

  // Everyone: when the map is ready, when the set of drivers with a position changes (fit.key), and when the selection is
  // cleared; never while a driver is selected, never on a refresh that only moved them.
  useEffect(() => {
    if (!ready || focused) return;
    const f = fit.frame;
    if (f.kind === 'box') map.current?.fitToCoordinates([at(f.sw), at(f.ne)], { edgePadding: DRIVERS_PADDING, animated: true });
    else if (f.kind === 'point') map.current?.animateCamera({ center: at(f.center), zoom: ONE_PLACE_ZOOM, heading: 0, pitch: 0 }, { duration: 600 });
  }, [fit, ready, focused]);

  // The selected driver: the map moves to them once per selection (the same row tapped again moves it again: nonce); a
  // later position of theirs does not pull the map back from where the person panned.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusKey = focus ? `${focus.username}:${focus.nonce}` : null;
  useEffect(() => {
    const f = focusRef.current;
    if (!ready || !f) return;
    map.current?.animateCamera({ center: at(f), zoom: DRIVER_ZOOM }, { duration: 600 });
  }, [ready, focusKey]);

  const readTurn = () => {
    map.current?.getCamera()
      .then((c) => setTurn((prev) => nextTurn(prev, c.heading ?? 0, c.pitch ?? 0)))
      .catch(() => undefined);
  };
  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    map.current?.animateCamera({ heading: 0, pitch: 0 }, { duration: 400 });
  };

  return (
    <>
      <GoogleMapView
        ref={map}
        provider={PROVIDER_GOOGLE}
        style={StyleSheet.absoluteFill}
        initialRegion={{ latitude: SRI_LANKA.lat, longitude: SRI_LANKA.lng, latitudeDelta: 3.5, longitudeDelta: 3.5 }}
        toolbarEnabled={false}
        showsCompass={false}
        onMapReady={() => setReady(true)}
        onMapLoaded={onLoaded}
        onRegionChangeComplete={readTurn}
      >
        {markers.map((m) => (
          // A marker's picture is taken once (tracksViewChanges off): a new ring, label or letters makes a new marker.
          <GoogleMarker
            key={`${m.username}:${m.tone}:${m.dim}:${m.selected}:${m.label ?? ''}:${m.initials}`}
            coordinate={at(m)}
            anchor={{ x: 0.5, y: driverPinAnchorY(m.label !== null) }}
            tracksViewChanges={false}
            zIndex={m.selected ? 9 : m.tone === 'blue' ? 8 : m.tone === 'green' ? 7 : 6}
            onPress={() => onPressMarker(m.username)}
          >
            <DriverPin marker={m} />
          </GoogleMarker>
        ))}
      </GoogleMapView>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: 12, right: 12 }} />
    </>
  );
}

function at(p: LatLng): { latitude: number; longitude: number } {
  return { latitude: p.lat, longitude: p.lng };
}
