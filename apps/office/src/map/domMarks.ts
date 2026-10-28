// The HTML elements the two real maps (MapLibre, Google) place on the map (Phase 7, Part 2b): a
// gap's marker with its card, a plan's pin with its chip, the playback marker. The same elements
// and CSS on both maps; each map only positions them.
import { type Cluster, clusterLabel, clusterTitle } from "./cluster";
import { cardPlacement, gapCardLines } from "./gapLogic";
import { isPin } from "./layers";
import { GAP_ICONS, svgMarkup } from "./mapIcons";
import { pinChip } from "./planDraw";
import type { GapMarker, GapMarkerKind, MapRoute, PlanPin } from "./types";

/** A gap marker is made again only when this changes. */
export const gapKey = (g: GapMarker) => `${g.kind}|${g.lat}|${g.lng}|${g.text}`;

/** The card opens on the side that stays inside the map (from the marker's place in the map's box). */
export function placeCard(el: HTMLElement, container: HTMLElement | null) {
  if (!container) return;
  const r = el.getBoundingClientRect(), c = container.getBoundingClientRect();
  if (!c.width || !c.height) return;
  const p = cardPlacement(r.left + r.width / 2 - c.left, r.top + r.height / 2 - c.top, c.width, c.height);
  el.classList.toggle("to-left", p.side === "left");
  el.classList.toggle("down", p.v === "down");
  el.classList.toggle("up", p.v === "up");
}

/**
 * Round 48 (item 3, z-order): a stop's dot is drawn UNDER the route line by the map itself (MapLibre: a circle layer below
 * the line's layer; Google: an element in the mapPane, under the polylines' pane; the drawn map: a circle before the line),
 * so the line reads over the clutter; the HTML button above keeps the hit area, the card and the name but draws nothing
 * ("under"), and shows its own dot only while open or hovered. Pins, event marks and clusters stay above the line.
 */
export const underLine = (kind: GapMarkerKind): boolean => kind === "stop";

/** Where a mark's element sits on its point: a pin's tip, every other mark's centre. */
export const markAnchor = (kind: GapMarkerKind): "bottom" | "center" => (isPin(kind) ? "bottom" : "center");

/**
 * A gap's marker: a small grey round button with the kind's icon; its card (the words) shows on hover (desktop) or
 * while open (a tap, a Gaps list row). The button's name is the whole text, so a screen reader hears it without the card.
 * Round 48: also a stop's dot ("stop", drawn under the line: underLine) and the route's pins ("start", "end": a pin shape).
 */
export function gapMarkEl(g: GapMarker, on: { toggle: (id: string) => void; close: () => void; container: () => HTMLElement | null }): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = `gap-mk ${g.kind}${isPin(g.kind) ? " pin" : ""}${underLine(g.kind) ? " under" : ""}`;
  el.dataset.gap = g.id;
  el.setAttribute("aria-label", g.text);
  el.setAttribute("aria-expanded", "false");
  const dot = document.createElement("span");
  dot.className = "gap-dot";
  dot.innerHTML = svgMarkup(GAP_ICONS[g.kind]);
  const card = document.createElement("span");
  card.className = "gap-card";
  card.setAttribute("aria-hidden", "true");
  const [head, rest] = gapCardLines(g.text);
  const b = document.createElement("b");
  b.textContent = head;
  card.appendChild(b);
  if (rest) {
    const s = document.createElement("span");
    s.textContent = rest;
    card.appendChild(s);
  }
  el.append(dot, card);
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    on.toggle(g.id);
  });
  el.addEventListener("keydown", (ev) => {
    if (ev.key !== "Escape") return;
    ev.stopPropagation();
    on.close();
  });
  el.addEventListener("pointerenter", () => placeCard(el, on.container()));
  return el;
}

export function setGapOpen(el: HTMLElement, open: boolean) {
  el.classList.toggle("open", open);
  el.setAttribute("aria-expanded", open ? "true" : "false");
}

/** Round 48: the dot the map draws under the line for a stop (the HTML maps place it in a pane below the lines). */
export function underDotEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "mk-under-dot";
  el.setAttribute("aria-hidden", "true");
  return el;
}

/**
 * A cluster's circle (Round 48, item 3; MarkerClusterer): the count in a round ink button, named "N marks here · zoom in
 * to see them"; a tap zooms the map to its marks. Kept above the line, like the pins.
 */
export function clusterEl(onZoom: (ids: string[]) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "mk-cluster";
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onZoom((el.dataset.ids ?? "").split("|").filter(Boolean));
  });
  return el;
}

export function setCluster(el: HTMLElement, c: Cluster) {
  el.dataset.ids = c.ids.join("|");
  el.dataset.cluster = c.id;
  el.textContent = clusterLabel(c.ids.length);
  el.title = clusterTitle(c.ids.length);
  el.setAttribute("aria-label", clusterTitle(c.ids.length));
}

/** A mark folded into a cluster is hidden (its element stays, so an open card survives a zoom). */
export function setClustered(el: HTMLElement, clustered: boolean) {
  el.classList.toggle("clustered", clustered);
  el.setAttribute("aria-hidden", clustered ? "true" : "false");
  if (clustered) el.setAttribute("tabindex", "-1");
  else el.removeAttribute("tabindex");
}

/** A plan's pin (§20): a round number ("S" for the start) with its chip beside it; red when late, highlighted when selected. */
export function planPinEl(pin: PlanPin, onPin: (id: string) => void): HTMLButtonElement {
  const el = document.createElement("button");
  el.type = "button";
  el.className = "plan-pin";
  el.innerHTML = `<span class="plan-pin-n"></span><span class="plan-pin-label"></span>`;
  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    onPin(pin.id);
  });
  return el;
}

export function setPlanPin(el: HTMLElement, pin: PlanPin, selected: boolean) {
  el.className = `plan-pin${pin.late ? " late" : ""}${selected ? " sel" : ""}`;
  el.setAttribute("aria-label", pin.label + (pin.late ? " · late" : ""));
  el.setAttribute("aria-pressed", selected ? "true" : "false");
  (el.firstChild as HTMLElement).textContent = String(pin.n);
  (el.lastChild as HTMLElement).textContent = pinChip(pin);
}

/** The playback marker: the recorded time over a round dot (§22). */
export function cursorEl(): HTMLDivElement {
  const el = document.createElement("div");
  el.className = "mk-cursor";
  el.setAttribute("role", "img");
  el.innerHTML = `<span class="mk-cursor-label"></span><span class="mk-cursor-dot"><span class="mk-cursor-arrow"></span></span>`;
  return el;
}

/** Hollow (a ring, no fill) while it crosses a gap; turned to the path's direction when the heading is known. */
export function setCursor(el: HTMLElement, c: NonNullable<MapRoute["cursor"]>) {
  const turned = c.heading != null && Number.isFinite(c.heading);
  el.className = `mk-cursor${c.estimated ? " est" : ""}${turned ? " heading" : ""}`;
  el.setAttribute("aria-label", `Playback ${c.label}${c.estimated ? " · estimated" : ""}`);
  (el.firstChild as HTMLElement).textContent = c.label;
  const arrow = el.querySelector(".mk-cursor-arrow") as HTMLElement | null;
  if (arrow) arrow.style.transform = turned ? `translate(-50%, -50%) rotate(${Math.round(c.heading as number)}deg) translateY(-15px)` : "";
}
