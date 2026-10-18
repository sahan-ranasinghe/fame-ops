// The office site's sounds (Hotfix 2, B): made in the browser with Web Audio, no audio files. Four short patterns
// that sound clearly different, one per kind of inbox item:
//   urgent  a task to approve, a task that needs a driver   "ring-ring": two fast trills, like a phone
//   alert   a request decided, a task declined              a two-note chime going up
//   soft    on the way, arrived                             one low, quiet "pop"
//   alarm   a critical issue                                four rising siren sweeps
//   info    everything else                                 nothing
// Browsers keep audio silent until the person clicks or presses a key on the page: `unlock()` runs inside that
// gesture; until then `play` answers "locked" and the page shows "Click to turn on sounds". Sound off, or the volume
// at 0, plays nothing. The volume (0–100) is squared, so the slider feels even to the ear.
import type { InboxItem, SoundPrefs } from "./types";

export type SoundKind = "urgent" | "alert" | "soft" | "alarm";
export const SOUND_KINDS: SoundKind[] = ["urgent", "alert", "soft", "alarm"];

/** What each sound is for, as Settings → Notifications says it. */
export const SOUND_TEXT: Record<SoundKind, { label: string; text: string }> = {
  urgent: { label: "Urgent", text: "A task to approve, a task that needs a driver" },
  alert: { label: "Alert", text: "A request decided, a task declined" },
  soft: { label: "Soft", text: "On the way, arrived" },
  alarm: { label: "Alarm", text: "A critical issue" },
};

/** The default: on, 70 % (plan, Hotfix 2 question 3). */
export const DEFAULT_SOUND: SoundPrefs = { on: true, volume: 70 };

/** One tone of a pattern: when it starts (s from the pattern's start), how long, its pitch (and where it glides to). */
export interface Tone {
  at: number;
  dur: number;
  freq: number;
  /** Glides to this pitch over the tone (the siren). */
  to?: number;
  wave: OscillatorType;
  /** Peak loudness at full volume, 0–1. */
  gain: number;
  /** pluck = a quick attack that dies away (bells, pops); flat = held, then a short release (the siren). */
  env: "pluck" | "flat";
}

const C6 = 1046.5;
const E6 = 1318.5;
const G5 = 784;

/** A fast trill of `n` notes alternating two pitches, from `at`. */
function trill(at: number, n: number, a: number, b: number): Tone[] {
  return Array.from({ length: n }, (_, i) => ({ at: at + i * 0.07, dur: 0.07, freq: i % 2 ? b : a, wave: "triangle" as const, gain: 0.5, env: "flat" as const }));
}

export const PATTERNS: Record<SoundKind, Tone[]> = {
  urgent: [...trill(0, 6, C6, E6), ...trill(0.55, 6, C6, E6)],
  alert: [
    { at: 0, dur: 0.35, freq: G5, wave: "sine", gain: 0.6, env: "pluck" },
    { at: 0.16, dur: 0.6, freq: C6, wave: "sine", gain: 0.6, env: "pluck" },
  ],
  soft: [{ at: 0, dur: 0.45, freq: 587, to: 523, wave: "sine", gain: 0.35, env: "pluck" }],
  alarm: [0, 0.36, 0.72, 1.08].map((at) => ({ at, dur: 0.32, freq: 650, to: 1300, wave: "sawtooth" as const, gain: 0.22, env: "flat" as const })),
};

/** How long a pattern lasts, s. */
export const patternSeconds = (kind: SoundKind): number => Math.max(...PATTERNS[kind].map((t) => t.at + t.dur));

/** The slider (0–100) as a gain (0–1), squared. Anything that is not a number counts as 0. */
export function volumeGain(volume: number): number {
  const v = Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) / 100 : 0;
  return v * v;
}

/** The kind's sound, or null (info and anything unknown play nothing). */
export function soundOf(kind: InboxItem["kind"] | string): SoundKind | null {
  return (SOUND_KINDS as string[]).includes(kind) ? kind as SoundKind : null;
}

