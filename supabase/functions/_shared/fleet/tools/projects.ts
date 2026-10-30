// Projects are Zoho Books jobs. We never call Zoho: the office's own Zoho
// connector reads the projects and hands them to import_projects.

import { z } from "zod";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap } from "../db.ts";
import { tool, zText } from "../tool.ts";

type Project = Pick<Row<"projects">, "id" | "job_no" | "short_name" | "name" | "customer_name" | "status">;
const COLUMNS = "id, job_no, short_name, name, customer_name, status";

export type MatchRule = "name" | "short_name" | "job_no" | "contains" | "none";

/** LIKE treats % and _ as wildcards; project names are full of underscores. */
const likeLiteral = (text: string) => text.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/**
 * Finds projects the way the Allowance Desk does (its doc, section 7.2), in order:
 * 1. the full project name, 2. the part after the first "_" (the DU ID / short name),
 * 3. the part before the first "_" (the job number), 4. names containing the text.
 */
export /** Round 52: an archived project is never matched (find_project, the trip forms' projects). */
async function matchProjects(db: Db, typed: string): Promise<{ rule: MatchRule; projects: Project[] }> {
  const text = typed.trim();
  const lower = text.toLowerCase();
  if (text === "") return { rule: "none", projects: [] };

  const byName = unwrap(await db.from("projects").select(COLUMNS).is("archived_at", null).ilike("name", likeLiteral(text)).limit(50), "projects")
    .filter((p) => p.name.toLowerCase() === lower);
  if (byName.length > 0) return { rule: "name", projects: byName };

  const byShort = unwrap(await db.from("projects").select(COLUMNS).is("archived_at", null).ilike("short_name", likeLiteral(text)).limit(50), "projects")
    .filter((p) => p.short_name?.toLowerCase() === lower);
  if (byShort.length > 0) return { rule: "short_name", projects: byShort };

  const byJob = unwrap(await db.from("projects").select(COLUMNS).is("archived_at", null).eq("job_no", text).limit(50), "projects");
  if (byJob.length > 0) return { rule: "job_no", projects: byJob };

  const containing = unwrap(
    await db.from("projects").select(COLUMNS).is("archived_at", null).ilike("name", `%${likeLiteral(text)}%`).order("name").limit(25),
    "projects",
  );
  return { rule: containing.length > 0 ? "contains" : "none", projects: containing };
}

const projectLine = (p: Project) => `${p.job_no ?? "-"} ${p.short_name ?? p.name} (${p.customer_name ?? "no customer"})`;

/** Exactly one project for the text, or an error that lists the candidates. */
export async function findOneProject(db: Db, typed: string): Promise<Project> {
  const { projects } = await matchProjects(db, typed);
  if (projects.length === 1) return projects[0];
  if (projects.length === 0) {
    throw new ToolError(`No project matches "${typed}". Try find_project, or import the project from Zoho Books first.`);
  }
  throw new ToolError(
    `Several projects match "${typed}": ${projects.slice(0, 8).map(projectLine).join("; ")}. Give the job number or full name.`,
  );
}

/** "13021_TRKAN1" -> job 13021, short name TRKAN1. */
function splitName(name: string): { job_no: string | null; short_name: string | null } {
  const at = name.indexOf("_");
  if (at <= 0) return { job_no: null, short_name: null };
  return { job_no: name.slice(0, at).trim() || null, short_name: name.slice(at + 1).trim() || null };
}

const zZohoId = z.string().trim().min(1).max(40);

export const importProjects = tool({
  name: "import_projects",
  title: "Import projects from Zoho Books",
  description:
    "Adds or updates projects (jobs) that were read from Zoho Books. Send them as they come from Zoho: project_id, project_name, " +
    "customer_id, customer_name, status. IDs must be strings (they are too long for numbers). Up to 500 per call; call again for more.",
  readOnly: false,
  input: z.object({
    projects: z.array(z.object({
      project_id: zZohoId.describe("Zoho project_id, as a string"),
      project_name: zText(300),
      customer_id: zZohoId.nullable().optional(),
      customer_name: zText(300).nullable().optional(),
      status: zText(40).nullable().optional().describe('e.g. "active"'),
    })).min(1).max(500),
  }),
  async run({ projects }, { db }) {
    // The same project twice in one batch cannot be upserted in one statement: keep the last.
    const byId = new Map(projects.map((p) => [p.project_id, p]));
    const rows = [...byId.values()].map((p) => ({
      zoho_project_id: p.project_id,
      name: p.project_name,
      ...splitName(p.project_name),
      customer_id: p.customer_id ?? null,
      customer_name: p.customer_name ?? null,
      status: p.status ?? null,
    }));
    const saved = unwrap(
      await db.from("projects").upsert(rows, { onConflict: "zoho_project_id" }).select("id"),
      "projects",
    );
    return {
      result: { received: projects.length, saved: saved.length, duplicates_in_batch: projects.length - rows.length },
      summary: `imported ${saved.length} projects`,
    };
  },
});

export const findProject = tool({
  name: "find_project",
  title: "Find project",
  description: "Looks up a project by full name, short name (DU ID, e.g. TRKAN1), job number (e.g. 13021) or part of the name. " +
    "Shows which rule matched and up to 25 candidates.",
  readOnly: true,
  input: z.object({ text: zText(200) }),
  async run({ text }, { db }) {
    const { rule, projects } = await matchProjects(db, text);
    return {
      result: {
        matched_by: rule,
        count: projects.length,
        note: projects.length > 1 ? "Several projects match. Pick one." : undefined,
        projects: projects.map(({ id: _id, ...shown }) => shown),
      },
      summary: `${projects.length} projects for "${text}" (${rule})`,
    };
  },
});
