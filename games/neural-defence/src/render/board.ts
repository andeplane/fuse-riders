import type { World, StructureKind } from "../engine/types.js";
import { STRUCTURES } from "../engine/catalog.js";
import { structureArt, teamArtFilter } from "./art.js";
import { terrainArt, WALKABLE_GROUND } from "./terrain-art.js";

const radius = 35,
  dx = Math.sqrt(3) * radius,
  dy = 1.5 * radius;
const ns = "http://www.w3.org/2000/svg";
const colors = ["#63cfff", "#ff8e9d", "#9ee394", "#f7d477"];
const sides = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
});
type Sprites = Readonly<Record<string, string>>;
type Moving = {
  kind?: "pulse" | "heavy" | "swift";
  key: string;
  slot: number;
  builder: boolean;
  from: number;
  to: number;
  departedAt: number;
  arrivesAt: number;
};
type Pulse = {
  element: SVGElement;
  born: number;
  duration?: number;
  arrival?: boolean;
};
interface BoardCache {
  key: string;
  tick: number;
  particleLayer: SVGGElement;
  effectLayer: SVGGElement;
  groundEffects: SVGGElement;
  arrivalAt: Map<number, number>;
  movers: Map<string, SVGGElement>;
  prior: Map<number, number>;
  pulses: Pulse[];
  structures: SVGGElement;
  links: SVGGElement;
  queues: SVGGElement;
  selection: SVGPolygonElement;
  territory: SVGGElement;
}
const caches = new WeakMap<SVGSVGElement, BoardCache>();
const escaped = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function image(
  sprites: Sprites,
  name: string,
  x: number,
  y: number,
  size: number,
): string {
  const url = sprites[`${name}-v2`] ?? sprites[name];
  return url
    ? `<image href="${escaped(url)}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" pointer-events="none"/>`
    : "";
}
export function hexCenter(
  width: number,
  cell: number,
): { x: number; y: number } {
  const row = Math.floor(cell / width),
    column = cell % width;
  return { x: radius + dx * (column + (row & 1) / 2), y: radius + dy * row };
}
export function hexPoints(width: number, cell: number, inset = 0): string {
  const { x, y } = hexCenter(width, cell);
  const scale = (radius - inset) / radius;
  return sides
    .map(
      ([sx, sy]) =>
        `${(x + sx * scale).toFixed(2)},${(y + sy * scale).toFixed(2)}`,
    )
    .join(" ");
}
function terrainMarkup(world: Readonly<World>, sprites: Sprites): string {
  return world.map.cells
    .map((cell, index) => {
      const { x, y } = hexCenter(world.map.width, index);
      const art = terrainArt(cell, index);
      const ground = cell.terrain === "open" ? art : null;
      let object = "";
      if (cell.terrain === "deposit")
        object =
          image(sprites, art!, x, y, 58) ||
          `<text x="${x}" y="${y + 6}" text-anchor="middle">${cell.resourceKind === "biomass" ? "◈" : "◇"}</text>`;
      if (cell.terrain === "blocked") {
        object =
          image(sprites, art!, x, y, 60) ||
          image(sprites, "blocker-boulder", x, y, 60) ||
          `<path d="M${x - 23} ${y + 13}l5 -29 22 -10 22 23 -4 24Z" fill="#68757a" stroke="#29383d" stroke-width="3"/>`;
      }
      if (cell.terrain === "open" && cell.towerSite)
        object = `<circle class="tower-site" cx="${x}" cy="${y}" r="19"/><text x="${x}" y="${y + 5}" text-anchor="middle">+</text>`;
      return `<g class="hex terrain-${cell.terrain}" data-cell="${index}"><polygon points="${hexPoints(world.map.width, index)}"/><clipPath id="tile-${index}"><polygon points="${hexPoints(world.map.width, index)}"/></clipPath><g class="ground-patch" clip-path="url(#tile-${index})">${ground ? image(sprites, ground, x, y, 82) : ""}</g>${object ? `<g class="terrain-object" clip-path="url(#tile-${index})" pointer-events="none"><ellipse cx="${x + 3}" cy="${y + 17}" rx="27" ry="12" fill="url(#contact-shadow)"/>${object}</g>` : ""}<polygon class="hex-hover-outline" points="${hexPoints(world.map.width, index, 1.5)}"/></g>`;
    })
    .join("");
}

