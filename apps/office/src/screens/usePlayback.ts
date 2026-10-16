// Playback of a route (web build; Phase 7, §22): the clock runs in recorded
// time at 1×, 5×, 20× or 60× on animation frames, and the marker sits at the
// position for that time on the path (playbackLogic: interpolated along the
// drawn line, along a gap's estimated line or its straight dashed hole over the
// gap's whole duration, still at a stop, turned to the path). A scrubber goes
// to any moment, playing or paused. Today's line may grow while it plays: the
// clock keeps going to the new end.
import { useEffect, useMemo, useRef, useState } from "react";
import { advance, type GapWindow, type PathPoint, type PlaybackSpeed, type Position, positionOn, SPEEDS } from "./playbackLogic";

export { SPEEDS, type PlaybackSpeed };

export interface Playback {
  /** The recorded time the marker is at, Unix ms. */
  t: number;
  start: number;
  end: number;
  playing: boolean;
  /** Playing, or moved away from the start: the marker is shown. */
  active: boolean;
  speed: PlaybackSpeed;
  /** Where the marker is at t (null without a path). */
  position: Position | null;
  toggle: () => void;
  /** To any moment (clamped to the route). */
  seek: (t: number) => void;
  setSpeed: (s: PlaybackSpeed) => void;
}

export function usePlayback(path: PathPoint[], windows: GapWindow[] = []): Playback {
  const start = path[0]?.at ?? 0;
  const end = path[path.length - 1]?.at ?? 0;
  const [t, setT] = useState(start);
  const tRef = useRef(start);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeedState] = useState<PlaybackSpeed>(60);
  const speedRef = useRef<PlaybackSpeed>(60);
  const endRef = useRef(end);
  endRef.current = end;

  // A new route (another day, another driver): back to its start, paused. New points on the same route leave the clock alone.
  useEffect(() => {
    tRef.current = start;
    setT(start);
    setPlaying(false);
  }, [start]);

  // The clock: each animation frame moves the recorded time on by the frame's real time × the speed.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last: number | null = null;
    const frame = (now: number) => {
      const dt = last === null ? 0 : now - last;
      last = now;
      const next = advance(tRef.current, dt, speedRef.current, endRef.current);
      tRef.current = next;
      setT(next);
      if (next >= endRef.current) {
        setPlaying(false);
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const seek = (v: number) => {
    const clamped = Math.max(start, Math.min(end, v));
    tRef.current = clamped;
    setT(clamped);
  };
  const toggle = () => {
    if (!playing && tRef.current >= end) seek(start);
    setPlaying((p) => !p);
  };
  const setSpeed = (s: PlaybackSpeed) => {
    speedRef.current = s;
    setSpeedState(s);
  };
  const shown = Math.max(start, Math.min(end, t));
  const position = useMemo(() => positionOn(path, shown, windows), [path, shown, windows]);
  return { t: shown, start, end, playing, active: playing || shown > start, speed, position, toggle, seek, setSpeed };
}
