// Google's encoded polyline (precision 5): the Routes API's leg lines (Phase 7, §20). Pure; the same file is in the
// driver app (src/lib/polyline.ts) and the office imports it as @fleet/polyline. Google's content: drawn on Google's
// maps only (rule 10).

export interface LatLng {
  lat: number;
  lng: number;
}

/** The points of an encoded polyline; an empty list for a broken one. */
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let i = 0;
  let lat = 0;
  let lng = 0;
  const next = (): number | null => {
    let result = 0;
    let shift = 0;
    let b: number;
    do {
      if (i >= encoded.length) return null;
      b = encoded.charCodeAt(i++) - 63;
      if (b < 0 || b > 63) return null;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < encoded.length) {
    const dLat = next();
    const dLng = next();
    if (dLat === null || dLng === null) return [];
    lat += dLat;
    lng += dLng;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** The encoded form of points (for tests and fixtures). */
export function encodePolyline(points: readonly LatLng[]): string {
  let out = "";
  let pLat = 0;
  let pLng = 0;
  const put = (v: number) => {
    let n = v < 0 ? ~(v << 1) : v << 1;
    while (n >= 0x20) {
      out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
      n >>= 5;
    }
    out += String.fromCharCode(n + 63);
  };
  for (const p of points) {
    const lat = Math.round(p.lat * 1e5);
    const lng = Math.round(p.lng * 1e5);
    put(lat - pLat);
    put(lng - pLng);
    pLat = lat;
    pLng = lng;
  }
  return out;
}
