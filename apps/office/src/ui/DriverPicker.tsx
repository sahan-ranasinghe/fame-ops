// The driver picker (Round 3; Uber Fleet's and Samsara's driver lists, the person first and the vehicle under them): the
// field shows the driver picked as the one-line driver card; a click opens the shared Sheet (ui/Sheet.tsx: a popover
// under the field on a desktop, a bottom sheet on a phone) with a search at the top (name, username or plate) and the
// driver cards (ui/DriverRow: the photo, the status, the vehicle chip, Free / Busy); a click on a card picks it and
// closes the sheet. Replaces the name-only driver selects. The rules: ui/driverPickerLogic.ts.
import { useRef, useState } from "react";
import { Pill } from "./basics";
import { DriverLine, DriverRow } from "./DriverRow";
import { vehicleChipWords } from "./driverRowLogic";
import { type DriverOption, filterOptions } from "./driverPickerLogic";
import { Icon } from "./icons";
import { EmptyLine, SearchBox } from "./ListKit";
import { Sheet } from "./Sheet";

export type { DriverOption } from "./driverPickerLogic";

export function DriverPicker({ id, value, options, onChange, emptyLabel, emptyChoice, loading, onTheDay, autoFocus, label = "Driver", hint }: {
  id: string;
  /** The driver shown as picked (a username); "" = none. */
  value: string;
  options: DriverOption[];
  onChange: (username: string) => void;
  /** The field's words while none is picked ("Choose a driver", "Keep (Kamal)"). */
  emptyLabel: string;
  /** A first row that goes back to none ("Keep the driver"); none = no such row. */
  emptyChoice?: string;
  loading?: boolean;
  /** The fleet setting vehicle_on_the_day: a driver with no vehicle known reads "Vehicle: on the day". */
  onTheDay?: boolean;
  autoFocus?: boolean;
  label?: string;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const field = useRef<HTMLButtonElement>(null);
  const picked = value ? options.find((o) => o.username === value) : undefined;
  const shown = filterOptions(options, text);
  const close = () => {
    setOpen(false);
    setText("");
  };
  const choose = (username: string) => {
    onChange(username);
    close();
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <button ref={field} id={id} type="button" className="dpick" aria-haspopup="dialog" aria-expanded={open} aria-describedby={`${id}-shown`}
        data-value={value} data-testid="driver-picker" autoFocus={autoFocus} onClick={() => (open ? close() : setOpen(true))}>
        {picked
          ? <span className="grow"><DriverLine name={picked.name} photo={picked.photo_url} vehicle={vehicleChipWords(picked.vehicle, { onTheDay })} testId="driver-picked" /></span>
          : <span className="grow dpick-empty">{loading ? "Loading…" : emptyLabel}</span>}
        <span id={`${id}-shown`} className="sr-only">{picked ? picked.name : loading ? "Loading" : emptyLabel}</span>
        <Icon name="down" />
      </button>
      {hint && <span className="hint">{hint}</span>}
      <Sheet open={open} onClose={close} title="Choose a driver" anchor={field} width={400} testId="driver-sheet">
        <SearchBox value={text} onChange={setText} label="Search drivers" placeholder="Name or plate" delay={0} />
        <div className="dpick-list" role="group" aria-label="Drivers">
          {emptyChoice && value && (
            <button type="button" className="btn" onClick={() => choose("")} data-testid="driver-none">{emptyChoice}</button>
          )}
          {shown.map((o) => (
            <DriverRow
              key={o.username}
              d={o}
              onPick={() => choose(o.username)}
              picked={o.username === value}
              vehicle={vehicleChipWords(o.vehicle, { onTheDay })}
              badge={o.fit ? <Pill tone={o.fit.free ? "ok" : "bad"}>{o.fit.text}</Pill> : undefined}
              testId="driver-option"
            />
          ))}
          {loading && options.length === 0 && <EmptyLine>Loading the drivers…</EmptyLine>}
          {!loading && shown.length === 0 && <EmptyLine>{text.trim() ? `No driver matches “${text.trim()}”.` : "No active drivers."}</EmptyLine>}
        </div>
      </Sheet>
    </div>
  );
}
