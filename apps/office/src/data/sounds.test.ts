// The office site's sounds (Hotfix 2, B) against a fake AudioContext: silent until the page's first click (the
// gesture gate), sound off and volume 0 play nothing, info plays nothing, four patterns that differ, the volume
// squared, and Test sound plays each kind in turn without overlapping.
import { describe, expect, it } from "vitest";
import { FakeAudio } from "../test/fakeAudio";
import { DEFAULT_SOUND, loudest, PATTERNS, patternSeconds, SOUND_KINDS, SoundPlayer, soundOf, soundPrefs, volumeGain } from "./sounds";

const on = (volume = 70) => ({ on: true, volume });

describe("the gesture gate", () => {
  it("plays nothing (and makes no audio context) until the page's first click unlocks it", async () => {
    let made = 0;
    const fake = new FakeAudio();
    const p = new SoundPlayer(() => { made++; return fake; });
    expect(p.play("urgent", on())).toBe("locked");
    expect(made).toBe(0);
    expect(p.unlocked).toBe(false);
    await expect(p.unlock()).resolves.toBe(true);
    expect(made).toBe(1);
    expect(p.unlocked).toBe(true);
    expect(p.play("urgent", on())).toBe("played");
    expect(fake.oscs).toHaveLength(PATTERNS.urgent.length);
    // A second unlock reuses the context.
    await p.unlock();
    expect(made).toBe(1);
  });
  it("stays locked when the browser refuses (no gesture yet), and where there is no Web Audio at all", async () => {
    const refused = new FakeAudio(false);
    const p = new SoundPlayer(() => refused);
    await expect(p.unlock()).resolves.toBe(false);
    expect(p.play("alarm", on())).toBe("locked");
    expect(refused.oscs).toHaveLength(0);
    const none = new SoundPlayer(() => null);
    await expect(none.unlock()).resolves.toBe(false);
    expect(none.play("alarm", on())).toBe("locked");
  });
});

describe("what plays", () => {
  it("sound off, volume 0 and info play nothing", async () => {
    const fake = new FakeAudio();
    const p = new SoundPlayer(() => fake);
    await p.unlock();
    expect(p.play("urgent", { on: false, volume: 70 })).toBe("off");
    expect(p.play("urgent", on(0))).toBe("silent");
    expect(p.play("info", on())).toBe("none");
    expect(fake.oscs).toHaveLength(0);
  });
  it("the volume is squared: half the slider is a quarter of the loudness", async () => {
    const peakAt = async (volume: number) => {
      const fake = new FakeAudio();
      const p = new SoundPlayer(() => fake);
      await p.unlock();
      p.play("soft", on(volume));
      return fake.gains[0].gain.peak();
    };
    const full = await peakAt(100);
    expect(full).toBeCloseTo(PATTERNS.soft[0].gain, 5);
    expect(await peakAt(50)).toBeCloseTo(full / 4, 5);
    expect(volumeGain(0)).toBe(0);
    expect(volumeGain(150)).toBe(1);
    expect(volumeGain(Number.NaN)).toBe(0);
  });
  it("starts now on the context's clock and stops every tone it starts", async () => {
    const fake = new FakeAudio();
    const p = new SoundPlayer(() => fake);
    await p.unlock();
    p.play("alert", on());
    expect(fake.oscs.map((o) => o.started)).toEqual(PATTERNS.alert.map((t) => 10 + 0.02 + t.at));
    for (const o of fake.oscs) expect(o.stopped).toBeGreaterThan(o.started!);
    expect(fake.oscs.map((o) => o.type)).toEqual(["sine", "sine"]);
  });
  it("four clearly different patterns: their wave, pitch, number of tones and length differ", () => {
    const sig = (k: keyof typeof PATTERNS) => JSON.stringify([PATTERNS[k].length, PATTERNS[k].map((t) => [t.wave, t.freq, t.to ?? 0]), patternSeconds(k).toFixed(2)]);
    const sigs = SOUND_KINDS.map(sig);
    expect(new Set(sigs).size).toBe(4);
    // Short: none is over 1.5 s.
    for (const k of SOUND_KINDS) expect(patternSeconds(k)).toBeLessThanOrEqual(1.5);
    // The soft one is the quietest, the alarm sweeps up.
    const loud = (k: keyof typeof PATTERNS) => Math.max(...PATTERNS[k].map((t) => t.gain));
    expect(loud("soft")).toBeLessThan(Math.min(loud("urgent"), loud("alert")));
    expect(PATTERNS.alarm.every((t) => (t.to ?? 0) > t.freq)).toBe(true);
  });
  it("Test sound plays each kind in turn, half a second apart, never overlapping", async () => {
    const fake = new FakeAudio();
    const p = new SoundPlayer(() => fake);
    await p.unlock();
    expect(p.playAll(on())).toBe("played");
    expect(fake.oscs).toHaveLength(SOUND_KINDS.reduce((n, k) => n + PATTERNS[k].length, 0));
    let i = 0;
    let lastEnd = 0;
    for (const k of SOUND_KINDS) {
      const starts = fake.oscs.slice(i, i + PATTERNS[k].length).map((o) => o.started!);
      i += PATTERNS[k].length;
      expect(Math.min(...starts)).toBeGreaterThanOrEqual(lastEnd + 0.5 - 1e-9);
      lastEnd = Math.min(...starts) + patternSeconds(k);
    }
    // Off: nothing, and says why.
    const off = new FakeAudio();
    const q = new SoundPlayer(() => off);
    await q.unlock();
    expect(q.playAll({ on: false, volume: 70 })).toBe("off");
    expect(off.oscs).toHaveLength(0);
  });
});

describe("which sound for new items", () => {
  it("the loudest kind wins: alarm, then urgent, alert, soft; info alone plays nothing", () => {
    expect(loudest([{ kind: "soft" }, { kind: "alarm" }, { kind: "urgent" }])).toBe("alarm");
    expect(loudest([{ kind: "soft" }, { kind: "alert" }, { kind: "urgent" }])).toBe("urgent");
    expect(loudest([{ kind: "soft" }, { kind: "alert" }])).toBe("alert");
    expect(loudest([{ kind: "info" }, { kind: "soft" }])).toBe("soft");
    expect(loudest([{ kind: "info" }])).toBeNull();
    expect(loudest([])).toBeNull();
    expect(soundOf("info")).toBeNull();
    expect(soundOf("alarm")).toBe("alarm");
  });
  it("the settings as the server answers them, the default on at 70 %", () => {
    expect(DEFAULT_SOUND).toEqual({ on: true, volume: 70 });
    expect(soundPrefs(undefined)).toEqual({ on: true, volume: 70 });
    expect(soundPrefs({ on: false })).toEqual({ on: false, volume: 70 });
    expect(soundPrefs({ on: true, volume: 133.4 })).toEqual({ on: true, volume: 100 });
    expect(soundPrefs({ volume: -5 })).toEqual({ on: true, volume: 0 });
  });
});