/** Decorative ground continues beyond the selectable cells; it has no game state. */
function backdropMarkup(sprites: Sprites): string {
  const ground = sprites[WALKABLE_GROUND];
  return `<defs><radialGradient id="contact-shadow"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><pattern id="ground-continuation" patternUnits="userSpaceOnUse" width="840" height="560"><rect width="840" height="560" fill="#26322e"/>${ground ? `<image href="${escaped(ground)}" width="840" height="560"/>` : ""}</pattern></defs><rect class="terrain-backdrop" width="100%" height="100%" fill="url(#ground-continuation)"/>`;
}
/** Reuse the illustrated tissue for placement and the board, with stable variation. */
export function neuronArtwork(
  width: number,
  cell: number,
  slot: number,
  sprites: Sprites = {},
): string {
  const { x, y } = hexCenter(width, cell);
  const seed = (cell * 37 + slot * 17) % 97;
  const size = 49 + (seed % 7);
  return `<g class="neuron-body" data-phase="${seed}" style="--team:${colors[slot]};transform-origin:${x}px ${y}px"><g style="filter:${teamArtFilter(slot)}" transform="rotate(${(seed % 6) * 60} ${x} ${y})">${image(sprites, structureArt("neuron", cell), x, y, size) || image(sprites, "neuron-v3", x, y, size) || `<circle class="structure-core" cx="${x}" cy="${y}" r="12"/>`}</g></g>`;
}
export function structureArtwork(
  width: number,
  cell: number,
  kind: StructureKind,
  slot: number,
  sprites: Sprites = {},
): string {
  if (kind === "neuron") return neuronArtwork(width, cell, slot, sprites);
  const { x, y } = hexCenter(width, cell);
  const size = kind === "brain" ? 90 : kind === "relay" ? 96 : 84;
  return `<g class="building-art" style="filter:${teamArtFilter(slot)}">${image(sprites, structureArt(kind), x, y + 36 - size / 2, size) || `<circle class="structure-core" cx="${x}" cy="${y}" r="16"/>`}</g>`;
}
function structureMarkup(world: Readonly<World>, sprites: Sprites): string {
  return [...world.structures]
    .sort((a, b) => a.cell - b.cell)
    .map((s) => {
      const { x, y } = hexCenter(world.map.width, s.cell),
        slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
      const hpMax = STRUCTURES[s.kind].hp;
      const stock = world.particles.filter(
        (p) =>
          p.ownerId === s.ownerId &&
          p.cell === s.cell &&
          p.mode === "stationed",
      ).length;
      const health =
        s.hp < hpMax
          ? `<rect class="structure-hp-bg" x="${x - 18}" y="${y - 29}" width="36" height="3"/><rect class="structure-hp" x="${x - 18}" y="${y - 29}" width="${36 * Math.max(0, Math.min(1, s.hp / hpMax))}" height="3"/>`
          : "";
      const artwork = structureArtwork(
        world.map.width,
        s.cell,
        s.kind,
        slot,
        sprites,
      );
      // Select the raised body as well as the ground footprint. These are
      // presentation hit regions only; placement continues to target terrain.
      const hit =
        s.kind === "neuron"
          ? { rx: 17, ry: 17, offset: 0 }
          : s.kind === "brain" || s.kind === "relay"
            ? { rx: 24, ry: 41, offset: -8 }
            : { rx: 24, ry: 33, offset: -3 };
      return `<g class="structure structure-${s.kind} ${s.connected ? "" : "disconnected"}" data-cell="${s.cell}" style="--team:${colors[slot]}"><ellipse class="contact-shadow" cx="${x + 4}" cy="${y + 19}" rx="${s.kind === "neuron" ? 23 : 34}" ry="16" fill="url(#contact-shadow)"/><circle class="owner-ring" cx="${x}" cy="${y}" r="${s.kind === "brain" ? 27 : 10}"/>${artwork || `<circle class="structure-core" cx="${x}" cy="${y}" r="15"/>`}${stock && s.connected ? `<g class="supply-orbit" style="transform-origin:${x}px ${y}px">${Array.from({ length: Math.min(6, Math.ceil(stock / 8)) }, (_, i) => `<circle cx="${x + Math.cos((i * Math.PI) / 3) * 22}" cy="${y + Math.sin((i * Math.PI) / 3) * 22}" r="2" fill="${colors[slot]}"/>`).join("")}</g>` : ""}${health}<circle class="charge-halo" cx="${x}" cy="${y}" r="10" opacity="${Math.min(0.7, stock / 48)}"/><ellipse class="structure-hit" cx="${x}" cy="${y + hit.offset}" rx="${hit.rx}" ry="${hit.ry}"/></g>`;
    })
    .join("");
}
function linkMarkup(world: Readonly<World>): string {
  const nodes = new Map(world.structures.map((s) => [s.cell, s]));
  const lines: string[] = [];
  for (const s of nodes.values()) {
    const row = Math.floor(s.cell / world.map.width),
      col = s.cell % world.map.width;
    const candidates: readonly (readonly [number, number])[] = [
      [col + 1, row],
      [col + (row & 1), row + 1],
      [col - 1 + (row & 1), row + 1],
    ];
    for (const [c, r] of candidates) {
      if (c < 0 || r < 0 || c >= world.map.width || r >= world.map.height)
        continue;
      const peer = nodes.get(r * world.map.width + c);
      if (!peer || peer.ownerId !== s.ownerId) continue;
      const a = hexCenter(world.map.width, s.cell),
        b = hexCenter(world.map.width, peer.cell),
        slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
      const connected = s.connected && peer.connected;
      const bend = (((s.cell + peer.cell) % 3) - 1) * 5;
      const curve = `M${a.x} ${a.y}Q${(a.x + b.x) / 2 + bend} ${(a.y + b.y) / 2 - bend} ${b.x} ${b.y}`;
      lines.push(
        `<g class="network-link${connected ? "" : " disconnected-link"}" data-from="${s.cell}" data-to="${peer.cell}" style="--team:${colors[slot]}"><path class="axon-sheath" d="${curve}"/><path class="axon" d="${curve}"/></g>`,
      );
    }
  }
  return lines.join("");
}
function setMarkup(element: SVGElement, markup: string): void {
  if (element.getAttribute("data-markup") === markup) return;
  element.innerHTML = markup;
  element.setAttribute("data-markup", markup);
}
function layer(svg: SVGSVGElement, className: string): SVGGElement {
  const element = svg.ownerDocument.createElementNS(ns, "g");
  element.setAttribute("class", className);
  svg.append(element);
  return element;
}
export interface BoardAnimation {
  animate(now: number): void;
}

