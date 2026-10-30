// Projects (/projects): the jobs copied from Zoho Books. Round 52 (docs/phase8-plan.md §40): the list (list_projects, newest
// first, its own search, Load more, Show archived) with Archive / Restore per row (set_project_archived, the vehicles
// permission; an archived project leaves the pickers, its trips keep it) and Delete permanently for one no task or request
// ever used (users: can_delete, one confirm). Find a project (find_project, the matching the forms use) and the Zoho import
// message stay as they were.
import { type FormEvent, useState } from "react";
import { useFleet } from "../app/FleetContext";
import type { FindProject } from "../data/types";
import { cap, joinDots } from "../lib/format";
import { errText } from "../transport/errors";
import type { FleetError } from "../transport/types";
import { Empty, Loading, Notice, Pill } from "../ui/basics";
import { FilterBar } from "../ui/FilterBar";
import { pairsDef } from "../ui/filterLogic";
import { EmptyLine, ListHeader, SkeletonRows, usePagedList, useUrlFilter } from "../ui/ListKit";
import { useToast } from "../ui/Toast";
import { DeleteRecordCard } from "./bin/BinParts";
import { deletedToast } from "./bin/binLogic";
import { ListFooter, ListStale, ListWaiting, SearchBox, useSearchBox } from "./listLocal";

/** One row of list_projects. */
export interface ProjectRow {
  id: string;
  job_no?: string;
  short_name?: string;
  name: string;
  customer?: string;
  status?: string;
  /** "2026-10-30 by Sahan" when archived. */
  archived?: string;
}
export interface ProjectsList {
  projects: ProjectRow[];
  total?: number;
  next?: string;
}

export const PROJECTS_QUERY = "projectsList";

/** list_projects' filters (the page asks with limit and cursor on top). */
export function projectsArgs(archived: boolean, search: string): Record<string, unknown> {
  return { ...(archived ? { archived: true } : {}), ...(search ? { search } : {}) };
}

/** What an empty list means, in words. */
export function projectsEmpty(archived: boolean, search: string): string {
  if (search) return `No ${archived ? "archived " : ""}project matches "${search}" (name, short name or job number).`;
  return archived ? "No project is archived." : "No projects yet. They come from Zoho Books: see below.";
}

/** The list of projects with Archive / Restore and Delete permanently per row. */
function ProjectsListCard() {
  const { me, transport, store, noConnector } = useFleet();
  const toast = useToast();
  const [show, setShow] = useUrlFilter<"0" | "1">("archived", "0", ["0", "1"]);
  const archived = show === "1";
  const box = useSearchBox("pq");
  const list = usePagedList<ProjectRow, ProjectsList>(PROJECTS_QUERY, "list_projects", projectsArgs(archived, box.search), (d) => d.projects,
    { enabled: !noConnector });
  const q = list.query;
  const d = q.data;
  const [busy, setBusy] = useState<string | null>(null);
  const [rowErr, setRowErr] = useState<{ id: string; text: string } | null>(null);
  const canChange = me.tools.includes("set_project_archived");

  async function setArchived(x: ProjectRow, on: boolean) {
    setBusy(x.id);
    setRowErr(null);
    try {
      await transport.call("set_project_archived", { project: x.id, archived: on });
      toast(on ? `${x.short_name || x.name} archived` : `${x.short_name || x.name} restored`);
      q.refetch();
      void store.invalidate();
    } catch (e) {
      setRowErr({ id: x.id, text: errText(e as FleetError)[0] });
    }
    setBusy(null);
  }

  return (
    <div className="stack" data-testid="projects-list-card">
      <FilterBar
        search={<SearchBox label="Find in the list" placeholder="Name, short name or job number" value={box.text} onChange={box.setText} onBlur={box.flush} />}
        filters={[pairsDef("archived", "Projects", [["0", "In use"], ["1", "Show archived"]], "0")]}
        values={{ archived: show }}
        onChange={(v) => setShow(v.archived === "1" ? "1" : "0")}
      />
      {!noConnector && <ListWaiting q={q} loading="Loading the projects…" />}
      {d && (
        <div className="card" style={q.stale ? { opacity: 0.6 } : undefined} aria-busy={q.updating || q.stale || undefined} data-testid="projects-list">
          <ListHeader title={archived ? "Archived projects" : "Projects"} count={list.total} updating={q.updating || q.stale} />
          <ListStale q={q} />
          {list.items.length ? (
            <div className="rows">
              {list.items.map((x) => (
                <div className="row" key={x.id} data-testid="project-row" style={{ flexWrap: "wrap" }}>
                  <span className="plate">{x.job_no || "—"}</span>
                  <div className="grow">
                    <div className="name">{x.short_name || x.name} {x.archived && <Pill tone="bad">Archived</Pill>}</div>
                    <div className="sub">{joinDots([x.short_name ? x.name : "", x.customer, x.archived ? `Archived ${x.archived}` : ""])}</div>
                    {rowErr?.id === x.id && <Notice tone="bad">{rowErr.text}</Notice>}
                  </div>
                  {x.status && <Pill tone={/active/i.test(x.status) ? "ok" : ""}>{cap(x.status)}</Pill>}
                  <div className="acts" style={{ margin: 0 }}>
                    {canChange && (
                      <button type="button" className="btn small" disabled={busy !== null} onClick={() => void setArchived(x, !x.archived)}>
                        {busy === x.id ? (x.archived ? "Restoring…" : "Archiving…") : x.archived ? "Restore" : "Archive"}
                      </button>
                    )}
                    <DeleteRecordCard compact kind="project" refValue={x.id} fallback="/projects"
                      onDeleted={(a) => { toast(deletedToast(a.until)); q.refetch(); }} />
                  </div>
                </div>
              ))}
            </div>
          ) : q.stale ? <SkeletonRows rows={3} /> : <EmptyLine>{projectsEmpty(archived, box.search)}</EmptyLine>}
          <ListFooter list={list} />
        </div>
      )}
    </div>
  );
}

const ZOHO_PROMPT = "Read all active projects from Zoho Books and import them into Fame Fleet.";

export function Projects() {
  const { me, transport } = useFleet();
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
        {me.tools.includes("list_projects") && <ProjectsListCard />}
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
