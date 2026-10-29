// Part 3b (H2): ONE driver row everywhere a driver is listed for dispatch: Who's available, the Drivers board (and the same
// words on Live). The photo (or the initials), the name, the status now as a chip (on a task blue, on duty green, off duty
// grey, not available amber), the window's "Not available · …" when there is one, "Last seen 17:42 near Kadawatha ·
// usually starts 07:40", "Next: Team drop · 14:30", then Call and WhatsApp (nothing without a number).
//
// The row's main part is a toggle button when the page picks a driver with it (Who's available), with the shared radio
// mark in front and the tint and the 2 px border when picked (ui/Select.tsx); the tick box, the
// right-hand slot (Choose, Assign, New task) and Call / WhatsApp sit beside it, never inside the button. Compact on a
// phone (the CSS: a smaller photo, Call under the text).
// Round 3 (the driver-first card of Uber Fleet's and Samsara's driver lists): the vehicle as a chip under the name (the
// plate, "regular", "Vehicle: on the day" or "No vehicle yet"), and on a trip with no app a small word in the duty
// state's place ("Drives themselves", "Someone else"). DriverLine is the same card on one line, spans only, for a place
// that is itself a button or a table cell (a board card, a task's header, a request's driver).
import type { ReactNode } from "react";
import type { DrivenBy, PhoneLinks } from "../data/types";
import { Avatar, Pill } from "./basics";
import { SelectMark } from "./Select";
import { ContactButtons } from "./ContactButtons";
import { type DriverRowInfo, drivenByWord, factsLine, firstName, nextLine, nowTone, type VehicleChipWords } from "./driverRowLogic";

export type { DriverRowInfo, VehicleChipWords } from "./driverRowLogic";

/** The vehicle chip: the plate in mono (with "regular" beside it), or the words in grey when there is no plate. */
export function VehicleChip({ chip, testId = "vehicle-chip" }: { chip: VehicleChipWords; testId?: string }) {
  return chip.plate
    ? <span className="vchip" data-testid={testId}><span className="plate">{chip.plate}</span>{chip.note ? <> <span className="vchip-note">{chip.note}</span></> : null}</span>
    : <span className="vchip none" data-testid={testId}>{chip.text}</span>;
}

/**
 * The driver card on one line: the photo (initials until there is one), the name, then the small word of a trip with no
 * app ("Drives themselves", "Someone else") or the status, and the vehicle chip. Spans only.
 */
export function DriverLine({ name, photo, drivenBy, selfDrive = false, status, vehicle, extra, testId = "driver-line" }: {
  name?: string | null;
  photo?: string | null;
  drivenBy?: Exclude<DrivenBy, "driver">;
  /** Round 50 (§37.3): a self trip driven with the app or on the web: "Self-drive" instead of "Drives themselves". */
  selfDrive?: boolean;
  /** The status in a word when the place has one (On duty, On a task). */
  status?: ReactNode;
  vehicle?: VehicleChipWords | null;
  /** After the chip (a vehicle's thumbnail). */
  extra?: ReactNode;
  testId?: string;
}) {
  const word = drivenByWord(drivenBy, selfDrive);
  return (
    <span className="dline" data-testid={testId}>
      <Avatar name={name} src={drivenBy === "other" ? undefined : photo} small />
      <span className="dline-text">
        <span className="name">{name || "—"}</span>
        {(word || status || vehicle) && (
          <span className="dline-facts">
            {word ? <span className="pill muted" data-testid="driven-by">{word}</span> : status}
            {extra}
            {vehicle && <VehicleChip chip={vehicle} />}
          </span>
        )}
      </span>
    </span>
  );
}

export interface DriverRowTick {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** "Ask Kamal Perera" */
  label: string;
}

export function DriverRow({
  d,
  phone,
  onPick,
  picked,
  rank,
  nameExtra,
  badge,
  tick,
  right,
  children,
  testId = "driver-row",
  contactTestId = "driver-row-contact",
  contactLabel,
  className,
  vehicle,
  drivenBy,
}: {
  d: DriverRowInfo;
  /** Call and WhatsApp; nothing is shown without a call link. */
  phone?: PhoneLinks | null;
  /** The main part becomes a toggle button that picks this driver. */
  onPick?: () => void;
  picked?: boolean;
  /** The place in the best-match order (1 = best). */
  rank?: number;
  /** After the name (the licence chip). */
  nameExtra?: ReactNode;
  /** At the right end of the main part (Free / Busy). */
  badge?: ReactNode;
  /** A tick box before the row (Ask drivers). */
  tick?: DriverRowTick;
  /** Outside the main part, on the right (Choose, Assign, New task). */
  right?: ReactNode;
  /** More lines under the row's own (the window's line, the vehicle). */
  children?: ReactNode;
  testId?: string;
  contactTestId?: string;
  /** "Call Kamal" by default. */
  contactLabel?: string;
  className?: string;
  /** Round 3: the vehicle chip under the name (driverRowLogic.vehicleChipWords); none = no chip. */
  vehicle?: VehicleChipWords | null;
  /** Round 3: a trip with no app: the small word in the status chip's place. */
  drivenBy?: Exclude<DrivenBy, "driver">;
}) {
  const facts = factsLine(d);
  const next = nextLine(d);
  const word = drivenByWord(drivenBy);
  const status = word ? undefined : d.now_status;
  const main = (
    <>
      {/* Hotfix O2-H2 Part 3: a row that picks a driver has the radio in front (empty / with its dot), never colour alone. */}
      {onPick && <SelectMark kind="radio" on={!!picked} />}
      <Avatar name={d.name} src={d.photo_url} small />
      {rank != null && <span className="num drow-rank" aria-label={`Best match number ${rank}`}>{rank}</span>}
      <span className="grow drow-text">
        <span className="name">{d.name}{nameExtra ? <> {nameExtra}</> : null}</span>
        {(status || word || d.not_available || vehicle) && (
          <span className="drow-status" data-testid="drow-status">
            {word && <Pill tone="muted">{word}</Pill>}
            {status && <Pill tone={nowTone(status.kind)}>{status.text}</Pill>}
            {vehicle && <VehicleChip chip={vehicle} />}
            {d.not_available && <span className="status warn" data-testid="drow-not-available">{d.not_available}</span>}
          </span>
        )}
        {facts && <span className="sub drow-line" data-testid="drow-facts">{facts}</span>}
        {next && <span className="sub drow-line" data-testid="drow-next">{next}</span>}
        {children}
      </span>
      {badge}
    </>
  );
  return (
    <div className={`drow${tick ? " has-tick" : ""}${picked ? " picked" : ""}${className ? ` ${className}` : ""}`} data-username={d.username ?? undefined}>
      {tick && (
        <span className="drow-tick">
          <input type="checkbox" checked={tick.checked} aria-label={tick.label} onChange={(e) => tick.onChange(e.target.checked)} />
        </span>
      )}
      {onPick
        ? (
          <button type="button" className={`drow-main pick${picked ? " picked" : ""}`} aria-pressed={!!picked} onClick={onPick} data-testid={testId}>
            {main}
          </button>
        )
        : <div className={`drow-main${picked ? " picked" : ""}`} data-testid={testId}>{main}</div>}
      {right && <div className="drow-right">{right}</div>}
      {phone?.call && (
        <div className="drow-contact" data-testid={contactTestId}>
          <ContactButtons phone={phone} label={contactLabel ?? `Call ${firstName(d.name)}`} />
        </div>
      )}
    </div>
  );
}