/** Render exact simulation journeys. RAF only interpolates one tick; it never launches or resolves a particle. */
export function renderBoard(
  svg: SVGSVGElement,
  world: Readonly<World>,
  selected: number | null,
  debug: boolean,
  reducedMotion: boolean,
  now: number,
  sprites: Sprites = {},
): BoardAnimation {
  const width = world.map.width,
    height = world.map.height;
  const key = JSON.stringify([
    world.matchId,
    world.map,
    debug,
    Object.keys(sprites),
  ]);
  let cached = caches.get(svg);
  if (!cached || cached.key !== key || world.tick < cached.tick) {
    svg.replaceChildren();
    svg.setAttribute(
      "viewBox",
      `0 0 ${Math.ceil(dx * (width - 0.5) + radius * 2)} ${dy * (height - 1) + radius * 2}`,
    );
    svg.setAttribute("role", "img");
    const backdrop = layer(svg, "backdrop-layer");
    backdrop.setAttribute("pointer-events", "none");
    backdrop.innerHTML = backdropMarkup(sprites);
    layer(svg, "terrain-layer").innerHTML = terrainMarkup(world, sprites);
    const territory = layer(svg, "territory-layer");
    const links = layer(svg, "link-layer"),
      queues = layer(svg, "queue-layer"),
      groundEffects = layer(svg, "ground-effect-layer"),
      structures = layer(svg, "structure-layer");
    const particleLayer = layer(svg, "particle-layer"),
      effectLayer = layer(svg, "effect-layer");
    for (const decorative of [
      territory,
      links,
      groundEffects,
      particleLayer,
      effectLayer,
    ])
      decorative.setAttribute("pointer-events", "none");
    if (debug)
      layer(svg, "debug-grid").innerHTML = world.map.cells
        .map((_, i) => `<polygon points="${hexPoints(width, i)}"/>`)
        .join("");
    const selection = svg.ownerDocument.createElementNS(ns, "polygon");
    selection.setAttribute("class", "selected-hex");
    // Selection belongs on the ground plane, below the building silhouette.
    svg.insertBefore(selection, structures);
    cached = {
      key,
      tick: world.tick,
      links,
      queues,
      structures,
      particleLayer,
      effectLayer,
      groundEffects,
      arrivalAt: new Map(),
      selection,
      movers: new Map(),
      prior: new Map(),
      pulses: [],
      territory,
    };
    caches.set(svg, cached);
  }
  const cache = cached;
  svg.setAttribute("data-reduced-motion", String(reducedMotion));
  svg.setAttribute(
    "aria-label",
    `${width} by ${height} hex map. Selected hex ${selected ?? "none"}.`,
  );
  cache.selection.setAttribute(
    "points",
    selected === null ? "" : hexPoints(width, selected),
  );
  setMarkup(cache.links, linkMarkup(world));
  setMarkup(
    cache.territory,
    world.structures
      .map(
        (s) =>
          `<circle cx="${hexCenter(width, s.cell).x}" cy="${hexCenter(width, s.cell).y}" r="25" fill="${colors[world.players.find((p) => p.id === s.ownerId)?.slot ?? 0]}" opacity="${s.connected ? 0.065 : 0.025}" pointer-events="none"/>`,
      )
      .join(""),
  );
  setMarkup(cache.structures, structureMarkup(world, sprites));
  setMarkup(
    cache.queues,
    world.players
      .flatMap((p) =>
        p.queue.map((q, i) => {
          const { x, y } = hexCenter(width, q.cell);
          return `<g class="queue-mark" data-cell="${q.cell}" style="--team:${colors[p.slot]}">${q.paid ? `<g opacity="${0.25 + (0.55 * q.progress) / Math.max(1, q.duration)}">${structureArtwork(width, q.cell, q.kind, p.slot, sprites)}</g><circle class="site-progress" cx="${x}" cy="${y}" r="24" pathLength="1" stroke-dasharray="${q.progress / Math.max(1, q.duration)} 1"/>` : ""}<circle cx="${x}" cy="${y}" r="24"/><text x="${x}" y="${y + 5}" text-anchor="middle">${i + 1}</text></g>`;
        }),
      )
      .join(""),
  );
  if (world.tick !== cache.tick && !reducedMotion)
    for (const p of world.particles) {
      if (
        cache.prior.has(p.id) &&
        p.mode === "stationed" &&
        p.cell === cache.prior.get(p.id) &&
        now - (cache.arrivalAt.get(p.cell) ?? -Infinity) >= 160 &&
        cache.pulses.length < 48
      ) {
        const circle = svg.ownerDocument.createElementNS(ns, "circle"),
          { x, y } = hexCenter(width, p.cell);
        circle.setAttribute("cx", String(x));
        circle.setAttribute("cy", String(y));
        circle.setAttribute("class", "arrival-pulse");
        circle.setAttribute(
          "stroke",
          colors[world.players.find((o) => o.id === p.ownerId)?.slot ?? 0]!,
        );
        cache.arrivalAt.set(p.cell, now);
        cache.groundEffects.append(circle);
        cache.pulses.push({
          element: circle,
          born: now,
          duration: 260,
          arrival: true,
        });
      }
    }
  if (world.tick !== cache.tick && !reducedMotion)
    for (const outcome of world.outcomes) {
      if (
        outcome.cell !== undefined &&
        (outcome.type === "constructed" || outcome.type === "destroyed") &&
        cache.pulses.length < 48
      ) {
        const { x, y } = hexCenter(width, outcome.cell);
        const burst = svg.ownerDocument.createElementNS(ns, "circle");
        burst.setAttribute("cx", String(x));
        burst.setAttribute("cy", String(y));
        burst.setAttribute(
          "class",
          outcome.type === "destroyed" ? "destruction-burst" : "growth-burst",
        );
        cache.effectLayer.append(burst);
        cache.pulses.push({ element: burst, born: now, duration: 650 });
      }
      if (
        outcome.type !== "damage" ||
        outcome.fromCell === undefined ||
        outcome.cell === undefined ||
        cache.pulses.length >= 48
      )
        continue;
      const a = hexCenter(width, outcome.fromCell),
        b = hexCenter(width, outcome.cell);
      const beam = svg.ownerDocument.createElementNS(ns, "path");
      beam.setAttribute("d", `M${a.x} ${a.y}L${b.x} ${b.y}`);
      beam.setAttribute(
        "stroke",
        colors[
          world.players.find((p) => p.id === outcome.playerId)?.slot ?? 0
        ]!,
      );
      beam.setAttribute("stroke-width", "4");
      beam.setAttribute("fill", "none");
      beam.setAttribute("class", "attack-flash");
      cache.effectLayer.append(beam);
      cache.pulses.push({ element: beam, born: now });
      if (cache.pulses.length < 48) {
        const impact = svg.ownerDocument.createElementNS(ns, "circle");
        impact.setAttribute("cx", String(b.x));
        impact.setAttribute("cy", String(b.y));
        impact.setAttribute("class", "impact-burst");
        cache.effectLayer.append(impact);
        cache.pulses.push({ element: impact, born: now, duration: 240 });
      }
    }
  cache.prior = new Map(
    world.particles
      .filter((p) => p.mode === "transit")
      .map((p) => [p.id, p.to]),
  );
  cache.tick = world.tick;
  const moving: Moving[] = world.particles
    .filter((p) => p.mode === "transit")
    .map((p) => ({
      key: `p${p.id}`,
      kind: p.kind,
      slot: world.players.find((o) => o.id === p.ownerId)?.slot ?? 0,
      builder: false,
      from: p.from,
      to: p.to,
      departedAt: p.departedAt,
      arrivesAt: p.arrivesAt,
    }));
  for (const p of world.players)
    if (p.alive && p.worker.mode !== "recovering" && p.worker.mode !== "idle") {
      const w = p.worker,
        movingEdge =
          (w.mode === "outbound" || w.mode === "returning") &&
          w.arrivesAt > world.tick;
      moving.push({
        key: `w${p.id}`,
        slot: p.slot,
        builder: true,
        from: movingEdge ? w.from : w.cell,
        to: movingEdge ? w.to : w.cell,
        departedAt: w.departedAt,
        arrivesAt: w.arrivesAt,
      });
    }
  const keys = new Set(moving.map((m) => m.key));
  for (const [id, element] of cache.movers)
    if (!keys.has(id)) {
      element.remove();
      cache.movers.delete(id);
    }
  for (const m of moving)
    if (!cache.movers.has(m.key)) {
      const element = svg.ownerDocument.createElementNS(ns, "g");
      element.setAttribute(
        "class",
        m.builder ? "builder-particle" : `attack-particle particle-${m.kind}`,
      );
      element.style.setProperty("--team", colors[m.slot]!);
      element.innerHTML = `<path class="particle-trail"/><g class="moving-glyph">${image(sprites, m.builder ? "particle-builder" : "particle-attack", 0, 0, m.builder ? 24 : 16) || `<circle r="${m.builder ? 5 : 3}" fill="${colors[m.slot]}"/>`}</g>`;
      cache.particleLayer.append(element);
      cache.movers.set(m.key, element);
    }
  const elements = moving.map((m) => ({
    m,
    glyph: cache.movers
      .get(m.key)!
      .querySelector<SVGGElement>(".moving-glyph")!,
    trail: cache.movers
      .get(m.key)!
      .querySelector<SVGPathElement>(".particle-trail")!,
  }));
  const orbits = [
    ...cache.structures.querySelectorAll<SVGGElement>(".supply-orbit"),
  ];
  const neurons = [
    ...cache.structures.querySelectorAll<SVGGElement>(
      ".structure-neuron:not(.disconnected) .neuron-body",
    ),
  ];
  const animate = (frameNow: number) => {
    // Absolute presentation time preserves phase when authoritative stock/HP
    // changes rebuild the structure markup. No simulation state is advanced.
    for (const orbit of orbits)
      orbit.style.transform = `rotate(${reducedMotion ? 0 : ((frameNow % 5000) * 360) / 5000}deg)`;
    for (const neuron of neurons) {
      const phase = Number(neuron.getAttribute("data-phase"));
      const breath = reducedMotion ? 0 : Math.sin(frameNow / 650 + phase);
      neuron.style.transform = `scale(${1 + breath * 0.07}, ${1 - breath * 0.045}) rotate(${breath * 3}deg)`;
    }
    const visualTick =
      world.tick +
      (reducedMotion ? 0 : Math.max(0, Math.min(1, (frameNow - now) / 50)));
    for (const { m, glyph, trail } of elements) {
      const a = hexCenter(width, m.from),
        b = hexCenter(width, m.to);
      const fraction = Math.max(
        0,
        Math.min(
          1,
          (visualTick - m.departedAt) / Math.max(1, m.arrivesAt - m.departedAt),
        ),
      );
      const x = a.x + (b.x - a.x) * fraction,
        y = a.y + (b.y - a.y) * fraction;
      const direction = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      glyph.setAttribute(
        "transform",
        `translate(${x} ${y}) rotate(${direction})`,
      );
      const tail = Math.max(0, fraction - 0.2);
      trail.setAttribute(
        "d",
        reducedMotion
          ? ""
          : `M${a.x + (b.x - a.x) * tail} ${a.y + (b.y - a.y) * tail}L${x} ${y}`,
      );
    }
    cache.pulses = cache.pulses.filter((p) => {
      const t = (frameNow - p.born) / (p.duration ?? 320);
      if (t >= 1 || reducedMotion) {
        p.element.remove();
        return false;
      }
      p.element.setAttribute("r", String(p.arrival ? 8 + t * 13 : 10 + t * 21));
      p.element.setAttribute(
        "opacity",
        String((p.arrival ? 0.35 : 1) * (1 - t)),
      );
      return true;
    });
  };
  animate(now);
  return { animate };
}
