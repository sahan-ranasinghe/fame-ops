import { describe, expect, it } from "vitest";
import { stateText, urlBase64ToUint8Array } from "./notificationsLogic";

describe("the VAPID key bytes", () => {
  it("decodes base64url without padding", () => {
    expect([...urlBase64ToUint8Array("BAE")]).toEqual([4, 1]);
    expect([...urlBase64ToUint8Array("-_8")]).toEqual([251, 255]);
    expect(urlBase64ToUint8Array("BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-ts1XbIu97ohXLbC2V4OWcB7Fm4").length).toBe(65);
  });
});

describe("the state line under This browser", () => {
  it("says when push is not set up on the server, whatever the browser", () => {
    expect(stateText("on", false, true)).toEqual({ text: "Push notifications are not switched on for the office yet.", tone: "info", can: null });
  });
  it("offers the right button", () => {
    expect(stateText("off", true, false).can).toBe("on");
    expect(stateText("on", true, true).can).toBe("off");
    expect(stateText("on", true, false).can).toBe("on");
    expect(stateText("blocked", true, false).can).toBeNull();
    expect(stateText("ios_not_installed", true, false).text).toContain("Add to Home Screen");
    expect(stateText("unsupported", true, false).text).toContain("Chrome, Edge or Firefox");
  });
});
