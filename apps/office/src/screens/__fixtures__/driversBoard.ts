// Part 3b (H5): a drivers_board answer for the tests: four drivers (free on duty, on a task, off duty, not available) and,
// with week_from, their week from Monday 19 October 2026.
import type { BoardDriver, DriversBoard, UnavailableEntry } from "../../data/types";

export const BOARD_DAYS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"];

export function boardDriver(name: string, username: string, over: Partial<BoardDriver> = {}): BoardDriver {
  return {
    name,
    username,
    status: { kind: "on_duty", text: "On duty since 07:12" },
    free_now: true,
    licence: { chip: "ok", expiry: "2027-05-01" },
    ...over,
  };
}

export const KAMAL = boardDriver("Kamal Perera", "kamal.p", {
  last_seen: "Last seen 17:42 near Kadawatha",
  usual_start: "07:40",
  next_task: { title: "Team drop", when: "14:30" },
  vehicle: { reg_no: "WP CAB-4521", source: "on_duty" },
  links: { phone: "+94771112222", phone_display: "077 111 2222", call: "tel:+94771112222", whatsapp: "https://wa.me/94771112222" },
});
export const NUWAN = boardDriver("Nuwan Silva", "nuwan.s", { status: { kind: "on_task", text: "On a task until ~15:40" }, free_now: false });
export const SUNIL = boardDriver("Sunil Fernando", "sunil.f", { status: { kind: "off_duty", text: "Off duty" }, free_now: false, licence: { chip: "red", expiry: "2026-10-01" } });
export const RUWAN = boardDriver("Ruwan Jaya", "ruwan.j", { status: { kind: "not_available", text: "Not available, back 13:00" }, free_now: false });

export const LEAVE: UnavailableEntry = {
  id: "u1",
  driver: "Ruwan Jaya",
  from: "2026-10-21 00:00",
  to: "2026-10-23 00:00",
  day: "2026-10-21",
  last_day: "2026-10-22",
  part: "full_day",
  reason: "leave",
  reason_text: "Leave",
  note: "Wedding",
  text: "Not available · leave",
  added_by: "Ruwan Jaya (the driver)",
  added: "2026-10-18 09:00",
};

export const HALF: UnavailableEntry = {
  id: "u2",
  driver: "Kamal Perera",
  from: "2026-10-20 08:00",
  to: "2026-10-20 13:00",
  day: "2026-10-20",
  last_day: "2026-10-20",
  end_time: "13:00",
  part: "morning",
  reason: "half_day",
  reason_text: "Half day",
  text: "Not available · half day, back 13:00",
  added_by: "Palitha",
  added: "2026-10-18 10:00",
};

const emptyDays = () => BOARD_DAYS.map((date) => ({ date, tasks: [] as { id: string; title: string; time: string; end?: string; status: string }[], not_available: [] as UnavailableEntry[] }));

export function boardAnswer(withWeek = false): DriversBoard {
  const drivers = [KAMAL, NUWAN, SUNIL, RUWAN];
  const kamalDays = emptyDays();
  kamalDays[1].not_available = [HALF];
  kamalDays[1].tasks = [
    { id: "t2", title: "Site visit", time: "14:30", end: "16:00", status: "assigned" },
    { id: "t1", title: "Team drop", time: "09:00", status: "completed" },
  ];
  const ruwanDays = emptyDays();
  ruwanDays[2].not_available = [LEAVE];
  ruwanDays[3].not_available = [LEAVE];
  return {
    as_of: "2026-10-20 08:00",
    filter: "all",
    counts: { all: 4, free_now: 1, on_task: 1, off_duty: 1, not_available: 1 },
    count: 4,
    drivers,
    week: withWeek
      ? {
        from: BOARD_DAYS[0],
        to: BOARD_DAYS[6],
        days: BOARD_DAYS,
        drivers: [
          { name: KAMAL.name, username: KAMAL.username, days: kamalDays },
          { name: NUWAN.name, username: NUWAN.username, days: emptyDays() },
          // Sunil is missing from the week (a driver the week lacks gets empty days).
          { name: RUWAN.name, username: RUWAN.username, days: ruwanDays },
        ],
      }
      : undefined,
  };
}
