// TEMPORARY (O4 spike, replaced by the browser map before any checkpoint). test:web fails while this file says TEMPORARY.
export interface PinPoint {
  lat: number;
  lng: number;
}
export const roundPin = (p: PinPoint): PinPoint => ({ lat: Math.round(p.lat * 1e6) / 1e6, lng: Math.round(p.lng * 1e6) / 1e6 });
export function PinAdjust(_props: Record<string, unknown>) {
  return null;
}
