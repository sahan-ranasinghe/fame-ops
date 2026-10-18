// One fill (/fuel/:id): the video of the fill played in the browser on its
// 1-hour signed link, the steps the driver ticked as bookmarks (a click opens
// the video there: the right piece, then the second within it), the litres,
// LKR, odometer, receipt, and the task it belongs to. A panel beside the list
// on a desktop, a full screen on a phone.
import { useContext, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { useFleet } from "../app/FleetContext";
import { useQuery } from "../data/useQuery";
import { FuelShown, useFuelArgs } from "./Fuel";
import type { FuelEntry, FuelList, SettingsResult, VideoMark } from "../data/types";
import { joinDots, num } from "../lib/format";
import { errText } from "../transport/errors";
import { Loading, Notice, Pill } from "../ui/basics";
import { PageTop } from "../ui/Page";
import { checklistWords, clockOf, megabytes, pieceAt, videoChip, videoTone } from "./fuelLogic";
import { canOpenTask } from "../transport/types";

export function FuelDetail() {
  const { id = "" } = useParams();
  const [params] = useSearchParams();
  const { me, transport } = useFleet();
  // The fill from the rows the list shows (Fuel keeps them while this page is open). Hotfix 3 (L3): the list shows a page
  // at a time, so a fill on another page (a link, a reload) is found by asking for the whole range once, as before.
  const { args } = useFuelArgs();
  const shown = useContext(FuelShown);
  const fromList: FuelEntry | undefined = shown?.entries.find((x) => x.id === id);
  const lookUp = !fromList && !!shown?.loaded && shown.total > shown.entries.length;
  const found = useQuery<FuelList>("fuel-fill", "list_fuel", lookUp ? args : null, { onWrite: false });
  const e: FuelEntry | undefined = fromList ?? found.data?.entries.find((x) => x.id === id);
  const missing = !e && !!shown?.loaded && (!lookUp || (found.data !== undefined && !found.stale));
  const [items, setItems] = useState<{ key: string; en: string }[] | undefined>();
  const [piece, setPiece] = useState(0);
  /** The second to open once the piece's metadata is loaded (a bookmark in another piece). */
  const [seek, setSeek] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  useEffect(() => { setPiece(0); setSeek(null); }, [id]);
  const backTo = `/fuel${params.toString() ? `?${params.toString()}` : ""}`;
  useEffect(() => {
    if (!me.tools.includes("get_settings")) return;
    let alive = true;
    void transport.call<SettingsResult>("get_settings", {}).then((s) => { if (alive) setItems(s.settings.fuel_video_checklist); }).catch(() => {});
    return () => { alive = false; };
  }, [transport, me.tools]);

  if (!e) {
    return (
      <>
        <PageTop title="Fill" backTo={backTo} />
        {found.err ? <Notice tone="bad">{errText(found.err)[0]}</Notice>
          : missing ? <Notice tone="info">This fill is not in the days and filters chosen.</Notice>
          : <Loading>Loading the fill…</Loading>}
      </>
    );
  }
  const v = e.video;
  const pieces = v.segments?.length ? v.segments : v.url ? [{ url: v.url, duration_s: v.duration_s, bytes: v.bytes }] : [];

  function goTo(m: VideoMark) {
    const target = pieceAt(m.at_s, pieces);
    const el = videoRef.current;
    if (target.piece === piece && el) {
      el.currentTime = target.offset;
      void el.play().catch(() => {});
      return;
    }
    setSeek(target.offset);
    setPiece(target.piece);
  }
  function loaded() {
    const el = videoRef.current;
    if (!el || seek === null) return;
    el.currentTime = seek;
    setSeek(null);
    void el.play().catch(() => {});
  }

  return (
    <div data-testid="fuel-detail">
      <PageTop title={<span className="mono">{e.at}</span>} sub={joinDots([e.vehicle, e.driver])} backTo={backTo} />
      {v.status === "uploaded" && v.url ? (
        <div className="card" style={{ overflow: "hidden" }}>
          <video
            key={piece}
            ref={videoRef}
            controls
            playsInline
            preload="metadata"
            autoPlay={piece > 0}
            src={pieces[piece]?.url ?? v.url}
            onLoadedMetadata={loaded}
            onEnded={() => { if (piece + 1 < pieces.length) setPiece(piece + 1); }}
            style={{ width: "100%", maxHeight: 420, background: "#000", display: "block" }}
            data-testid="fuel-video"
          />
          {v.marks && v.marks.length > 0 && (
            <div className="card-b" style={{ padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="fuel-marks">
              <span className="sub">Steps</span>
              {v.marks.map((m, i) => (
                <button key={i} type="button" className="chip" title={`Open the video at ${m.clock}`} onClick={() => goTo(m)}>{m.label} {m.clock}</button>
              ))}
            </div>
          )}
          {pieces.length > 1 && (
            <div className="card-b" style={{ padding: "8px 14px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }} data-testid="fuel-pieces">
              <Pill tone="warn">Interrupted · {pieces.length} pieces</Pill>
              <span className="sub">The recording stopped and was continued; the pieces play one after another.</span>
              {pieces.map((p, i) => (
                <button key={i} type="button" className={`chip${i === piece ? " on" : ""}`} aria-pressed={i === piece} onClick={() => { setSeek(null); setPiece(i); }}>
                  Piece {i + 1}{p.duration_s != null ? ` · ${clockOf(p.duration_s)}` : ""}
                </button>
              ))}
            </div>
          )}
          <div className="card-b sub" style={{ padding: "8px 14px" }}>{joinDots([v.duration_s != null ? clockOf(v.duration_s) : "", v.bytes ? megabytes(v.bytes) : "", v.uploaded_at ? `uploaded ${v.uploaded_at}` : ""])} · the link works for 1 hour</div>
        </div>
      ) : (
        <Notice tone={v.status === "failed" || v.status === "none" ? "bad" : "info"}><Pill tone={videoTone(v.status)}>{videoChip(v.status)}</Pill> {v.note ?? ""}</Notice>
      )}
      <div className="card card-b">
        <dl className="kv">
          <div><dt>Litres</dt><dd className="num">{e.litres != null ? num(e.litres) : "—"}</dd></div>
          <div><dt>Amount</dt><dd className="num">{e.lkr != null ? `LKR ${num(e.lkr)}` : "—"}</dd></div>
          <div><dt>Odometer</dt><dd className="num">{e.odometer_km != null ? `${num(e.odometer_km)} km` : "—"}</dd></div>
          <div><dt>Receipt</dt><dd>{e.receipt && e.receipt.startsWith("http") ? <a className="btn small" href={e.receipt} target="_blank" rel="noopener">Photo</a> : e.receipt ?? "—"}</dd></div>
          <div style={{ gridColumn: "1/-1" }}><dt>Steps shown</dt><dd>{v.timeline ?? (checklistWords(v.checklist, items) || "—")}</dd></div>
        </dl>
      </div>
      <div className="acts">
        {e.task_id && canOpenTask(me) && <Link className="btn" to={`/tasks/${e.task_id}`}>Open the task →</Link>}
        {e.driver_username && <Link className="btn" to={`/drivers/${e.driver_username}`}>Driver</Link>}
      </div>
    </div>
  );
}
