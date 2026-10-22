// Round 4–7, feature 6 (phase8-plan.md §33.3): who rides on a trip (task_detail's or a request card's passengers_list).
// A registered office person is a row with their photo (they get the trip's news in the app and see it in My trips);
// someone without an account is a row with their number, Call / WhatsApp, and "Share trip" (the trip in words on WhatsApp,
// task_detail's `share`; nothing is sent until they press Send in WhatsApp). The pages pass the list only while the switch
// passengers is on (the task page, a request: off = the count alone; the server stops sending the names too).
import type { Passenger, PhoneLinks } from "../data/types";
import { Avatar } from "../ui/basics";
import { ContactButtons } from "../ui/ContactButtons";
import { Icon } from "../ui/icons";
import { passengerRow } from "./passengersLogic";

/** A typed passenger's number with its links, as ContactButtons takes them (none without a call link). */
const linksOf = (p: Passenger): PhoneLinks | null =>
  p.call ? { phone: p.phone ?? "", phone_display: p.phone_display ?? p.phone ?? "", call: p.call, whatsapp: p.whatsapp ?? "" } : null;

export function PassengerList({ list }: { list: Passenger[] }) {
  if (!list.length) return null;
  return (
    <div data-testid="passenger-list">
      {list.map((p, i) => {
        const row = passengerRow(p);
        return (
          <div className="prow" key={`${p.employee_id ?? p.name}-${i}`} data-testid="passenger-row" data-registered={row.registered ? "yes" : "no"}>
            <Avatar small name={p.name} src={p.photo_url} />
            <span className="grow">
              <b>{p.name}</b>
              <div className="sub">{row.registered ? "Has the app · told about the trip" : row.call ? "No account" : "No account · no number"}</div>
            </span>
            {!row.registered && <ContactButtons phone={linksOf(p)} label="Call" testId="call-passenger" />}
            {!row.registered && row.share && (
              <a className="btn small" href={row.share} target="_blank" rel="noopener" data-testid="share-trip"><Icon name="chat" />Share trip</a>
            )}
          </div>
        );
      })}
    </div>
  );
}
