// Round 2 (21 October 2026): the slide-to-confirm's geometry (Uber / PickMe / DoorDash "slide to arrive"), pure so
// scripts/test-stop-slides.ts runs it. The thumb travels from the track's left edge to its right edge; it completes only
// when let go at 90 % of the travel or more, else it springs back. A tap never moves it, so a tap never completes it.

/** Released at this share of the travel or more: done. */
export const SLIDE_DONE_AT = 0.9;

/** How far the thumb can travel: the track's inner width less the thumb (0 before the track is laid out). */
export function slideTravel(trackWidth: number, thumbWidth: number, padding = 0): number {
  return Math.max(0, trackWidth - thumbWidth - 2 * padding);
}

/** The thumb's offset for a drag of dx (never left of the start, never past the end). */
export function slideOffset(dx: number, travel: number): number {
  if (!(travel > 0) || !Number.isFinite(dx)) return 0;
  return Math.min(travel, Math.max(0, dx));
}

/** 0 at the start, 1 at the end. */
export function slideProgress(dx: number, travel: number): number {
  return travel > 0 ? slideOffset(dx, travel) / travel : 0;
}

/** What letting go at dx does: 'done' at 90 % of the travel or more, else 'back' (springs back). */
export function slideRelease(dx: number, travel: number): 'done' | 'back' {
  return travel > 0 && slideProgress(dx, travel) >= SLIDE_DONE_AT ? 'done' : 'back';
}
