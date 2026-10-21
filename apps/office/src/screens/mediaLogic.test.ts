// Photos and documents, the pure part (Phase 7, §5, §6, §28): the canvas sizes and the square crop, which files a
// document takes, the documents as rows, save_vehicle_document's arguments, the words, which buttons show, and the
// requester's phone in the request forms (§4).
import { describe, expect, it } from "vitest";
import type { VehicleDocument } from "../data/types";
import {
  byWhenText, canSetDriverPhoto, canSetVehiclePhoto, docActions, docFileKind, documentRows, DOC_PX, expiryText, fitLongSide, MAX_DOC_BYTES,
  megabytes, phoneChange, PROFILE_PX, saveDocInput, squareCrop, THUMB_PX, VEHICLE_PX,
} from "./mediaLogic";
import { editFields, emptyRequest, updateRequestInput, validateNewRequest } from "./requestLogic";

describe("the canvas sizes", () => {
  it("crops the centred square of a wide or tall photo and draws it at 512 × 512", () => {
    expect(squareCrop(4000, 3000)).toEqual({ sx: 500, sy: 0, sw: 3000, sh: 3000, w: PROFILE_PX, h: PROFILE_PX });
    expect(squareCrop(3000, 4000)).toEqual({ sx: 0, sy: 500, sw: 3000, sh: 3000, w: 512, h: 512 });
    expect(squareCrop(301, 300)).toEqual({ sx: 0, sy: 0, sw: 300, sh: 300, w: 512, h: 512 });
    // A small square is made 512 too: every profile photo has the same size.
    expect(squareCrop(200, 200)).toMatchObject({ sw: 200, w: 512 });
  });

  it("fits the long side and never blows a small picture up", () => {
    expect(fitLongSide(4000, 3000, VEHICLE_PX)).toEqual({ sx: 0, sy: 0, sw: 4000, sh: 3000, w: 1600, h: 1200 });
    expect(fitLongSide(3000, 4000, THUMB_PX)).toMatchObject({ w: 192, h: 256 });
    expect(fitLongSide(4032, 3024, DOC_PX)).toMatchObject({ w: 2000, h: 1500 });
    expect(fitLongSide(800, 600, VEHICLE_PX)).toMatchObject({ w: 800, h: 600 });
    expect(fitLongSide(10000, 10, THUMB_PX)).toMatchObject({ w: 256, h: 1 });
  });
});

describe("a document's file", () => {
  it("takes a PDF up to 10 MB as it is and any photo to be resized; refuses the rest", () => {
    expect(docFileKind({ type: "application/pdf", name: "ins.pdf", size: 2_000_000 })).toEqual({ kind: "pdf" });
    expect(docFileKind({ type: "", name: "Insurance.PDF", size: 1000 })).toEqual({ kind: "pdf" });
    expect(docFileKind({ type: "application/pdf", name: "big.pdf", size: MAX_DOC_BYTES + 1 })).toEqual({ error: "This PDF is 10.0 MB: a document can be up to 10 MB." });
    expect(docFileKind({ type: "image/png", name: "cr.png", size: 25_000_000 })).toEqual({ kind: "photo" });
    expect(docFileKind({ type: "image/jpeg", name: "lic.jpg", size: 3_000_000 })).toEqual({ kind: "photo" });
    expect(docFileKind({ type: "text/plain", name: "notes.txt", size: 10 })).toEqual({ error: "Choose a photo or a PDF." });
  });

  it("says sizes in KB and MB", () => {
    expect(megabytes(640 * 1024)).toBe("640 KB");
    expect(megabytes(1.25 * 1024 * 1024)).toBe("1.3 MB");
    expect(megabytes(10)).toBe("1 KB");
  });
});

const doc = (over: Partial<VehicleDocument>): VehicleDocument => ({
  id: "d1", kind: "insurance", kind_name: "Insurance", content_type: "application/pdf", uploaded: "2026-10-14 10:05 by Palitha", ...over,
});

