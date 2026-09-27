import type { World, StructureKind } from "../engine/types.js";
import { refreshSpriteImages, type BuildingSprites } from "./sprite-raster.js";
import { STRUCTURES, attackCells } from "../engine/catalog.js";
import { neighbors } from "../engine/map.js";
import { structureArt, teamSvgFilter, svgArtFilters } from "./art.js";
import { terrainArt, WALKABLE_GROUND } from "./terrain-art.js";
import { combatEffect } from "./combat-effects.js";
import { damagePlume, damageAnimation } from "./damage-plume.js";
import { weaponFlightMs } from "./weapon-trail.js";
import { rockRelief, rockReliefMarkup } from "./terrain-relief.js";
import {
  networkPath,
  networkPathMarkup,
  sampleNetworkPath,
} from "./network-path.js";
import {
  constructionMarkup,
  constructionAnimation,
} from "./construction-effects.js";
import { hexCenter, hexPoints, boardSize } from "./projection.js";
export { hexCenter, hexPoints } from "./projection.js";
const ns = "http://www.w3.org/2000/svg";
const colors = ["#63cfff", "#ff8e9d", "#9ee394", "#f7d477"];
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
  ground?: SVGElement;
  body?: SVGElement;
  animate?: (age: number) => void;
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
  castShadows: SVGGElement;
  links: SVGGElement;
  queues: SVGGElement;
  selection: SVGPolygonElement;
  firingRange: SVGGElement;
  territory: SVGGElement;
  terrainObjects: SVGElement[];
  recoil: Map<number, { born: number; dx: number; dy: number }>;
  weaponKinds: Map<string, StructureKind>;
}
const caches = new WeakMap<SVGSVGElement, BoardCache>();
function weaponStyle(
  world: Readonly<World>,
  cache: BoardCache,
  owner: string,
  cell: number | undefined,
): "siege" | "relay" | "pulse" {
  const kind =
    world.structures.find((s) => s.ownerId === owner && s.cell === cell)
      ?.kind ??
    (world.tick === cache.tick + 1
      ? cache.weaponKinds.get(`${owner}:${cell}`)
      : undefined);
  return kind === "siege" || kind === "relay" ? kind : "pulse";
}
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
    ? `<image href="${escaped(url)}" data-sprite="${escaped(name)}" x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" pointer-events="none"/>`
    : "";
}
function terrainMarkup(world: Readonly<World>, sprites: Sprites): string {
  const relief = new Map(
    rockRelief(world.map).map((rock) => [rock.cell, rock]),
  );
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
        const rock = relief.get(index);
        object =
          image(sprites, art!, x, y - (rock?.height ?? 0), rock ? 48 : 60) ||
          image(sprites, "blocker-boulder", x, y, 60) ||
          `<path class="terrain-fallback" d="M${x - 23} ${y + 13}l5 -29 22 -10 22 23 -4 24Z" fill="#68757a" stroke="#29383d" stroke-width="3"/>`;
        if (rock) object = rockReliefMarkup(rock) + object;
      }
      if (cell.terrain === "open" && cell.towerSite)
        object = `<circle class="tower-site" cx="${x}" cy="${y}" r="19"/><text x="${x}" y="${y + 5}" text-anchor="middle">+</text>`;
      if (object && cell.terrain !== "open")
        object += `<ellipse class="terrain-hit" data-cell="${index}" cx="${x}" cy="${y - 3 - (relief.get(index)?.height ?? 0)}" rx="${relief.has(index) ? 24 : 20}" ry="${relief.has(index) ? 32 : 25}"/>`;
      return `<g class="hex terrain-${cell.terrain}" data-cell="${index}"><polygon points="${hexPoints(world.map.width, index)}"/><clipPath id="tile-${index}"><polygon points="${hexPoints(world.map.width, index)}"/></clipPath><g class="ground-patch" clip-path="url(#tile-${index})">${ground ? image(sprites, ground, x, y, 82) : ""}</g>${object ? `<g class="terrain-object" data-terrain="${cell.terrain}" data-depth="${index}" pointer-events="none"><ellipse cx="${x + 9}" cy="${y + 14}" rx="30" ry="10" fill="url(#contact-shadow)"/>${object}</g>` : ""}<polygon class="hex-hover-outline" points="${hexPoints(world.map.width, index, 1.5)}"/></g>`;
    })
    .join("");
}

