// The site-list presets (Part 4): small fixtures shaped like the operators' sheets. Pure.
import { assertEquals } from "@std/assert";
import { BUILT_IN, cellNumber, dialogRows, inLanka, kindOf, mapTable, mappingProblems, mobitel4gRows, mobitelEpRows, operatorOf, parseMobitelName, splitIds } from "./sites.ts";

Deno.test("cells: numbers with spaces or #N/A, ids split on , ; / and spaces", () => {
  assertEquals(cellNumber(" 7.9272 "), 7.9272);
  assertEquals(cellNumber("9. 680384"), 9.680384);
  assertEquals(cellNumber("#N/A"), null);
  assertEquals(cellNumber(""), null);
  assertEquals(cellNumber(81.4569), 81.4569);
  assertEquals(splitIds("CM0164, cm0170;KA0001 / MT0184", "MT0184"), ["CM0164", "CM0170", "KA0001"]);
  assertEquals(inLanka(6.9, 79.9), true);
  assertEquals(inLanka(79.95, 6.9), false);
});

Deno.test("Mobitel names: the code, the place, the sector suffix dropped; glued and code-only forms", () => {
  assertEquals(parseMobitelName("AMARA1 Aranthalawa  89L  Am NOA"), { code: "AMARA1", name: "Aranthalawa" });
  assertEquals(parseMobitelName("KYKAD3Kadugannawa8L"), { code: "KYKAD3", name: "Kadugannawa" });
  assertEquals(parseMobitelName("COKOT1_Kotte_Junction_8L"), { code: "COKOT1", name: "Kotte Junction" });
  assertEquals(parseMobitelName("GLGAL2 Galkulama2"), { code: "GLGAL2", name: "Galkulama" });
  assertEquals(parseMobitelName("AMMAH3"), { code: "AMMAH3", name: null });
  assertEquals(parseMobitelName("Rideela"), { code: null, name: "Rideela" });
  assertEquals(parseMobitelName("COL045A Bambalapitiya"), { code: "COL045A", name: "Bambalapitiya" });
  assertEquals(parseMobitelName(null), { code: null, name: null });
});

Deno.test("Dialog: one row one site, other ids, a pin only inside Sri Lanka, a repeat id reported", () => {
  const r = dialogRows([
    { "Site ID": "MT0184", "Other Site IDS": null, "Site Name": "Inamaluwa Town_Hutch", "New Region": "Central", District: "Matale", Depot: "Dambulla", Latitude: 7.927222, Longitude: 80.684722 },
    { "Site ID": "KA0197", "Other Site IDS": "CM0164", "Site Name": "Hanthana Hutch", "New Region": "Central", District: "Kandy", Depot: "Kandy", Latitude: null, Longitude: null },
    { "Site ID": "MT0184", "Site Name": "again" },
    { "Site ID": null, "Site Name": null },
    { "Site ID": null, "Site Name": "No id here" },
  ]);
  assertEquals(r.rows.length, 2);
  assertEquals(r.rows[0], { operator: "dialog", site_id: "MT0184", other_ids: [], name: "Inamaluwa Town_Hutch", region: "Central", district: "Matale", depot: "Dambulla", lat: 7.927222, lng: 80.684722 });
  assertEquals(r.rows[1].other_ids, ["CM0164"]);
  assertEquals(r.rows[1].lat, undefined);
  assertEquals([r.with_pin, r.no_pin], [1, 1]);
  assertEquals(r.skipped, [{ row: 4, reason: "MT0184 appears twice" }, { row: 6, reason: "no Site ID" }]);
});

Deno.test("Mobitel 4G: one place per coordinate at 4 decimals, the most frequent code and name; a code kept by one place only", () => {
  const r = mobitel4gRows([
    { SiteName: "AMARA1 Aranthalawa  89L  Am NOA", Longitude: 81.45691, Latitude: 7.53312 },
    { SiteName: "AMARA1 Aranthalawa  8L", Longitude: 81.45689, Latitude: 7.53309 },
    { SiteName: "AMARA2 Aranthalawa 9L", Longitude: 81.4569, Latitude: 7.5331 },
    { SiteName: "AMARA1 Elsewhere 8L", Longitude: 81.6, Latitude: 7.6 },
    { SiteName: "Rideela", Longitude: 80.5, Latitude: 7.2 },
    { SiteName: "COX1 Nowhere", Longitude: "#N/A", Latitude: "#N/A" },
    { SiteName: null, Longitude: null, Latitude: null },
  ]);
  assertEquals(r.rows.map((x) => [x.site_id ?? null, x.name, x.lat, x.lng]), [
    ["AMARA1", "Aranthalawa", 7.5331, 81.4569],
    [null, "Elsewhere", 7.6, 81.6],
    [null, "Rideela", 7.2, 80.5],
  ]);
  assertEquals(r.skipped, [{ row: 7, reason: "no coordinates" }]);
});

