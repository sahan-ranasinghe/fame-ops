// The control cluster's rules (Phase 7, §24 and §25), pure so they are tested without a map: when
// the compass shows, which buttons the cluster has and in what order, and a map's fixed height.
import type { CSSProperties } from "react";

/** A map's camera in degrees: MapLibre's bearing and pitch, or Google's heading and tilt. */
export interface Camera {
  bearing?: number | null;
  pitch?: number | null;
  heading?: number | null;
  tilt?: number | null;
}

/** Below this an angle is float noise, not a turn. */
const EPS = 0.01;

/** An angle in (-180, 180]: 360 is north again. */
export function signedAngle(deg: number): number {
  const a = ((deg % 360) + 360) % 360;
  return a > 180 ? a - 360 : a;
}

const turned = (d: number | null | undefined) => d != null && Number.isFinite(d) && Math.abs(signedAngle(d)) > EPS;
const tilted = (d: number | null | undefined) => d != null && Number.isFinite(d) && Math.abs(d) > EPS;

/** The compass shows only while the map is rotated (bearing or heading not 0) or tilted (pitch or tilt not 0). */
export function compassShown(c: Camera): boolean {
  return turned(c.bearing) || turned(c.heading) || tilted(c.pitch) || tilted(c.tilt);
}

export type ControlKey = "zoom-in" | "zoom-out" | "compass" | "trails" | "fit";

/** The cluster's buttons top to bottom (§25): zoom in, zoom out, the compass when needed, trails (Live), fit. */
export function controlKeys(o: { zoom: boolean; compass: boolean; trails: boolean; fit: boolean }): ControlKey[] {
  const out: ControlKey[] = [];
  if (o.zoom) out.push("zoom-in", "zoom-out");
  if (o.compass) out.push("compass");
  if (o.trails) out.push("trails");
  if (o.fit) out.push("fit");
  return out;
}

/** A map with a fixed height (a map inside a form, §23): a block of that height, whatever its width. */
export function fixedHeight(height: number | undefined): CSSProperties | undefined {
  return height && height > 0 ? { height, minHeight: 0, aspectRatio: "auto" } : undefined;
}
