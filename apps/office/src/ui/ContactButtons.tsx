// Call and WhatsApp for a person (Hotfix 2, F): on a phone the dialler (tel:) and WhatsApp (wa.me), which the person
// taps; on a computer the number with Copy and WhatsApp web. Nothing dials by itself. Hidden when there is no number
// (the page offers Call office instead, where it says so).
import type { PhoneLinks } from "../data/types";
import { Icon } from "./icons";
import { useIsPhone } from "./phone";
import { useToast } from "./Toast";

/** "+94771234567" → "077 123 4567" (Sri Lankan mobiles and landlines); anything else as given. */
export function phoneDisplay(phone: string): string {
  const d = phone.replace(/[^0-9]/g, "");
  const local = d.startsWith("94") && d.length === 11 ? `0${d.slice(2)}` : d.length === 10 && d.startsWith("0") ? d : null;
  return local ? `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}` : phone;
}

/** The links of a bare number (when an answer carries only the E.164 number). */
export function linksOf(phone: string | null | undefined): PhoneLinks | null {
  if (!phone) return null;
  const d = phone.replace(/[^0-9]/g, "");
  const intl = d.startsWith("94") ? d : d.startsWith("0") ? `94${d.slice(1)}` : d;
  return { phone: `+${intl}`, phone_display: phoneDisplay(phone), call: `tel:+${intl}`, whatsapp: `https://wa.me/${intl}` };
}

export function ContactButtons({ phone, label = "Call", whatsapp = true, testId }: {
  phone: PhoneLinks | null | undefined;
  /** "Call driver", "Call the fleet admin", "Call office". */
  label?: string;
  whatsapp?: boolean;
  testId?: string;
}) {
  const isPhone = useIsPhone();
  const toast = useToast();
  if (!phone?.call) return null;
  if (isPhone) {
    return (
      <span className="acts contact-buttons" data-testid={testId}>
        <a className="btn small" href={phone.call}><Icon name="phone" />{label}</a>
        {whatsapp && phone.whatsapp && <a className="btn small" href={phone.whatsapp} target="_blank" rel="noreferrer"><Icon name="chat" />WhatsApp</a>}
      </span>
    );
  }
  const copy = () => {
    void navigator.clipboard?.writeText(phone.phone).then(() => toast("Number copied"), () => toast(phone.phone_display));
  };
  return (
    <span className="acts contact-buttons" data-testid={testId}>
      <span className="num" title={label}>{phone.phone_display}</span>
      <button type="button" className="btn small" onClick={copy}>Copy</button>
      {whatsapp && phone.whatsapp && (
        <a className="btn small" href={phone.whatsapp.replace("https://wa.me/", "https://web.whatsapp.com/send?phone=")} target="_blank" rel="noreferrer">
          <Icon name="chat" />WhatsApp
        </a>
      )}
    </span>
  );
}
