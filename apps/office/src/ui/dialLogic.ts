// The clock dial's math (Material 3's time picker on Android and Google Calendar's, 21 October 2026), pure: the same file
// is apps/office/src/ui/dialLogic.ts. A 24-hour dial: the outer ring 00 (at the top), 1 … 11; the inner ring 12 (at the
// top), 13 … 23. Then the minutes ring, 00 at the top, every minute pickable (the labels every 5). Tests: scripts/test-patterns.ts.

export type DialMode = 'hour' | 'minute';

/** The angle of a point from the dial's top, clockwise, 0–360. */
function angleOf(x: number, y: number, cx: number, cy: number): number {
  const a = (Math.atan2(x - cx, cy - y) * 180) / Math.PI;
  return (a + 360) % 360;
}

/**
 * The hour under a point: its angle picks one of 12 slots; inside the middle of the two rings it is the inner ring
 * (12 … 23). `outer` and `inner` are the rings' radii.
 */
export function hourAt(x: number, y: number, cx: number, cy: number, outer: number, inner: number): number {
  const slot = Math.round(angleOf(x, y, cx, cy) / 30) % 12;
  const dist = Math.hypot(x - cx, y - cy);
  const innerRing = dist < (outer + inner) / 2;
  return innerRing ? (slot === 0 ? 12 : slot + 12) : slot;
}

/** The minute under a point (every minute: 6° each). */
export function minuteAt(x: number, y: number, cx: number, cy: number): number {
  return Math.round(angleOf(x, y, cx, cy) / 6) % 60;
}

/** Where a value sits on the dial: its angle (degrees from the top, clockwise) and its ring's radius. */
export function placeOf(mode: DialMode, value: number, outer: number, inner: number): { angle: number; radius: number } {
  if (mode === 'minute') return { angle: (value % 60) * 6, radius: outer };
  const innerRing = value >= 12;
  return { angle: (value % 12) * 30, radius: innerRing ? inner : outer };
}

/** The point for an angle and a radius, from the dial's centre. */
export function pointOf(angle: number, radius: number, cx: number, cy: number): { x: number; y: number } {
  const r = (angle * Math.PI) / 180;
  return { x: cx + radius * Math.sin(r), y: cy - radius * Math.cos(r) };
}

/** The labels of a mode's dial: [value, text]; the hours on two rings, the minutes every 5. */
export function dialLabels(mode: DialMode): { value: number; text: string; inner: boolean }[] {
  if (mode === 'minute') return Array.from({ length: 12 }, (_, i) => ({ value: i * 5, text: String(i * 5).padStart(2, '0'), inner: false }));
  const outerRing = Array.from({ length: 12 }, (_, i) => ({ value: i, text: i === 0 ? '00' : String(i), inner: false }));
  const innerRing = Array.from({ length: 12 }, (_, i) => ({ value: i + 12, text: String(i + 12), inner: true }));
  return [...outerRing, ...innerRing];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "09:05" from an hour and a minute. */
export const hhmm = (h: number, m: number) => `${pad(((h % 24) + 24) % 24)}:${pad(((m % 60) + 60) % 60)}`;

/** The hour and the minute of "09:05" (00:00 for anything else). */
export function partsOf(v: string): { h: number; m: number } {
  const ok = /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
  return ok ? { h: Number(v.slice(0, 2)), m: Number(v.slice(3, 5)) } : { h: 0, m: 0 };
}

/** Typed digits for one part ("7" → 7, "25" → null for an hour): the keyboard mode's check. */
export function typedPart(text: string, max: number): number | null {
  if (!/^\d{1,2}$/.test(text.trim())) return null;
  const n = Number(text.trim());
  return n >= 0 && n <= max ? n : null;
}
