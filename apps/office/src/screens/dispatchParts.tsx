// Pieces the dispatch forms share (Phase 7, Part 2): the fleet settings and
// the plan preview as queries, the driver-first pick with the vehicle that
// fills itself, the departure check beside the fields, and Start from with
// "Passengers get in here".
import type { ReactNode } from "react";
import { useFleet } from "../app/FleetContext";
import type { PlanPreview, SettingsResult, Vehicle } from "../data/types";
import { type Query, useQuery } from "../data/useQuery";
import { DriverPicker, type DriverOption } from "../ui/DriverPicker";
import { LocationSearch } from "../ui/LocationSearch";
import type { Picked } from "../ui/locationLogic";
import type { DefaultVehicle } from "./availabilityLogic";
import { type DepartureCheck, usedLeave } from "./departureLogic";
import { DwellPicker } from "./DwellPicker";
import { type StartFields, WHAT_LABEL } from "./stopsLogic";
import { type FeatureKey, featureOn, switchesOff } from "./switchLogic";
import { ANY_TYPES, anyValue, isChoice, ON_THE_DAY, ON_THE_DAY_LABEL } from "./vehicleChoiceLogic";

/** The plan preview is computed this long after the last edit (no Plan now since 21 October 2026): every call may count against a daily cap. */
export const PLAN_DEBOUNCE_MS = 1500;

/** get_settings, once per page (the base place, the times at stops by type, self-drive). */
export function useFleetSettings(): Query<SettingsResult> {
  const { me } = useFleet();
  return useQuery<SettingsResult>("settings", "get_settings", {}, { enabled: me.tools.includes("get_settings"), onWrite: false });
}

/**
 * A feature switch as a page follows it (Round 4–7; screens/switchLogic.ts): `on` unless saved off; `settled` once
 * get_settings has answered (or failed, or the person may not call it: on, as absent). A poll waits for `settled`, so a
 * switched-off feature never asks.
 */
export function useSwitch(key: FeatureKey): { on: boolean; settled: boolean } {
  const { me } = useFleet();
  const s = useFleetSettings();
  return { on: featureOn(s.data?.settings, key), settled: !me.tools.includes("get_settings") || s.data !== undefined || s.err !== undefined };
}

/** The switches saved off (the menus hide the pages they turn off). */
export function useSwitchesOff(): FeatureKey[] {
  return switchesOff(useFleetSettings().data?.settings);
}

/** Hotfix 2 (J): the fleet setting vehicle_on_the_day (off until every driver's phone has the update; absent = off). */
export const vehicleOnTheDay = (s: SettingsResult | undefined): boolean => s?.settings.vehicle_on_the_day === true;

/**
 * plan_task for the form as it stands, 1.5 s after the last edit; the plan shown stays while the next one comes. The web
 * asks for each leg's Google road line too (with_line, for the plan map on Google's map: §20); the artifact has no such map.
 */
export function usePlanPreview(input: Record<string, unknown> | null): Query<PlanPreview> {
  const { me } = useFleet();
  const args = input && __BUILD__ === "web" ? { ...input, with_line: true } : input;
  return useQuery<PlanPreview>("plan", "plan_task", args, { debounce: PLAN_DEBOUNCE_MS, keep: true, enabled: me.tools.includes("plan_task"), onWrite: false });
}

/** The base place as Start from's default: its name and id (null until the settings answer, or when none is set). */
export function basePlace(s: SettingsResult | undefined): { id: string; name: string } | null {
  return s?.base_place ? { id: s.base_place.id, name: s.base_place.name } : null;
}

/**
 * The driver field, first on the form (Round 3: the driver picker, ui/DriverPicker: the driver-first cards with a search,
 * a popover on a desktop, a sheet on a phone; it replaced the name-only select).
 */
export function DriverSelect({ id, value, drivers, onChange, emptyLabel, emptyChoice, autoFocus, loading, onTheDay }: {
  id: string;
  value: string;
  /** ui/driverPickerLogic.driverOptions: Who's available's rows, the driver list, the free drivers. */
  drivers: DriverOption[];
  onChange: (username: string) => void;
  emptyLabel: string;
  /** A row that goes back to none ("Keep the driver"). */
  emptyChoice?: string;
  autoFocus?: boolean;
  loading?: boolean;
  /** The fleet setting vehicle_on_the_day (the chip of a driver with no vehicle known). */
  onTheDay?: boolean;
}) {
  return <DriverPicker id={id} value={value} options={drivers} onChange={onChange} emptyLabel={emptyLabel} emptyChoice={emptyChoice} autoFocus={autoFocus} loading={loading} onTheDay={onTheDay} />;
}

