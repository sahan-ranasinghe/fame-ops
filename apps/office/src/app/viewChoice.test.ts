import { describe, expect, it } from "vitest";
import { mobileTarget, phoneLike } from "./viewChoice";

const ANDROID = "Mozilla/5.0 (Linux; Android 14; CPH2119) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36";
const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const LAPTOP = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36";

describe("which build a browser gets (O4)", () => {
  it("a phone by its browser, or a narrow touch screen; an iPad, a laptop and a laptop's narrow window keep the desktop site", () => {
    expect(phoneLike(412, LAPTOP, true)).toBe(true);
    expect(phoneLike(412, LAPTOP, false)).toBe(false);
    expect(phoneLike(1280, ANDROID, true)).toBe(true);
    expect(phoneLike(1280, IPHONE, true)).toBe(true);
    expect(phoneLike(700, IPAD, true)).toBe(false);
    expect(phoneLike(1366, LAPTOP, false)).toBe(false);
  });
  it("a phone goes to /m/ with the page it asked for; the choice wins either way", () => {
    expect(mobileTarget("/", "", null, 412, ANDROID, true, true)).toBe("/m/");
    expect(mobileTarget("/requests/abc", "?x=1", null, 412, ANDROID, true, true)).toBe(`/m/?from=${encodeURIComponent("/requests/abc?x=1")}`);
    expect(mobileTarget("/tasks", "", "desktop", 412, ANDROID, true, true)).toBeNull();
    expect(mobileTarget("/tasks", "", "mobile", 1366, LAPTOP, false, true)).toBe(`/m/?from=${encodeURIComponent("/tasks")}`);
    expect(mobileTarget("/tasks", "", null, 1366, LAPTOP, false, true)).toBeNull();
    expect(mobileTarget("/tasks", "", null, 600, LAPTOP, false, true)).toBeNull();
  });
  it("while the redirect is held, a phone stays on the desktop site unless it chose the mobile view", () => {
    expect(mobileTarget("/", "", null, 412, ANDROID, true)).toBeNull();
    expect(mobileTarget("/tasks", "", "mobile", 412, ANDROID, true)).toBe(`/m/?from=${encodeURIComponent("/tasks")}`);
    expect(mobileTarget("/tasks", "", "desktop", 412, ANDROID, true)).toBeNull();
  });
  it("the privacy page and the set-password landing stay on the desktop site", () => {
    expect(mobileTarget("/privacy", "", null, 412, ANDROID, true, true)).toBeNull();
    expect(mobileTarget("/set-password", "", "mobile", 412, ANDROID, true, true)).toBeNull();
  });
});
