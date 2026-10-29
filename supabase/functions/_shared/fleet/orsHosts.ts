// openrouteservice's hosts (15 October 2026): api.openrouteservice.org is
// deprecated (a tenth of the quota since 27 August, shut down in the first week
// of November 2026); the same key works on api.heigit.org, where directions are
// /openrouteservice/v2/… and geocoding /pelias/v1/…. Every call goes to the new
// host; only when it answers 404 or 410 (the path moved or is gone) is the old
// one tried, once. Any other answer, good or bad, is the answer.
// Round 49: openrouteservice also answers 404 for "no road near this point" (error 2010) and "no route" (2009), as
// its own JSON error ({ error: { code, message } }). That is the host answering, not a moved path: it is returned as
// the answer and the old host is not asked (before, every such gap cost two requests and two errors).

export const ORS_DIRECTIONS_URLS = [
  "https://api.heigit.org/openrouteservice/v2/directions/driving-car/json",
  "https://api.openrouteservice.org/v2/directions/driving-car/json",
];
/** Directions with the road geometry (a gap's estimated line, Part 5b). */
export const ORS_GEOJSON_URLS = [
  "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
];
export const ORS_AUTOCOMPLETE_URLS = [
  "https://api.heigit.org/pelias/v1/autocomplete",
  "https://api.openrouteservice.org/geocode/autocomplete",
];

/** openrouteservice's own error answer: { error: { code: <number>, message } } (a gateway's 404 has no such code). */
export function orsErrorCode(body: unknown): number | null {
  const code = (body as { error?: { code?: unknown } } | null)?.error?.code;
  return typeof code === "number" ? code : null;
}

/** "No road near a point" (2010) and "no route between the points" (2009): a real answer, not a failure. */
export const ORS_NO_ROUTE_CODES: ReadonlySet<number> = new Set([2009, 2010]);

/**
 * The new host, then (on 404 or 410 only, when it is not openrouteservice's own JSON error) the old one. `query` is appended to each URL. `onFallback` is called before
 * the old host is tried: the first request was made and counts against the quota too (Round 48: every request counted).
 */
export async function orsFetch(
  urls: string[],
  init: RequestInit,
  query = "",
  fetcher: typeof fetch = fetch,
  onFallback?: () => unknown,
): Promise<Response> {
  let last: Response | null = null;
  for (const [i, url] of urls.entries()) {
    const res = await fetcher(url + query, init);
    if ((res.status === 404 || res.status === 410) && i < urls.length - 1) {
      // openrouteservice's own error (no road near a point, no route): the host answered; that is the answer.
      const text = await res.text().catch(() => "");
      let body: unknown = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      if (orsErrorCode(body) !== null) return new Response(text, { status: res.status, headers: res.headers });
      last = res;
      if (onFallback) await onFallback();
      continue;
    }
    return res;
  }
  return last!;
}
