// Pieces the request pages share: the four vehicle groups and one vehicle as
// an option (the plate, what it is, how it stands, the custodian's links), the
// requester's timeline, and (Phase 7, §33) the card's head: who asked, or a
// proposed task's title with its driver and vehicle, and "Leave-by passed".
// Round 3: the asker's photo in the head, and who the request asked to drive (AskedWho).
// Round 3 Part A: the self-drive licence line (A5), the status pill with the Expired badge (A6), dates in words (A4).
import { Fragment } from "react";
import { Link } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { FieldChanges, Holder, RequestCard, SuggestedVehicle, Suggestions } from "../data/types";
import { addDays, cap, joinDots, requestTone, today } from "../lib/format";
import { datesInWords } from "../lib/when";
import { Avatar, Pill } from "../ui/basics";
import { ContactButtons, linksOf } from "../ui/ContactButtons";
import { DriverLine } from "../ui/DriverRow";
import { firstName } from "../ui/driverRowLogic";
import { Icon } from "../ui/icons";
import { HolderStrip } from "../ui/Holder";
import type { Wanted } from "../ui/holderLogic";
import { askedOf, selfDriveLicenceLine } from "../ui/whoDrivesLogic";
import { StatusBanner } from "../ui/patterns";
import { LATE_TEXT, proposalLine, changeLine } from "./approvalLogic";
import { againFields, diffLines, timelineSteps } from "./requestLogic";

export const GROUPS: [keyof NonNullable<Suggestions["groups"]>, string][] = [
  ["free_pool", "Free"],
  ["free_assigned", "Assigned to someone · ask first"],
  ["busy", "Busy"],
  ["in_garage", "In the garage"],
];

export function VehicleOption({ v, name, checked, disabled, onPick }: { v: SuggestedVehicle; name: string; checked: boolean; disabled?: boolean; onPick: () => void }) {
  const tone = v.pick === "no" ? "bad" : v.pick === "possible" ? "warn" : "";
  return (
    <label className="opt" style={disabled ? { opacity: 0.55 } : undefined}>
      <input type="radio" name={name} value={v.reg_no} checked={checked} disabled={disabled} onChange={onPick} />
      <span className="grow">
        <span className="plate">{v.reg_no}</span>
        <span className={`sub ${tone}`} style={{ display: "block", marginTop: 4 }}>{joinDots([v.make_model, v.seats ? `${v.seats} seats` : "", v.availability, v.but, v.back])}</span>
        {v.assigned_to && (
          <span className="sub" style={{ display: "block", marginTop: 4 }}>
            {joinDots([`Assigned to ${v.assigned_to}`, v.custodian_note, v.note])}
            {v.call && <> · <a href={v.call} onClick={(e) => e.stopPropagation()}>Call</a></>}
            {v.whatsapp && <> · <a href={v.whatsapp} target="_blank" rel="noopener" onClick={(e) => e.stopPropagation()}>WhatsApp</a></>}
          </span>
        )}
      </span>
    </label>
  );
}

