// "Who drives?" (Round 3; the rental and car-sharing booking forms' "Who's driving?", e.g. Turo, Enterprise): ONE
// question on every request, booking and assign form. Three chips (A driver · I'll drive myself · Someone else), the
// shared ChoiceChip (ui/Select.tsx: the check before the words when picked), and under Someone else their name and phone.
// Hidden when the fleet setting self_drive_allowed is off (every trip then needs a driver: the parent sends nothing).
// The rules and the words: ui/whoDrivesLogic.ts.
import { ChoiceChip } from "./Select";
import { type DrivenBy, SELF_WORDS, whoChoices, type WhoDrivesValue, whoHint } from "./whoDrivesLogic";

export function WhoDrives({ id, value, onChange, selfWords = SELF_WORDS, picksVehicle, hidden }: {
  /** The prefix of the fields' ids ("nr", "af"). */
  id: string;
  value: WhoDrivesValue;
  onChange: (v: WhoDrivesValue) => void;
  /** "I'll drive myself", or "Nimal drives" on someone else's request (whoDrivesLogic.selfLabel). */
  selfWords?: string;
  /** The form picks a vehicle (Assign a task, Book now): the hint says to pick it. */
  picksVehicle?: boolean;
  /** self_drive_allowed is off: nothing is shown. */
  hidden?: boolean;
}) {
  if (hidden) return null;
  const pick = (by: DrivenBy) => onChange({ ...value, by });
  const hint = whoHint(value.by, { picksVehicle, selfWords });
  return (
    <div className="field who-drives" data-testid="who-drives">
      <span className="lab" id={`${id}-who`}>Who drives?</span>
      <div className="chips" role="group" aria-labelledby={`${id}-who`}>
        {whoChoices(selfWords).map(([by, words]) => (
          <ChoiceChip key={by} selected={value.by === by} onClick={() => pick(by)} testId={`who-${by}`}>{words}</ChoiceChip>
        ))}
      </div>
      {value.by === "other" && (
        <div className="grid2" data-testid="who-other">
          <div className="field">
            <label htmlFor={`${id}-who-name`}>Their name</label>
            <input id={`${id}-who-name`} maxLength={120} autoComplete="off" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor={`${id}-who-phone`}>Their phone</label>
            <input id={`${id}-who-phone`} maxLength={30} inputMode="tel" autoComplete="off" placeholder="077 123 4567" value={value.phone}
              onChange={(e) => onChange({ ...value, phone: e.target.value })} />
          </div>
        </div>
      )}
      {hint && <span className="hint" data-testid="who-hint">{hint}</span>}
    </div>
  );
}
