// Fleetio's service and documents per vehicle (Round 4–7, item 8, §33.7), shared by Maintenance and Reminders: the
// summary first ("2 services overdue · 1 document expired"), then one card per vehicle, the most urgent first: the plate
// and the model, the service due by km and by date with its bar, the documents as chips (ok / expiring / expired /
// missing; the rental's end). A card opens the vehicle's page. 25 cards at a time (Load more on a phone, page numbers on a
// desktop). The rules: vehicleCareLogic.ts.
import { Link } from "react-router";
import { dayWords } from "../lib/when";
import { Pill, Plate, VehicleThumb } from "../ui/basics";
import { Icon } from "../ui/icons";
import { EmptyLine, ListHeader, LoadMore, Pager, useLocalPagedList } from "../ui/ListKit";
import { type CareCounts, docTone, docWords, serviceTone, serviceWords, summaryText, type VehicleCare } from "./vehicleCareLogic";

const day = (d: string) => dayWords(d);

/** One vehicle: the service with its bar, the documents as chips. */
export function CareCard({ c }: { c: VehicleCare }) {
  const tone = serviceTone(c.service.state);
  return (
    <Link className="card care-card" to={`/vehicles/${encodeURIComponent(c.reg_no)}`} data-testid="care-card" data-level={c.level}>
      <div className="care-head">
        <VehicleThumb src={c.thumb_url} plate={c.reg_no} />
        <Plate v={c.reg_no} />
        <span className="grow sub clip">{c.make_model ?? ""}</span>
        {c.in_garage && <Pill tone="warn">In garage</Pill>}
      </div>
      <div className="care-service" data-testid="care-service">
        <div className="name" style={{ fontWeight: 500 }}>
          <Icon name="wrench" />
          <span>Service</span>
          <span className={tone === "bad" ? "bad-text" : tone === "warn" ? "warn-text" : "muted"}>
            {c.service.state === "not_set" ? "Not set" : serviceWords(c.service, day)}
          </span>
          {c.service.state === "overdue" && <Pill tone="bad">Overdue</Pill>}
          {c.service.state === "due_soon" && <Pill tone="warn">Due soon</Pill>}
        </div>
        {c.service.state !== "not_set" && (
          <div className={`bar ${tone}`} role="meter" aria-label="How near the service is" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(c.service.fill * 100)}>
            <i style={{ width: `${Math.round(c.service.fill * 100)}%` }} />
          </div>
        )}
        {c.service.garage && <span className="sub">Garage booked {dayWords(c.service.garage, { inline: true })}</span>}
      </div>
      <div className="doc-chips" data-testid="care-docs">
        {c.docs.map((d) => <span key={d.kind} className={`doc-chip ${docTone(d.state)}`} data-state={d.state}>{docWords(d, day)}</span>)}
      </div>
    </Link>
  );
}

/** The counts in one line above the cards. */
export function CareSummary({ counts }: { counts: CareCounts }) {
  return (
    <div className="care-summary" data-testid="care-summary">
      <b>{counts.attention ? `${counts.attention} of ${counts.vehicles} vehicles need attention` : `All ${counts.vehicles} vehicles in order`}</b>
      {counts.attention > 0 && <span className="sub">{summaryText(counts)}</span>}
    </div>
  );
}

/** The cards, 25 at a time, with the empty line when there is none. */
export function CareList({ title, cards, empty, resetKey, testId }: { title: string; cards: VehicleCare[]; empty: string; resetKey?: string; testId?: string }) {
  const list = useLocalPagedList(cards, { resetKey });
  return (
    <div className="stack" data-testid={testId}>
      <div className="card"><ListHeader title={title} count={cards.length} />{cards.length === 0 && <EmptyLine>{empty}</EmptyLine>}</div>
      {cards.length > 0 && <div className="care-cards">{list.items.map((c) => <CareCard key={c.reg_no} c={c} />)}</div>}
      {(list.hasMore || list.pages > 1) && <div className="card"><LoadMore list={list} /><Pager list={list} /></div>}
    </div>
  );
}
