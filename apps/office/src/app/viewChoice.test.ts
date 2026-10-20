import { describe, expect, it } from "vitest";
import { mobileTarget, phoneLike } from "./viewChoice";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; CPH2119) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const LAPTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

describe("which build a browser gets (O4)", () => {
  it("a phone by its screen or its browser; an iPad and a laptop keep the desktop site", () => {
    expect(phoneLike(412, LAPTOP)).toBe(true);
    expect(phoneLike(1280, ANDROID)).toBe(true);
    expect(phoneLike(1280, IPHONE)).toBe(true);
    expect(phoneLike(1024, IPAD)).toBe(false);
    expect(phoneLike(1366, LAPTOP)).toBe(false);
  });
  it("a phone goes to /m/ with the page it asked for; the choice wins either way", () => {
    expect(mobileTarget("/", "", null, 412, ANDROID)).toBe("/m/");
    expect(mobileTarget("/requests/abc", "?x=1", null, 412, ANDROID)).toBe(`/m/?from=${encodeURIComponent("/requests/abc?x=1")}`);
    expect(mobileTarget("/tasks", "", "desktop", 412, ANDROID)).toBeNull();
    expect(mobileTarget("/tasks", "", "mobile", 1366, LAPTOP)).toBe(`/m/?from=${encodeURIComponent("/tasks")}`);
    expect(mobileTarget("/tasks", "", null, 1366, LAPTOP)).toBeNull();
  });
  it("the privacy page and the set-password landing stay on the desktop site", () => {
    expect(mobileTarget("/privacy", "", null, 412, ANDROID)).toBeNull();
    expect(mobileTarget("/set-password", "", "mobile", 412, ANDROID)).toBeNull();
  });
});
