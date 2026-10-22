// Round 4–7, feature 6 (phase8-plan.md §33.3): who rides, by name, in the trip forms (New request and Book now, Assign a
// task, Edit request, Change the task). Google Calendar's guests: a search box over the office people (find_people: the
// photo, the name, the role as a label), the picked people as chips with their photo and ✕, and "Add someone without an
// account" (a name and an optional Sri Lankan phone: they can be sent the trip on WhatsApp). The passenger count stays a
// field of its own; under the chips the two together ("Asha, Kamal +3"). The rules: screens/passengersLogic.ts.
import { type KeyboardEvent, useId, useState } from "react";
import type { FoundPeople } from "../data/types";
import { useQuery } from "../data/useQuery";
import { PHONE_BAD } from "../lib/phones";
import { addRider, MAX_PASSENGERS, removeRider, type Rider, riderKey, ridersLine, typedRider } from "../screens/passengersLogic";
import { errText } from "../transport/errors";
import { Avatar } from "./basics";
import { phoneDisplay } from "./ContactButtons";

/** How long typing settles before find_people is asked. */
const SEARCH_DEBOUNCE_MS = 300;

export function PassengersField({ id, value, onChange, count }: {
  id: string;
  value: Rider[];
  onChange: (riders: Rider[]) => void;
  /** The passenger count as typed beside it (for "Asha, Kamal +3"). */
  count?: string;
}) {
  const listId = useId();
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState<{ name: string; phone: string; err: string | null } | null>(null);
  const want = text.trim();
  const q = useQuery<FoundPeople>("people", "find_people", want ? { text: want } : null, { debounce: SEARCH_DEBOUNCE_MS, keep: true, onWrite: false });
  const full = value.length >= MAX_PASSENGERS;
  const picked = new Set(value.map(riderKey));
  const people = (q.data?.people ?? []);
  const showList = open && !!want;
  const busy = q.loading || q.updating;
  const n = parseInt((count ?? "").trim(), 10);
  const line = ridersLine(value.map((r) => r.name), Number.isFinite(n) ? n : null);

  const pick = (p: FoundPeople["people"][number]) => {
    onChange(addRider(value, { person: p.id, name: p.name, label: p.label, ...(p.photo_url ? { photo_url: p.photo_url } : {}) }));
    setText("");
  };
  const addTyped = () => {
    if (!typed) return;
    const r = typedRider(typed.name, typed.phone);
    if ("error" in r) {
      setTyped({ ...typed, err: r.error === "name" ? "Type the name." : PHONE_BAD });
      return;
    }
    onChange(addRider(value, r.rider));
    setTyped(null);
  };
  // Enter inside the field never sends the page's form: it picks the first person, or adds the typed one.
  const onSearchKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const first = people.find((p) => !picked.has(`p:${p.id}`));
      if (first && showList) pick(first);
    } else if (e.key === "Escape") {
      setText("");
      setOpen(false);
    }
  };
  const onTypedKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTyped();
    }
  };

  return (
    <div className="field" data-testid="passengers-field">
      <span className="lab" id={`${id}-who-lab`}>Who rides <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></span>
      {value.length > 0 && (
        <ul className="pchips" aria-labelledby={`${id}-who-lab`} data-testid="passenger-chips">
          {value.map((r) => (
            <li className="pchip" key={riderKey(r)} data-testid="passenger-chip">
              <Avatar small name={r.name} src={r.photo_url} />
              <span className="pchip-name">{r.name}{!r.person && r.phone ? <span className="sub mono"> {phoneDisplay(r.phone)}</span> : null}</span>
              <button type="button" className="pchip-x" aria-label={`Remove ${r.name}`} onClick={() => onChange(removeRider(value, riderKey(r)))}>✕</button>
            </li>
          ))}
        </ul>
      )}
      {!full && (
        <div className="ls">
          <input
            id={`${id}-people`}
            role="combobox"
            aria-label="Search people by name"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            autoComplete="off"
            maxLength={80}
            placeholder="Search office people by name"
            value={text}
            onChange={(e) => { setText(e.target.value); setOpen(true); }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={onSearchKey}
          />
          {showList && (
            <ul className="ls-list" id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()} data-testid="people-results">
              {people.map((p) => {
                const on = picked.has(`p:${p.id}`);
                return (
                  <li key={p.id} role="option" aria-selected={on} aria-disabled={on} className="ls-row" onClick={() => { if (!on) pick(p); }} data-testid="people-row">
                    <Avatar small name={p.name} src={p.photo_url} />
                    <div className="ls-main"><b>{p.name}</b><span className="sub">{on ? `${p.label} · added` : p.label}</span></div>
                  </li>
                );
              })}
              {busy && people.length === 0 && <li className="ls-note">Searching…</li>}
              {!busy && !q.err && q.data && people.length === 0 && <li className="ls-note">Nobody in the office by that name. Add them below without an account.</li>}
              {q.err && <li className="ls-note bad">{errText(q.err)[0]}</li>}
            </ul>
          )}
        </div>
      )}
      {full && <span className="hint">At most {MAX_PASSENGERS} passengers by name.</span>}
      {!full && !typed && (
        <div><button type="button" className="linkish" onClick={() => setTyped({ name: want, phone: "", err: null })} data-testid="add-typed">Add someone without an account</button></div>
      )}
      {typed && (
        <div className="card card-b form" style={{ gap: 10 }} data-testid="typed-passenger">
          <div className="grid2">
            <div className="field"><label htmlFor={`${id}-typed-name`}>Their name</label>
              <input id={`${id}-typed-name`} maxLength={120} value={typed.name} onChange={(e) => setTyped({ ...typed, name: e.target.value, err: null })} onKeyDown={onTypedKey} autoFocus /></div>
            <div className="field"><label htmlFor={`${id}-typed-phone`}>Phone (optional)</label>
              <input id={`${id}-typed-phone`} maxLength={30} inputMode="tel" placeholder="077 123 4567" value={typed.phone} onChange={(e) => setTyped({ ...typed, phone: e.target.value, err: null })} onKeyDown={onTypedKey} /></div>
          </div>
          {typed.err && <span className="hint warn" role="alert">{typed.err}</span>}
          <div className="acts">
            <button type="button" className="btn small dark" onClick={addTyped}>Add</button>
            <button type="button" className="btn small" onClick={() => setTyped(null)}>Cancel</button>
          </div>
        </div>
      )}
      <span className="hint">
        {line ? <><b data-testid="passengers-line">{line}</b> · </> : null}
        Office people are told about the trip and see it in My trips; someone without an account can be sent it on WhatsApp.
      </span>
    </div>
  );
}
