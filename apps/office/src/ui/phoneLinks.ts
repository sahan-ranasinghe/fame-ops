// The links an older answer carries (Live's `links`: call "tel:+94…", whatsapp "https://wa.me/94…") as the PhoneLinks
// ContactButtons takes (Hotfix 2, F). Pure.
import type { PhoneLinks } from "../data/types";
import { linksOf, phoneDisplay } from "./ContactButtons";

/** From a tel: link (and its WhatsApp link); null without a call link. */
export function linksFromCall(links: { call?: string | null; whatsapp?: string | null; phone?: string | null } | null | undefined): PhoneLinks | null {
  const call = links?.call?.trim();
  if (!call && !links?.phone) return null;
  const phone = (links?.phone || (call ?? "").replace(/^tel:/i, "")).trim();
  const base = linksOf(phone);
  return {
    phone: base?.phone ?? phone,
    phone_display: phoneDisplay(phone),
    call: call || base?.call || `tel:${phone}`,
    whatsapp: links?.whatsapp || base?.whatsapp || "",
  };
}
