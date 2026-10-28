// Round 48 (item 2): what the route map's ⓘ sheet says (Apple Maps' info sheet, Google Maps' legend under "Map details"),
// pure, so scripts/test-map-layout.ts checks it: the legend (the speed bands, the holes, the estimated roads, the start and
// end pins, the stop dot, the gap marker, the cluster), the explanatory sentences that stood under the map before (the
// estimated roads over N gaps, the server's km note) and the map data's credits in full. The credits the licences
// require stay on the map itself (RouteMap's credit line, DriversMap's, Google's own logo): this sheet only repeats them
// with more words.

import { ORS_CREDIT, OSM_CREDIT } from '../components/taskMapLogic';
import { BAND_COLORS, SPEED_BANDS, type SpeedBand } from './driversLogic';

type Words = (key: string, vars?: Record<string, string | number>) => string;

export type LegendMark = 'line' | 'dashed' | 'pinStart' | 'pinEnd' | 'dot' | 'gap' | 'cluster';

export interface LegendEntry {
  key: string;
  mark: LegendMark;
  color: string;
  text: string;
}

export interface MapInfoInput {
  /** The engine mounted now: Google's map credits itself. */
  googleMap: boolean;
  /** An estimated road is drawn (openrouteservice's). */
  estimated: boolean;
  /** How many gaps have one. */
  estimatedGaps: number;
  /** The server's sentence about the km (driver_route's km_note), in its own words. */
  kmNote?: string | null;
  /** The server's sentence about the estimated roads (estimated_note). */
  estimatedNote?: string | null;
}

export interface MapInfo {
  legend: LegendEntry[];
  /** The explanatory sentences, in the person's language where ours, the server's as given. */
  notes: string[];
  /** The map data's credits, in the providers' own words (never translated). */
  credits: string[];
}

/** The colour of the gap marker and the end pins (ink), the stop dot (the standing band's grey). */
export const MARK_COLORS = { pin: '#15181c', dot: BAND_COLORS.standing, gap: '#b3261e', cluster: '#1e4fa0' } as const;

export function mapInfo(input: MapInfoInput, t: Words): MapInfo {
  const legend: LegendEntry[] = [
    ...SPEED_BANDS.map((b: SpeedBand): LegendEntry => ({ key: b, mark: 'line', color: BAND_COLORS[b], text: t(`office.drivers.route.legend.${b}`) })),
    { key: 'gap', mark: 'dashed', color: BAND_COLORS.gap, text: t('office.drivers.route.legend.gap') },
    ...(input.estimated ? [{ key: 'estimated', mark: 'dashed' as const, color: BAND_COLORS.estimated, text: t('office.drivers.route.legend.estimated') }] : []),
    { key: 'start', mark: 'pinStart', color: MARK_COLORS.pin, text: t('dayRoute.legendStart') },
    { key: 'end', mark: 'pinEnd', color: MARK_COLORS.pin, text: t('dayRoute.legendEnd') },
    { key: 'stop', mark: 'dot', color: MARK_COLORS.dot, text: t('dayRoute.legendStop') },
    { key: 'event', mark: 'gap', color: MARK_COLORS.gap, text: t('dayRoute.legendGap') },
    { key: 'cluster', mark: 'cluster', color: MARK_COLORS.cluster, text: t('dayRoute.legendCluster') },
  ];
  const notes: string[] = [];
  if (input.estimated) notes.push(t('dayRoute.estimatedNote', { n: input.estimatedGaps }));
  if (input.estimatedNote) notes.push(input.estimatedNote);
  if (input.kmNote) notes.push(input.kmNote);
  const credits = [input.googleMap ? 'Google Maps' : OSM_CREDIT, ...(input.estimated ? [`${ORS_CREDIT} · map data © OpenStreetMap contributors`] : [])];
  return { legend, notes, credits };
}
