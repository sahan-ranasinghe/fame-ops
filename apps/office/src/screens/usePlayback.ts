// Playback of a route (web build): a clock that runs from the first point to
// the last at ×10, ×60 or ×300, paused or seeked with a slider. The marker's
// position is read off the line for the clock's time (positionAt).
import { useEffect, useRef, useState } from "react";

export const SPEEDS = [10, 60, 300] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];
const TICK_MS = 100;

export interface Playback {
  /** The clock, Unix ms. */
  t: number;
  start: number;
  end: number;
  playing: boolean;
  speed: PlaybackSpeed;
  toggle: () => void;
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

export function usePlayback(points: { at: number }[]): Playback {
  const start = points[0]?.at ?? 0;
  const end = points[points.length - 1]?.at ?? 0;
  const [t, setT] = useState(start);
  const tRef = useRef(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(60);

  // A new route (another day, another driver): back to its start, paused. New points on the same route leave the clock alone.
  useEffect(() => {
    tRef.current = start;
    setT(start);
    setPlaying(false);
  }, [start]);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const next = Math.min(end, tRef.current + (now - last) * speed);
      last = now;
      tRef.current = next;
      setT(next);
      if (next >= end) setPlaying(false);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [playing, speed, end]);

  const seek = (v: number) => {
    const clamped = Math.max(start, Math.min(end, v));
    tRef.current = clamped;
    setT(clamped);
  };
  const toggle = () => {
    if (!playing && tRef.current >= end) seek(start);
    setPlaying((p) => !p);
  };
  return { t, start, end, playing, speed, toggle, seek, setSpeed };
}
