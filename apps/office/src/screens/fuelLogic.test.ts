import { describe, expect, it } from "vitest";
import { checklistWords, clockOf, megabytes, pieceAt, videoChip, videoTone, videoWords } from "./fuelLogic";

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
  it("a bookmark lands in the right piece at the right second", () => {
    const pieces = [{ duration_s: 200 }, { duration_s: 112 }];
    expect(pieceAt(4, pieces)).toEqual({ piece: 0, offset: 4 });
    expect(pieceAt(199, pieces)).toEqual({ piece: 0, offset: 199 });
    expect(pieceAt(200, pieces)).toEqual({ piece: 1, offset: 0 });
    expect(pieceAt(250, pieces)).toEqual({ piece: 1, offset: 50 });
    // Past the end (a mark later than the pieces' lengths say): the last piece, as far as it goes.
    expect(pieceAt(400, pieces)).toEqual({ piece: 1, offset: 200 });
    expect(pieceAt(38, [{ duration_s: 41 }])).toEqual({ piece: 0, offset: 38 });
    expect(pieceAt(38, [{}])).toEqual({ piece: 0, offset: 38 });
    expect(pieceAt(38, [])).toEqual({ piece: 0, offset: 38 });
  });
  it("the ticked items by name", () => {
    const items = [{ key: "pump", en: "Pump display" }, { key: "plate", en: "Number plate" }];
    expect(checklistWords(["pump", "plate", "other"], items)).toBe("Pump display, Number plate, other");
    expect(checklistWords(undefined, items)).toBe("");
  });
});