/** The requester's timeline: sent → seen → approved → changed → decided again / cancelled (from the events). */
export function Timeline({ q }: { q: RequestCard }) {
  return (
    <ol className="rq-timeline" data-testid="request-timeline">
      {timelineSteps(q).map((s, i) => (
        <li key={`${s.label}-${i}`} className={s.done ? "done" : ""}>
          <i className={`dot ${s.done ? "ok" : "muted"}`} />
          <span>
            <b>{s.label}</b>
            {s.at ? <span className="sub" style={{ display: "block" }}>{datesInWords(s.at)}</span> : null}
            {s.lines?.length ? <span className="sub" style={{ display: "block" }}>{s.lines.join(" · ")}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

/** What changed, one line per field: "time Thu 15 Oct 09:00 → Thu 15 Oct 09:30". */
export function ChangesList({ changes, testId = "changes" }: { changes?: FieldChanges | null; testId?: string }) {
  const lines = diffLines(changes);
  if (lines.length === 0) return null;
  return (
    <ul className="changes" data-testid={testId}>
      {lines.map((l) => <li key={l}>{l}</li>)}
    </ul>
  );
}

/**
 * The groups of free vehicles as radio options, or the flat list when the tool gave no groups. Round 4–7 (7): a busy
 * vehicle's holder under its option ("Anoja's · 08:00–11:00" with Ask), never inside the radio's label.
 */
export function VehicleGroups({ sug, name, vehicle, onPick, greyGarage, wanted }: { sug: Suggestions; name: string; vehicle: string; onPick: (reg: string) => void; greyGarage?: boolean; wanted?: Wanted | null }) {
  if (!sug.groups) return <>{sug.vehicles.map((v) => <VehicleOption key={v.reg_no} v={v} name={name} checked={vehicle === v.reg_no} onPick={() => onPick(v.reg_no)} />)}</>;
  return (
    <>
      {GROUPS.map(([key, label]) => {
        const rows = sug.groups![key];
        if (rows.length === 0) return null;
        return (
          <div key={key} className="form" data-testid={`group-${key}`}>
            <div className="lab">{label}</div>
            {rows.map((v) => {
              const holder = key === "busy" ? (v as SuggestedVehicle & { holder?: Holder }).holder : undefined;
              return (
                <Fragment key={v.reg_no}>
                  <VehicleOption v={v} name={name} checked={vehicle === v.reg_no} disabled={greyGarage && key === "in_garage"} onPick={() => onPick(v.reg_no)} />
                  {holder && <HolderStrip holder={holder} resource="vehicle" what={v.reg_no} wanted={wanted} />}
                </Fragment>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

/**
 * The card's head: who asked (and for whom); a proposed task's title and "Task for Kamal · WP CAB-4521 · proposed by
 * Nimal" (the driver and the vehicle only to who may see them, §35 19); then the project and when it was asked.
 */
export function RequestHead({ q, proposal }: { q: RequestCard; proposal: boolean }) {
  return (
    <>
      {q.kind === "change"
        ? (
          <>
            {/* Round 48 (item 1): a change to an existing task, waiting for the fleet admin. */}
            <div className="name" style={{ fontSize: 19 }}><Pill tone="warn">Change</Pill> {q.title || q.change?.task_title || "Proposed change"}</div>
            <div className="sub" data-testid="proposal-line">{changeLine(q)}</div>
          </>
        )
        : q.kind === "task"
        ? (
          <>
            <div className="name" style={{ fontSize: 19 }}><Pill tone="live">Task</Pill> {q.title || "Proposed task"}</div>
            <div className="sub" data-testid="proposal-line">{proposal ? proposalLine(q) : `Proposed by ${q.requested_by}`}</div>
          </>
        )
        : (
          <div className="name person" style={{ fontSize: 19 }}>
            {/* Round 3: the asker's photo (the initials until there is one). */}
            <Avatar name={q.requested_by} src={q.requested_by_photo_url} small />
            <span>{q.requested_by}{q.on_behalf_of ? <span className="muted"> · for {q.on_behalf_of}</span> : null}</span>
          </div>
        )}
      <div className="sub">{joinDots([q.project, datesInWords(q.asked), q.one_step ? "booked directly by the office" : ""])}</div>
    </>
  );
}

/**
 * Round 4–7, item 12 (the approved mockup 3): the decide page's ONE status banner: "Waiting for your OK" (a changed booking:
 * "Changed · decide again"), when it leaves, and Call / WhatsApp the person who asked when their number is known.
 */
export function DecideBanner({ q }: { q: RequestCard }) {
  const leave = q.trip?.leave_by ?? q.fields?.time;
  const phone = linksOf(q.requester_phone);
  return (
    <StatusBanner tone="warn" icon="clock" testId="decide-banner"
      title={q.status === "changed" ? "Changed · decide again" : "Waiting for your OK"}
      line={leave ? `Leaves ${leave}${q.fields?.date ? ` · ${datesInWords(q.when)}` : ""}` : q.when}>
      {phone ? <span><ContactButtons phone={phone} label={`Call ${firstName(q.requested_by)}`} testId="requester-contact" /></span> : null}
    </StatusBanner>
  );
}

/** Waiting past its leave-by (§35 18): it stays in the queue and is never sent by itself. */
export function LateNotice({ approver }: { approver: boolean }) {
  return (
    <div className="notice bad" data-testid="late-notice" role="status">
      <p>
        <b>{LATE_TEXT}.</b>{" "}
        {approver ? "It is never sent by itself: send it with a later leave-by, or decline it." : "It is never sent by itself: the fleet admin decides it, or you withdraw it."}
      </p>
    </div>
  );
}

/**
 * Round 3: who the request asked to drive, when it is not a driver of ours: the driver card with the small word
 * ("Drives themselves": the asker; "Someone else": their name, with Call and WhatsApp on their own number), or "The
 * custodian drives" (the older path). Nothing for a driver.
 */
export function AskedWho({ q }: { q: RequestCard }) {
  const asked = askedOf(q);
  if (asked === "driver") return null;
  if (asked === "custodian") return <span data-testid="asked-who">The custodian drives</span>;
  const other = asked === "other";
  const name = other ? q.driver_name || "Someone else" : q.requested_by;
  const phone = other ? linksOf(q.driver_phone) : null;
  return (
    <span style={{ display: "grid", gap: 6 }} data-testid="asked-who">
      <DriverLine name={name} photo={other ? undefined : q.requested_by_photo_url} drivenBy={asked} testId="asked-who-line" />
      {phone && <ContactButtons phone={phone} label={`Call ${firstName(name)}`} testId="call-asked" />}
    </span>
  );
}

/** Round 3 (A6): an expired request's own badge (nobody decided it before its day was over): the hourglass and the word. */
export const ExpiredBadge = () => <span className="pill expired" data-testid="expired-badge"><Icon name="expired" />Expired</span>;

/**
 * A request's status as one pill, the same on every page: Waiting / Changed amber, Approved green, Declined red,
 * Cancelled grey, Expired its own badge with an icon (never colour alone).
 */
export function RequestStatusPill({ status }: { status?: RequestCard["status"] | string }) {
  if (status === "expired") return <ExpiredBadge />;
  return <Pill tone={requestTone(status)}>{cap(status || "waiting")}</Pill>;
}

/**
 * Round 3 (A5; Zipcar for Business / Enterprise CarShare: the member's licence on file): on a request the asker drives
 * themselves, whether their driving licence is on file on the trip's day. Amber for none or expired, a warning only: the
 * approver may still approve. `mine`: the page is the asker's own (a link to add it on My profile).
 */
export function SelfDriveLicence({ q, mine }: { q: Pick<RequestCard, "self_drive_licence">; mine?: boolean }) {
  const line = selfDriveLicenceLine(q.self_drive_licence);
  if (!line) return null;
  return (
    <p className={`licence-line ${line.tone}`} data-testid="self-drive-licence" data-state={q.self_drive_licence}>
      <Icon name="licence" />
      <span>{line.text}{mine && line.tone === "warn" ? <> · <Link to="/settings/profile">Add it on My profile</Link></> : null}</span>
    </p>
  );
}

/** What New request reads from the link's state: the fields of an expired request asked again (Round 3, A6). */
export interface AgainState {
  again: ReturnType<typeof againFields>;
  /** The expired request's route, for the line at the top of the form. */
  from?: string;
}

/**
 * Round 3 (A6): "Request again" on an expired request (its page and its My trips row; Uber's and Airbnb's "Book again"):
 * New request opens with everything copied but the day, which starts as tomorrow. For anyone who may ask for a vehicle.
 */
export function RequestAgain({ q, className = "btn" }: { q: RequestCard; className?: string }) {
  const { me } = useFleet();
  // A proposed task that expired is not a vehicle request: it is not copied into one (Checkpoint 3 review).
  if (q.status !== "expired" || q.kind === "task" || !me.tools.includes("create_request")) return null;
  const state: AgainState = { again: againFields(q, { tomorrow: addDays(today(), 1), me: me.name }), from: q.route };
  return <Link className={className} to="/requests/new" state={state} data-testid="request-again" onClick={(e) => e.stopPropagation()}>Request again</Link>;
}
