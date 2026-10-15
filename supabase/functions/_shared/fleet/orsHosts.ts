// openrouteservice's hosts (15 October 2026): api.openrouteservice.org is
// deprecated (a tenth of the quota since 27 August, shut down in the first week
// of November 2026); the same key works on api.heigit.org, where directions are
// /openrouteservice/v2/… and geocoding /pelias/v1/…. Every call goes to the new
// host; only when it answers 404 or 410 (the path moved or is gone) is the old
// one tried, once. Any other answer, good or bad, is the answer.

export const ORS_DIRECTIONS_URLS = [
  "https://api.heigit.org/openrouteservice/v2/directions/driving-car/json",
  "https://api.openrouteservice.org/v2/directions/driving-car/json",
];
export const ORS_AUTOCOMPLETE_URLS = [
  "https://api.heigit.org/pelias/v1/autocomplete",
  "https://api.openrouteservice.org/geocode/autocomplete",
];

/** The new host, then (on 404 or 410 only) the old one. `query` is appended to each URL. */
export async function orsFetch(urls: string[], init: RequestInit, query = "", fetcher: typeof fetch = fetch): Promise<Response> {
  let last: Response | null = null;
  for (const [i, url] of urls.entries()) {
    const res = await fetcher(url + query, init);
    if ((res.status === 404 || res.status === 410) && i < urls.length - 1) {
      await res.body?.cancel().catch(() => undefined);
      last = res;
      continue;
    }
    return res;
  }
  return last!;
}