/**
 * The vehicle select after the driver: empty = the driver's vehicle ("WP CAB-4521 · Kamal's vehicle today"),
 * or "Pick a vehicle" when the driver brings none. Picking one is a choice no refresh overwrites.
 */
export function VehicleSelect({ id, value, def, vehicles, onChange, emptyLabel = "Pick a vehicle", hint, choices, dayDefault, forTrip }: {
  id: string;
  /** The vehicle chosen; "" = the default. */
  value: string;
  def: DefaultVehicle | null;
  vehicles: Pick<Vehicle, "reg_no" | "make_model" | "status">[];
  onChange: (reg: string) => void;
  emptyLabel?: string;
  hint?: ReactNode;
  /** Hotfix 2 (J, vehicle_on_the_day on): "Driver's vehicle on the day" and "Any <type>" besides the plates. */
  choices?: boolean;
  /** The default is the driver's vehicle on the day (a later day, or a driver who brings none today). */
  dayDefault?: boolean;
  /**
   * Round 48 (Google Calendar's room picker): each plate's availability for the TRIP's window ("Free Thu 29 Oct", "Busy
   * 09:00–13:00 that day · Team drop", "In the garage now · …"), shown instead of the vehicle's status now when known.
   */
  forTrip?: Map<string, string>;
}) {
  const first = dayDefault ? ON_THE_DAY_LABEL : def ? `${def.reg_no} · ${def.why}` : emptyLabel;
  const words = (v: Pick<Vehicle, "reg_no" | "status">) => forTrip?.get(v.reg_no) ?? v.status;
  return (
    <div className="field">
      <label htmlFor={id}>Vehicle</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{first}</option>
        {choices && !dayDefault && <option value={ON_THE_DAY}>{ON_THE_DAY_LABEL}</option>}
        {choices && ANY_TYPES.map(([type, label]) => <option key={type} value={anyValue(type)}>{label}</option>)}
        {vehicles.map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}{v.make_model ? ` · ${v.make_model}` : ""}{words(v) ? ` · ${words(v)}` : ""}</option>)}
      </select>
      {value && dayDefault && value !== ON_THE_DAY
        ? <span className="hint" data-testid="vehicle-changed">Instead of the driver's vehicle on the day. <button type="button" className="linkish" onClick={() => onChange("")}>Leave it to the day</button></span>
        : value && !dayDefault && def && value !== def.reg_no
        ? <span className="hint" data-testid="vehicle-changed">Instead of {def.why} {def.reg_no}. <button type="button" className="linkish" onClick={() => onChange("")}>Use {def.reg_no}</button></span>
        : hint ? <span className="hint">{hint}</span>
        : dayDefault && !value ? <span className="hint" data-testid="vehicle-day-default">The driver confirms the vehicle they hold at Start task.</span>
        : isChoice(value) ? <span className="hint">The driver picks one at Start task.</span> : null}
    </div>
  );
}

/**
 * Hotfix 2 (J, vehicle_on_the_day on): the decide page's and Book now's vehicle radios get "Driver's vehicle on the day"
 * and "Any <type>" before the vehicles by plate.
 */
export function VehicleChoiceRadios({ name, value, onPick, dayDefault }: { name: string; value: string; onPick: (v: string) => void; dayDefault?: boolean }) {
  return (
    <div className="form" data-testid="vehicle-choices">
      <label className="opt">
        <input type="radio" name={name} value={ON_THE_DAY} checked={value === ON_THE_DAY} onChange={() => onPick(dayDefault ? "" : ON_THE_DAY)} />
        <span className="grow">{ON_THE_DAY_LABEL}<span className="sub" style={{ display: "block", marginTop: 4 }}>The driver confirms the vehicle they hold at Start task.</span></span>
      </label>
      {ANY_TYPES.map(([type, label]) => (
        <label className="opt" key={type}>
          <input type="radio" name={name} value={anyValue(type)} checked={value === anyValue(type)} onChange={() => onPick(anyValue(type))} />
          <span className="grow">{label}<span className="sub" style={{ display: "block", marginTop: 4 }}>The driver picks one at Start task.</span></span>
        </label>
      ))}
    </div>
  );
}

/**
 * The departure check beside a field: red or amber with Use 07:24 (and Move arrive-by), or "Arrives 25 min early"; for a
 * late return (§20) Use 07:40 and, second, Move back by to 18:20 (`onMoveBack`, where the form holds the back-by; its
 * field's name in `backLabel`).
 */
