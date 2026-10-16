// What changed in a task's stops, for the driver's push (Phase 7, §11: "Task changed: Stop 2 added: Kurunegala site").
// Stops are named by their place in the order (removed stops not counted). Pure: update_task_stops keeps the answer in the
// plan (plan_json.stop_changes) and the push trigger hands it to push-task, which says it in the driver's language.

export interface StopForChange {
  /** The same stop before and after: its place id, Google place id, else type + name. */
  key: string;
  place: string;
  /** What the driver sees of it besides the place: compared for "changed". */
  detail: string;
}

export interface StopChange {
  n: number;
  place: string;
  change: "added" | "removed" | "moved" | "changed";
}

/** At most `max` changes, in the order of the stops after the change; the removed ones last. */
export function stopChanges(
  before: readonly StopForChange[],
  after: readonly StopForChange[],
  max = 3,
): { list: StopChange[]; more: number } {
  const was = new Map(before.map((s, i) => [s.key, { i, s }]));
  const now = new Set(after.map((s) => s.key));
  const out: StopChange[] = [];
  after.forEach((s, i) => {
    const old = was.get(s.key);
    if (!old) out.push({ n: i + 1, place: s.place, change: "added" });
    else if (old.i !== i) out.push({ n: i + 1, place: s.place, change: "moved" });
    else if (old.s.detail !== s.detail) out.push({ n: i + 1, place: s.place, change: "changed" });
  });
  before.forEach((s, i) => {
    if (!now.has(s.key)) out.push({ n: i + 1, place: s.place, change: "removed" });
  });
  return { list: out.slice(0, max), more: Math.max(0, out.length - max) };
}

/** The key and the detail of a stop row (a saved one or one about to be saved). */
export function stopForChange(s: {
  type: string;
  place_name: string;
  place_id?: string | null;
  google_place_id?: string | null;
  what?: string | null;
  note?: string | null;
  dwell_min?: number | null;
  arrive_by?: string | null;
}): StopForChange {
  return {
    key: s.place_id ?? s.google_place_id ?? `${s.type}|${s.place_name.trim().toLowerCase()}`,
    place: s.place_name,
    detail: [s.type, s.what ?? "", s.note ?? "", s.dwell_min ?? "", s.arrive_by ? new Date(s.arrive_by).toISOString() : ""].join("|"),
  };
}
