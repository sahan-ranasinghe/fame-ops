// The Fuel page's words (Phase 6, Part 3): the video's state in a phrase and a
// tone, sizes and lengths as the office reads them. Pure.
import type { VideoCard } from "../data/types";
import type { Tone } from "../lib/format";

/** "16 MB" (one decimal under 10 MB). */
export function megabytes(bytes: number): string {
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** "0:47" */
export function clockOf(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** "Video 0:47 · 16 MB", "Video 5:12 · 38 MB · interrupted, 2 pieces", "Uploading on the phone", "No video", … */
export function videoWords(v: VideoCard): string {
  if (v.status === "uploaded") {
    return [
      `Video ${v.duration_s != null ? clockOf(v.duration_s) : ""}`.trim(),
      v.bytes ? megabytes(v.bytes) : null,
      v.interrupted ? `interrupted, ${v.segments?.length ?? 2} pieces` : null,
    ].filter(Boolean).join(" · ");
  }
  return v.note ?? v.status;
}

/** The chip's tone: uploaded = ok, on the way = warn, failed or missing = bad, pruned = grey. */
export function videoTone(status: VideoCard["status"]): Tone {
  switch (status) {
    case "uploaded":
      return "ok";
    case "recorded":
    case "uploading":
      return "warn";
    case "failed":
    case "none":
      return "bad";
    default:
      return "muted";
  }
}

/** The short chip label. */
export function videoChip(status: VideoCard["status"], interrupted?: boolean): string {
  if (status === "uploaded" && interrupted) return "Video · interrupted";
  return { uploaded: "Video", recorded: "On the phone", uploading: "Uploading", failed: "Upload failed", none: "No video", pruned: "Pruned" }[status] ?? status;
}

/** Which piece a second of the fill falls in, and the second within it: the pieces play one after another. */
export function pieceAt(atS: number, pieces: { duration_s?: number }[]): { piece: number; offset: number } {
  let start = 0;
  for (let i = 0; i < pieces.length; i++) {
    const d = pieces[i]?.duration_s ?? 0;
    if (atS < start + d || i === pieces.length - 1) return { piece: i, offset: Math.max(0, atS - start) };
    start += d;
  }
  return { piece: 0, offset: Math.max(0, atS) };
}

/** The checklist items the driver ticked, by their English names when the setting knows them (rows from before the steps had seconds). */
export function checklistWords(ticked: string[] | undefined, items: { key: string; en: string }[] | undefined): string {
  if (!ticked?.length) return "";
  return ticked.map((k) => items?.find((i) => i.key === k)?.en ?? k).join(", ");
}
