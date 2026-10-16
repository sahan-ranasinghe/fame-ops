// The encoded polyline of the Routes API legs (Phase 7, §20).
import { assertEquals } from "@std/assert";
import { decodePolyline, encodePolyline } from "./polyline.ts";

Deno.test("Google's documented example decodes to its three points", () => {
  assertEquals(decodePolyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@"), [
    { lat: 38.5, lng: -120.2 },
    { lat: 40.7, lng: -120.95 },
    { lat: 43.252, lng: -126.453 },
  ]);
});

Deno.test("Sri Lankan points round-trip; a broken string gives no points", () => {
  const pts = [{ lat: 6.8868, lng: 79.8612 }, { lat: 7.2906, lng: 80.6337 }, { lat: 7.4839, lng: 80.3683 }];
  assertEquals(decodePolyline(encodePolyline(pts)), pts);
  assertEquals(decodePolyline("_p~iF~ps|U_"), []);
  assertEquals(decodePolyline(""), []);
});