// The few parts of Web Audio used here, so a test can hand in a fake.
export interface ParamLike {
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  exponentialRampToValueAtTime(v: number, t: number): unknown;
}
export interface NodeLike {
  connect(dest: unknown): unknown;
}
export interface OscLike extends NodeLike {
  type: OscillatorType;
  frequency: ParamLike;
  start(t: number): void;
  stop(t: number): void;
}
export interface GainLike extends NodeLike {
  gain: ParamLike;
}
export interface AudioLike {
  readonly state: string;
  readonly currentTime: number;
  readonly destination: unknown;
  resume(): Promise<void>;
  createOscillator(): OscLike;
  createGain(): GainLike;
}
export type MakeAudio = () => AudioLike | null;

/** The browser's AudioContext (webkitAudioContext on old Safari), or null where there is none. */
export const browserAudio: MakeAudio = () => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: new () => AudioLike; webkitAudioContext?: new () => AudioLike };
  const C = w.AudioContext ?? w.webkitAudioContext;
  try {
    return C ? new C() : null;
  } catch {
    return null;
  }
};

/** Schedules the tones on the context from `start` (its clock), each at `level` × its own gain. */
export function schedule(ctx: AudioLike, tones: Tone[], level: number, start: number): void {
  for (const t of tones) {
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    const at = start + t.at;
    const end = at + t.dur;
    const peak = Math.max(0.0001, t.gain * level);
    osc.type = t.wave;
    osc.frequency.setValueAtTime(t.freq, at);
    if (t.to) osc.frequency.linearRampToValueAtTime(t.to, end);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + Math.min(0.015, t.dur / 4));
    if (t.env === "pluck") g.gain.exponentialRampToValueAtTime(0.0001, end);
    else {
      g.gain.setValueAtTime(peak, Math.max(at, end - 0.02));
      g.gain.linearRampToValueAtTime(0.0001, end);
    }
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(at);
    osc.stop(end + 0.03);
  }
}

/** What `play` did: played; nothing for this kind (info); sound off; volume 0; the page has had no click yet. */
export type PlayResult = "played" | "none" | "off" | "silent" | "locked";

export class SoundPlayer {
  private ctx: AudioLike | null = null;

  constructor(private readonly make: MakeAudio = browserAudio) {}

  /** The browser lets this page play now. */
  get unlocked(): boolean {
    return this.ctx?.state === "running";
  }

  /**
   * Call inside a click or a key press (or once the page has had one: navigator.userActivation): makes the audio
   * context and asks the browser to let it play. Answers whether it may.
   */
  unlock(): Promise<boolean> {
    if (!this.ctx) this.ctx = this.make();
    const ctx = this.ctx;
    if (!ctx) return Promise.resolve(false);
    if (ctx.state === "running") return Promise.resolve(true);
    return ctx.resume().then(() => ctx.state === "running", () => false);
  }

  /** Plays the kind's sound now (plus `offset` s), at the person's volume, unless off, silent, locked or info. */
  play(kind: InboxItem["kind"] | SoundKind, prefs: SoundPrefs, offset = 0): PlayResult {
    const sound = soundOf(kind);
    if (!sound) return "none";
    if (!prefs.on) return "off";
    const level = volumeGain(prefs.volume);
    if (level <= 0) return "silent";
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return "locked";
    schedule(ctx, PATTERNS[sound], level, ctx.currentTime + 0.02 + offset);
    return "played";
  }

  /** "Test sound": every kind in turn, half a second apart. Answers what the first one did. */
  playAll(prefs: SoundPrefs): PlayResult {
    let offset = 0;
    let first: PlayResult | null = null;
    for (const k of SOUND_KINDS) {
      const r = this.play(k, prefs, offset);
      first ??= r;
      if (r !== "played") return first;
      offset += patternSeconds(k) + 0.5;
    }
    return first ?? "none";
  }
}

/** The loudest kind among new items (alarm, then urgent, alert, soft), or null when they are all info. */
export function loudest(items: Pick<InboxItem, "kind">[]): SoundKind | null {
  for (const k of ["alarm", "urgent", "alert", "soft"] as SoundKind[]) if (items.some((i) => i.kind === k)) return k;
  return null;
}

/** The person's settings as the server answers them (any missing part from the default). */
export function soundPrefs(s: Partial<SoundPrefs> | null | undefined): SoundPrefs {
  return {
    on: typeof s?.on === "boolean" ? s.on : DEFAULT_SOUND.on,
    volume: typeof s?.volume === "number" && Number.isFinite(s.volume) ? Math.round(Math.min(100, Math.max(0, s.volume))) : DEFAULT_SOUND.volume,
  };
}
