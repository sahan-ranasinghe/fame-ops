import { BUILT_IN } from "@fleet/sites";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { FleetProvider } from "../../app/FleetContext";
import { FleetStore } from "../../data/store";
import type { ImportPreset } from "../../data/types";
import type { Me, Transport, WatchEvent } from "../../transport/types";
import ImportSites from "./ImportSites";

const presets: ImportPreset[] = (Object.keys(BUILT_IN) as (keyof typeof BUILT_IN)[]).map((key) => ({ key, name: BUILT_IN[key].name, built_in: true, mapping: BUILT_IN[key].mapping }));

/** list_import_presets answers only when the test says so (a slow line, or a busy server). */
class SlowPresets implements Transport {
  readonly kind = "api" as const;
  private release: (() => void) | null = null;
  private held = new Promise<void>((r) => { this.release = r; });
  answerPresets() { this.release?.(); }
  me(): Promise<Me> {
    return Promise.resolve({ name: "Sahan", role: "admin", permissions: ["view", "vehicles"], tools: ["list_import_presets", "list_place_imports", "import_places"] });
  }
  async call<T>(tool: string): Promise<T> {
    if (tool === "list_import_presets") { await this.held; return { presets } as T; }
    if (tool === "list_place_imports") return { imports: [] } as T;
    return {} as T;
  }
  watch<T>(_tool: string, _args: Record<string, unknown>, _cb: (ev: WatchEvent<T>) => void): () => void {
    return () => {};
  }
  invalidate(): Promise<void> {
    return Promise.resolve();
  }
}

function xlsxFile(sheetName: string, name: string): File {
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([
    { "Site ID": "CMB001", "Other Site IDS": null, "Site Name": "Kollupitiya", "New Region": "Western", District: "Colombo", Depot: "Colombo", Latitude: 6.91, Longitude: 79.85 },
  ]), sheetName);
  const bytes = XLSX.write(book, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  const file = new File([bytes], name);
  // jsdom's File may not read itself back; the page only calls arrayBuffer().
  Object.defineProperty(file, "arrayBuffer", { value: () => Promise.resolve(bytes) });
  return file;
}

async function mount() {
  const transport = new SlowPresets();
  const me = await transport.me();
  render(
    <FleetProvider value={{ store: new FleetStore(transport), transport, me, noConnector: false }}>
      <MemoryRouter><ImportSites /></MemoryRouter>
    </FleetProvider>,
  );
  return transport;
}

describe("ImportSites", () => {
  it("a file picked before the presets arrive still gets the preset its sheet names", async () => {
    const transport = await mount();
    fireEvent.change(screen.getByLabelText("The spreadsheet"), { target: { files: [xlsxFile("All Operational Sites_DNS Data", "dialog.xlsx")] } });
    // The workbook is read while the presets are still on their way.
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    transport.answerPresets();
    await waitFor(() => expect(screen.getByLabelText<HTMLSelectElement>("The preset").value).toBe("dialog"));
    expect(screen.getByLabelText<HTMLSelectElement>("Site id").value).toBe("Site ID");
  });

  it("a sheet no preset names is mapped by guess", async () => {
    const transport = await mount();
    transport.answerPresets();
    await waitFor(() => expect(screen.getByRole("option", { name: "Dialog site list" })).toBeTruthy());
    fireEvent.change(screen.getByLabelText("The spreadsheet"), { target: { files: [xlsxFile("Our sites", "ours.xlsx")] } });
    await waitFor(() => expect(screen.queryByTestId("import-mapping")).not.toBeNull());
    expect(screen.getByLabelText<HTMLSelectElement>("The preset").value).toBe("__custom__");
    expect(screen.getByLabelText<HTMLSelectElement>("Name (required)").value).toBe("Site Name");
  });
});
