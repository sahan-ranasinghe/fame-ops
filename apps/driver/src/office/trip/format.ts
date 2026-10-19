// Office mode (Phase 8, O2): the few helpers the copied trip logic takes from the site's lib/format.ts and
// availabilityLogic.ts (apps/office/src at main 03d3538).

export type { Tone } from '../ui';

/** A WhatsApp link for a Sri Lankan number (0771234567 → wa.me/94771234567), with a text when given. */
export function waLink(phone?: string | null, text?: string): string {
  let d = String(phone || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('0')) d = '94' + d.slice(1);
  return 'https://wa.me/' + d + (text ? '?text=' + encodeURIComponent(text) : '');
}

/** The vehicle a driver would take (availability): the plate and why ("Kamal's today", "regular"). */
export interface DefaultVehicle {
  reg_no: string;
  why: string;
}
