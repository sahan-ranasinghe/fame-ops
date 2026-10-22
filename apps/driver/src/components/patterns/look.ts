// Round 4–7, item 12 (the approved mockups of 22 October 2026, design/mockups/2026-10-22/README.md): the few values the
// mockup patterns add to the app's tokens (theme.ts keeps the brand colours and fonts). One place, read by the patterns of
// this folder (TopBar, StatsRow, StatusBanner, RouteStepper, ListRow, BottomActionBar, NewTripFab) and by the screens that
// lay them out, so a card, a divider or a tint is the same everywhere.

import { colors } from '@/theme';

export type ToneName = 'blue' | 'green' | 'amber' | 'red' | 'muted';

export const look = {
  /** A card's 1 px border and its radius (README: card #ffffff, border #e7e5df, radius 16). */
  border: '#e7e5df',
  radius: 16,
  /** The line between rows inside a card. */
  divider: '#efede8',
  /** A round control's ring (the back button, Call, WhatsApp, the bell). */
  ring: '#e2e0da',
  /** The route stepper's rail, and a stop still to come at the end of a running trip. */
  rail: '#d9d6ce',
  railTodo: '#9a9ea3',
  /** The quiet grey tile behind an icon (a vehicle, a project). */
  quiet: '#efede8',
  quietInk: '#3d4247',
} as const;

/** A tone's colours: the chip / banner background, its text, the banner's border and second line, the round icon's fill. */
export const TINT: Record<ToneName, { bg: string; ink: string; border: string; sub: string; solid: string; onSolid: string }> = {
  blue: { bg: colors.blueChip, ink: colors.blue, border: '#c9d7ef', sub: '#163b78', solid: colors.blue, onSolid: '#ffffff' },
  green: { bg: colors.greenChip, ink: colors.green, border: '#c4dfc7', sub: '#1d5522', solid: colors.green, onSolid: '#ffffff' },
  amber: { bg: colors.amberChip, ink: colors.amberText, border: '#f1d9a0', sub: '#6b4600', solid: colors.amber, onSolid: colors.ink },
  red: { bg: colors.redChip, ink: colors.red, border: '#f0c4bf', sub: '#8c1d17', solid: colors.red, onSolid: '#ffffff' },
  muted: { bg: '#ebe9e3', ink: colors.muted, border: look.ring, sub: colors.muted, solid: colors.muted, onSolid: '#ffffff' },
};
