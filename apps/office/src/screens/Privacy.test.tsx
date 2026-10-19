// Part 6 (store readiness): the privacy policy at /privacy, open without signing in, in plain English with what is
// collected, who sees it and how long it is kept.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isPrivacyPath } from "../app/WebApp";
import { loadPrivacyContact, Privacy, type PrivacyContact } from "./Privacy";

const contact = (c: PrivacyContact) => () => Promise.resolve(c);

describe("the privacy policy", () => {
  it("says what is collected, who sees it and how long it is kept", () => {
    render(<Privacy load={contact({})} />);
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

  it("Questions: the privacy e-mail from the setting as a mailto: link; removed, the office phone; neither, the fleet admin", async () => {
    const { unmount } = render(<Privacy load={contact({ email: "privacy@fame.test", phone: "011 234 5678", phone_e164: "+94112345678" })} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "privacy@fame.test" }).getAttribute("href")).toBe("mailto:privacy@fame.test"));
    expect(screen.queryByRole("link", { name: "011 234 5678" })).toBeNull();
    unmount();
    const second = render(<Privacy load={contact({ phone: "011 234 5678", phone_e164: "+94112345678" })} />);
    await waitFor(() => expect(screen.getByRole("link", { name: "011 234 5678" }).getAttribute("href")).toBe("tel:+94112345678"));
    second.unmount();
    render(<Privacy load={contact({})} />);
    await waitFor(() => expect(screen.getByTestId("privacy-contact").textContent).toBe("Ask the fleet admin of Fame Global Solutions."));
  });

  it("reads the contact from office-api's public answer (no session), and copes with a failure", async () => {
    const asked: string[] = [];
    const ok = await loadPrivacyContact(((url: string) => {
      asked.push(url);
      return Promise.resolve(Response.json({ email: "privacy@fame.test", other: "never shown" }));
    }) as unknown as typeof fetch);
    expect(ok).toEqual({ email: "privacy@fame.test" });
    expect(asked[0]).toMatch(/\/office-api\/public\/privacy$/);
    expect(await loadPrivacyContact((() => Promise.resolve(new Response("", { status: 500 }))) as unknown as typeof fetch)).toEqual({});
    expect(await loadPrivacyContact((() => Promise.reject(new Error("offline"))) as unknown as typeof fetch)).toEqual({});
  });

  it("no address is written into the page: it comes from the setting", () => {
    const source = readFileSync(join(process.cwd(), "src/screens/Privacy.tsx"), "utf8");
    expect(source.match(/[\w.+-]+@[\w-]+\.[\w.]+/g) ?? []).toEqual([]);
  });

  it("docs/privacy-policy.md says what the page says (every paragraph and point)", () => {
    render(<Privacy load={contact({})} />);
    const flat = (t: string) => t.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    const doc = flat(readFileSync(join(process.cwd(), "../../docs/privacy-policy.md"), "utf8"));
    const parts = [...document.querySelectorAll("main li, main p")]
      .filter((el) => !el.closest("[data-testid=privacy-contact]") && el.getAttribute("data-testid") !== "privacy-contact")
      .map((el) => flat(el.textContent ?? ""))
      .filter((t) => t && !t.startsWith("Last updated"));
    expect(parts.length).toBeGreaterThan(15);
    expect(parts.filter((t) => !doc.includes(t))).toEqual([]);
    for (const h of [...document.querySelectorAll("main h2")].map((el) => el.textContent ?? "")) expect(doc).toContain(`## ${h}`.replace(/\s+/g, " "));
  });
});
