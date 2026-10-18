// Fuel entries for a month with their receipts and videos (Phase 6, Part 3):
// the office's Fuel page. Links work for 1 hour.

import { z } from "zod";
import { fetchAll, unwrap } from "../db.ts";
import { findDriver, findVehicle, loadRefs } from "../fleet.ts";
import { centsToLkr } from "../format.ts";
import { PHOTO_LINK_NOTE, photoLinks, photoOrNote } from "../photos.ts";
import { loadSettings } from "../settings.ts";
import { colomboDate, colomboDateTime, monthRange } from "../time.ts";
import { daySpan, tool, zDate, zMonth, zText } from "../tool.ts";
import { VIDEO_LINK_NOTE, videoCard, videoLinks, videoStatusOf } from "../videos.ts";

export const listFuel = tool({
  name: "list_fuel",
  title: "Fuel entries with their videos",
  description:
    "Every fuel entry of a month (newest first): the vehicle, the driver, litres, LKR, the odometer, the receipt photo link, and the " +
    "video of the fill: its status (uploaded with 1-hour links, one per piece when the recording was interrupted and continued; " +
    "uploading or recorded on the phone; failed; pruned after the keep months; none), its length, size, and the steps the driver " +
    'ticked while recording with the second of each (marks: bookmarks into the video; timeline: "Plate 0:04 · Zero 0:11 · …"). ' +
    "Totals for the month. With from and to (Colombo days, both counted) the entries and totals are those days', and " +
    "month_totals are the month that contains to.",
  readOnly: true,
  input: z.object({
    month: zMonth.optional().describe("YYYY-MM. Default: this month"),
    from: zDate.optional().describe("First day of a range, YYYY-MM-DD (with to; instead of month)"),
    to: zDate.optional().describe("Last day of the range"),
    vehicle: zText(20).optional().describe("Plate"),
    driver: zText(80).optional().describe("Username, code or name"),
  }),
  async run({ month, from: fromDay, to: toDay, vehicle, driver }, { db, now }) {
    const span = daySpan(fromDay, toDay);
    const which = span ? span.to.slice(0, 7) : month ?? colomboDate(now).slice(0, 7);
    const { from, to } = span ? { from: span.start, to: span.end } : monthRange(which);
    const [refs, settings] = await Promise.all([loadRefs(db), loadSettings(db)]);
    const onlyVehicle = vehicle ? findVehicle(refs, vehicle) : null;
    const onlyDriver = driver ? findDriver(refs, driver) : null;
    const logs = await fetchAll((a, b) => {
      let q = db.from("fuel_logs").select("*").gte("logged_at", from).lt("logged_at", to);
      if (onlyVehicle) q = q.eq("vehicle_id", onlyVehicle.id);
      if (onlyDriver) q = q.eq("employee_id", onlyDriver.id);
      return q.order("logged_at", { ascending: false }).order("id").range(a, b);
    }, "fuel logs");
    const [photos, videos] = await Promise.all([
      photoLinks(db, { ids: logs.flatMap((l) => l.receipt_photo_id ? [l.receipt_photo_id] : []) }),
      videoLinks(db, logs),
    ]);
    const entries = logs.map((l) => ({
      id: l.id,
      at: colomboDateTime(l.logged_at),
      vehicle: refs.veh.get(l.vehicle_id)?.reg_no,
      driver: refs.emp.get(l.employee_id)?.name,
      driver_username: refs.emp.get(l.employee_id)?.username ?? undefined,
      task_id: l.task_id ?? undefined,
      litres: l.litres === null ? null : Number(l.litres),
      lkr: centsToLkr(l.amount_cents),
      odometer_km: l.odometer_km,
      receipt: photoOrNote(photos, l.receipt_photo_id),
      video: videoCard(l, videos, l.video_uploaded_at ? colomboDateTime(l.video_uploaded_at) : undefined, settings.fuel_video_checklist),
    }));
    const totals = {
      entries: entries.length,
      litres: Math.round(entries.reduce((s, e) => s + (e.litres ?? 0), 0) * 100) / 100,
      lkr: entries.reduce((s, e) => s + (e.lkr ?? 0), 0),
      videos: logs.filter((l) => videoStatusOf(l) === "uploaded").length,
      interrupted: logs.filter((l) => l.video_interrupted).length,
      videos_waiting: logs.filter((l) => ["recorded", "uploading"].includes(videoStatusOf(l))).length,
      videos_missing: logs.filter((l) => ["none", "failed"].includes(videoStatusOf(l))).length,
      bytes: logs.reduce((s, l) => s + (videoStatusOf(l) === "uploaded" ? l.video_bytes ?? 0 : 0), 0),
    };
    // The month that contains To, for the monthly figures beside a range (Phase 7, §8).
    let monthTotals: { entries: number; litres: number; lkr: number } | undefined;
    if (span) {
      const m = monthRange(which);
      const rows = await fetchAll((a, b) => {
        let q = db.from("fuel_logs").select("id, litres, amount_cents").gte("logged_at", m.from).lt("logged_at", m.to);
        if (onlyVehicle) q = q.eq("vehicle_id", onlyVehicle.id);
        if (onlyDriver) q = q.eq("employee_id", onlyDriver.id);
        return q.order("logged_at").order("id").range(a, b);
      }, "fuel logs");
      monthTotals = {
        entries: rows.length,
        litres: Math.round(rows.reduce((sum, r) => sum + Number(r.litres ?? 0), 0) * 100) / 100,
        lkr: centsToLkr(rows.reduce((sum, r) => sum + (r.amount_cents ?? 0), 0)) ?? 0,
      };
    }
    return {
      result: {
        month: which,
        from: span?.from,
        to: span?.to,
        vehicle: onlyVehicle?.reg_no,
        driver: onlyDriver?.name,
        totals,
        month_totals: monthTotals,
        entries,
        links: `${PHOTO_LINK_NOTE} ${VIDEO_LINK_NOTE}`,
      },
      summary: `fuel ${span ? `${span.from}…${span.to}` : which}: ${entries.length} entries, ${totals.videos} videos` +
        (onlyVehicle ? ` (${onlyVehicle.reg_no})` : "") +
        (onlyDriver ? ` (${onlyDriver.name})` : ""),
    };
  },
});
