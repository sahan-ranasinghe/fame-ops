// The artifact lists every connector tool (ALL_TOOLS: its declaration and its menus come from it): the same names as
// the connector's permission table, less the web app's upload tools, so a new tool is never left out of the artifact.
import { TOOL_PERMISSION } from "@fleet/permissions";
import { describe, expect, it } from "vitest";
import { ALL_TOOLS } from "./types";

const WEB_ONLY = ["photo_upload_url", "vehicle_document_upload_url"];

describe("ALL_TOOLS", () => {
  it("names every connector tool once, and nothing else", () => {
    expect(new Set(ALL_TOOLS).size).toBe(ALL_TOOLS.length);
    expect([...ALL_TOOLS].sort()).toEqual(Object.keys(TOOL_PERMISSION).filter((t) => !WEB_ONLY.includes(t)).sort());
  });
});
