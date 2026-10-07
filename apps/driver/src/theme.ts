// Design tokens, sampled from the Fame Fleet design (design/png).

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
  sinhalaHeading: 'GemunuLibre_700Bold',
  sinhalaHeadingExtraBold: 'GemunuLibre_800ExtraBold',
  sinhalaFallback: 'NotoSansSinhala_400Regular',
} as const;
