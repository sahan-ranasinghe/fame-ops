import { assertEquals } from "jsr:@std/assert";
import { COLOMBO, kmText, nearestFirst, ourPlacesFirst, SUGGEST_LIMITS } from "./suggest.ts";

const colombo05 = { name: "Head office, Colombo 05", kind: "office", lat: 6.8905, lng: 79.8669 };
const kandy = { name: "Kandy store", kind: "store", lat: 7.2906, lng: 80.6337 };
const galle = { name: "Galle site", kind: "site", lat: 6.0535, lng: 80.221 };
const noPin = { name: "Somewhere", kind: "other", lat: null, lng: null };

Deno.test("nearest first, ties by name, unpinned last, the limit kept", () => {
  const out = nearestFirst([galle, noPin, kandy, colombo05], COLOMBO, 3);
  assertEquals(out.map((r) => r.name), ["Head office, Colombo 05", "Kandy store", "Galle site"]);
  const all = nearestFirst([galle, noPin, kandy, colombo05], COLOMBO, 10);
  assertEquals(all[3].name, "Somewhere");
  const tie = nearestFirst([{ name: "B", lat: 7, lng: 80 }, { name: "A", lat: 7, lng: 80 }], { lat: 7, lng: 80 }, 2);
  assertEquals(tie.map((r) => r.name), ["A", "B"]);
});

Deno.test("our places: the offices first, then the rest, each nearest first", () => {
  const far = { name: "Jaffna office", kind: "office", lat: 9.6615, lng: 80.0255 };
  const out = ourPlacesFirst([kandy, far, galle, colombo05], COLOMBO, 3);
  assertEquals(out.map((r) => r.name), ["Head office, Colombo 05", "Jaffna office", "Kandy store"]);
});

Deno.test("the distance under a suggestion", () => {
  assertEquals(kmText(COLOMBO, { lat: 6.9271, lng: 79.8612 }), "0.0 km");
  assertEquals(kmText(COLOMBO, kandy), "94 km");
  assertEquals(SUGGEST_LIMITS.towns, 5);
});
