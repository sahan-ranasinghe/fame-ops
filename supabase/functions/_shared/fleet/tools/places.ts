// Places: the saved pickup and drop-off points.

import { z } from "zod";
import type { Db, Row } from "../db.ts";
import { ToolError, unwrap } from "../db.ts";
import { mapsPoint } from "../format.ts";
import { tool, zText } from "../tool.ts";

export type Place = Row<"places">;

/**
 * The saved place a pickup or drop-off text refers to, or null when it is just
 * free text. An exact name wins; otherwise the text must point at one place only.
 */
export async function findPlace(db: Db, typed: string): Promise<Place | null> {
  const want = typed.trim().toLowerCase();
  if (want === "") return null;
  const places = unwrap(await db.from("places").select("*").order("name").limit(1000), "places");
  const exact = places.find((p) => p.name.toLowerCase() === want);
  if (exact) return exact;
  const partial = places.filter((p) => p.name.toLowerCase().includes(want) || want.includes(p.name.toLowerCase()));
  return partial.length === 1 ? partial[0] : null;
}

function placeCard(p: Place) {
  return {
    name: p.name,
    address: p.address,
    kind: p.kind,
    maps: p.lat != null && p.lng != null ? mapsPoint(p.lat, p.lng) : undefined,
  };
}

export const listPlaces = tool({
  name: "list_places",
  title: "List places",
  description: "Saved places (offices, stores, sites) that tasks can use as pickup or drop-off.",
  readOnly: true,
  input: z.object({ search: zText(80).optional().describe("Part of the name or address") }),
  async run({ search }, { db }) {
    const all = unwrap(await db.from("places").select("*").order("name").limit(1000), "places");
    const want = search?.toLowerCase();
    const places = all
      .filter((p) => !want || p.name.toLowerCase().includes(want) || (p.address ?? "").toLowerCase().includes(want))
      .map(placeCard);
    return { result: { count: places.length, places }, summary: `${places.length} places` };
  },
});

export const addPlace = tool({
  name: "add_place",
  title: "Add place",
  description:
    "Saves a place for pickups and drop-offs. With lat and lng the driver gets a map pin and a distance; without them the app navigates by address.",
  readOnly: false,
  input: z.object({
    name: zText(120).describe('e.g. "Head office, Colombo 05"'),
    address: zText(240).optional(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    kind: z.enum(["office", "store", "site", "other"]).optional(),
  }),
  async run({ name, address, lat, lng, kind }, { db }) {
    if ((lat === undefined) !== (lng === undefined)) throw new ToolError("Give both lat and lng, or neither.");
    const created = unwrap(
      await db.from("places")
        .insert({ name, address: address ?? null, lat: lat ?? null, lng: lng ?? null, kind: kind ?? "other" })
        .select("*").single(),
      "place",
    );
    return { result: { added: placeCard(created) }, summary: `added place ${created.name}` };
  },
});
