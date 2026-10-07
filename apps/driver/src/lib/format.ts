// Numbers, links and distances. Digits are always Latin, in both languages.

/** "84,512" */
export function thousands(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** The whole number in a text field such as "84,563", or null when it is empty or not a number. */
export function parseWhole(text: string): number | null {
  const digits = text.replace(/[^\d]/g, '');
  if (digits === '' || digits.length > 7) return null;
  return Number(digits);
}

/** A decimal such as "32.5" or "11,840.50", or null. */
export function parseDecimal(text: string): number | null {
  const cleaned = text.replace(/,/g, '').trim();
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(cleaned);
}

/** Sri Lankan number in international digits ("94771234567"), or null. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10 && digits.startsWith('0')) return `94${digits.slice(1)}`;
  if (digits.length === 9) return `94${digits}`;
  return digits.length >= 9 ? digits : null;
}

export function telLink(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

/** Google Maps directions to coordinates or, failing that, to an address or place name. */
export function navigateLink(to: { lat?: number | null; lng?: number | null; text?: string | null }): string | null {
  const destination = to.lat != null && to.lng != null ? `${to.lat},${to.lng}` : to.text?.trim();
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

/** Straight-line distance in km. */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** "Nuwan" from "Nuwan Perera". */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

/**
 * The odometer number in text read from a photo. Odometers show 4 to 7 digits;
 * when the last known reading is given, the candidate closest to it (and not
 * far below it) wins, otherwise the longest one.
 */
export function odometerFromText(text: string, lastKnownKm?: number | null): number | null {
  const candidates = [...text.matchAll(/\d[\d ,.]{2,9}\d/g)]
    .map((m) => m[0].replace(/[^\d]/g, ''))
    .filter((digits) => digits.length >= 4 && digits.length <= 7)
    .map(Number);
  if (candidates.length === 0) return null;
  if (lastKnownKm != null) {
    const plausible = candidates.filter((n) => n >= lastKnownKm - 5 && n <= lastKnownKm + 5000);
    if (plausible.length > 0) return plausible.reduce((best, n) => (Math.abs(n - lastKnownKm) < Math.abs(best - lastKnownKm) ? n : best));
  }
  return candidates.reduce((best, n) => (String(n).length > String(best).length ? n : best));
}
