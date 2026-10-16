// Gap markers (Phase 7, §21): one small grey marker per gap, its words in a card on hover (desktop)
// or tap (phone), never as permanent text. The pure rules (the card's lines, which side it opens
// to, when an opened marker is centred) and the open-card state the three maps share.
import { useCallback, useEffect, useRef, useState } from "react";

/** The card's words: the first part in bold (what it was), the rest under it ("14:02–14:44 · 42 min · …"). */
export function gapCardLines(text: string): [string, string] {
  const [head, ...rest] = text.split(" · ");
  return [head ?? "", rest.join(" · ")];
}

export interface CardPlacement {
  /** The card opens to this side of the marker: left in the right part of the map (clear of the controls there). */
  side: "left" | "right";
  /** Beside the marker (mid), or below / above it near the top / bottom edge. */
  v: "mid" | "down" | "up";
}

/** Where a marker's card opens, from the marker's position (x, y) in a map of w × h pixels, so it stays inside the map. */
export function cardPlacement(x: number, y: number, w: number, h: number): CardPlacement {
  const side = x > w * 0.55 ? "left" : "right";
  const edge = Math.min(48, h / 4);
  const v = y < edge ? "down" : y > h - edge ? "up" : "mid";
  return { side, v };
}

/**
 * An opened marker is centred only when it sits near the edge or outside the view (its card would not fit); one well
 * inside the view stays where it is ("gently": no zoom change, no move for nothing).
 */
export function needsCentre(x: number, y: number, w: number, h: number): boolean {
  const mx = Math.min(90, w * 0.15), my = Math.min(70, h * 0.15);
  return x < mx || x > w - mx || y < my || y > h - my;
}

/**
 * The open card: openGap (a Gaps list row) opens it, a tap on the marker opens or closes it, a tap on the map or Escape
 * closes it. Every open and close made on the map is told to the page (onGap); hover shows a card without opening it.
 */
export function useGapOpen(openGap: string | null | undefined, onGap: ((id: string | null) => void) | undefined): [string | null, (id: string | null) => void] {
  const [open, setOpen] = useState<string | null>(openGap ?? null);
  useEffect(() => setOpen(openGap ?? null), [openGap]);
  const tell = useRef(onGap);
  tell.current = onGap;
  const set = useCallback((id: string | null) => {
    setOpen(id);
    tell.current?.(id);
  }, []);
  return [open, set];
}
