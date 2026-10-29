// Fix B (29 October 2026): From / To / Add stop, Uber's and PickMe's route form: a stop row dragged by its handle. The
// geometry is pure (tests/whereRoute.test.tsx runs it): where a row lands when let go, from the rows' boxes as laid out.
// The rows' order itself is the shared rule (office/trip/stopsLogic.ts moveStopTo).

/** A row as laid out: its top and its height (the same parent for every row). */
export interface RowBox {
  y: number;
  h: number;
}

/**
 * The index the row `from` lands at when let go after moving `dy`: the number of the other rows whose middle is above the
 * dragged row's middle (so it is the splice index moveStopTo takes). A row not laid out yet keeps its place.
 */
export function dropIndex(from: number, dy: number, boxes: readonly (RowBox | undefined)[]): number {
  const me = boxes[from];
  if (!me || !Number.isFinite(dy)) return from;
  const middle = me.y + me.h / 2 + dy;
  let above = 0;
  for (let j = 0; j < boxes.length; j++) {
    if (j === from) continue;
    const b = boxes[j];
    if (!b) return from;
    if (b.y + b.h / 2 < middle) above++;
  }
  return above;
}

/** The drag's offset, kept inside the rows (a row never travels above the first or below the last). */
export function dragOffset(from: number, dy: number, boxes: readonly (RowBox | undefined)[]): number {
  const me = boxes[from];
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  if (!me || !first || !last || !Number.isFinite(dy)) return 0;
  return Math.min(last.y + last.h - (me.y + me.h), Math.max(first.y - me.y, dy));
}
