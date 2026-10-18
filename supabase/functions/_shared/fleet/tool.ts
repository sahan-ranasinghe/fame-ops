// What a connector tool is, and the input pieces the tools share.

import { z } from "zod";
import type { Db } from "./db.ts";
import { ToolError } from "./db.ts";
import type { Actor } from "./roles.ts";
import { dayRange, isRealDate } from "./time.ts";

export interface Ctx {
  db: Db;
  now: Date;
  /** The person the tool runs for (role already checked), and the channel they came through. */
  actor: Actor;
}

export interface Out {
  /** Sent back to Claude as compact JSON. */
  result: unknown;
  /** One short line for office_audit. Never put a PIN here. */
  summary: string;
}

export interface Tool<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  description: string;
  input: S;
  /** true = only reads; false = adds or changes data (never deletes). */
  readOnly: boolean;
  run: (args: z.infer<S>, ctx: Ctx) => Promise<Out>;
}

export function tool<S extends z.ZodObject>(def: Tool<S>): Tool<S> {
  return def;
}

// deno-lint-ignore no-explicit-any
export type AnyTool = Tool<any>;

export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use the form YYYY-MM-DD");
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use the 24-hour form HH:MM");
export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Use the form YYYY-MM");
export const zId = z.guid();
export const zText = (max: number) => z.string().trim().min(1).max(max);
export const zVehicleType = z.enum(["car", "van", "double_cab", "lorry", "other"]);

/** Rejects dates such as 2026-02-31, which pass the pattern but do not exist. */
export function realDate(date: string, name = "date"): string {
  if (!isRealDate(date)) throw new ToolError(`${name}: ${date} is not a real date.`);
  return date;
}

/**
 * Phase 7 (§8): a span of Colombo days from the date-range control, both days counted: the UTC range [start, end) to
 * query, or null when neither is given. One without the other, From after To, or more than maxDays is refused in words.
 */
export function daySpan(
  from: string | undefined,
  to: string | undefined,
  maxDays = 366,
): { from: string; to: string; start: string; end: string } | null {
  if (from === undefined && to === undefined) return null;
  if (from === undefined || to === undefined) throw new ToolError("Give from and to together (YYYY-MM-DD).");
  realDate(from, "from");
  realDate(to, "to");
  if (from > to) throw new ToolError(`from (${from}) is after to (${to}).`);
  const days = Math.round((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86400000) + 1;
  if (days > maxDays) throw new ToolError(`${days} days is too long: at most ${maxDays}.`);
  return { from, to, start: dayRange(from).from, end: dayRange(to).to };
}
