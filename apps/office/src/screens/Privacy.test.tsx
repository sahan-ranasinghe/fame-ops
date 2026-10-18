// Part 6 (store readiness): the privacy policy at /privacy, open without signing in, in plain English with what is
// collected, who sees it and how long it is kept.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isPrivacyPath } from "../app/WebApp";
import { Privacy } from "./Privacy";

describe("the privacy policy", () => {
  it("says what is collected, who sees it and how long it is kept", () => {
    render(<Privacy />);
    expect(screen.getByRole("heading", { name: "Privacy policy" })).toBeTruthy();
    for (const title of ["What we collect", "Who sees it", "How long it is kept", "Your choices", "Security", "Questions"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    const text = document.body.textContent ?? "";
    expect(text).toContain("only while you are on duty");
    expect(text).toContain("when the app is closed or not in use");
    expect(text).toContain("Location points: 90 days");
    expect(text).toContain("Fuel videos: 12 months");
    expect(text).toContain("never sell data");
  });

  it("opens at /privacy, with or without a trailing slash, and nowhere else", () => {
    expect(isPrivacyPath("/privacy")).toBe(true);
    expect(isPrivacyPath("/privacy/")).toBe(true);
    expect(isPrivacyPath("/")).toBe(false);
    expect(isPrivacyPath("/privacy-old")).toBe(false);
  });
});
