// Round 50 (29 October 2026, phase8-plan.md §37.3, §37.5): the office's view of a self trip on the site, pure. A trip an
// office person drives with the app or on the web (/m/ driver-lite) says "Self-drive" (not "Drives themselves · no app");
// a trip driven on the web never has the Live state: Live says "Web trip · last seen at <stop> HH:MM"; its actions'
// positions (Start, each stop, Finish) are joined by straight dashed lines labelled "No live route · web trip" (Google
// Maps' straight line where no route is known), never a GPS line and never km. Office mode's twin with the same rules:
// apps/driver/src/office/webTripLogic.ts (scripts/test-web-trip.ts compares the two).
import type { LiveDriver, WebPoint } from "./types";

/** The words on the route views and in the legend. */
export const WEB_LINE_TEXT = "No live route · web trip";
export const WEB_LINE_NOTE = "Driven in a browser: only the positions of Start, each stop and Finish, joined by straight dashed lines. Not the road, and no km from them.";
export const SELF_DRIVE = "Self-drive";

/** A self trip driven with the app or on the web: "Self-drive". The manual office path (driven_in office) is not. */
export function isSelfDriveTrip(t: { driven_by?: string; self_drive?: boolean; driven_in?: string | null }): boolean {
  if (t.driven_in === "app" || t.driven_in === "web") return true;
  if (t.driven_in === "office") return false;
  return t.self_drive === true;
}

/** The server's "Drives themselves · no app" on a self-drive trip reads "Self-drive"; any other line as it came. */
export function selfDriveLine(line: string | undefined, t: { driven_by?: string; self_drive?: boolean; driven_in?: string | null }): string | undefined {
  return line === "Drives themselves · no app" && t.driven_by === "self" && isSelfDriveTrip(t) ? SELF_DRIVE : line;
}

/** Live's line for a web trip: "Web trip · last seen at Kurunegala site 10:42"; null for any other card. */
export function webTripSeen(d: Pick<LiveDriver, "web_trip" | "last_seen">): string | null {
  if (!d.web_trip) return null;
  const at = d.last_seen?.at;
  if (!at) return "Web trip · no position yet";
  return d.last_seen?.stop ? `Web trip · last seen at ${d.last_seen.stop} ${at}` : `Web trip · last seen ${at}`;
}

/** The web trip's usable positions in time order. */
export function webPointsInOrder(points: readonly WebPoint[] | null | undefined): WebPoint[] {
  return (points ?? [])
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng) && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180)
    .map((p, i) => ({ p, i, at: Date.parse(p.at) }))
    .sort((a, b) => (Number.isFinite(a.at) && Number.isFinite(b.at) && a.at !== b.at ? a.at - b.at : a.i - b.i))
    .map((x) => x.p);
}

/** One straight dashed line through the actions' positions in time order (a repeat of a place once); two points or more. */
export function webLinePoints(points: readonly WebPoint[] | null | undefined): { lat: number; lng: number }[] {
  const out: { lat: number; lng: number }[] = [];
  for (const p of webPointsInOrder(points)) {
    const last = out[out.length - 1];
    if (last && last.lat === p.lat && last.lng === p.lng) continue;
    out.push({ lat: p.lat, lng: p.lng });
  }
  return out.length >= 2 ? out : [];
}

const ACTION_WORD: Record<WebPoint["action"], string> = { start: "Started", arrive: "Arrived", leave: "Left", finish: "Finished" };

/** A web action's mark: "Started · 08:12", "Arrived · Kurunegala site · 10:42". */
export function webMarkText(p: Pick<WebPoint, "action" | "stop" | "time">): string {
  return [ACTION_WORD[p.action] ?? p.action, (p.action === "arrive" || p.action === "leave") && p.stop ? p.stop : null, p.time].filter(Boolean).join(" · ");
}
