// Playback of a route (web build): the marker steps through every point of the
// line in time order at ×10, ×60 or ×300 of real time (a long gap between two
// points is waited out in at most 1.5 s), paused or seeked with a slider that
// jumps to the last point at or before the chosen time. The marker sits on the
// stored points themselves: nothing is interpolated between them.
import { useEffect, useRef, useState } from "react";

export const SPEEDS = [10, 60, 300] as const;
export type PlaybackSpeed = (typeof SPEEDS)[number];
/** A step never waits less than this (a frame) nor more than this (a long gap). */
const MIN_STEP_MS = 16;
const MAX_STEP_MS = 1500;

export interface Playback {
  /** The clock: the time of the point the marker is on, Unix ms. */
  t: number;
  start: number;
  end: number;
  /** The point the marker is on. */
  index: number;
  playing: boolean;
  speed: PlaybackSpeed;
  toggle: () => void;
  /** To a time: the marker goes to the last point at or before it. */
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

export function usePlayback(points: { at: number }[]): Playback {
  const start = points[0]?.at ?? 0;
  const end = points[points.length - 1]?.at ?? 0;
  const [index, setIndex] = useState(0);
  const indexRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(60);

  // A new route (another day, another driver): back to its start, paused. New points on the same route leave the marker alone.
  useEffect(() => {
    indexRef.current = 0;
    setIndex(0);
    setPlaying(false);
  }, [start]);

  useEffect(() => {
    if (!playing) return;
    let timer = 0;
    const stepNext = () => {
      const i = indexRef.current;
      if (i >= points.length - 1) {
        setPlaying(false);
        return;
      }
      const wait = Math.min(MAX_STEP_MS, Math.max(MIN_STEP_MS, (points[i + 1].at - points[i].at) / speed));
      timer = window.setTimeout(() => {
        indexRef.current = i + 1;
        setIndex(i + 1);
        stepNext();
      }, wait);
    };
    stepNext();
    return () => clearTimeout(timer);
  }, [playing, speed, points]);

  const seek = (v: number) => {
    const clamped = Math.max(start, Math.min(end, v));
    let lo = 0;
    let hi = points.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (points[mid].at <= clamped) lo = mid;
      else hi = mid - 1;
    }
    indexRef.current = Math.max(0, lo);
    setIndex(Math.max(0, lo));
  };
  const toggle = () => {
    if (!playing && indexRef.current >= points.length - 1) seek(start);
    setPlaying((p) => !p);
  };
  const safeIndex = Math.min(index, Math.max(0, points.length - 1));
  return { t: points[safeIndex]?.at ?? start, start, end, index: safeIndex, playing, speed, toggle, seek, setSpeed };
}
