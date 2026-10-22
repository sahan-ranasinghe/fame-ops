// Design tokens, sampled from the Fame Fleet design (design/png).

import { Platform, type TextStyle, type ViewStyle } from 'react-native';

export const colors = {
  ink: '#15181c', // dark header, primary text
  darkSurface: '#22272c',
  page: '#f3f2ee',
  card: '#ffffff',
  mapLand: '#e9e7e0',
  amber: '#f2a900', // primary buttons, active tab
  blue: '#1e4fa0', // live, sharing, in progress
  blueChip: '#e6edf8',
  amberText: '#8a5a00', // stale, warnings
  red: '#b3261e', // danger, not sharing, expired
  muted: '#5d646c',
  line: '#dcd9d0',
  /** Office mode (Phase 8, decision 6): free / active. */
  green: '#27702d', // Round 2b: 5.2:1 on its chip (#2e7d32 was 4.4:1, under WCAG AA)
  greenChip: '#e3f1e4',
  redChip: '#fbeceb',
  amberChip: '#fdf1d6',
  // Round 4–7, item 12 (design/mockups/2026-10-22, README's tokens): the approved mockups' card border and divider, the
  // chips' text and tints, the stepper's rail, the slide's track.
  cardLine: '#e7e5df',
  divider: '#efede8',
  rail: '#d9d6ce',
  iconInk: '#3d4247',
  greenText: '#1f6b2a',
  greenSoft: '#e8f3e9',
  amberSoft: '#fdf3dc',
  amberEdge: '#f1d9a0',
  amberDeep: '#6b4600',
  redSoft: '#fbe9e7',
  onBlueSoft: '#dbe5f6',
} as const;

// Names under which the fonts are loaded in src/app/_layout.tsx.
export const fonts = {
  body: 'IBMPlexSans_400Regular',
  bodyMedium: 'IBMPlexSans_500Medium',
  bodySemiBold: 'IBMPlexSans_600SemiBold',
  bodyBold: 'IBMPlexSans_700Bold',
  mono: 'IBMPlexMono_500Medium', // plates, times, odometer numbers
  monoSemiBold: 'IBMPlexMono_600SemiBold',
  heading: 'Archivo_800ExtraBold',
  sinhalaBody: 'Yaldevi_400Regular',
  sinhalaBodySemiBold: 'Yaldevi_600SemiBold',
  sinhalaHeadingExtraBold: 'GemunuLibre_800ExtraBold',
} as const;

// Web parity (docs/ui-patterns.md, "Web parity"): the same screens run as the mobile website /m/ through react-native-web,
// where Android's `elevation`, `hitSlop` and the status bar do nothing. These helpers give the browser the app's look and
// leave the phone exactly as it was.

const isWeb = Platform.OS === 'web';

/** The CSS shadow a browser draws for an Android elevation (dp): a key shadow below and a soft ambient one around, as
 *  Material draws them. `up` for a surface anchored to the bottom of the screen (a bottom card), whose shadow shows on its
 *  top edge. */
export function webShadow(level: number, up = false): string {
  const dir = up ? -1 : 1;
  const key = `0 ${dir * Math.max(1, Math.round(level / 2))}px ${Math.max(2, level)}px rgba(0,0,0,0.16)`;
  const ambient = `0 ${dir * Math.max(1, Math.round(level / 6))}px ${Math.max(2, Math.round(level / 2))}px rgba(0,0,0,0.12)`;
  return `${key}, ${ambient}`;
}

/** A surface's shadow: `elevation` on the phone, the matching box-shadow in a browser. */
export function shadow(level: number, up = false): ViewStyle {
  return (isWeb ? { boxShadow: webShadow(level, up) } : { elevation: level }) as ViewStyle;
}

/** A browser's mouse hover on a Pressable (react-native-web passes `hovered` with `pressed`; a touch never hovers, the phone
 *  has no hover): slightly lighter, quieter than the pressed state. In a Pressable's style function:
 *  `(state) => [..., state.pressed && { opacity: 0.8 }, hoverStyle(state)]`. */
export function hoverStyle(state: { readonly pressed: boolean }): ViewStyle | null {
  return isWeb && (state as { hovered?: boolean }).hovered && !state.pressed ? { opacity: 0.9 } : null;
}

/** `hitSlop` does nothing in a browser: the same bigger target as padding with a matching negative margin (the layout does
 *  not move). Only for a Pressable with no padding or margin of its own. */
export function webHitSlop(n: number): ViewStyle | null {
  return isWeb ? { padding: n, margin: -n } : null;
}

/** A text box drawn inside its own bordered box (the search bar, the place search): no browser focus ring inside the box
 *  (the phone draws none; the caret shows the focus). */
export const webInnerInput: TextStyle | null = isWeb ? ({ outlineStyle: 'none' } as unknown as TextStyle) : null;

/** The browser's theme colour (its address bar / the installed app's status bar), set by the screen in front to the colour
 *  of its top, as the phone's transparent status bar shows the header under it: ink under a dark header, page under a light
 *  one. Nothing on the phone. */
export function setWebThemeColor(color: string): void {
  if (!isWeb || typeof document === 'undefined') return;
  // Every theme-color tag (the export adds its own beside the page template's).
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    if (meta.getAttribute('content') !== color) meta.setAttribute('content', color);
  });
}
