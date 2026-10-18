// A fake AudioContext for the sound tests (Hotfix 2, B): it records every tone scheduled, and stays suspended until
// resume() (which a browser allows only after a click or key press: `allow`).
import type { AudioLike, GainLike, OscLike } from "../data/sounds";

export class FakeParam {
  calls: [op: string, v: number, t: number][] = [];
  setValueAtTime(v: number, t: number) { this.calls.push(["set", v, t]); }
  linearRampToValueAtTime(v: number, t: number) { this.calls.push(["lin", v, t]); }
  exponentialRampToValueAtTime(v: number, t: number) { this.calls.push(["exp", v, t]); }
  peak() { return Math.max(...this.calls.map((c) => c[1])); }
}

export interface FakeOsc extends OscLike {
  frequency: FakeParam;
  started?: number;
  stopped?: number;
}

export class FakeAudio implements AudioLike {
  state = "suspended";
  currentTime = 10;
  destination = {};
  resumes = 0;
  oscs: FakeOsc[] = [];
  gains: { gain: FakeParam }[] = [];
  constructor(public allow = true) {}
  resume() {
    this.resumes++;
    if (this.allow) this.state = "running";
    return Promise.resolve();
  }
  createOscillator(): OscLike {
    const o: FakeOsc = {
      type: "sine",
      frequency: new FakeParam(),
      connect: () => undefined,
      start: (t: number) => { o.started = t; },
      stop: (t: number) => { o.stopped = t; },
    };
    this.oscs.push(o);
    return o;
  }
  createGain(): GainLike {
    const g = { gain: new FakeParam(), connect: () => undefined };
    this.gains.push(g);
    return g;
  }
  /** The first frequency of each tone scheduled since `from` (which pattern played). */
  freqs(from = 0): number[] {
    return this.oscs.slice(from).map((o) => o.frequency.calls[0]?.[1]);
  }
}
