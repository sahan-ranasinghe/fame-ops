// Vehicle requests: the new-request form and the decision, as the connector expects them.

export interface RequestFields {
  by: string;
  project: string;
  date: string;
  time: string;
  back: string;
  need: string;
  from: string;
  to: string;
  pax: string;
  tools: boolean;
  note: string;
}

export const emptyRequest = (date: string): RequestFields => ({
  by: "", project: "", date, time: "", back: "", need: "", from: "", to: "", pax: "", tools: false, note: "",
});

export function validateNewRequest(f: RequestFields, staffName?: string): { error: string } | { input: Record<string, unknown> } {
  const t = (s: string) => s.trim();
  const by = staffName ?? t(f.by);
  if (!by || !t(f.date) || !t(f.time)) return { error: "Add who needs it, the day and the time." };
  const input: Record<string, unknown> = { requested_by: by, date: t(f.date), time: t(f.time) };
  if (t(f.project)) input.project = t(f.project);
  if (t(f.back)) input.back_by = t(f.back);
  if (t(f.need)) input.need_type = t(f.need);
  if (t(f.from)) input.route_from = t(f.from);
  if (t(f.to)) input.route_to = t(f.to);
  if (t(f.pax) !== "") input.pax = Math.max(0, Math.min(80, parseInt(t(f.pax), 10) || 0));
  if (f.tools) input.tools = true;
  if (t(f.note)) input.note = t(f.note);
  return { input };
}

export function decisionInput(
  d: { id: string; decision: "approve" | "decline"; reason?: string; vehicle?: string; driver?: string; decidedBy?: string },
): { error: string } | { input: Record<string, unknown> } {
  const input: Record<string, unknown> = { request_id: d.id, decision: d.decision };
  if (d.decidedBy) input.decided_by = d.decidedBy.slice(0, 80);
  if (d.decision === "decline") {
    const r = (d.reason ?? "").trim();
    if (!r) return { error: "Write the reason first. The person who asked will see it." };
    input.reason = r;
  } else {
    if (!d.vehicle || !d.driver) return { error: "Pick a vehicle and a driver." };
    input.vehicle = d.vehicle;
    input.driver = d.driver;
  }
  return { input };
}
