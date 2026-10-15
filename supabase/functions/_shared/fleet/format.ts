// Links, phone numbers, money and small output helpers.

/** Sri Lankan number in international digits ("94771234567"), or null. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) {
    return `94${digits.slice(1)}`;
  }
  if (digits.length === 9) return `94${digits}`;
  return digits.length >= 9 ? digits : null;
}

export function telLink(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

export function waLink(
  phone: string | null | undefined,
  text?: string,
): string | null {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return text
    ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}`
    : `https://wa.me/${digits}`;
}

/** Google Maps pin at a position. */
export function mapsPoint(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Google Maps directions to coordinates or, failing that, to an address. */
export function mapsDirections(
  to: { lat?: number | null; lng?: number | null; text?: string | null },
): string | null {
  const destination = to.lat != null && to.lng != null
    ? `${to.lat},${to.lng}`
    : to.text?.trim();
  return destination
    ? `https://www.google.com/maps/dir/?api=1&destination=${
      encodeURIComponent(destination)
    }`
    : null;
}

export function contactLinks(
  phone: string | null | undefined,
): { call: string | null; whatsapp: string | null } {
  return { call: telLink(phone), whatsapp: waLink(phone) };
}

/** Money is stored as integer cents. */
export function centsToLkr(cents: number | null | undefined): number | null {
  return cents == null ? null : cents / 100;
}

export function lkrToCents(lkr: number): number {
  return Math.round(lkr * 100);
}

/** "3,240" */
export function thousands(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

export function kmh(speedMps: number | null | undefined): number | null {
  return speedMps == null || speedMps < 0 ? null : Math.round(speedMps * 3.6);
}

/** Drops null and undefined everywhere, to keep the JSON compact. */
export function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v !== null && v !== undefined) out[key] = prune(v);
    }
    return out;
  }
  return value;
}

/** Lower-case letters and digits only: for forgiving name and plate matching. */
export function plain(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}