describe("the documents as rows", () => {
  it("has the four papers, the agreement only for a rented vehicle, each Other and a row to add one", () => {
    const rows = documentRows({ documents: [doc({})], missing: ["revenue_licence", "emission", "registration"] }, { rented: false });
    expect(rows.map((r) => r.key)).toEqual(["revenue_licence", "insurance", "emission", "registration", "other:new"]);
    expect(rows.map((r) => r.missing)).toEqual([true, false, true, true, false]);
    expect(rows.map((r) => r.expires)).toEqual([true, true, true, false, false]);
    expect(rows[1].doc?.id).toBe("d1");
    expect(rows[4]).toMatchObject({ kind: "other", label: "Another document" });
    expect(rows[4].doc).toBeUndefined();
  });

  it("adds the rent or lease agreement when rented, missing or kept anyway, and lists the Others by name", () => {
    expect(documentRows({ documents: [], missing: ["lease"] }, { rented: false }).map((r) => r.key)).toContain("lease");
    expect(documentRows({ documents: [], missing: [] }, { rented: true }).find((r) => r.key === "lease")).toMatchObject({ label: "Rent or lease agreement", expires: true, missing: false });
    const others = documentRows({
      documents: [doc({ id: "o1", kind: "other", kind_name: "Fitness certificate", name: "Fitness certificate" }), doc({ id: "l1", kind: "lease", kind_name: "Rent or lease agreement" })],
    }, { rented: false });
    expect(others.map((r) => r.key)).toEqual(["revenue_licence", "insurance", "emission", "registration", "lease", "other:o1", "other:new"]);
    expect(others[5]).toMatchObject({ label: "Fitness certificate", expires: false });
  });

  it("is the four papers with nothing while the answer loads", () => {
    expect(documentRows(undefined, { rented: false }).map((r) => r.doc)).toEqual([undefined, undefined, undefined, undefined, undefined]);
  });
});

describe("save_vehicle_document's arguments", () => {
  const base = { vehicle: "WP CAB-4521", path: "v1/insurance/x.pdf", contentType: "application/pdf", bytes: 1234 };
  it("sends the expiry only for a kind that has one, and only a real date", () => {
    expect(saveDocInput({ ...base, kind: "insurance", expiry: "2027-03-12" })).toEqual({
      vehicle: "WP CAB-4521", kind: "insurance", path: "v1/insurance/x.pdf", content_type: "application/pdf", bytes: 1234, expiry: "2027-03-12",
    });
    expect(saveDocInput({ ...base, kind: "insurance", expiry: "" })).not.toHaveProperty("expiry");
    expect(saveDocInput({ ...base, kind: "registration", expiry: "2027-03-12" })).not.toHaveProperty("expiry");
    expect(saveDocInput({ ...base, kind: "lease", expiry: "2027-01-31" })).toMatchObject({ expiry: "2027-01-31" });
  });

  it("names an Other and nothing else", () => {
    expect(saveDocInput({ ...base, kind: "other", name: "  Fitness certificate " })).toMatchObject({ name: "Fitness certificate" });
    expect(saveDocInput({ ...base, kind: "insurance", name: "x" })).not.toHaveProperty("name");
  });
});

