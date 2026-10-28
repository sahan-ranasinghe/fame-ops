// Round 48 (item 3): overlapping route markers cluster into one numbered circle until the map is zoomed in (Google Maps'
// marker clustering, the grid-based algorithm of its MarkerClusterer). Pure: no map module, no React, so every engine (Google's
// native map, MapLibre's, both browser maps) asks the same question and draws the same clusters, and
// scripts/test-map-layout.ts runs it. The markers are projected to Web Mercator pixels at the map's zoom and put in a grid
// of CLUSTER_CELL_PX cells; a cell with two markers or more is one cluster at their mean, the rest stay single. Above
// CLUSTER_MAX_ZOOM nothing clusters (the person zoomed in to see each marker).

export interface ClusterInput {
  key: string;
  lat: number;
  lng: number;
}

export interface Cluster {
  key: string;
  lat: number;
  lng: number;
  count: number;
  /** The markers inside, in the order given. */
  keys: string[];
}

export interface Clustered<M extends ClusterInput> {
  clusters: Cluster[];
  singles: M[];
}

/** The grid's cell, in screen pixels (about a marker's own size, so two markers that would overlap share a cell). */
export const CLUSTER_CELL_PX = 56;
/** From this zoom on every marker is drawn on its own (a street's zoom). */
export const CLUSTER_MAX_ZOOM = 17;
/** A tap on a cluster zooms in by this much, so its markers come apart. */
export const CLUSTER_ZOOM_STEP = 2;
/** A map's deepest zoom the engines draw well. */
export const MAX_ZOOM = 20;

const TILE = 256;

/** Web Mercator pixels at a zoom (the world is 256 × 2^zoom pixels wide). */
export function projectPx(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * Math.pow(2, zoom);
  const clamped = Math.max(-85.05113, Math.min(85.05113, lat));
  const sin = Math.sin((clamped * Math.PI) / 180);
  return {
    x: ((lng + 180) / 360) * scale,
    y: (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale,
  };
}

/**
 * The markers grouped by grid cell at this zoom: a cell with two or more becomes a cluster at their mean position; a
 * cell with one leaves that marker single. A zoom at or above the limit (or none known yet) clusters nothing.
 */
export function clusterMarkers<M extends ClusterInput>(markers: readonly M[], zoom: number | null, opts: { cellPx?: number; maxZoom?: number } = {}): Clustered<M> {
  const cell = opts.cellPx ?? CLUSTER_CELL_PX;
  const maxZoom = opts.maxZoom ?? CLUSTER_MAX_ZOOM;
  if (zoom === null || !Number.isFinite(zoom) || zoom >= maxZoom || markers.length < 2) return { clusters: [], singles: [...markers] };
  const cells = new Map<string, M[]>();
  for (const m of markers) {
    if (!Number.isFinite(m.lat) || !Number.isFinite(m.lng)) continue;
    const p = projectPx(m.lat, m.lng, zoom);
    const id = `${Math.floor(p.x / cell)}:${Math.floor(p.y / cell)}`;
    cells.set(id, [...(cells.get(id) ?? []), m]);
  }
  const clusters: Cluster[] = [];
  const singles: M[] = [];
  for (const group of cells.values()) {
    if (group.length < 2) {
      singles.push(group[0]);
      continue;
    }
    const lat = group.reduce((s, m) => s + m.lat, 0) / group.length;
    const lng = group.reduce((s, m) => s + m.lng, 0) / group.length;
    clusters.push({ key: `cluster:${group.map((m) => m.key).join('|')}`, lat, lng, count: group.length, keys: group.map((m) => m.key) });
  }
  return { clusters, singles };
}

/** The zoom a tap on a cluster goes to: two steps in, never past the deepest zoom. */
export function clusterZoom(zoom: number | null, step = CLUSTER_ZOOM_STEP): number {
  const z = zoom === null || !Number.isFinite(zoom) ? CLUSTER_MAX_ZOOM - step : zoom;
  return Math.min(MAX_ZOOM, Math.max(CLUSTER_MAX_ZOOM, Math.round(z + step)));
}

/** Google's native map reports a region, not a zoom: the zoom from the longitude span over the map's width in pixels. */
export function zoomFromRegion(longitudeDelta: number, widthPx: number): number | null {
  if (!(longitudeDelta > 0) || !(widthPx > 0)) return null;
  return Math.log2((360 * widthPx) / (TILE * longitudeDelta));
}
