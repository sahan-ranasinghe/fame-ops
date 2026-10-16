import { describe, expect, it } from "vitest";
import { compassShown, controlKeys, fixedHeight, signedAngle } from "./controlsLogic";

describe("the compass (§24): shown only while the map is rotated or tilted", () => {
  it("north up and flat: no compass, on either map", () => {
    expect(compassShown({ bearing: 0, pitch: 0 })).toBe(false);
    expect(compassShown({ heading: 0, tilt: 0 })).toBe(false);
    expect(compassShown({})).toBe(false);
    expect(compassShown({ bearing: null, pitch: null, heading: null, tilt: null })).toBe(false);
  });

  it("MapLibre: a bearing or a pitch shows it", () => {
    expect(compassShown({ bearing: 12, pitch: 0 })).toBe(true);
    expect(compassShown({ bearing: -3.5, pitch: 0 })).toBe(true);
    expect(compassShown({ bearing: 0, pitch: 30 })).toBe(true);
  });

  it("Google: a heading or a tilt (the 45° imagery) shows it", () => {
    expect(compassShown({ heading: 90, tilt: 0 })).toBe(true);
    expect(compassShown({ heading: 0, tilt: 45 })).toBe(true);
  });

  it("a full turn is north again; float noise is not a turn", () => {
    expect(compassShown({ bearing: 360 })).toBe(false);
    expect(compassShown({ heading: -360 })).toBe(false);
    expect(compassShown({ bearing: 1e-9, pitch: -1e-9 })).toBe(false);
    expect(compassShown({ bearing: Number.NaN })).toBe(false);
    expect(signedAngle(350)).toBe(-10);
    expect(signedAngle(190)).toBe(-170);
    expect(signedAngle(-90)).toBe(-90);
    expect(signedAngle(180)).toBe(180);
  });
});

describe("the control cluster (§25)", () => {
  it("one column top to bottom: zoom in, zoom out, the compass when needed, trails, fit", () => {
    expect(controlKeys({ zoom: true, compass: true, trails: true, fit: true })).toEqual(["zoom-in", "zoom-out", "compass", "trails", "fit"]);
    expect(controlKeys({ zoom: true, compass: false, trails: false, fit: true })).toEqual(["zoom-in", "zoom-out", "fit"]);
    expect(controlKeys({ zoom: true, compass: false, trails: true, fit: true })).toEqual(["zoom-in", "zoom-out", "trails", "fit"]);
    expect(controlKeys({ zoom: false, compass: false, trails: false, fit: false })).toEqual([]);
  });

  it("a map with a height is a fixed block (§23), else the map's usual shape", () => {
    expect(fixedHeight(280)).toEqual({ height: 280, minHeight: 0, aspectRatio: "auto" });
    expect(fixedHeight(undefined)).toBeUndefined();
    expect(fixedHeight(0)).toBeUndefined();
  });
});
