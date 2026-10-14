// Fuel videos (Phase 6, Part 3): the card's words and link rule, the prune selection. Pure.
import { assertEquals } from "@std/assert";
import { pruneDue, videoCard, videoStatusOf } from "./videos.ts";

const base = { video_status: "uploaded", video_duration_s: 47, video_bytes: 16_000_000, video_checklist: ["pump", "odometer"], video_uploaded_at: "2026-10-14T05:00:00.000Z" };

Deno.test("the card: an uploaded video carries its link, duration, size and the ticked items", () => {
  assertEquals(videoCard(base, "https://x/signed", "2026-10-14 10:30"), {
    status: "uploaded",
    duration_s: 47,
    bytes: 16_000_000,
    url: "https://x/signed",
    checklist: ["pump", "odometer"],
    uploaded_at: "2026-10-14 10:30",
    note: undefined,
  });
});

Deno.test("the card: no link for a video that is not uploaded, and a note in words", () => {
  assertEquals(videoCard({ ...base, video_status: "uploading" }, "https://x/signed").url, undefined);
  assertEquals(videoCard({ ...base, video_status: "uploading" }, undefined).note, "Uploading on the phone");
  assertEquals(videoCard({ ...base, video_status: "none", video_checklist: null }, undefined).note, "No video");
  assertEquals(videoCard({ ...base, video_status: "pruned" }, undefined).note, "Pruned after 12 months");
  assertEquals(videoCard({ ...base, video_status: "failed" }, undefined).note, "The upload failed on the phone");
  assertEquals(videoCard(base, undefined).note, "The file is not in storage (not uploaded yet, or removed)");
  assertEquals(videoStatusOf({ video_status: "whatever" }), "none");
  assertEquals(videoStatusOf({ video_status: null as unknown as string }), "none");
});

Deno.test("the prune takes uploaded videos older than 12 months, oldest first, a batch at a time", () => {
  const now = new Date("2026-10-14T00:00:00.000Z");
  const rows = [
    { id: "new", video_path: "a/new.mp4", video_status: "uploaded", video_uploaded_at: "2026-09-01T00:00:00.000Z", logged_at: "2026-09-01T00:00:00.000Z" },
    { id: "old2", video_path: "a/old2.mp4", video_status: "uploaded", video_uploaded_at: "2025-08-01T00:00:00.000Z", logged_at: "2025-08-01T00:00:00.000Z" },
    { id: "old1", video_path: "a/old1.mp4", video_status: "uploaded", video_uploaded_at: "2025-06-01T00:00:00.000Z", logged_at: "2025-06-01T00:00:00.000Z" },
    { id: "pruned", video_path: "a/p.mp4", video_status: "pruned", video_uploaded_at: "2025-01-01T00:00:00.000Z", logged_at: "2025-01-01T00:00:00.000Z" },
    { id: "nopath", video_path: null, video_status: "uploaded", video_uploaded_at: "2025-01-01T00:00:00.000Z", logged_at: "2025-01-01T00:00:00.000Z" },
    { id: "byLogged", video_path: "a/l.mp4", video_status: "uploaded", video_uploaded_at: null, logged_at: "2025-09-01T00:00:00.000Z" },
    { id: "edge", video_path: "a/e.mp4", video_status: "uploaded", video_uploaded_at: "2025-10-14T00:00:00.000Z", logged_at: "2025-10-14T00:00:00.000Z" },
  ];
  assertEquals(pruneDue(rows, now).map((r) => r.id), ["old1", "old2", "byLogged"]);
  assertEquals(pruneDue(rows, now, 2).map((r) => r.id), ["old1", "old2"]);
});
