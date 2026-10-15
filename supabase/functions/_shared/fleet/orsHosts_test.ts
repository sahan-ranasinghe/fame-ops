// openrouteservice's hosts (15 October 2026): the new host first, the old one only on 404 or 410.
import { assertEquals } from "@std/assert";
import { ORS_AUTOCOMPLETE_URLS, ORS_DIRECTIONS_URLS, orsFetch } from "./orsHosts.ts";

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
