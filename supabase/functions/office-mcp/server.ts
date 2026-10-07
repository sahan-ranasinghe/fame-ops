// The MCP server: the list of tools, and the wrapper that every call goes
// through (audit row first, then the tool, then the outcome).

import { McpServer } from "@modelcontextprotocol/server";
import { auditFinish, auditStart } from "./audit.ts";
import type { Db } from "./db.ts";
import { ToolError } from "./db.ts";
import { prune } from "./format.ts";
import type { AnyTool } from "./tool.ts";
import { createDriver, listDrivers, resetPin, setDriverActive, updateDriver } from "./tools/drivers.ts";
import { driverRoute, liveDrivers } from "./tools/locations.ts";
import { listVehicleReports, mileageSummary, updateVehicleReport } from "./tools/mileage.ts";
import { fleetOverview } from "./tools/overview.ts";
import { addPlace, listPlaces } from "./tools/places.ts";
import { findProject, importProjects } from "./tools/projects.ts";
import { createRequest, decideRequest, listRequests, suggestVehicles } from "./tools/requests.ts";
import { cancelTask, createTask, reassignTask, taskBoard, taskDetail } from "./tools/tasks.ts";
import { addRentalCompany, listVehicles, registerVehicle, updateVehicle } from "./tools/vehicles.ts";

/** Everything the office can do. There is nothing else: no raw SQL, no deletes. */
export const TOOLS: AnyTool[] = [
  fleetOverview,
  liveDrivers,
  driverRoute,
  listDrivers,
  createDriver,
  resetPin,
  setDriverActive,
  updateDriver,
  listVehicles,
  registerVehicle,
  updateVehicle,
  addRentalCompany,
  listPlaces,
  addPlace,
  createTask,
  taskBoard,
  taskDetail,
  cancelTask,
  reassignTask,
  createRequest,
  listRequests,
  suggestVehicles,
  decideRequest,
  mileageSummary,
  listVehicleReports,
  updateVehicleReport,
  importProjects,
  findProject,
];

const INSTRUCTIONS = [
  "Fame Fleet office connector for Fame Global Solutions (Sri Lanka): vehicles, drivers, tasks, vehicle requests, live locations and mileage.",
  "All dates and times are Asia/Colombo (dates YYYY-MM-DD, times 24-hour HH:MM). Money is LKR. Distances are km.",
  "Drivers are identified by username, employee code or name; vehicles by number plate (spaces and dashes do not matter).",
  "create_task, reassign_task and decide_request return warnings. They never block: read them to the user.",
  "Nothing can be deleted. Tasks are cancelled, drivers and vehicles are switched off.",
  "Links: maps = Google Maps, call = tel:, whatsapp = wa.me. Photo links stop working after 1 hour.",
  "Projects come from Zoho Books: read them with the Zoho connector and pass them to import_projects.",
].join("\n");

interface ToolReply {
  content: { type: "text"; text: string }[];
  isError?: boolean;
  [key: string]: unknown;
}

function reply(text: string, isError = false): ToolReply {
  return { content: [{ type: "text", text }], ...(isError && { isError: true }) };
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs one tool call. Arguments are never written to the function log (they can hold a PIN). */
export async function runTool(db: Db, def: AnyTool, args: unknown): Promise<ToolReply> {
  let auditId: number;
  try {
    auditId = await auditStart(db, def.name, args);
  } catch (error) {
    console.error(`${def.name}: audit log failed: ${messageOf(error)}`);
    return reply("The audit log could not be written, so nothing was done. Please try again.", true);
  }

  try {
    const out = await def.run(args, { db, now: new Date() });
    await auditFinish(db, auditId, out.summary);
    return reply(JSON.stringify(prune(out.result)));
  } catch (error) {
    if (error instanceof ToolError) {
      await auditFinish(db, auditId, `refused: ${error.message}`);
      return reply(error.message, true);
    }
    console.error(`${def.name} (audit #${auditId}): ${messageOf(error)}`);
    await auditFinish(db, auditId, `error: ${messageOf(error)}`);
    return reply(`Something went wrong inside the connector (audit #${auditId}). Check the current state before trying again.`, true);
  }
}

export function buildServer(db: Db): McpServer {
  const server = new McpServer({ name: "fame-fleet-office", version: "1.0.0" }, { instructions: INSTRUCTIONS });
  for (const def of TOOLS) {
    server.registerTool(
      def.name,
      {
        title: def.title,
        description: def.description,
        inputSchema: def.input,
        annotations: {
          readOnlyHint: def.readOnly,
          destructiveHint: false,
          idempotentHint: def.readOnly,
          openWorldHint: false,
        },
      },
      (args: unknown) => runTool(db, def, args),
    );
  }
  return server;
}