/** Decorative ground continues beyond the selectable cells; it has no game state. */
function backdropMarkup(
  sprites: Sprites,
  size: { width: number; height: number },
): string {
  const ground = sprites[WALKABLE_GROUND];
  const cliff = sprites["terrain-cliff-material-v1"];
  return `<defs><pattern id="cliff-material" patternUnits="userSpaceOnUse" width="180" height="180"><rect width="180" height="180" fill="#657078"/>${cliff ? `<image href="${escaped(cliff)}" width="180" height="180"/>` : ""}</pattern><radialGradient id="contact-shadow"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><pattern id="ground-continuation" patternUnits="userSpaceOnUse" width="${size.width * 2}" height="${size.height * 2}"><rect width="${size.width * 2}" height="${size.height * 2}" fill="#172723"/>${ground ? ["", `translate(${size.width * 2} 0) scale(-1 1)`, `translate(0 ${size.height * 2}) scale(1 -1)`, `translate(${size.width * 2} ${size.height * 2}) scale(-1 -1)`].map((transform) => `<image href="${escaped(ground)}" width="${size.width}" height="${size.height}" preserveAspectRatio="none" transform="${transform}" opacity="0.5"/>`).join("") : ""}</pattern></defs><rect class="terrain-backdrop" width="100%" height="100%" fill="url(#ground-continuation)"/>`;
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
  return `<g class="neuron-body" data-phase="${seed}" style="--team:${colors[slot]};transform-origin:${x}px ${y}px"><g filter="${teamSvgFilter(slot)}" transform="rotate(${(seed % 6) * 60} ${x} ${y})">${image(sprites, structureArt("neuron", cell), x, y, size) || image(sprites, "neuron-v3", x, y, size) || `<circle class="structure-core" cx="${x}" cy="${y}" r="12"/>`}</g></g>`;
}
const buildingFoot = 25;
function buildingSize(kind: Exclude<StructureKind, "neuron">): number {
  return kind === "brain" ? 90 : kind === "relay" ? 96 : 84;
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
  const size = buildingSize(kind);
  return `<g class="building-art" filter="${teamSvgFilter(slot)}">${image(sprites, structureArt(kind), x, y + buildingFoot - size / 2, size) || `<circle class="structure-core" cx="${x}" cy="${y}" r="16"/>`}</g>`;
}
/** Project the sprite silhouette away from a shared upper-left light source. */
function shadowMarkup(world: Readonly<World>, sprites: Sprites): string {
  return world.structures
    .map((s) => {
      if (s.kind === "neuron") return "";
      const { x, y } = hexCenter(world.map.width, s.cell);
      const foot = y + buildingFoot;
      const size = buildingSize(s.kind);
      return `<g class="building-cast-shadow" transform="matrix(1 0 -0.55 -0.3 ${0.55 * foot} ${1.3 * foot})" filter="url(#nd-art-shadow)" opacity="0.28">${image(sprites, structureArt(s.kind), x, foot - size / 2, size)}</g>`;
    })
    .join("");
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
      const healthY =
        s.kind === "neuron"
          ? y - 35
          : y + buildingFoot - buildingSize(s.kind) - 7;
      const health =
        s.hp < hpMax
          ? `<rect class="structure-hp-bg" x="${x - 18}" y="${healthY}" width="36" height="3"/><rect class="structure-hp" x="${x - 18}" y="${healthY}" width="${36 * Math.max(0, Math.min(1, s.hp / hpMax))}" height="3"/>`
          : "";
      const artwork =
        structureArtwork(world.map.width, s.cell, s.kind, slot, sprites) +
        (s.kind === "neuron"
          ? ""
          : damagePlume(x + 6, y - 18, s.hp / hpMax, s.id));
      // Select the raised body as well as the ground footprint. These are
      // presentation hit regions only; placement continues to target terrain.
      const hit =
        s.kind === "neuron"
          ? { rx: 17, ry: 17, offset: 0 }
          : s.kind === "brain" || s.kind === "relay"
            ? { rx: 24, ry: 41, offset: -19 }
            : { rx: 24, ry: 33, offset: -14 };
      const supply =
        stock && s.connected
          ? `<ellipse class="supply-footprint" cx="${x}" cy="${y + 20}" rx="${s.kind === "neuron" ? 20 : 29}" ry="9" opacity="${Math.min(0.35, stock / 96)}"/>`
          : "";
      return `<g class="structure structure-${s.kind} ${s.connected ? "" : "disconnected"}" data-cell="${s.cell}" style="--team:${colors[slot]}"><ellipse class="contact-shadow" cx="${x + 4}" cy="${y + 19}" rx="${s.kind === "neuron" ? 23 : 34}" ry="16" fill="url(#contact-shadow)"/>${supply}<circle class="owner-ring" cx="${x}" cy="${y}" r="${s.kind === "brain" ? 27 : 10}"/>${artwork || `<circle class="structure-core" cx="${x}" cy="${y}" r="15"/>`}${stock && s.connected ? `<g class="supply-orbit" style="transform-origin:${x}px ${y}px">${Array.from({ length: Math.min(6, Math.ceil(stock / 8)) }, (_, i) => `<circle cx="${x + Math.cos((i * Math.PI) / 3) * 22}" cy="${y + Math.sin((i * Math.PI) / 3) * 22}" r="2" fill="${colors[slot]}"/>`).join("")}</g>` : ""}${health}<ellipse class="structure-hit" cx="${x}" cy="${y + hit.offset}" rx="${hit.rx}" ry="${hit.ry}"/></g>`;
    })
    .join("");
}
function linkMarkup(world: Readonly<World>): string {
  const nodes = new Map(world.structures.map((s) => [s.cell, s]));
  const lines: string[] = [];
  for (const s of nodes.values()) {
    if (s.connected && STRUCTURES[s.kind].miningBonus) {
      const to = hexCenter(world.map.width, s.cell);
      for (const cell of neighbors(world.map, s.cell)) {
        const deposit = world.map.cells[cell];
        if (deposit?.terrain !== "deposit") continue;
        const from = hexCenter(world.map.width, cell);
        lines.push(
          `<path class="extraction-flow extraction-${deposit.resourceKind}" d="M${from.x} ${from.y}L${to.x} ${to.y}"/>`,
        );
      }
    }
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
      const slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
      const connected = s.connected && peer.connected;
      const curve = networkPathMarkup(
        networkPath(world.map.width, s.cell, peer.cell),
      );
      lines.push(
        `<g class="network-link${connected ? "" : " disconnected-link"}" data-from="${s.cell}" data-to="${peer.cell}" style="--team:${colors[slot]}"><path class="axon-shadow" d="${curve}"/><path class="axon-sheath" d="${curve}"/><path class="axon-rim" d="${curve}"/><path class="axon" d="${curve}"/></g>`,
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
function constructionBodies(world: Readonly<World>, sprites: Sprites): string {
  return world.players
    .flatMap((p) =>
      p.queue
        .filter((q) => q.paid)
        .map((q) => {
          const at = hexCenter(world.map.width, q.cell);
          return constructionMarkup({
            cell: q.cell,
            slot: p.slot,
            ...at,
            height: q.kind === "neuron" ? 56 : buildingSize(q.kind),
            progress: q.progress / Math.max(1, q.duration),
            active: p.worker.mode === "building",
            color: colors[p.slot]!,
            artwork: structureArtwork(
              world.map.width,
              q.cell,
              q.kind,
              p.slot,
              sprites,
            ),
          });
        }),
    )
    .join("");
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
  buildingSprites?: BuildingSprites,
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
    const size = boardSize(width, height);
    svg.setAttribute("viewBox", `0 0 ${size.width} ${size.height}`);
    svg.setAttribute("role", "img");
    const backdrop = layer(svg, "backdrop-layer");
    backdrop.setAttribute("pointer-events", "none");
    backdrop.innerHTML = backdropMarkup(sprites, size);
    backdrop
      .querySelector("defs")!
      .insertAdjacentHTML(
        "beforeend",
        svgArtFilters() +
          [...colors, "#ffb767"]
            .map(
              (color) =>
                `<radialGradient id="combat-light-${color.slice(1)}"><stop offset="0" stop-color="#fffde5"/><stop offset="0.18" stop-color="${color}" stop-opacity="0.9"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></radialGradient>`,
            )
            .join("") +
          '<radialGradient id="combat-smoke"><stop offset="0" stop-color="#31373d" stop-opacity="0.8"/><stop offset="0.5" stop-color="#555b62" stop-opacity="0.4"/><stop offset="1" stop-color="#60676c" stop-opacity="0"/></radialGradient>' +
          '<radialGradient id="combat-dust"><stop offset="0" stop-color="#b6a17e" stop-opacity="0.65"/><stop offset="0.5" stop-color="#877e68" stop-opacity="0.35"/><stop offset="1" stop-color="#716b5d" stop-opacity="0"/></radialGradient>' +
          '<radialGradient id="combat-blast-smoke"><stop offset="0" stop-color="#edbd75" stop-opacity="0.8"/><stop offset="0.3" stop-color="#9d8f75" stop-opacity="0.8"/><stop offset="0.7" stop-color="#605b50" stop-opacity="0.5"/><stop offset="1" stop-color="#605b50" stop-opacity="0"/></radialGradient>',
      );
    const terrain = layer(svg, "terrain-layer");
    terrain.innerHTML = terrainMarkup(world, sprites);
    const terrainObjects = [
      ...terrain.querySelectorAll<SVGElement>(".terrain-object"),
    ];
    const territory = layer(svg, "territory-layer");
    const firingRange = layer(svg, "firing-range-layer");
    firingRange.setAttribute("aria-hidden", "true");
    const castShadows = layer(svg, "cast-shadow-layer");
    const links = layer(svg, "link-layer"),
      queues = layer(svg, "queue-layer"),
      groundEffects = layer(svg, "ground-effect-layer"),
      particleLayer = layer(svg, "particle-layer"),
      structures = layer(svg, "structure-layer");
    const effectLayer = layer(svg, "effect-layer");
    for (const decorative of [
      territory,
      firingRange,
      castShadows,
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
      castShadows,
      particleLayer,
      effectLayer,
      groundEffects,
      arrivalAt: new Map(),
      selection,
      firingRange,
      movers: new Map(),
      prior: new Map(),
      pulses: [],
      territory,
      terrainObjects,
      recoil: new Map(),
      weaponKinds: new Map(),
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
  const selectedWeapon = world.structures.find((s) => s.cell === selected);
  setMarkup(
    cache.firingRange,
    selectedWeapon
      ? [...attackCells(world.map, selectedWeapon.cell, selectedWeapon.kind)]
          .filter(
            (cell) =>
              cell !== selected && world.map.cells[cell]?.terrain === "open",
          )
          .sort((a, b) => a - b)
          .map(
            (cell) =>
              `<polygon class="firing-range-cell" data-range-cell="${cell}" points="${hexPoints(width, cell)}"/>`,
          )
          .join("")
      : "",
  );
  setMarkup(cache.links, linkMarkup(world));
  const matrix = buildingSprites ? svg.getScreenCTM() : null;
  if (matrix && buildingSprites)
    sprites = buildingSprites.resolve(
      Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d)),
    );
  setMarkup(cache.castShadows, shadowMarkup(world, sprites));
  setMarkup(
    cache.territory,
    world.structures
      .map(
        (s) =>
          `<circle cx="${hexCenter(width, s.cell).x}" cy="${hexCenter(width, s.cell).y}" r="25" fill="${colors[world.players.find((p) => p.id === s.ownerId)?.slot ?? 0]}" opacity="${s.connected ? 0.065 : 0.025}" pointer-events="none"/>`,
      )
      .join(""),
  );
  setMarkup(
    cache.structures,
    structureMarkup(world, sprites) + constructionBodies(world, sprites),
  );
  setMarkup(
    cache.queues,
    world.players
      .flatMap((p) =>
        p.queue.map((q, i) => {
          const { x, y } = hexCenter(width, q.cell);
          return `<g class="queue-mark" data-cell="${q.cell}" style="--team:${colors[p.slot]}">${q.paid ? `<circle class="site-progress" cx="${x}" cy="${y}" r="24" pathLength="1" stroke-dasharray="${q.progress / Math.max(1, q.duration)} 1"/>` : ""}<circle cx="${x}" cy="${y}" r="24"/><text x="${x}" y="${y + 5}" text-anchor="middle">${i + 1}</text></g>`;
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
        !["damage", "shielded", "destroyed", "constructed"].includes(
          outcome.type,
        ) ||
        outcome.cell === undefined ||
        cache.pulses.length >= 48
      )
        continue;
      if (
        outcome.type !== "damage" &&
        outcome.type !== "shielded" &&
        outcome.type !== "destroyed" &&
        outcome.type !== "constructed"
      )
        continue;
      const at = hexCenter(width, outcome.cell);
      const from =
        outcome.type === "damage" && outcome.fromCell !== undefined
          ? hexCenter(width, outcome.fromCell)
          : undefined;
      const hits = world.outcomes.filter(
        (hit) =>
          hit.type === "damage" &&
          hit.cell === outcome.cell &&
          hit.fromCell !== undefined,
      );
      const incoming = hits.sort(
        (a, b) =>
          (b.amount ?? 0) - (a.amount ?? 0) || a.fromCell! - b.fromCell!,
      )[0]?.fromCell;
      const lostKind =
        world.tick === cache.tick + 1 && outcome.type === "destroyed"
          ? cache.weaponKinds.get(`${outcome.playerId}:${outcome.cell}`)
          : undefined;
      let wreck: SVGElement | undefined;
      if (lostKind && lostKind !== "neuron") {
        wreck = svg.ownerDocument.createElementNS(ns, "g");
        wreck.innerHTML = structureArtwork(
          width,
          outcome.cell,
          lostKind,
          world.players.find((p) => p.id === outcome.playerId)?.slot ?? 0,
          sprites,
        );
      }
      const effect = combatEffect(
        svg.ownerDocument,
        outcome.type,
        at,
        outcome.type === "destroyed"
          ? "#ffb767"
          : colors[
              world.players.find((p) => p.id === outcome.playerId)?.slot ?? 0
            ]!,
        world.tick * 31 + outcome.cell,
        from,
        {
          wreck: wreck
            ? { artwork: wreck, foot: { x: at.x, y: at.y + buildingFoot } }
            : undefined,
          weapon: weaponStyle(world, cache, outcome.playerId, outcome.fromCell),
          incoming:
            incoming === undefined ? undefined : hexCenter(width, incoming),
          impactDelay:
            outcome.type === "destroyed" || outcome.type === "shielded"
              ? Math.max(
                  0,
                  ...hits.map(
                    (hit) =>
                      weaponFlightMs[
                        weaponStyle(world, cache, hit.playerId, hit.fromCell)
                      ],
                  ),
                )
              : undefined,
        },
      );
      cache.effectLayer.append(effect.element);
      effect.body?.setAttribute("data-depth", String(outcome.cell));
      cache.groundEffects.append(effect.ground);
      cache.pulses.push({ ...effect, born: now });
      if (from && outcome.fromCell !== undefined) {
        const length = Math.max(1, Math.hypot(at.x - from.x, at.y - from.y));
        cache.recoil.set(outcome.fromCell, {
          born: now,
          dx: ((from.x - at.x) / length) * 2.5,
          dy: ((from.y - at.y) / length) * 2.5,
        });
      }
    }
  // Reattach persistent wrecks after structure markup is refreshed. Solid
  // silhouettes share ground-depth ordering; smoke/sparks remain above it.
  const bodies = [
    ...cache.structures.querySelectorAll<SVGGElement>(".structure"),
    ...cache.structures.querySelectorAll<SVGGElement>(".construction-body"),
    ...cache.terrainObjects,
    ...cache.pulses.flatMap((p) => (p.body ? [p.body] : [])),
  ];
  bodies.sort(
    (a, b) =>
      Number(a.getAttribute("data-cell") ?? a.getAttribute("data-depth")) -
      Number(b.getAttribute("data-cell") ?? b.getAttribute("data-depth")),
  );
  for (const body of bodies) cache.structures.append(body);
  cache.prior = new Map(
    world.particles
      .filter((p) => p.mode === "transit")
      .map((p) => [p.id, p.to]),
  );
  cache.tick = world.tick;
  cache.weaponKinds = new Map(
    world.structures.map((s) => [`${s.ownerId}:${s.cell}`, s.kind]),
  );
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
    path: networkPath(width, m.from, m.to),
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
  const constructionAnimations = [
    ...cache.structures.querySelectorAll<SVGGElement>(".construction-body"),
  ].map(constructionAnimation);
  const damageAnimations = [
    ...cache.structures.querySelectorAll<SVGGElement>(".damage-plume"),
  ].map(damageAnimation);
  let displayedSprites: Sprites | null = null;
  const animate = (frameNow: number) => {
    // Camera/DPR and async raster changes also matter after authoritative
    // frames stop (for example at the result screen). Use the existing RAF.
    const matrix = buildingSprites ? svg.getScreenCTM() : null;
    if (matrix && buildingSprites) {
      const resolved = buildingSprites.resolve(
        Math.max(
          Math.hypot(matrix.a, matrix.b),
          Math.hypot(matrix.c, matrix.d),
        ),
      );
      if (resolved !== displayedSprites) {
        refreshSpriteImages(svg, resolved);
        displayedSprites = resolved;
      }
    }
    for (const animateDamage of damageAnimations)
      animateDamage(frameNow, reducedMotion);
    for (const animateSite of constructionAnimations)
      animateSite(frameNow, reducedMotion);
    for (const [cell, kick] of cache.recoil) {
      const age = (frameNow - kick.born) / 240;
      const art = cache.structures.querySelector<SVGGElement>(
        `.structure[data-cell="${cell}"] .building-art`,
      );
      if (age >= 1 || reducedMotion) {
        art?.removeAttribute("transform");
        cache.recoil.delete(cell);
      } else {
        const amount =
          Math.sin(Math.min(1, Math.max(0, age)) * Math.PI) * (1 - age);
        art?.setAttribute(
          "transform",
          `translate(${kick.dx * amount} ${kick.dy * amount})`,
        );
      }
    }
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
    for (const { m, glyph, trail, path } of elements) {
      const fraction = Math.max(
        0,
        Math.min(
          1,
          (visualTick - m.departedAt) / Math.max(1, m.arrivesAt - m.departedAt),
        ),
      );
      const { x, y, dx, dy } = sampleNetworkPath(path, fraction);
      const direction = (Math.atan2(dy, dx) * 180) / Math.PI;
      glyph.setAttribute(
        "transform",
        `translate(${x} ${y}) rotate(${direction})`,
      );
      const tail = Math.max(0, fraction - 0.2);
      trail.setAttribute(
        "d",
        reducedMotion ? "" : networkPathMarkup(path, tail, fraction),
      );
    }
    cache.pulses = cache.pulses.filter((p) => {
      const t = (frameNow - p.born) / (p.duration ?? 320);
      if (t >= 1 || reducedMotion) {
        p.element.remove();
        p.ground?.remove();
        p.body?.remove();
        return false;
      }
      if (p.animate) {
        p.animate(t);
        return true;
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
