import { type FormEvent, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { FindProject } from "../data/types";
import { cap, joinDots } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill } from "../ui/basics";
import { useToast } from "../ui/Toast";

const ZOHO_PROMPT = "Read all active projects from Zoho Books and import them into Fame Fleet.";

export function Projects() {
  const { transport } = useFleet();
  const toast = useToast();
  const [q, setQ] = useState("");
  const [state, setState] = useState<{ kind: "idle" } | { kind: "busy" } | { kind: "done"; p: FindProject } | { kind: "error"; text: string }>({ kind: "idle" });

  async function search(ev: FormEvent) {
    ev.preventDefault();
    if (!q.trim()) return;
    setState({ kind: "busy" });
    try {
      setState({ kind: "done", p: await transport.call<FindProject>("find_project", { text: q.trim() }) });
    } catch (e) {
      setState({ kind: "error", text: errText(e as FleetError)[0] });
    }
  }

  return (
    <section className="view">
      <div className="ph"><div><div className="eyebrow">Jobs from Zoho Books</div><h1>Projects</h1></div></div>
      <div className="stack">
        <form className="card card-b form" onSubmit={search}>
          <div className="field">
            <label htmlFor="proj-q">Find a project</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input id="proj-q" placeholder="Job number, DU ID (e.g. TRKAN1) or part of the name" style={{ flex: "1 1 240px" }} value={q} onChange={(e) => setQ(e.target.value)} />
              <button className="btn dark" type="submit">Search</button>
            </div>
          </div>
        </form>
        {state.kind === "busy" && <Loading>Searching…</Loading>}
        {state.kind === "error" && <Notice tone="bad">{state.text}</Notice>}
        {state.kind === "done" && (
          <div className="card">
            {state.p.projects.length ? (
              <>
                <div className="card-h"><h2>{state.p.projects.length} found</h2><span className="muted small">Matched by {cap(state.p.matched_by || "")}</span></div>
                <div className="rows">
                  {state.p.projects.map((x, i) => (
                    <div className="row" key={i}>
                      <span className="plate">{x.job_no || "—"}</span>
                      <div className="grow"><div className="name">{x.short_name || x.name}</div><div className="sub">{joinDots([x.name, x.customer_name])}</div></div>
                      {x.status && <Pill tone={/active/i.test(x.status) ? "ok" : ""}>{cap(x.status)}</Pill>}
                    </div>
                  ))}
                </div>
              </>
            ) : <Empty>No project matches. If projects were never imported from Zoho Books, the list is empty: see below.</Empty>}
          </div>
        )}
        <div className="card card-b">
          <h2>Bring projects in from Zoho Books</h2>
          <p className="muted">Projects are copied from Zoho Books, so tasks can be charged to the right job. Open a chat in Claude with both the Zoho Books and Fame Fleet connectors turned on and send:</p>
          <p className="mono" style={{ background: "var(--surface-2)", padding: "12px 14px", borderRadius: 10, margin: "0 0 12px" }}>{ZOHO_PROMPT}</p>
          <button type="button" className="btn" onClick={() => { void navigator.clipboard?.writeText(ZOHO_PROMPT).then(() => toast("Copied")); }}>Copy the message</button>
          <p className="muted small">The project cost report in the design comes later, once fuel and rent data are flowing.</p>
        </div>
      </div>
    </section>
  );
}
