// The free map for the Live tab's drivers (DriversMap.tsx; Office mode, Phase 8 O1): MapLibre with OpenFreeMap's tiles, no
// key, in every build, as OpenTaskMap.tsx. The same markers as Google's map (driver positions are ours: nothing is held back
// here), the frame around them all, and the move to a selected driver. It says when it has loaded (onDidFinishLoadingMap)
// or failed (onDidFailLoadingMap: the style or the tiles could not be fetched).

import { Camera, type CameraRef, type CameraStop, Map, Marker } from '@maplibre/maplibre-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';

import { useApp } from '@/state/app';
import { MapCompass } from './MapCompass';
import { DRIVER_PIN, DRIVER_ZOOM, DriverPin, DRIVERS_PADDING, type DriversEngineProps, nextTurn, ONE_PLACE_ZOOM, SRI_LANKA, type Turn } from './mapPins';

const MAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

export function OpenDriversMap({ markers, fit, focus, onPressMarker, onLoaded, onFailed }: DriversEngineProps) {
  const { t } = useApp();
  const camera = useRef<CameraRef>(null);
  const [turn, setTurn] = useState<Turn>({ heading: 0, pitch: 0 });
  const focused = focus !== null;

  const framed = useMemo((): CameraStop => {
    const f = fit.frame;
    if (f.kind === 'box') return { bounds: [f.sw.lng, f.sw.lat, f.ne.lng, f.ne.lat], padding: DRIVERS_PADDING };
    if (f.kind === 'point') return { center: [f.center.lng, f.center.lat], zoom: ONE_PLACE_ZOOM };
    return { center: [SRI_LANKA.lng, SRI_LANKA.lat], zoom: 6.4 };
  }, [fit]);

  /** A camera move on the mounted map (setStop throws until the native view exists: then the Camera's own stop is enough). */
  const move = (next: CameraStop) => {
    try {
      void camera.current?.setStop({ ...next, duration: 600, easing: 'ease' });
    } catch {
      // The map is not up yet: the Camera's stop applies when it is.
    }
  };

  // Everyone: the Camera's own stop (applied once the map is ready, so drivers that arrive before the tiles still frame it)
  // follows the set of drivers with a position while nobody is selected. The Camera deep-compares its stop, so the frame
  // after a selection is cleared is set on it by hand below.
  const [stop, setStop] = useState(framed);
  useEffect(() => {
    if (!focused) setStop(framed);
  }, [framed, focused]);
  const wasFocused = useRef(false);
  useEffect(() => {
    if (wasFocused.current && !focused) move({ ...framed });
    wasFocused.current = focused;
    // Only the selection's end refits (the frame itself goes through the Camera's stop).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused]);

  // The selected driver: once per selection (the same row tapped again: nonce), never on their later positions.
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const focusKey = focus ? `${focus.username}:${focus.nonce}` : null;
  useEffect(() => {
    const f = focusRef.current;
    if (!f) return;
    move({ center: [f.lng, f.lat], zoom: DRIVER_ZOOM });
  }, [focusKey]);

  const northUp = () => {
    setTurn({ heading: 0, pitch: 0 });
    move({ bearing: 0, pitch: 0 });
  };

  return (
    <>
      <Map
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLE}
        logo={false}
        compass={false}
        onDidFinishLoadingMap={onLoaded}
        onDidFailLoadingMap={onFailed}
        onRegionDidChange={(e) => setTurn((prev) => nextTurn(prev, e.nativeEvent.bearing, e.nativeEvent.pitch))}
      >
        <Camera ref={camera} {...stop} duration={600} easing="ease" />
        {markers.map((m) => (
          // The ring's centre on the position whatever the label's height: anchored at the bottom, moved down by half a ring.
          <Marker
            key={`${m.username}:${m.tone}:${m.dim}:${m.selected}:${m.label ?? ''}:${m.initials}`}
            id={`driver-${m.username}`}
            lngLat={[m.lng, m.lat]}
            anchor="bottom"
            offset={[0, DRIVER_PIN.size / 2]}
            onPress={() => onPressMarker(m.username)}
          >
            <DriverPin marker={m} />
          </Marker>
        ))}
      </Map>
      <MapCompass heading={turn.heading} pitch={turn.pitch} label={t('map.northUp')} onPress={northUp} style={{ top: 12, right: 12 }} />
    </>
  );
}