describe("the words", () => {
  it("says who uploaded and when, with the year only when it is not this year's", () => {
    // Dates in words (Round 3 A4, lib/when.ts), on 21 October 2026 in Colombo.
    const now = new Date("2026-10-21T04:30:00Z");
    expect(byWhenText("Uploaded", "2026-10-14 10:05 by Palitha", { now })).toBe("Uploaded by Palitha Wed 14 Oct 10:05");
    expect(byWhenText("Uploaded", "2026-10-21 10:05 by Palitha", { now })).toBe("Uploaded by Palitha today 10:05");
    expect(byWhenText("Uploaded", "2025-03-02 09:00", { now })).toBe("Uploaded Sun 2 Mar 2025 09:00");
    expect(byWhenText("replaced", "yesterday", { now })).toBe("replaced yesterday");
    expect(byWhenText("Removed", undefined, { now })).toBe("Removed");
  });

  it("says the expiry", () => {
    const now = new Date("2026-10-21T04:30:00Z");
    expect(expiryText("2027-03-12", { now })).toBe("Expires Fri 12 Mar 2027");
    expect(expiryText("2026-11-02", { now })).toBe("Expires Mon 2 Nov");
    expect(expiryText("2026-10-01", { now })).toBe("Expired Thu 1 Oct");
    expect(expiryText(undefined)).toBe("No expiry date");
  });
});

describe("which buttons show", () => {
  const all = ["vehicle_documents", "vehicle_document_upload_url", "save_vehicle_document", "remove_vehicle_document", "restore_vehicle_document", "update_vehicle", "photo_upload_url", "set_driver_photo", "set_vehicle_photo"];
  it("uploads only from the web app, with both tools", () => {
    expect(docActions(all, true)).toEqual({ upload: true, remove: true, restore: true, saveDate: true });
    expect(docActions(all, false)).toEqual({ upload: false, remove: true, restore: true, saveDate: true });
    expect(docActions(["vehicle_documents", "save_vehicle_document"], true)).toEqual({ upload: false, remove: false, restore: false, saveDate: false });
  });

  it("replaces a photo only on the web with the upload tool and the save tool", () => {
    expect(canSetDriverPhoto(all, true)).toBe(true);
    expect(canSetDriverPhoto(all, false)).toBe(false);
    expect(canSetDriverPhoto(["set_driver_photo"], true)).toBe(false);
    expect(canSetVehiclePhoto(all, true)).toBe(true);
    expect(canSetVehiclePhoto(["photo_upload_url", "set_driver_photo"], true)).toBe(false);
  });
});

describe("the requester's phone (§4)", () => {
  it("is sent only when it changed, and empty clears it", () => {
    expect(phoneChange(" 0771234567 ", "0771234567")).toBeNull();
    expect(phoneChange("0779999999", "0771234567")).toEqual({ requester_phone: "0779999999" });
    expect(phoneChange("", "0771234567")).toEqual({ requester_phone: null });
    expect(phoneChange("", undefined)).toBeNull();
  });

  it("goes with a new request when an approver gives it, and with a change only when it differs", () => {
    const f = { ...emptyRequest("2026-10-20"), leaveBy: "08:00", stops: [{ ...emptyRequest("2026-10-20").stops[0], place: "Head office" }, { ...emptyRequest("2026-10-20").stops[1], place: "Matara" }] };
    const v = validateNewRequest({ ...f, requesterPhone: " 077 123 4567 " });
    expect("input" in v && v.input.requester_phone).toBe("077 123 4567");
    const plain = validateNewRequest(f);
    expect("input" in plain && "requester_phone" in plain.input).toBe(false);

    const card = { fields: { date: "2026-10-20", time: "08:00", route_from: "Head office", route_to: "Matara" }, requester_phone: "0771234567" };
    const was = editFields(card);
    expect(was.requesterPhone).toBe("0771234567");
    expect(updateRequestInput("r1", 3, { ...was, requesterPhone: "" }, was)).toEqual({ input: { request_id: "r1", version: 3, requester_phone: null } });
    expect(updateRequestInput("r1", 3, { ...was, requesterPhone: "0779999999" }, was)).toEqual({ input: { request_id: "r1", version: 3, requester_phone: "0779999999" } });
    expect(updateRequestInput("r1", 3, was, was)).toEqual({ error: "Nothing changed." });
    // Not on the form (no approve, or an older draft): the phone stays as it is.
    expect(updateRequestInput("r1", 3, { ...was, requesterPhone: undefined }, was)).toEqual({ error: "Nothing changed." });
  });
});
