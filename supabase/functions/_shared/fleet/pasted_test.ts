// A pasted location (Part 4): coordinates, full Google Maps links, short links through a fake redirect chain.
import { assertEquals } from "@std/assert";
import { isMapsLink, parseCoordinates, parseMapsLink, pastedPin, resolveMapsLink } from "./pasted.ts";

Deno.test('coordinates: "lat, lng" in its usual forms; not a phone number or a single number', () => {
  assertEquals(parseCoordinates("6.9271, 79.8612"), { lat: 6.9271, lng: 79.8612, from: "coordinates" });
  assertEquals(parseCoordinates(" 6.9271 79.8612 "), { lat: 6.9271, lng: 79.8612, from: "coordinates" });
  assertEquals(parseCoordinates("6.9271;79.8612")?.lng, 79.8612);
  assertEquals(parseCoordinates("0771234567"), null);
  assertEquals(parseCoordinates("MT0184"), null);
  assertEquals(parseCoordinates("120, 79"), null);
});

Deno.test("full links: the place's own pin wins over the map centre; q= and the name", () => {
  const place =
    "https://www.google.com/maps/place/Fame+Global+Solutions/@6.9755,79.9165,17z/data=!3m1!4b1!4m6!3m5!1s0x3ae2!8m2!3d6.9752867!4d79.9190013!16s";
  assertEquals(parseMapsLink(place), { lat: 6.9752867, lng: 79.9190013, name: "Fame Global Solutions", from: "link" });
  assertEquals(parseMapsLink("https://www.google.com/maps/@7.2906,80.6337,15z"), {
    lat: 7.2906,
    lng: 80.6337,
    name: undefined,
    from: "link",
  });
  assertEquals(parseMapsLink("https://maps.google.com/?q=7.2906,80.6337")?.lat, 7.2906);
  assertEquals(parseMapsLink("https://www.google.com/maps/search/?api=1&query=6.97,79.91")?.lng, 79.91);
  assertEquals(isMapsLink("https://example.com/maps/@6.9,79.9,15z"), false);
  assertEquals(isMapsLink("https://maps.app.goo.gl/AbCd123"), true);
});

Deno.test("short links: redirects are followed on Google hosts only, at most 5 hops", async () => {
  const hops: string[] = [];
  const chain: Record<string, string> = {
    "https://maps.app.goo.gl/AbCd123": "https://www.google.com/maps/place/Kandy/@7.29,80.63,15z/data=!3d7.2906!4d80.6337",
  };
  const fake = ((url: string | URL) => {
    hops.push(String(url));
    const next = chain[String(url)];
    return Promise.resolve(new Response(null, next ? { status: 302, headers: { location: next } } : { status: 200 }));
  }) as typeof fetch;
  assertEquals(await resolveMapsLink("https://maps.app.goo.gl/AbCd123", fake), { lat: 7.2906, lng: 80.6337, name: "Kandy", from: "link" });
  assertEquals(hops, ["https://maps.app.goo.gl/AbCd123"]);
  // A redirect off Google is not followed.
  const evil = ((url: string | URL) =>
    Promise.resolve(
      new Response(
        null,
        String(url).includes("goo.gl") ? { status: 302, headers: { location: "https://evil.example/@6.9,79.9" } } : { status: 200 },
      ),
    )) as typeof fetch;
  assertEquals(await resolveMapsLink("https://maps.app.goo.gl/Bad", evil), null);
  // Coordinates never reach the network; plain text is not a pin.
  const none = (() => Promise.reject(new Error("no network"))) as typeof fetch;
  assertEquals((await pastedPin("6.9, 79.9", none))?.from, "coordinates");
  assertEquals(await pastedPin("Kandy", none), null);
});
