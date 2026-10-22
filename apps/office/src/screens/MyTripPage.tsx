// Round 4–7, feature 4 (phase8-plan.md §33.1): a trip nobody drives with the app, on the person's own account (I'll drive
// myself, or Someone else drives it), at /my-trips/:task (a panel beside My trips on a desktop, a full page on a phone; the
// notification "Trip finished? Enter the odometer" links here). my_trip says where the trip is and what it asks now:
// - the vehicle check before setting off: "Any damage or problem with <plate>?" No, all good (optional photos of the four
//   sides under More details) or Yes, a problem (what it is, 1–6 photos, a note), and the odometer now (the vehicle's last
//   reading prefilled; never under it). On the trip's day from 2 h before its planned start it starts the trip (On the
//   way); earlier it is only recorded, and the page says so. With the switch vehicle_check off (check_needed false): only
//   the odometer, which starts the trip from that time.
// - "Trip finished? Enter the odometer" (my_trip's finish, or a day over with no check): the odometer now (never under the
//   start), the start when there is none (the vehicle's last reading by default), and under More details the fuel added
//   (litres and / or LKR) and an odometer photo. A trip closed at 09:00 the next day (Completed · not confirmed) is
//   confirmed with the same form.
// One sticky button, disabled with its reason under it; a save goes back to My trips with the outcome in the toast. Photos
// go up as they are picked, into the person's own folder (FleetContext tripPhoto: the web build only; the artifact says
// photos need the web app). The rules: myTripLogic.ts.
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import type { MyTrip, ReportCategory } from "../data/types";
import { useQuery } from "../data/useQuery";
import { dayWords } from "../lib/when";
import { asFleetError, errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { ContactButtons, linksOf } from "../ui/ContactButtons";
import { Loading, Notice, Pill, Plate } from "../ui/basics";
import { PageTop, StickyActions, useAfterSave } from "../ui/Page";
import { ChoiceCard, ChoiceChip } from "../ui/Select";
import { useToast } from "../ui/Toast";
import { tripPhoto as makeTripPhoto } from "./imageCanvas";
import {
  CATEGORIES, checkButton, checkInput, checkReason, type CheckForm, emptyFinish, finishInput, finishReason, type FinishForm,
  MAX_PROBLEM_PHOTOS, needsStart, plateWords, SIDE_TEXT, SIDES, type Side, tripFacts, tripKm, tripMode, windowLine,
} from "./myTripLogic";
import { TRIPS_PATH, useTripCard } from "./myTripsQuery";
import { FilePick } from "./PhotoUpload";
import { RequestDetail } from "./RequestDetail";

type Shot = { id: string; url?: string };
type PhotoKind = "vehicle_report" | "vehicle_check" | "odometer";

const STOP_TYPE: Record<string, string> = { pickup: "Pickup", drop: "Drop", visit: "Visit" };

/** "today", "tomorrow" or "on Thu 23 Oct": the trip's day inside a sentence. */
export function onDayWords(date: string): string {
  const day = dayWords(date, { inline: true });
  return /^(today|tomorrow|yesterday)$/.test(day) ? day : `on ${day}`;
}

/**
 * /my-trips/:id: a request of My trips opens its page (from the list on screen, no call); any other id is a trip of the
 * person's own (my_trip: a notification's link, a row's Vehicle check / Trip finished?), and a request outside the list's
 * dates still opens its page when my_trip says it is not a trip.
 */
export function MyTripOrRequest() {
  const { id = "" } = useParams();
  const trips = useTripCard(id);
  if (trips.card) return <RequestDetail />;
  if (trips.waiting) return <><PageTop title="My trip" backTo={TRIPS_PATH} /><Loading>Loading the trip…</Loading></>;
  return <MyTripPage key={id} id={id} fallback={<RequestDetail />} />;
}

/** The optional things of a step under one fold (More details), open by itself when one of them holds something. */
function MoreDetails({ filled, children }: { filled: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(filled);
  const shown = open || filled;
  return (
    <div className="form" style={{ gap: 12 }}>
      <button type="button" className="btn small" aria-expanded={shown} onClick={() => setOpen((v) => !v)} data-testid="more-details">
        {shown ? "Fewer details ▴" : "More details ▾"}
      </button>
      {shown && children}
    </div>
  );
}

/** One photo slot: the picture once it is up, else the button that takes one (the web app only). */
function PhotoSlot({ label, add = "Add photo", shot, busy, onFile, onRemove, testId }: {
  label: string;
  /** The button's words ("Add front"); the same for every slot of one kind is fine when there is one. */
  add?: string;
  shot?: Shot;
  busy: boolean;
  onFile: (f: File) => void;
  onRemove?: () => void;
  testId?: string;
}) {
  return (
    <figure className="pf-photo" data-testid={testId}>
      {shot
        ? (shot.url ? <img src={shot.url} alt={label} /> : <div className="pf-photo-none small">Photo added</div>)
        : <div className="pf-photo-none muted small">{label}</div>}
      <figcaption>
        <span className="small">{label}</span>
        {shot && onRemove
          ? <button type="button" className="btn small" onClick={onRemove}>Remove</button>
          : <FilePick label={shot ? "Replace" : add} busy={busy} busyLabel="Uploading…" accept="image/*" className="btn small" onFile={onFile} />}
      </figcaption>
    </figure>
  );
}

export function MyTripPage({ id, fallback }: { id: string; fallback?: ReactNode }) {
  const { transport, store, tripPhoto } = useFleet();
  const toast = useToast();
  const afterSave = useAfterSave();
  const { search } = useLocation();
  const home = TRIPS_PATH + search;
  const q = useQuery<MyTrip>("myTrip", "my_trip", { task_id: id }, { every: 60_000 });
  const canPhoto = !!tripPhoto && transport.kind === "api";

  const [finishing, setFinishing] = useState(false);
  const [checkId, setCheckId] = useState(() => crypto.randomUUID());
  const [result, setResult] = useState<"ok" | "problem" | null>(null);
  const [odometer, setOdometer] = useState<string | null>(null);
  const [category, setCategory] = useState<ReportCategory | "">("");
  const [note, setNote] = useState("");
  const [problemPhotos, setProblemPhotos] = useState<Shot[]>([]);
  const [sides, setSides] = useState<Partial<Record<Side, Shot>>>({});
  const [finish, setFinish] = useState<FinishForm | null>(null);
  const [finishPhoto, setFinishPhoto] = useState<Shot | null>(null);
  const [uploading, setUploading] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // The pictures made on this page are let go when it goes.
  const made = useRef<string[]>([]);
  useEffect(() => () => { for (const u of made.current) URL.revokeObjectURL(u); }, []);

  const t = q.data && q.data.task_id === id ? q.data : undefined;
  // A request's id (an older link, or a trip outside the list's dates): its own page.
  if (!t && q.err && /not one of your trips/i.test(q.err.message ?? "") && fallback) return <>{fallback}</>;
  if (!t) {
    return (
      <div data-testid="my-trip">
        <PageTop title="My trip" backTo={home} />
        {q.err
          ? <Notice tone="bad" action={<button type="button" className="btn small" onClick={q.refetch}>Try again</button>}>{errText(q.err as FleetError)[0]}</Notice>
          : <Loading>Loading the trip…</Loading>}
      </div>
    );
  }

  const mode = tripMode(t, finishing);
  const plate = plateWords(t);
  const onDay = onDayWords(t.date);
  const checkForm: CheckForm = {
    result,
    odometer: odometer ?? (t.last_odometer_km != null ? String(t.last_odometer_km) : ""),
    category,
    note,
    photos: problemPhotos.map((p) => p.id),
    sides: SIDES.flatMap((side) => (sides[side] ? [{ photo_id: sides[side]!.id, side }] : [])),
    uploading: uploading.filter((u) => u !== "finish").length,
  };
  const fin: FinishForm = { ...(finish ?? emptyFinish(t)), photo: finishPhoto?.id ?? null, uploading: uploading.includes("finish") };

  /** A picked file made a JPEG and sent up into my own folder; `put` keeps its id (and a local picture). */
  async function addPhoto(kind: PhotoKind, slot: string, file: File, put: (s: Shot) => void) {
    if (!tripPhoto) return;
    setUploading((u) => [...u, slot]);
    setProblem(null);
    try {
      const jpeg = await makeTripPhoto(file);
      const out = await tripPhoto.save(kind, jpeg);
      if (typeof out === "string") {
        setProblem(out === "network" ? "No connection: the photo did not go up. Try again." : "The photo was not saved. Try again.");
      } else {
        let url: string | undefined;
        if (typeof URL.createObjectURL === "function") {
          url = URL.createObjectURL(jpeg);
          made.current.push(url);
        }
        put({ id: out.id, url });
      }
    } catch (e) {
      setProblem(errText(asFleetError(e))[0]);
    }
    setUploading((u) => {
      const i = u.indexOf(slot);
      return i < 0 ? u : [...u.slice(0, i), ...u.slice(i + 1)];
    });
  }

  async function sendCheck() {
    if (!t || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await transport.call<MyTrip>("my_trip_check", checkInput(t.task_id, checkId, t, checkForm));
      setCheckId(crypto.randomUUID());
      toast(r.started_now
        ? `On the way · left ${r.started ?? ""}`.trim()
        : `Check recorded. The trip starts ${onDayWords(r.date)} from ${r.window.opens_at}: check again then.`);
      void store.invalidate();
      afterSave(home);
    } catch (e) {
      setProblem(errText(asFleetError(e))[0]);
      setBusy(false);
    }
  }

  async function sendFinish() {
    if (!t || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const r = await transport.call<MyTrip>("finish_my_trip", finishInput(t.task_id, t, fin));
      const km = r.km ?? tripKm(t, fin);
      toast(`Trip finished${km != null ? ` · ${km.toLocaleString("en-US")} km` : ""}${mode === "confirm" ? " · confirmed" : ""}`);
      void store.invalidate();
      afterSave(home);
    } catch (e) {
      setProblem(errText(asFleetError(e))[0]);
      setBusy(false);
    }
  }

  const head = (
    <PageTop
      title={t.title}
      sub={<>My trip · <span className="mono">{dayWords(t.date)} {t.leave_at}</span>{t.not_confirmed && <> <Pill>Completed · not confirmed</Pill></>}</>}
      backTo={home}
    />
  );

  const facts = (
    <div className="card card-b" data-testid="my-trip-facts">
      <dl className="kv">
        <div><dt>Vehicle</dt><dd>{t.vehicle ? <Plate v={t.vehicle} /> : "—"}{t.vehicle_label && t.vehicle_label !== t.vehicle && <div className="sub">{t.vehicle_label}</div>}</dd></div>
        <div><dt>Leave · back by</dt><dd className="mono">{t.leave_at}{t.back_by ? ` · ${t.back_by_date && t.back_by_date !== t.date ? `${dayWords(t.back_by_date)} ` : ""}${t.back_by}` : ""}</dd></div>
        <div>
          <dt>Who drives</dt>
          <dd>
            {t.driven_by === "self" ? "You drive it yourself" : t.driver_name ?? "Someone else"}
            {t.driven_by === "other" && t.driver_phone && <div style={{ marginTop: 6 }}><ContactButtons phone={linksOf(t.driver_phone)} label={`Call ${t.driver_name?.split(" ")[0] ?? "the driver"}`} testId="call-trip-driver" /></div>}
          </dd>
        </div>
        {t.planned_km ? <div><dt>Planned</dt><dd className="num">about {t.planned_km} km</dd></div> : null}
        {t.stops.length > 0 && (
          <div style={{ gridColumn: "1/-1" }}>
            <dt>Stops</dt>
            <dd style={{ fontWeight: 400 }}>{t.stops.map((s) => <div key={s.n}>{s.n}. {STOP_TYPE[s.type] ?? s.type} · {s.place}</div>)}</dd>
          </div>
        )}
      </dl>
      {tripFacts(t).map((line) => <div key={line} className="sub" data-testid="my-trip-fact">{line}</div>)}
    </div>
  );

  if (mode === "done" || mode === "cancelled" || mode === "other") {
    return (
      <div className="stack" data-testid="my-trip">
        {head}
        {mode === "done" && <Notice tone="ok">Trip finished{t.km != null ? ` · ${t.km.toLocaleString("en-US")} km` : ""}. Nothing more to do.</Notice>}
        {mode === "cancelled" && <Notice>This trip was cancelled.</Notice>}
        {mode === "other" && <Notice>Nothing to do on this trip now.</Notice>}
        {facts}
      </div>
    );
  }

  if (mode === "check") {
    const why = checkReason(t, checkForm, onDay);
    const photosBlocked = result === "problem" && !canPhoto;
    return (
      <div className="stack" data-testid="my-trip">
        {head}
        {facts}
        <div className="card card-b form" data-testid="my-trip-check">
          <h2>{t.check_needed ? "Vehicle check before you set off" : "Start the trip"}</h2>
          <p className="muted small" style={{ margin: 0 }} data-testid="my-trip-window">{windowLine(t, onDay)}</p>
          {t.check && t.check.date && <p className="small" style={{ margin: 0 }}>Already checked {dayWords(t.check.date, { inline: true })} at {t.check.at}{t.check.result === "problem" ? " (a problem reported)" : " (all good)"}.</p>}
          {t.check_needed && (
            <div className="field">
              <span className="lab">Any damage or problem with <span className="mono">{plate}</span>?</span>
              <div role="radiogroup" aria-label={`Any damage or problem with ${plate}?`} style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
                <ChoiceCard selected={result === "ok"} onPick={() => setResult("ok")} testId="check-ok"><b>No, all good</b></ChoiceCard>
                <ChoiceCard selected={result === "problem"} onPick={() => setResult("problem")} testId="check-problem"><b>Yes, a problem</b></ChoiceCard>
              </div>
            </div>
          )}
          {t.check_needed && result === "problem" && (
            <>
              <div className="field">
                <span className="lab">What is it?</span>
                <div className="chips" role="group" aria-label="What is it?">
                  {CATEGORIES.map(([k, label]) => <ChoiceChip key={k} selected={category === k} onClick={() => setCategory(k)} testId={`cat-${k}`}>{label}</ChoiceChip>)}
                </div>
              </div>
              <div className="field">
                <span className="lab">Photos of the problem ({problemPhotos.length} of {MAX_PROBLEM_PHOTOS})</span>
                {photosBlocked
                  ? <Notice tone="bad">A problem needs photos: open the Fame Fleet web app to report it.</Notice>
                  : (
                    <div className="pf-photos" data-testid="problem-photos">
                      {problemPhotos.map((p, n) => (
                        <PhotoSlot key={p.id} label={`Photo ${n + 1}`} shot={p} busy={false} onFile={() => undefined}
                          onRemove={() => setProblemPhotos((x) => x.filter((y) => y.id !== p.id))} />
                      ))}
                      {problemPhotos.length + checkForm.uploading < MAX_PROBLEM_PHOTOS && (
                        <PhotoSlot label={problemPhotos.length ? "Another photo" : "A photo of the problem"} busy={uploading.some((u) => u.startsWith("problem"))}
                          onFile={(f) => void addPhoto("vehicle_report", `problem-${Date.now()}`, f, (s) => setProblemPhotos((x) => [...x, s]))} testId="problem-photo-add" />
                      )}
                    </div>
                  )}
              </div>
              <div className="field">
                <label htmlFor="mt-note">Note (optional)</label>
                <textarea id="mt-note" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="A few words for the office" />
              </div>
            </>
          )}
          <div className="field">
            <label htmlFor="mt-odometer">Odometer now (km)</label>
            <input id="mt-odometer" className="mono" inputMode="numeric" autoComplete="off" value={checkForm.odometer} onChange={(e) => setOdometer(e.target.value)} />
            {t.last_odometer_km != null && <span className="hint">The vehicle's last reading: {t.last_odometer_km.toLocaleString("en-US")} km. Never under it.</span>}
          </div>
          {t.check_needed && result === "ok" && (
            <MoreDetails filled={checkForm.sides.length > 0}>
              <span className="lab">Add 4 photos (front, back, left, right)</span>
              {canPhoto
                ? (
                  <div className="pf-photos" data-testid="side-photos">
                    {SIDES.map((side) => (
                      <PhotoSlot key={side} label={SIDE_TEXT[side]} add={`Add ${side}`} shot={sides[side]} busy={uploading.includes(side)}
                        onFile={(f) => void addPhoto("vehicle_check", side, f, (s) => setSides((x) => ({ ...x, [side]: s })))}
                        onRemove={sides[side] ? () => setSides((x) => ({ ...x, [side]: undefined })) : undefined} testId={`side-${side}`} />
                    ))}
                  </div>
                )
                : <p className="muted small" style={{ margin: 0 }}>Photos need the Fame Fleet web app.</p>}
            </MoreDetails>
          )}
          {problem && <Notice tone="bad">{problem}</Notice>}
          <StickyActions>
            <button type="button" className="btn primary" disabled={!!why || busy || photosBlocked} onClick={() => void sendCheck()} data-testid="check-send">
              {busy ? "Saving…" : checkButton(t, { result })}
            </button>
            {why && <p className="hint btn-why" data-testid="check-why">{why}</p>}
          </StickyActions>
          {/* Already back without a check: the odometer closes it. */}
          {t.can.finish && <button type="button" className="btn small" onClick={() => setFinishing(true)} data-testid="already-done">Trip already done? Enter the odometer</button>}
        </div>
      </div>
    );
  }

  // finish or confirm
  const why = finishReason(t, fin);
  const km = tripKm(t, fin);
  const setFin = (patch: Partial<FinishForm>) => setFinish({ ...fin, ...patch });
  return (
    <div className="stack" data-testid="my-trip">
      {head}
      {mode === "confirm" && <Notice>This trip was closed at 09:00 the next day without the odometer (Completed · not confirmed). Enter it to confirm the trip.</Notice>}
      {facts}
      <div className="card card-b form" data-testid="my-trip-finish">
        <h2>{mode === "confirm" ? "Enter the odometer" : "Trip finished? Enter the odometer"}</h2>
        {needsStart(t) && (
          <div className="field">
            <label htmlFor="mt-start">Odometer at the start (km)</label>
            <input id="mt-start" className="mono" inputMode="numeric" autoComplete="off" value={fin.start} onChange={(e) => setFin({ start: e.target.value })} />
            <span className="hint">No reading at the start: the vehicle's last reading{t.last_odometer_km != null ? ` (${t.last_odometer_km.toLocaleString("en-US")} km)` : ""}, change it if it was different.</span>
          </div>
        )}
        <div className="field">
          <label htmlFor="mt-end">Odometer now (km)</label>
          <input id="mt-end" className="mono" inputMode="numeric" autoComplete="off" value={fin.odometer} onChange={(e) => setFin({ odometer: e.target.value })} />
          <span className="hint" data-testid="my-trip-km">
            {t.start_odometer_km != null ? `Start ${t.start_odometer_km.toLocaleString("en-US")} km` : ""}
            {km != null ? `${t.start_odometer_km != null ? " · " : ""}${km.toLocaleString("en-US")} km this trip` : ""}
          </span>
        </div>
        <MoreDetails filled={!!(fin.litres || fin.amount || finishPhoto)}>
          <div className="grid2">
            <div className="field">
              <label htmlFor="mt-litres">Fuel added (litres)</label>
              <input id="mt-litres" className="mono" inputMode="decimal" autoComplete="off" value={fin.litres} onChange={(e) => setFin({ litres: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor="mt-amount">Amount (LKR)</label>
              <input id="mt-amount" className="mono" inputMode="decimal" autoComplete="off" value={fin.amount} onChange={(e) => setFin({ amount: e.target.value })} />
            </div>
          </div>
          <span className="lab">Odometer photo</span>
          {canPhoto
            ? (
              <div className="pf-photos" data-testid="finish-photo">
                <PhotoSlot label="The odometer" shot={finishPhoto ?? undefined} busy={uploading.includes("finish")}
                  onFile={(f) => void addPhoto("odometer", "finish", f, setFinishPhoto)} onRemove={finishPhoto ? () => setFinishPhoto(null) : undefined} />
              </div>
            )
            : <p className="muted small" style={{ margin: 0 }}>Photos need the Fame Fleet web app.</p>}
        </MoreDetails>
        {problem && <Notice tone="bad">{problem}</Notice>}
        <StickyActions>
          <button type="button" className="btn primary" disabled={!!why || busy} onClick={() => void sendFinish()} data-testid="finish-send">
            {busy ? "Saving…" : mode === "confirm" ? "Confirm trip" : "Finish trip"}
          </button>
          {why && <p className="hint btn-why" data-testid="finish-why">{why}</p>}
        </StickyActions>
        {finishing && t.state === "to_check" && <button type="button" className="btn small" onClick={() => setFinishing(false)}>Back to the vehicle check</button>}
      </div>
    </div>
  );
}
