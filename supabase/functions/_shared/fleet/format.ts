// Links, phone numbers, money and small output helpers.

/** Sri Lankan number in international digits ("94771234567"), or null. */
export function phoneDigits(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10 && digits.startsWith("0")) return `94${digits.slice(1)}`;
  if (digits.length === 9) return `94${digits}`;
  return digits.length >= 9 ? digits : null;
}

/**
 * Hotfix 2 (F): a Sri Lankan number as stored, E.164 ("+94771234567"), from 077 123 4567, 77 123 4567, 94771234567 or
 * +94 77 123 4567 (spaces, dashes and brackets ignored); null when it is none of those.
 */
export function phoneE164(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (/^0[1-9]\d{8}$/.test(d)) return `+94${d.slice(1)}`;
  if (/^[1-9]\d{8}$/.test(d)) return `+94${d}`;
  if (/^94[1-9]\d{8}$/.test(d)) return `+${d}`;
  return null;
}

/** "+94771234567" → "077 123 4567"; another number as it is. */
export function phoneDisplay(phone: string | null | undefined): string | undefined {
  if (!phone) return undefined;
  const e = phoneE164(phone);
  if (!e) return phone;
  const local = `0${e.slice(3)}`;
  return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
}

/** A number with its links (Call and WhatsApp), or undefined when there is none. */
export function phoneLinks(
  phone: string | null | undefined,
): { phone: string; phone_display: string; call: string; whatsapp: string } | undefined {
  const call = telLink(phone);
  const whatsapp = waLink(phone);
  if (!phone || !call || !whatsapp) return undefined;
  return { phone: phoneE164(phone) ?? phone, phone_display: phoneDisplay(phone) ?? phone, call, whatsapp };
}

export function telLink(phone: string | null | undefined): string | null {
  const digits = phoneDigits(phone);
  return digits ? `tel:+${digits}` : null;
}

export function waLink(phone: string | null | undefined, text?: string): string | null {
  const digits = phoneDigits(phone);
  if (!digits) return null;
  return text ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : `https://wa.me/${digits}`;
}

/** Google Maps pin at a position. */
export function mapsPoint(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** Google Maps directions to coordinates or, failing that, to an address. */
export function mapsDirections(to: { lat?: number | null; lng?: number | null; text?: string | null }): string | null {
  const destination = to.lat != null && to.lng != null ? `${to.lat},${to.lng}` : to.text?.trim();
  return destination ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}` : null;
}

export function contactLinks(phone: string | null | undefined): { call: string | null; whatsapp: string | null } {
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
