import type { World } from "../engine/types.js";

const radius = 35,
  dx = Math.sqrt(3) * radius,
  dy = 1.5 * radius;
const ns = "http://www.w3.org/2000/svg";
const colors = ["#63cfff", "#ff8e9d", "#9ee394", "#f7d477"];
const teams = ["blue", "coral", "green", "gold"];
const sides = Array.from({ length: 6 }, (_, i) => {
  const angle = (Math.PI / 180) * (60 * i - 30);
  return [Math.cos(angle) * radius, Math.sin(angle) * radius] as const;
});
type Sprites = Readonly<Record<string, string>>;
type Moving = {
  key: string;
  slot: number;
  builder: boolean;
  from: number;
  to: number;
  departedAt: number;
  arrivesAt: number;
};
type Pulse = { element: SVGElement; born: number };
interface BoardCache {
  key: string;
  tick: number;
  particleLayer: SVGGElement;
  effectLayer: SVGGElement;
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
export function hexPoints(width: number, cell: number): string {
  const { x, y } = hexCenter(width, cell);
  return sides
    .map(([sx, sy]) => `${(x + sx).toFixed(2)},${(y + sy).toFixed(2)}`)
    .join(" ");
}
function terrainMarkup(world: Readonly<World>, sprites: Sprites): string {
  return world.map.cells
    .map((cell, index) => {
      const { x, y } = hexCenter(world.map.width, index);
      const variation = ["a", "b", "c"][index % 3];
      const ground =
        cell.terrain === "open" && cell.variant && sprites[cell.variant]
          ? cell.variant
          : `terrain-slate-${variation}`;
      let object = "";
      if (cell.terrain === "deposit")
        object =
          image(sprites, `deposit-${cell.resourceKind}`, x, y, 64) ||
          `<text x="${x}" y="${y + 6}" text-anchor="middle">${cell.resourceKind === "biomass" ? "◈" : "◇"}</text>`;
      if (cell.terrain === "blocked") {
        const variants = [
          "blocker-rock-cluster-a",
          "blocker-boulder-a",
          "blocker-rock-ridge-a",
          "blocker-rock-cluster-b",
          "blocker-boulder-b",
          "blocker-rock-ridge-b",
        ];
        object =
          image(
            sprites,
            cell.variant ?? variants[index % variants.length]!,
            x,
            y,
            66,
          ) || image(sprites, "blocker-boulder", x, y, 66);
      }
      if (cell.terrain === "open" && cell.towerSite)
        object = `<circle class="tower-site" cx="${x}" cy="${y}" r="19"/><text x="${x}" y="${y + 5}" text-anchor="middle">+</text>`;
      return `<g class="hex terrain-${cell.terrain}" data-cell="${index}"><polygon points="${hexPoints(world.map.width, index)}"/><clipPath id="tile-${index}"><polygon points="${hexPoints(world.map.width, index)}"/></clipPath><g class="ground-patch" clip-path="url(#tile-${index})">${image(sprites, ground, x, y, 82) || image(sprites, "terrain-slate-a", x, y, 82)}</g>${object}</g>`;
    })
    .join("");
}

/** Decorative ground continues beyond the selectable cells; it has no game state. */
function backdropMarkup(sprites: Sprites): string {
  const patches: string[] = [];
  // Extra rows/columns overlap the pattern boundary so its edges have no gaps.
  for (let row = -1; row <= 2; row++) {
    for (let column = -1; column <= 3; column++) {
      const x = radius + dx * (column + (row & 1) / 2);
      const y = radius + dy * row;
      const points = sides.map(([sx, sy]) => `${x + sx},${y + sy}`).join(" ");
      const id = `ground-${row + 1}-${column + 1}`;
      const variant = ["a", "b", "c"][(column + 3) % 3];
      patches.push(
        `<clipPath id="${id}"><polygon points="${points}"/></clipPath><g class="ground-patch" clip-path="url(#${id})">${image(sprites, `terrain-slate-${variant}`, x, y, 82) || image(sprites, "terrain-slate-a", x, y, 82)}</g>`,
      );
    }
  }
  return `<defs><pattern id="ground-continuation" patternUnits="userSpaceOnUse" width="${dx * 3}" height="${dy * 2}"><rect width="100%" height="100%" fill="#122840"/>${patches.join("")}</pattern></defs><rect class="terrain-backdrop" width="100%" height="100%" fill="url(#ground-continuation)"/>`;
}
function structureMarkup(world: Readonly<World>, sprites: Sprites): string {
  return world.structures
    .map((s) => {
      const { x, y } = hexCenter(world.map.width, s.cell),
        slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
      const sprite =
        s.kind === "brain"
          ? sprites[`brain-${teams[slot]}-v2`] ||
            sprites[`brain-${teams[slot]}`]
            ? `brain-${teams[slot]}`
            : "brain"
          : s.kind === "tower"
            ? "tower-experimental"
            : `neuron-${teams[slot]}`;
      const hpMax = s.kind === "brain" ? 240 : s.kind === "tower" ? 100 : 60;
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
      return `<g class="structure ${s.connected ? "" : "disconnected"}" data-cell="${s.cell}" style="--team:${colors[slot]}"><circle class="owner-ring" cx="${x}" cy="${y}" r="${s.kind === "brain" ? 27 : 10}"/>${image(sprites, sprite, x, y, s.kind === "brain" ? 72 : 66) || `<circle class="structure-core" cx="${x}" cy="${y}" r="15"/>`}<path class="owner-notch" d="M${x - 5} ${y + 27}h10"/><text class="owner-number" x="${x}" y="${y + 31}" text-anchor="middle">${slot + 1}</text>${health}<circle class="charge-halo" cx="${x}" cy="${y}" r="10" opacity="${Math.min(0.7, stock / 48)}"/></g>`;
    })
    .join("");
}
function linkMarkup(world: Readonly<World>): string {
  const nodes = new Map(
    world.structures.filter((s) => s.connected).map((s) => [s.cell, s]),
  );
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
      lines.push(
        `<path class="axon" style="stroke:${colors[slot]}" d="M${a.x} ${a.y}L${b.x} ${b.y}"/>`,
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
      structures = layer(svg, "structure-layer");
    const particleLayer = layer(svg, "particle-layer"),
      effectLayer = layer(svg, "effect-layer");
    for (const decorative of [territory, links, particleLayer, effectLayer])
      decorative.setAttribute("pointer-events", "none");
    if (debug)
      layer(svg, "debug-grid").innerHTML = world.map.cells
        .map((_, i) => `<polygon points="${hexPoints(width, i)}"/>`)
        .join("");
    const selection = svg.ownerDocument.createElementNS(ns, "polygon");
    selection.setAttribute("class", "selected-hex");
    svg.append(selection);
    cached = {
      key,
      tick: world.tick,
      links,
      queues,
      structures,
      particleLayer,
      effectLayer,
      selection,
      movers: new Map(),
      prior: new Map(),
      pulses: [],
      territory,
    };
    caches.set(svg, cached);
  }
  const cache = cached;
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
          `<polygon points="${hexPoints(width, s.cell)}" fill="${colors[world.players.find((p) => p.id === s.ownerId)?.slot ?? 0]}" opacity="${s.connected ? 0.17 : 0.055}" pointer-events="none"/>`,
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
          return `<g class="queue-mark" data-cell="${q.cell}" style="--team:${colors[p.slot]}">${q.paid ? image(sprites, "construction-site", x, y, 62) : ""}<circle cx="${x}" cy="${y}" r="24"/><text x="${x}" y="${y + 5}" text-anchor="middle">${i + 1}</text></g>`;
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
        cache.effectLayer.append(circle);
        cache.pulses.push({ element: circle, born: now });
      }
    }
  if (world.tick !== cache.tick && !reducedMotion)
    for (const outcome of world.outcomes) {
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
        m.builder ? "builder-particle" : "attack-particle",
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
  const animate = (frameNow: number) => {
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
      const t = (frameNow - p.born) / 320;
      if (t >= 1 || reducedMotion) {
        p.element.remove();
        return false;
      }
      p.element.setAttribute("r", String(10 + t * 21));
      p.element.setAttribute("opacity", String(1 - t));
      return true;
    });
  };
  animate(now);
  return { animate };
}
