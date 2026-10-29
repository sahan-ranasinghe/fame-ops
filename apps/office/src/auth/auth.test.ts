import { describe, expect, it } from "vitest";
import { MAX_PASSWORD_BYTES, MIN_PASSWORD, passwordLength } from "./SetPassword";
import { qrSrc } from "./TotpEnrol";

describe("sign-in rules", () => {
  it("office passwords need 6 characters on the set-password page", () => {
    expect(MIN_PASSWORD).toBe(6);
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(passwordLength("abc 1!")).toBe(6);
    expect(passwordLength("මුරපදය")).toBe(6);
  });
  it("shows Supabase's QR code whether it comes as SVG or as a data URL", () => {
    expect(qrSrc("<svg xmlns='http://www.w3.org/2000/svg'></svg>")?.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(qrSrc("data:image/svg+xml;utf8,%3Csvg%3E")).toBe("data:image/svg+xml;utf8,%3Csvg%3E");
    expect(qrSrc(undefined)).toBeUndefined();
  });
});