export function DepartureNote({ check, onUse, onMove, onMoveBack, backLabel = "back by", testId = "departure-check" }: {
  check: DepartureCheck | null;
  onUse?: (time: string) => void;
  /** Moves the late stop's arrive-by (where the form holds it). */
  onMove?: (n: number, time: string) => void;
  /** Moves the form's back-by (or end) time. */
  onMoveBack?: (time: string) => void;
  backLabel?: string;
  testId?: string;
}) {
  if (!check || check.kind === "fill") return null;
  if (check.kind === "early") return <span className="hint" data-testid={testId}>{check.text}</span>;
  const buttons = !!(onUse || (onMove && check.moveTo) || (onMoveBack && check.moveBackTo));
  return (
    <div className="field" data-testid={testId} role="status" style={{ gap: 6 }}>
      <span style={{ color: check.tone === "bad" ? "var(--bad)" : "var(--warn)", fontWeight: 600, fontSize: 14 }}>{check.text}</span>
      {buttons && (
        <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {onUse && <button type="button" className="btn small" onClick={() => onUse(usedLeave(check))}>Use {check.leaveBy}</button>}
          {onMove && check.moveTo && <button type="button" className="btn small" onClick={() => onMove(check.n, check.moveTo!)}>Move arrive-by to {check.moveTo}</button>}
          {onMoveBack && check.moveBackTo && <button type="button" className="btn small" onClick={() => onMoveBack(check.moveBackTo!)}>Move {backLabel} to {check.moveBackTo}</button>}
        </span>
      )}
    </div>
  );
}

/**
 * Start from: the location search box, the base place while it is empty (Settings → Fleet; the server takes the
 * same), and "Passengers get in here": the start becomes Stop 1, a pickup, and the next stop is Stop 2.
 */
export function StartFrom({ id, value, base, onChange, google = true, stay, note }: {
  id: string;
  value: StartFields;
  /** The base place: the default while nothing else is typed or picked. */
  base: { id: string; name: string } | null;
  onChange: (patch: Partial<StartFields>) => void;
  google?: boolean;
  /** The start stop's time there, from the plan ("5 min · usual here"). */
  stay?: string;
  note?: ReactNode;
}) {
  const empty = !value.start.trim() && !value.startPlaceId && !value.startGooglePlaceId;
  const name = empty ? base?.name ?? "" : value.start.trim();
  return (
    <div className="field" data-testid="start-from">
      <label htmlFor={id}>Start from</label>
      <LocationSearch id={id} value={value.start} placeholder={base ? `${base.name} · the base place` : "The base place (Settings → Fleet)"} google={google}
        onText={(text) => onChange({ start: text, startPlaceId: undefined, startGooglePlaceId: undefined, startLat: undefined, startLng: undefined })}
        onPick={(p: Picked) => onChange({ start: p.name, startPlaceId: p.placeId, startGooglePlaceId: p.googlePlaceId, startLat: p.lat, startLng: p.lng })} />
      <span className="check">
        <input type="checkbox" id={`${id}-pax`} checked={value.startPax} onChange={(e) => onChange({ startPax: e.target.checked })} />{" "}
        <label htmlFor={`${id}-pax`}>Passengers get in here</label>
      </span>
      {value.startPax
        ? (
          <>
            <span className="hint" data-testid="start-stop">Stop 1 · Pickup · {name || "the start"} · {stay ?? "the place’s usual time there"}. The next stop is Stop 2.</span>
            {/* The start stop's own fields (Tick it moves them here from the pickup). */}
            <div className="grid2">
              <div className="field">
                <label htmlFor={`${id}-what`}>What gets in</label>
                <select id={`${id}-what`} value={value.startWhat ?? ""} onChange={(e) => onChange({ startWhat: e.target.value as StartFields["startWhat"] })}>
                  <option value="">People</option>
                  {Object.entries(WHAT_LABEL).filter(([k]) => k !== "people").map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${id}-note`}>Note at the start</label>
                <input id={`${id}-note`} maxLength={300} value={value.startNote ?? ""} onChange={(e) => onChange({ startNote: e.target.value })} />
              </div>
            </div>
            <DwellPicker id={`${id}-dwell`} value={value.startDwell ?? ""} fallback={null} onChange={(text) => onChange({ startDwell: text })} />
          </>
        )
        : note ? <span className="hint">{note}</span> : null}
    </div>
  );
}

/** Where the start is, for the same-as-start check: the picked place or pin, else the base place. */
export function startPoint(f: StartFields, base: { id: string; name: string } | null): { placeId?: string; lat?: number; lng?: number } | null {
  if (f.startPlaceId || f.startLat !== undefined) return { placeId: f.startPlaceId, lat: f.startLat, lng: f.startLng };
  if (!f.start.trim() && !f.startGooglePlaceId && base) return { placeId: base.id };
  return null;
}
