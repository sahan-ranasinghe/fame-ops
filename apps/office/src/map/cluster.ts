// Clusters for a route's small marks (Round 48, item 3): the pattern is Google Maps' MarkerClusterer with its grid
// algorithm (@googlemaps/markerclusterer is not in node_modules, the artifact build must stay one file and the e2e runs
// offline, so this is our own small grid, shared by all three engines). The map projects each mark to pixels, this
// groups the marks that fall in the same grid cell, and the map shows one numbered circle per group until the person
// zooms in (a tap on the circle zooms to its marks). The open mark (a tapped row's) is never clustered: it must stay
// visible with its card. Pure, so it is tested without a map.

/** The grid's cell in pixels: marks closer than about this overlap at the marker's size (22 px) and cluster. */
export const CLUSTER_CELL_PX = 48;

export interface ClusterItem {
  id: string;
  x: number;
  y: number;
}

export interface Cluster {
  /** Stable for the same members: "cluster:" + their ids. */
  id: string;
  /** The members' mean position in the same pixel space. */
  x: number;
  y: number;
  ids: string[];
}

export interface Clustered {
  /** The marks shown on their own, in the input order. */
  singles: string[];
  clusters: Cluster[];
}

/**
 * The marks grouped by grid cell: a cell with two or more marks is one cluster at their mean position; a cell with one
 * is a single. `keep` names marks that are always singles (the open one) and never counted in a cluster.
 */
export function clusterItems(items: readonly ClusterItem[], opts: { cell?: number; keep?: Iterable<string> } = {}): Clustered {
  const cell = opts.cell && opts.cell > 0 ? opts.cell : CLUSTER_CELL_PX;
  const keep = new Set(opts.keep ?? []);
  const cells = new Map<string, ClusterItem[]>();
  const singles: string[] = [];
  for (const it of items) {
    if (keep.has(it.id) || !Number.isFinite(it.x) || !Number.isFinite(it.y)) {
      singles.push(it.id);
      continue;
    }
    const key = `${Math.floor(it.x / cell)},${Math.floor(it.y / cell)}`;
    const list = cells.get(key);
    if (list) list.push(it);
    else cells.set(key, [it]);
  }
  const clusters: Cluster[] = [];
  for (const list of cells.values()) {
    if (list.length === 1) {
      singles.push(list[0].id);
      continue;
    }
    const n = list.length;
    clusters.push({
      id: `cluster:${list.map((it) => it.id).join("|")}`,
      x: list.reduce((s, it) => s + it.x, 0) / n,
      y: list.reduce((s, it) => s + it.y, 0) / n,
      ids: list.map((it) => it.id),
    });
  }
  // The singles back in the input order (the keeps and the one-mark cells were pushed as met).
  const order = new Map(items.map((it, i) => [it.id, i]));
  singles.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  return { singles, clusters };
}

/** The number on the circle: "12", "99+". */
export const clusterLabel = (n: number): string => (n > 99 ? "99+" : String(n));

/** The circle's name (its tooltip and what a screen reader hears): "12 marks here · zoom in to see them". */
export const clusterTitle = (n: number): string => `${n} marks here · zoom in to see them`;

/** The mean of the members' positions (lat / lng), where the circle is placed on a map that positions by coordinates. */
export function meanOf(points: readonly { lat: number; lng: number }[]): { lat: number; lng: number } {
  const n = points.length || 1;
  return { lat: points.reduce((s, p) => s + p.lat, 0) / n, lng: points.reduce((s, p) => s + p.lng, 0) / n };
}