Deno.test("Mobitel EP: one id per row; swapped coordinates and a space inside a number are repaired and reported", () => {
  const r = mobitelEpRows([
    { "Site ID": "COL018", "Lat. (N)": 6.8833, "Lon. (E)": 79.8814 },
    { "Site ID": "ZBAT44", "Lat. (N)": 79.95, "Lon. (E)": 6.91139 },
    { "Site ID": "JFJAF7", "Lat. (N)": "9. 680384     ", "Lon. (E)": "80. 014588    " },
    { "Site ID": "BAD1", "Lat. (N)": 1, "Lon. (E)": 2 },
    { "Site ID": "COL018", "Lat. (N)": 6.8833, "Lon. (E)": 79.8814 },
  ]);
  assertEquals(r.rows.map((x) => [x.site_id, x.lat, x.lng]), [["COL018", 6.8833, 79.8814], ["ZBAT44", 6.91139, 79.95], ["JFJAF7", 9.680384, 80.014588]]);
  assertEquals(r.repaired, [{ row: 3, note: "ZBAT44: latitude and longitude were swapped" }, { row: 4, note: "JFJAF7: a space inside a coordinate removed" }]);
  assertEquals(r.skipped, [{ row: 5, reason: "BAD1: outside Sri Lanka" }, { row: 6, reason: "COL018 appears twice" }]);
});

Deno.test("the mapping engine: any sheet, the header on row 3, \"lat, lng\" in one column, the operator from a column", () => {
  const table = [
    ["Fame Global · site list", null, null, null, null],
    [null, null, null, null, null],
    ["Code", "Location name", "GPS", "Owner", "Type", "Address"],
    ["KL0173", "Katukurunda South", "6.556615, 79.985751", "Dialog", "Tower", "Katukurunda"],
    ["kl0179", "Narthupana", "80.079083, 6.620861", "dialog axiata", "site", null],
    ["KL0187", "", "6.694911, 79.981926", "Mobitel", "office", null],
    [null, null, null, null, null],
    ["KL0173", "Again", "6.5, 79.9", "Dialog", null, null],
    ["XX0001", "Kuala Lumpur", "3.139, 101.6869", "Dialog", null, null],
    ["", "", "", "", "", ""],
    [null, "No code here", null, "Hutch", null, null],
  ];
  const mapping = { header_row: 3, columns: { site_id: "code", name: "Location name", latlng: "GPS", operator: "Owner", kind: "Type", address: "Address" } };
  assertEquals(mappingProblems(table, mapping), []);
  const r = mapTable(table, mapping);
  assertEquals(r.rows, [
    { operator: "dialog", name: "Katukurunda South", site_id: "KL0173", address: "Katukurunda", kind: "site", lat: 6.556615, lng: 79.985751 },
    { operator: "dialog", name: "Narthupana", site_id: "KL0179", kind: "site", lat: 6.620861, lng: 80.079083 },
    { operator: "mobitel", name: "KL0187", site_id: "KL0187", kind: "office", lat: 6.694911, lng: 79.981926 },
    { operator: "other", name: "No code here" },
  ]);
  assertEquals(r.repaired, [{ row: 5, note: "KL0179: latitude and longitude were swapped" }]);
  assertEquals(r.skipped, [{ row: 8, reason: "KL0173 appears twice" }, { row: 9, reason: "XX0001: outside Sri Lanka" }]);
  assertEquals([r.read, r.with_pin, r.no_pin], [6, 3, 1]);
});

Deno.test("mapping problems in words; the operator as one value; kinds and operators read loosely", () => {
  const table = [["Name", "Lat", "Lng"], ["Kandy office", 7.29, 80.63]];
  assertEquals(mappingProblems(table, { header_row: 1, columns: { lat: "Lat" } }), [
    "Choose the column with the name.", "Choose both the latitude and the longitude column (or one \"lat, lng\" column).", "Choose the operator: a column, or one value for every row.",
  ]);
  assertEquals(mappingProblems(table, { header_row: 1, columns: { name: "Nom", lat: "Lat", lng: "Lng" }, operator: "other" }), ['There is no column "Nom" (name).']);
  assertEquals(mapTable(table, { header_row: 1, columns: { name: "name", lat: "LAT", lng: "lng" }, operator: "other" }).rows, [{ operator: "other", name: "Kandy office", lat: 7.29, lng: 80.63 }]);
  assertEquals([operatorOf("Dialog Axiata PLC"), operatorOf("SLT-Mobitel"), operatorOf("Airtel")], ["dialog", "mobitel", "other"]);
  assertEquals([kindOf("Head office"), kindOf("Warehouse"), kindOf("Tower"), kindOf("shop")], ["office", "store", "site", null]);
});

Deno.test("the built-in presets are mappings on the same engine: Dialog needs ids, EP attaches within 100 m, 4G keeps its name rule", () => {
  assertEquals(BUILT_IN.dialog.mapping.require_id, true);
  assertEquals(BUILT_IN.mobitel_ep.mapping.attach_within_m, 100);
  const g = mapTable([["SiteName", "Longitude", "Latitude"], ["AMARA1 Aranthalawa 89L", 81.4569, 7.5331], [null, "#N/A", "#N/A"]], BUILT_IN.mobitel_4g.mapping);
  assertEquals(g.rows, [{ operator: "mobitel", name: "Aranthalawa", lat: 7.5331, lng: 81.4569, site_id: "AMARA1" }]);
});

