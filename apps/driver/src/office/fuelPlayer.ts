// Release 1.4.0 (docs/release-1.4.0.md item 2): a fill's fuel video played in the app (expo-video), as the site's /fuel/:id
// plays it: the pieces one after another, the steps the driver ticked as bookmarks (a tap opens the right piece at its
// second), the pieces to pick when the recording was interrupted. Until 1.4.0 the video opened in the phone's browser; that
// stays as "Open in the browser" on the player.
//
// The fill is handed to the player in memory (the lists already read a fresh answer when their links are over 50 minutes
// old, VIDEO_LINK_FRESH_MS): its 1-hour signed links never go into a route's address.

import { videoPieces } from './manageLogic';
import type { VideoCard, VideoMark } from './types';

/** What the player shows: the fill's day and time, vehicle · driver, its video, and the piece to start with (0-based). */
export interface PlayerFill {
  title: string;
  sub: string;
  video: VideoCard;
  start: number;
}

let handed: PlayerFill | null = null;

/** The list or the task page hands the fill over just before it opens the player. */
export function handToPlayer(fill: PlayerFill): void {
  handed = fill;
}

/** The fill the player was opened for; null when the app was opened straight on the player (a reload on the web). */
export function playerFill(): PlayerFill | null {
  return handed;
}

/** The second at_s of the whole fill as a piece and a second within it (the site's fuelLogic.pieceAt). */
export function pieceAt(atS: number, pieces: { duration_s?: number }[]): { piece: number; offset: number } {
  let start = 0;
  for (let i = 0; i < pieces.length; i++) {
    const d = pieces[i]?.duration_s ?? 0;
    if (atS < start + d || i === pieces.length - 1) return { piece: i, offset: Math.max(0, atS - start) };
    start += d;
  }
  return { piece: 0, offset: Math.max(0, atS) };
}

/** The pieces the player can play (their links), in order. */
export const playerPieces = (v: VideoCard) => videoPieces(v);

/** The bookmarks: "Plate 0:04" chips, in order. */
export function markChips(v: VideoCard): { key: string; label: string; mark: VideoMark }[] {
  return (v.marks ?? []).map((m, i) => ({ key: `${i}`, label: `${m.label} ${m.clock}`, mark: m }));
}

/** The piece n (1-based, as the lists number them) as the player's start (0-based), kept inside the pieces there are. */
export function startPiece(v: VideoCard, n: number): number {
  const count = playerPieces(v).length;
  return Math.min(Math.max(0, n - 1), Math.max(0, count - 1));
}
