// One control cluster for every map (Phase 7, §24 and §25): zoom in, zoom out, the compass (only
// while the map is rotated or tilted), today's trails (Live) and fit, all 40 px, one column on the
// right edge, centred vertically so no corner is covered (the corners keep Google's logo, the
// legend and the attribution).
import { Icon } from "../ui/icons";
import { controlKeys } from "./controlsLogic";
import { COMPASS_NORTH, COMPASS_SOUTH } from "./mapIcons";

export interface MapControlsProps {
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  /** Shown only while `shown` (controlsLogic.compassShown); the needle points north (turned by the bearing). */
  compass?: { shown: boolean; bearing: number; reset: () => void } | null;
  trails?: { on: boolean; toggle: () => void };
  onFit?: () => void;
  fitLabel?: string;
}

export function MapControls({ onZoomIn, onZoomOut, compass, trails, onFit, fitLabel = "Fit everyone on the map" }: MapControlsProps) {
  const keys = controlKeys({ zoom: !!(onZoomIn && onZoomOut), compass: !!compass?.shown, trails: !!trails, fit: !!onFit });
  if (!keys.length) return null;
  return (
    <div className="map-ctl" role="group" aria-label="Map controls" data-testid="map-controls">
      {keys.map((k) => {
        switch (k) {
          case "zoom-in":
            return <button key={k} type="button" aria-label="Zoom in" title="Zoom in" onClick={onZoomIn}>+</button>;
          case "zoom-out":
            return <button key={k} type="button" aria-label="Zoom out" title="Zoom out" onClick={onZoomOut}>−</button>;
          case "compass":
            return (
              <button key={k} type="button" className="compass" aria-label="Turn the map north up" title="North up" onClick={compass!.reset}>
                <svg viewBox="0 0 24 24" aria-hidden="true" style={{ transform: `rotate(${-Math.round(compass!.bearing)}deg)` }}>
                  <path d={COMPASS_NORTH} fill="var(--bad)" />
                  <path d={COMPASS_SOUTH} fill="currentColor" opacity=".45" />
                </svg>
              </button>
            );
          case "trails":
            return (
              <button key={k} type="button" className="trails" aria-label="Today’s trails" title="Today’s trails" aria-pressed={trails!.on} onClick={trails!.toggle}>
                <Icon name="route" />
              </button>
            );
          case "fit":
            return <button key={k} type="button" aria-label={fitLabel} title={fitLabel} onClick={onFit}><Icon name="fit" /></button>;
        }
      })}
    </div>
  );
}
