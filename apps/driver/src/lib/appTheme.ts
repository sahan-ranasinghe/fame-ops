// C (Round 4–7, docs/phase8-plan.md §33.12; Google Maps, Uber): ONE theme value for the app and the mobile website /m/,
// read by every map, so the map follows the app's theme. The app and /m/ are light only today (the page says
// color-scheme "only light"), so every map is light; the day the app gets a dark theme, APP_SCHEME (or the hook) changes
// and every map follows: Google's map on the phone (react-native-maps' userInterfaceStyle), Google's in the browser
// (colorScheme, read when the map is made) and the free map (OpenFreeMap's Liberty or Dark style). Pure: no React Native
// import, so the Node test scripts read it as it is.

export type AppScheme = 'light' | 'dark';

/** The app's theme: light only today. */
export const APP_SCHEME: AppScheme = 'light';

/** The theme every map reads (a hook, so a dark theme later can follow the phone or a setting without touching the maps). */
export function useMapScheme(): AppScheme {
  return APP_SCHEME;
}

/** OpenFreeMap's styles (no key): Liberty for light, its Dark style for dark (the office site's FREE_MAP_STYLES). */
export const FREE_MAP_STYLES: Readonly<Record<AppScheme, string>> = {
  light: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
};

/** The free map's style for the scheme. */
export function freeMapStyle(scheme: AppScheme): string {
  return FREE_MAP_STYLES[scheme];
}

/** Google's map in the browser (/m/): its colour scheme, read only when the map is made (no map id needed). */
export function googleColorScheme(scheme: AppScheme): 'LIGHT' | 'DARK' {
  return scheme === 'dark' ? 'DARK' : 'LIGHT';
}
