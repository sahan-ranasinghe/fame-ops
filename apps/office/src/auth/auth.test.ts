import { describe, expect, it } from "vitest";
import { MIN_PASSWORD } from "./SetPassword";
import { qrSrc } from "./TotpEnrol";

describe("sign-in rules", () => {
  it("passwords need 12 characters, the dashboard's minimum", () => {
    expect(MIN_PASSWORD).toBe(12);
  });
  it("shows Supabase's QR code whether it comes as SVG or as a data URL", () => {
    expect(qrSrc("<svg xmlns='http://www.w3.org/2000/svg'></svg>")?.startsWith("data:image/svg+xml;utf8,")).toBe(true);
    expect(qrSrc("data:image/svg+xml;utf8,%3Csvg%3E")).toBe("data:image/svg+xml;utf8,%3Csvg%3E");
    expect(qrSrc(undefined)).toBeUndefined();
  });
});
