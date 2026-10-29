// openrouteservice's hosts (15 October 2026): the new host first, the old one only on 404 or 410.
import { assertEquals } from "@std/assert";
import { ORS_AUTOCOMPLETE_URLS, ORS_DIRECTIONS_URLS, orsErrorCode, orsFetch } from "./orsHosts.ts";

const answering = (codes: Record<string, number>, seen: string[]) =>
  ((url: string) => {
    seen.push(url);
    const host = new URL(url).host;
    return Promise.resolve(new Response("{}", { status: codes[host] ?? 200 }));
  }) as unknown as typeof fetch;

Deno.test("the new host answers: the old one is never asked", async () => {
  const seen: string[] = [];
  const res = await orsFetch(ORS_DIRECTIONS_URLS, { method: "POST" }, "", answering({}, seen));
  assertEquals([res.status, seen], [200, ["https://api.heigit.org/openrouteservice/v2/directions/driving-car/json"]]);
});

Deno.test("404 or 410 on the new host: the old host once, with the same query", async () => {
  for (const code of [404, 410]) {
    const seen: string[] = [];
    const res = await orsFetch(ORS_AUTOCOMPLETE_URLS, {}, "?text=kandy", answering({ "api.heigit.org": code }, seen));
    assertEquals([res.status, seen], [200, [
      "https://api.heigit.org/pelias/v1/autocomplete?text=kandy",
      "https://api.openrouteservice.org/geocode/autocomplete?text=kandy",
    ]]);
  }
});

Deno.test("any other answer from the new host is the answer (a bad key, the quota, a server error)", async () => {
  for (const code of [401, 403, 429, 500]) {
    const seen: string[] = [];
    const res = await orsFetch(ORS_DIRECTIONS_URLS, {}, "", answering({ "api.heigit.org": code }, seen));
    assertEquals([res.status, seen.length], [code, 1]);
  }
  // Both hosts gone: the old host's answer.
  const seen: string[] = [];
  const res = await orsFetch(ORS_DIRECTIONS_URLS, {}, "", answering({ "api.heigit.org": 404, "api.openrouteservice.org": 410 }, seen));
  assertEquals([res.status, seen.length], [410, 2]);
});

Deno.test("Round 48: onFallback runs once, before the old host is tried, and never when the new host answers", async () => {
  const seen: string[] = [];
  let fallbacks = 0;
  const order: string[] = [];
  const f = ((url: string) => {
    order.push(new URL(url).host);
    return answering({ "api.heigit.org": 404 }, seen)(url);
  }) as unknown as typeof fetch;
  await orsFetch(ORS_DIRECTIONS_URLS, {}, "", f, () => {
    fallbacks += 1;
    order.push("counted");
  });
  assertEquals([fallbacks, order], [1, ["api.heigit.org", "counted", "api.openrouteservice.org"]]);
  let none = 0;
  await orsFetch(ORS_DIRECTIONS_URLS, {}, "", answering({}, []), () => void (none += 1));
  assertEquals(none, 0);
});

Deno.test("Round 49: openrouteservice's own 404 (no road near a point, 2010) is the answer: the old host is not asked", async () => {
  const seen: string[] = [];
  const body = {
    error: { code: 2010, message: "Could not find routable point within a radius of 350.0 meters of specified coordinate 0" },
  };
  const f = ((url: string) => {
    seen.push(url);
    return Promise.resolve(Response.json(body, { status: 404 }));
  }) as unknown as typeof fetch;
  let fallbacks = 0;
  const res = await orsFetch(ORS_DIRECTIONS_URLS, {}, "", f, () => fallbacks++);
  assertEquals([res.status, seen.length, fallbacks], [404, 1, 0]);
  assertEquals(orsErrorCode(await res.json()), 2010, "the answer's body is still readable by the caller");
  // A gateway's 404 (no openrouteservice error code) still means the path moved: the old host is asked.
  assertEquals(orsErrorCode({ error: "Not Found" }), null);
});
