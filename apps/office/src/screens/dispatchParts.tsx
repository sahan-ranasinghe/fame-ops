// Pieces the dispatch forms share (Phase 7, Part 2): the fleet settings and
// the plan preview as queries, the driver-first pick with the vehicle that
// fills itself, the departure check beside the fields, and Start from with
// "Passengers get in here".
import type { ReactNode } from "react";
import { useFleet } from "../app/FleetContext";
import type { Driver, PlanPreview, SettingsResult, Vehicle } from "../data/types";
import { type Query, useQuery } from "../data/useQuery";
import { LocationSearch } from "../ui/LocationSearch";
import type { Picked } from "../ui/locationLogic";
import type { DefaultVehicle } from "./availabilityLogic";
import type { DepartureCheck } from "./departureLogic";
import { DwellPicker } from "./DwellPicker";
import { type StartFields, WHAT_LABEL } from "./stopsLogic";

/** The plan preview is computed this long after the last edit (or at once with Plan now): every call may count against a daily cap. */
export const PLAN_DEBOUNCE_MS = 1500;

/** get_settings, once per page (the base place, the times at stops by type, self-drive). */
export function useFleetSettings(): Query<SettingsResult> {
  const { me } = useFleet();
  return useQuery<SettingsResult>("settings", "get_settings", {}, { enabled: me.tools.includes("get_settings"), onWrite: false });
}

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

/** The driver select, first on the form. */
export function DriverSelect({ id, value, drivers, onChange, emptyLabel, autoFocus, loading }: {
  id: string;
  value: string;
  drivers: Pick<Driver, "username" | "name">[];
  onChange: (username: string) => void;
  emptyLabel: string;
  autoFocus?: boolean;
  loading?: boolean;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Driver</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} autoFocus={autoFocus}>
        <option value="">{loading ? "Loading…" : emptyLabel}</option>
        {drivers.map((d) => <option key={d.username} value={d.username}>{d.name}</option>)}
      </select>
    </div>
  );
}

/**
 * The vehicle select after the driver: empty = the driver's vehicle ("WP CAB-4521 · Kamal's vehicle today"),
 * or "Pick a vehicle" when the driver brings none. Picking one is a choice no refresh overwrites.
 */
export function VehicleSelect({ id, value, def, vehicles, onChange, emptyLabel = "Pick a vehicle", hint }: {
  id: string;
  /** The vehicle chosen; "" = the default. */
  value: string;
  def: DefaultVehicle | null;
  vehicles: Pick<Vehicle, "reg_no" | "make_model" | "status">[];
  onChange: (reg: string) => void;
  emptyLabel?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="field">
      <label htmlFor={id}>Vehicle</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{def ? `${def.reg_no} · ${def.why}` : emptyLabel}</option>
        {vehicles.map((v) => <option key={v.reg_no} value={v.reg_no}>{v.reg_no}{v.make_model ? ` · ${v.make_model}` : ""}{v.status ? ` · ${v.status}` : ""}</option>)}
      </select>
      {value && def && value !== def.reg_no
        ? <span className="hint" data-testid="vehicle-changed">Instead of {def.why} {def.reg_no}. <button type="button" className="linkish" onClick={() => onChange("")}>Use {def.reg_no}</button></span>
        : hint ? <span className="hint">{hint}</span> : null}
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
          {onUse && <button type="button" className="btn small" onClick={() => onUse(check.leaveBy)}>Use {check.leaveBy}</button>}
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
