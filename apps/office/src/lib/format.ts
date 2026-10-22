// Small formatting helpers shared by every screen. Times from the tools are
// already Asia/Colombo text; only the clock and today's date are computed here.

export const TZ = "Asia/Colombo";
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" });
const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });

export const today = () => dayFmt.format(new Date());
export function addDays(d: string, n: number): string {
  const t = new Date(d + "T12:00:00Z");
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}
export function longDate(d: string, noYear = false): string {
  return new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: noYear ? undefined : "numeric",
    timeZone: "UTC",
  });
}
export const clock = (ms: number) => timeFmt.format(new Date(ms));
export const initials = (n?: string | null) =>
  String(n || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";

const nf = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
export const num = (n: unknown) => (n === null || n === undefined || n === "" || isNaN(Number(n))) ? "—" : nf.format(Number(n));
export const plateOf = (v?: string | null) => String(v || "").split(" · ")[0];
export const cap = (s?: string | null) => s ? String(s).charAt(0).toUpperCase() + String(s).slice(1).replace(/_/g, " ") : "";
/** "2026-10-12 09:57" → "09:57" */
export const hhmm = (s?: string | null) => s ? String(s).slice(-5) : "";

export function latLng(url?: string | null): { lat: number; lng: number } | null {
  if (!url) return null;
  let s = String(url);
  try {
    s = decodeURIComponent(s);
  } catch {
    /* keep raw */
  }
  const m = s.match(/(?:query|destination)=(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/);
  return m ? { lat: +m[1], lng: +m[2] } : null;
}

export function waLink(phone?: string | null, text?: string): string {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("0")) d = "94" + d.slice(1);
  return "https://wa.me/" + d + (text ? "?text=" + encodeURIComponent(text) : "");
}

/** The warnings a write tool returns, as sentences. */
export function warnList(p: unknown): string[] {
  const o = (p ?? {}) as { warnings?: unknown; warning?: unknown };
  const w = o.warnings ?? o.warning ?? [];
  const arr = Array.isArray(w) ? w : [w];
  return arr.filter(Boolean).map((x) => {
    if (typeof x === "string") return x;
    const y = x as { message?: string; text?: string; warning?: string };
    return y.message || y.text || y.warning || JSON.stringify(x);
  });
}

export type Tone = "" | "live" | "warn" | "bad" | "ok" | "muted";

export function locTone(text?: string | null): Tone {
  const t = String(text || "").toLowerCase();
  if (t.includes("not sharing")) return "bad";
  if (t.startsWith("live") || t.includes("sharing")) return "live";
  return "warn";
}
export function levelTone(level?: string | null): Tone {
  const l = String(level || "").toLowerCase();
  return l === "red" ? "bad" : (l === "orange" || l === "amber" || l === "yellow") ? "warn" : l === "blue" ? "live" : l === "green" ? "ok" : "warn";
}
export function requestTone(status?: string): Tone {
  return status === "waiting" || status === "changed" ? "warn" : status === "approved" ? "ok" : status === "declined" ? "bad" : status === "cancelled" ? "muted" : "";
}
/** The vehicle's availability line (list_vehicles): on a task = live, booked = warn, in garage = bad, free = ok. */
export function vehicleAvailabilityTone(text?: string | null): Tone {
  const t = text || "";
  return /^On a task/i.test(t) ? "live" : /^Booked/i.test(t) ? "warn" : /garage/i.test(t) ? "bad" : /^Free/i.test(t) ? "ok" : "";
}
export function availabilityTone(label?: string): Tone {
  const l = label || "";
  return /garage|booked|^task /i.test(l) ? "bad" : /over/i.test(l) ? "warn" : "";
}
export function attIcon(what?: string | null): "person" | "wrench" | "gauge" | "alert" | "doc" {
  const w = String(what || "").toLowerCase();
  if (w.includes("driver")) return "person";
  if (w.includes("service")) return "wrench";
  if (w.includes("km")) return "gauge";
  if (w.includes("problem")) return "alert";
  return "doc";
}

/** 100% over n rows, whole numbers, the remainder on the first rows. */
export function splitEqually(n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(100 / n);
  return Array.from({ length: n }, (_, i) => base + (i < 100 - base * n ? 1 : 0));
}

export const joinDots = (parts: (string | null | undefined | false)[]) => parts.filter(Boolean).join(" · ");
