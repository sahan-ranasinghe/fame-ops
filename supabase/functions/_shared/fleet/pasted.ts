// A location pasted into the search box (Phase 6, Part 4): "6.9271, 79.8612",
// a full Google Maps link, or a maps.app.goo.gl short link. The short link is
// resolved on the server (the browser cannot follow it across origins): every
// redirect hop must stay on a Google host, at most 5 hops, 5 s each, no body
// read. Pure parsing plus one resolver; Deno tests: pasted_test.ts.

export interface PastedPin {
  lat: number;
  lng: number;
  /** The place's name when the link carries one (/maps/place/<name>/…). */
  name?: string;
  from: "coordinates" | "link";
}

const COORDS = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*[,;\s]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/;

/** "6.9271, 79.8612" (also "6.9271 79.8612", "6.9271;79.8612"). */
export function parseCoordinates(text: string): PastedPin | null {
  const m = text.match(COORDS);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  return validPin(lat, lng) ? { lat, lng, from: "coordinates" } : null;
}

const validPin = (lat: number, lng: number) =>
  Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 &&
  Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

const GOOGLE_HOSTS =
  /^(?:www\.|maps\.)?google\.(?:com|lk|co\.uk|co\.in)$|^maps\.app\.goo\.gl$|^goo\.gl$/i;

/** Is this a Google Maps link we read (or resolve)? */
export function isMapsLink(text: string): boolean {
  try {
    const u = new URL(text.trim());
    return (u.protocol === "https:" || u.protocol === "http:") &&
      GOOGLE_HOSTS.test(u.hostname) && (u.hostname.endsWith("goo.gl")
        ? true
        : u.pathname.startsWith("/maps") || u.searchParams.has("q") ||
          u.searchParams.has("query"));
  } catch {
    return false;
  }
}

export const isShortLink = (text: string) => {
  try {
    const h = new URL(text.trim()).hostname.toLowerCase();
    return h === "maps.app.goo.gl" || h === "goo.gl";
  } catch {
    return false;
  }
};

/**
 * The pin of a full Google Maps link. The place's own pin (!3d<lat>!4d<lng>) wins over the map's centre
 * (@lat,lng,zoom); then q= / query= / ll= / destination= with "lat,lng". The name from /maps/place/<name>/.
 */
export function parseMapsLink(link: string): PastedPin | null {
  let u: URL;
  try {
    u = new URL(link.trim());
  } catch {
    return null;
  }
  const whole = decodeURIComponent(u.pathname + u.search + u.hash);
  const placeName = u.pathname.match(/\/maps\/place\/([^/@]+)/)?.[1];
  const name = placeName
    ? decodeURIComponent(placeName.replace(/\+/g, " ")).trim()
    : undefined;
  const pinned = [
    ...whole.matchAll(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/g),
  ].pop();
  if (pinned && validPin(Number(pinned[1]), Number(pinned[2]))) {
    return {
      lat: Number(pinned[1]),
      lng: Number(pinned[2]),
      name,
      from: "link",
    };
  }
  for (const key of ["q", "query", "ll", "destination", "daddr"]) {
    const v = u.searchParams.get(key);
    const c = v ? parseCoordinates(v) : null;
    if (c) return { ...c, name, from: "link" };
  }
  const centre = whole.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (centre && validPin(Number(centre[1]), Number(centre[2]))) {
    return {
      lat: Number(centre[1]),
      lng: Number(centre[2]),
      name,
      from: "link",
    };
  }
  return null;
}

/**
 * Follows a short link's redirects (HEAD, then GET without reading the body) while every hop stays on a
 * Google host, and parses where it lands. Null when it does not lead to a pin.
 */
export async function resolveMapsLink(
  link: string,
  fetcher: typeof fetch = fetch,
): Promise<PastedPin | null> {
  let url = link.trim();
  for (let hop = 0; hop < 5; hop++) {
    // Every hop must be a Google host before anything in it is read.
    let host: string;
    try {
      host = new URL(url).hostname;
    } catch {
      return null;
    }
    if (!GOOGLE_HOSTS.test(host)) return null;
    const direct = parseMapsLink(url);
    if (direct && !isShortLink(url)) return direct;
    let res: Response;
    try {
      res = await fetcher(url, {
        method: "GET",
        redirect: "manual",
        signal: AbortSignal.timeout(5000),
        headers: { "User-Agent": "FameFleet/1.0" },
      });
    } catch {
      return null;
    }
    await res.body?.cancel().catch(() => undefined);
    const next = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !next) {
      return parseMapsLink(url);
    }
    url = new URL(next, url).toString();
  }
  return parseMapsLink(url);
}

/** What the box holds: coordinates, a Maps link (full or short), or nothing pasted. */
export async function pastedPin(
  text: string,
  fetcher: typeof fetch = fetch,
): Promise<PastedPin | null> {
  const coords = parseCoordinates(text);
  if (coords) return coords;
  if (!isMapsLink(text)) return null;
  return isShortLink(text)
    ? resolveMapsLink(text, fetcher)
    : parseMapsLink(text);
}
