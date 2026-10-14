import { describe, expect, it } from "vitest";
import { checklistWords, clockOf, megabytes, videoChip, videoTone, videoWords } from "./fuelLogic";

describe("the Fuel page's words", () => {
  it("sizes and lengths", () => {
    expect(megabytes(16 * 1024 * 1024)).toBe("16 MB");
    expect(megabytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(clockOf(47)).toBe("0:47");
    expect(clockOf(90)).toBe("1:30");
  });
  it("the video in a phrase", () => {
    expect(videoWords({ status: "uploaded", duration_s: 47, bytes: 16 * 1024 * 1024 })).toBe("Video 0:47 · 16 MB");
    expect(videoWords({ status: "uploaded", duration_s: 312, bytes: 38 * 1024 * 1024, interrupted: true, segments: [{}, {}] })).toBe("Video 5:12 · 38 MB · interrupted, 2 pieces");
    expect(videoChip("uploaded", true)).toBe("Video · interrupted");
    expect(videoWords({ status: "uploading", note: "Uploading on the phone" })).toBe("Uploading on the phone");
    expect(videoWords({ status: "none", note: "No video" })).toBe("No video");
  });
  it("tones and chips", () => {
    expect(videoTone("uploaded")).toBe("ok");
    expect(videoTone("uploading")).toBe("warn");
    expect(videoTone("failed")).toBe("bad");
    expect(videoTone("none")).toBe("bad");
    expect(videoTone("pruned")).toBe("muted");
    expect(videoChip("recorded")).toBe("On the phone");
  });
  it("the ticked items by name", () => {
    const items = [{ key: "pump", en: "Pump display" }, { key: "plate", en: "Number plate" }];
    expect(checklistWords(["pump", "plate", "other"], items)).toBe("Pump display, Number plate, other");
    expect(checklistWords(undefined, items)).toBe("");
  });
});
