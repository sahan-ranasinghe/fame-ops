// One small icon per row of a driver's day (Round 3 A1; Google Maps Timeline's activity icons): a car = driving, a pin =
// stopped, a warning = app not running or no GPS, a cloud with an arrow = offline here (uploaded later). The row's
// words say the same thing, so the icon is never the only sign (and never colour alone). Used by every Gaps list (a task's
// route, Live's shown route); the driver page's timeline is gone (§33.6 item 1).
import type { SegmentKind } from "../data/types";
import type { GapMarkerKind } from "../map/types";
import { Icon } from "../ui/icons";

export type TimelineKind = SegmentKind | GapMarkerKind;

/** The icon and its tone for a timeline or gap row's kind. */
export function timelineIconOf(kind: TimelineKind): { icon: "car" | "pin" | "alert" | "upload"; tone: "live" | "" | "warn" } {
  switch (kind) {
    case "driving": return { icon: "car", tone: "live" };
    case "stopped":
    case "stop": return { icon: "pin", tone: "" };
    case "late": return { icon: "upload", tone: "" };
    default: return { icon: "alert", tone: "warn" }; // no_data (app not running), no_gps (no GPS signal)
  }
}

export function TimelineIcon({ kind }: { kind: TimelineKind }) {
  const { icon, tone } = timelineIconOf(kind);
  return <span className={`tl-ico${tone ? ` ${tone}` : ""}`} data-testid="tl-icon" data-icon={icon} aria-hidden="true"><Icon name={icon} /></span>;
}
