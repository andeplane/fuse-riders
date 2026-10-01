import type { World, StructureKind } from "../engine/types.js";
import {
  refreshSpriteImages,
  teamSpritePaint,
  type BuildingSprites,
  type SpritePaint,
} from "./sprite-raster.js";
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
import {
  cocoonMarkup,
  pointAlong,
  neuronAnimation,
  neuronDefs,
  neuronImageUrl,
  neuronMarkup,
  neuronVisual,
  type NeuronVisual,
} from "./neuron-art.js";
import { seededRandom, type Neighbour } from "./neuron-form.js";
import {
  CREEP_RADIUS,
  creepPatternMarkup,
  TEAM_PALETTES,
  veinMarkup,
} from "./creep.js";
import { CreepLayer, type CreepSource } from "./creep-layer.js";
import { arrangeChildren, KeyedLayer, type KeyedItem } from "./keyed-layer.js";
import { organicBurst } from "./organic-burst.js";
import { SPORE_POD, sporeMarkup } from "./spore-art.js";
import { buildingRoots, buildingRootsMarkup } from "./building-roots.js";
import {
  claimLabelMarkup,
  POWERUP_STYLE,
  powerupDefs,
  powerupMarkup,
} from "./powerup-art.js";
import { POWERUP_PRESENTATION, isPowerupKind } from "../engine/powerups.js";
import {
  bloodTravel,
  heartbeat,
  vesselMarkup,
  vesselNetwork,
  vesselPoint,
  type Vessel,
} from "./vessels.js";
import {
  CYTOPLASM,
  EMBERS,
  LightField,
  rgb,
  SPARKS,
  SPORES,
  SPROUT,
  type LightRenderer,
  type LightTransform,
  type Rgb,
} from "./light-field.js";
export { hexCenter, hexPoints } from "./projection.js";
const ns = "http://www.w3.org/2000/svg";
const colors = TEAM_PALETTES.map((p) => p.glow);
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
  /** Structure and construction-site elements, one per item, reused when unchanged. */
  structureItems: KeyedLayer;
  castShadows: SVGGElement;
  links: SVGGElement;
  queues: SVGGElement;
  powerups: SVGGElement;
  selection: SVGPolygonElement;
  firingRange: SVGGElement;
  territory: SVGGElement;
  terrainObjects: SVGElement[];
  recoil: Map<number, { born: number; dx: number; dy: number }>;
  weaponKinds: Map<string, StructureKind>;
  /** First presentation time of structures, dendrites and links; -Infinity when present at load. */
  born: Map<string, number>;
  creep: CreepLayer;
  /** Vein markup per connected structure; recomputed only when it changes. */
  veins: Map<string, string>;
  /** Neuron forms by cell, team and neighbours, reused while unchanged. */
  memo: { neurons: NeuronMemo };
  fresh: boolean;
  light: LightField;
  spores: readonly Spore[];
  vessels: readonly Vessel[];
}
function hashText(text: string): number {
  let hash = 2166136261;
  for (const c of text) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  return hash >>> 0;
}
interface Spore {
  x: number;
  y: number;
  size: number;
  speed: number;
  rise: number;
  phase: number;
  color: Rgb;
}
/** Drifting motes of light over the whole arena; fixed per match. */
function sporesFor(size: { width: number; height: number }, seed: string) {
  let hash = 2166136261;
  for (const c of seed) hash = Math.imul(hash ^ c.charCodeAt(0), 16777619);
  const random = seededRandom(hash >>> 0);
  return Array.from(
    { length: Math.round((size.width * size.height) / 9000) },
    () => ({
      x: random() * size.width,
      y: random() * size.height,
      size: 1.4 + random() * 2.2,
      speed: 0.15 + random() * 0.35,
      rise: 2 + random() * 5,
      phase: random() * Math.PI * 2,
      color: (random() < 0.6 ? [0.7, 0.95, 1] : [0.8, 1, 0.7]) as Rgb,
    }),
  );
}
const LINK_GROW_MS = 900;
/** A stable identity for a decorative light, so thinning keeps the same ones. */
const decorKey = (kind: number, index: number) =>
  kind * 0x1000000 + (index & 0xffffff);
const caches = new WeakMap<SVGSVGElement, BoardCache>();
function weaponStyle(
  world: Readonly<World>,
  cache: BoardCache,
  owner: string,
  cell: number | undefined,
): "siege" | "relay" | "spore" | "pulse" {
  const kind =
    world.structures.find((s) => s.ownerId === owner && s.cell === cell)
      ?.kind ??
    (world.tick === cache.tick + 1
      ? cache.weaponKinds.get(`${owner}:${cell}`)
      : undefined);
  return kind === "siege" || kind === "relay" || kind === "spore"
    ? kind
    : "pulse";
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
  paint?: { key: SpritePaint; filter: string },
): string {
  const url = sprites[`${name}-v2`] ?? sprites[name];
  return url
    ? `<image href="${escaped(url)}" data-sprite="${escaped(name)}"${paint ? ` data-sprite-paint="${paint.key}" data-sprite-filter="${paint.filter}"` : ""} x="${x - size / 2}" y="${y - size / 2}" width="${size}" height="${size}" pointer-events="none"/>`
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
      return `<g class="hex terrain-${cell.terrain}" data-cell="${index}"><polygon points="${hexPoints(world.map.width, index)}"/><clipPath id="tile-${index}"><polygon points="${hexPoints(world.map.width, index)}"/></clipPath><g class="ground-patch" clip-path="url(#tile-${index})">${ground ? image(sprites, ground, x, y, 82) : ""}</g>${object ? `<g class="terrain-object" data-terrain="${cell.terrain}"${cell.terrain === "deposit" ? ` data-resource="${cell.resourceKind}" style="--delay:${(-((index * 0.618) % 1) * 3.6).toFixed(2)}s"` : ""} data-depth="${index}" pointer-events="none"><ellipse cx="${x + 9}" cy="${y + 14}" rx="30" ry="10" fill="url(#contact-shadow)"/>${object}</g>` : ""}<polygon class="hex-hover-outline" points="${hexPoints(world.map.width, index, 1.5)}"/></g>`;
    })
    .join("");
}

/** Decorative ground continues beyond the selectable cells; it has no game state. */
function backdropMarkup(
  sprites: Sprites,
  size: { width: number; height: number },
  vessels: readonly Vessel[],
): string {
  const ground = sprites[WALKABLE_GROUND];
  const cliff = sprites["terrain-cliff-material-v1"];
  return `<defs><pattern id="cliff-material" patternUnits="userSpaceOnUse" width="180" height="180"><rect width="180" height="180" fill="#657078"/>${cliff ? `<image href="${escaped(cliff)}" width="180" height="180"/>` : ""}</pattern><radialGradient id="contact-shadow"><stop offset="0" stop-color="#000" stop-opacity="0.7"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient><pattern id="ground-continuation" patternUnits="userSpaceOnUse" width="${size.width * 2}" height="${size.height * 2}"><rect width="${size.width * 2}" height="${size.height * 2}" fill="#172723"/>${ground ? ["", `translate(${size.width * 2} 0) scale(-1 1)`, `translate(0 ${size.height * 2}) scale(1 -1)`, `translate(${size.width * 2} ${size.height * 2}) scale(-1 -1)`].map((transform) => `<image href="${escaped(ground)}" width="${size.width}" height="${size.height}" preserveAspectRatio="none" transform="${transform}" opacity="0.5"/>`).join("") : ""}</pattern></defs><rect class="terrain-backdrop" width="100%" height="100%" fill="url(#ground-continuation)"/>${vesselMarkup(vessels)}`;
}
/** Same-owner structures around a cell, as projected offsets for dendrites to reach toward. */
function neuronNeighbours(
  world: Readonly<World>,
  cell: number,
  owner: string,
): Neighbour[] {
  const at = hexCenter(world.map.width, cell);
  return neighbors(world.map, cell)
    .filter((n) =>
      world.structures.some((s) => s.cell === n && s.ownerId === owner),
    )
    .map((n) => {
      const to = hexCenter(world.map.width, n);
      return { cell: n, dx: to.x - at.x, dy: to.y - at.y };
    });
}
/** The selected neuron as a standalone image for the inspector portrait. */
export function neuronPortraitUrl(
  world: Readonly<World>,
  cell: number,
): string | undefined {
  const s = world.structures.find((s) => s.cell === cell);
  if (s?.kind !== "neuron") return undefined;
  const { x, y } = hexCenter(world.map.width, cell);
  const slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
  return neuronImageUrl(
    neuronVisual(x, y, cell, neuronNeighbours(world, cell, s.ownerId)),
    slot,
  );
}
/** Procedural neuron: unique per cell and team, reaching toward its neighbours. */
export function neuronArtwork(
  width: number,
  cell: number,
  slot: number,
  neighbours: readonly Neighbour[] = [],
): string {
  const { x, y } = hexCenter(width, cell);
  return neuronMarkup(neuronVisual(x, y, cell, neighbours), slot);
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
  if (kind === "neuron") return neuronArtwork(width, cell, slot);
  if (kind === "spore") {
    const at = hexCenter(width, cell);
    return sporeMarkup(at.x, at.y, slot);
  }
  const { x, y } = hexCenter(width, cell);
  const size = buildingSize(kind);
  return `<g class="building-art" filter="${teamSvgFilter(slot)}">${image(sprites, structureArt(kind), x, y + buildingFoot - size / 2, size, { key: teamSpritePaint(slot), filter: teamSvgFilter(slot) }) || `<circle class="structure-core" cx="${x}" cy="${y}" r="16"/>`}</g>`;
}
/** Project the sprite silhouette away from a shared upper-left light source. */
function shadowMarkup(world: Readonly<World>, sprites: Sprites): string {
  return world.structures
    .map((s) => {
      if (s.kind === "neuron" || s.kind === "spore") return "";
      const { x, y } = hexCenter(world.map.width, s.cell);
      const foot = y + buildingFoot;
      const size = buildingSize(s.kind);
      return `<g class="building-cast-shadow" transform="matrix(1 0 -0.55 -0.3 ${0.55 * foot} ${1.3 * foot})" filter="url(#nd-art-shadow)" opacity="0.28">${image(sprites, structureArt(s.kind), x, foot - size / 2, size, { key: "shadow", filter: "url(#nd-art-shadow)" })}</g>`;
    })
    .join("");
}
type NeuronMemo = Map<string, { visual: NeuronVisual; markup: string }>;
function structureItems(
  world: Readonly<World>,
  sprites: Sprites,
  neurons: Map<number, NeuronVisual>,
  memo: { neurons: NeuronMemo },
): KeyedItem[] {
  const stocks = new Map<string, number>();
  for (const p of world.particles)
    if (p.mode === "stationed") {
      const key = `${p.ownerId}:${p.cell}`;
      stocks.set(key, (stocks.get(key) ?? 0) + 1);
    }
  const forms: NeuronMemo = new Map();
  const items = [...world.structures]
    .sort((a, b) => a.cell - b.cell)
    .map((s) => {
      const { x, y } = hexCenter(world.map.width, s.cell),
        slot = world.players.find((p) => p.id === s.ownerId)?.slot ?? 0;
      const hpMax = STRUCTURES[s.kind].hp;
      const stock = stocks.get(`${s.ownerId}:${s.cell}`) ?? 0;
      const healthY =
        s.kind === "neuron"
          ? y - 35
          : y + buildingFoot - buildingSize(s.kind) - 7;
      const health =
        s.hp < hpMax
          ? `<rect class="structure-hp-bg" x="${x - 18}" y="${healthY}" width="36" height="3"/><rect class="structure-hp" x="${x - 18}" y="${healthY}" width="${36 * Math.max(0, Math.min(1, s.hp / hpMax))}" height="3"/>`
          : "";
      let artwork: string;
      if (s.kind === "neuron") {
        // A neuron's form depends only on its cell, team and neighbours.
        const neighbours = neuronNeighbours(world, s.cell, s.ownerId);
        const key = `${s.cell}:${slot}:${neighbours.map((n) => n.cell).join(",")}`;
        let form = memo.neurons.get(key);
        if (!form) {
          const visual = neuronVisual(x, y, s.cell, neighbours);
          form = { visual, markup: neuronMarkup(visual, slot) };
        }
        forms.set(key, form);
        neurons.set(s.cell, form.visual);
        artwork = form.markup;
      } else
        artwork =
          buildingRootsMarkup(
            x,
            y + buildingFoot,
            slot,
            s.cell * 7 + 3,
            s.kind === "brain" ? 1.3 : 1,
          ) +
          structureArtwork(world.map.width, s.cell, s.kind, slot, sprites) +
          damagePlume(x + 6, y - 18, s.hp / hpMax, s.id);
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
      const markup = `<g class="structure structure-${s.kind} ${s.connected ? "" : "disconnected"}" data-cell="${s.cell}" style="--team:${colors[slot]}"><ellipse class="contact-shadow" cx="${x + 4}" cy="${y + 19}" rx="${s.kind === "neuron" ? 23 : 34}" ry="16" fill="url(#contact-shadow)"/>${supply}<circle class="owner-ring" cx="${x}" cy="${y}" r="${s.kind === "brain" ? 27 : 10}"/>${artwork || `<circle class="structure-core" cx="${x}" cy="${y}" r="15"/>`}${stock && s.connected ? `<g class="supply-orbit" style="transform-origin:${x}px ${y}px">${Array.from({ length: Math.min(6, Math.ceil(stock / 8)) }, (_, i) => `<circle cx="${x + Math.cos((i * Math.PI) / 3) * 22}" cy="${y + Math.sin((i * Math.PI) / 3) * 22}" r="2" fill="${colors[slot]}"/>`).join("")}</g>` : ""}${health}<ellipse class="structure-hit" cx="${x}" cy="${y + hit.offset}" rx="${hit.rx}" ry="${hit.ry}"/></g>`;
      return { key: `s${s.id}`, markup };
    });
  memo.neurons = forms;
  return items;
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
        `<g class="network-link${connected ? "" : " disconnected-link"}" data-from="${s.cell}" data-to="${peer.cell}" style="--team:${TEAM_PALETTES[slot]?.mid};--glow:${TEAM_PALETTES[slot]?.light};--flesh:${TEAM_PALETTES[slot]?.dark}"><path class="axon-shadow" d="${curve}"/><path class="axon-sheath" d="${curve}"/><path class="axon-rim" d="${curve}"/><path class="axon" d="${curve}"/></g>`,
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
function constructionItems(
  world: Readonly<World>,
  sprites: Sprites,
): KeyedItem[] {
  return world.players.flatMap((p) =>
    p.queue
      .filter((q) => q.paid)
      .map((q) => ({
        key: `c${p.slot}:${q.cell}:${q.kind}`,
        markup: constructionBody(world, sprites, p, q),
      })),
  );
}
function constructionBody(
  world: Readonly<World>,
  sprites: Sprites,
  p: World["players"][number],
  q: World["players"][number]["queue"][number],
): string {
  const at = hexCenter(world.map.width, q.cell);
  const progress = q.progress / Math.max(1, q.duration);
  if (q.kind === "neuron")
    return cocoonMarkup(
      neuronVisual(at.x, at.y, q.cell, neuronNeighbours(world, q.cell, p.id)),
      p.slot,
      progress,
      p.worker.mode === "building",
    );
  return constructionMarkup({
    cell: q.cell,
    slot: p.slot,
    ...at,
    height: buildingSize(q.kind),
    progress,
    active: p.worker.mode === "building",
    color: colors[p.slot]!,
    artwork: structureArtwork(world.map.width, q.cell, q.kind, p.slot, sprites),
  });
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
  light?: LightRenderer,
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
    const vessels = vesselNetwork(size, hashText(world.map.id));
    backdrop.innerHTML = backdropMarkup(sprites, size, vessels);
    backdrop
      .querySelector("defs")!
      .insertAdjacentHTML(
        "beforeend",
        svgArtFilters() +
          neuronDefs() +
          powerupDefs() +
          TEAM_PALETTES.map((_, slot) => creepPatternMarkup(slot)).join("") +
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
      powerups = layer(svg, "powerup-layer"),
      groundEffects = layer(svg, "ground-effect-layer"),
      particleLayer = layer(svg, "particle-layer"),
      structures = layer(svg, "structure-layer");
    const effectLayer = layer(svg, "effect-layer");
    for (const decorative of [
      territory,
      powerups,
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
      powerups,
      structures,
      structureItems: new KeyedLayer(structures),
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
      born: new Map(),
      creep: new CreepLayer(territory, size),
      veins: new Map(),
      memo: { neurons: new Map() },
      fresh: true,
      light: new LightField(),
      spores: sporesFor(size, `${world.matchId}`),
      vessels,
    };
    caches.set(svg, cached);
  }
  const cache = cached;
  // Measure once, before this render writes to the DOM: reading layout after
  // a write forces a synchronous layout.
  const measured = measure(svg, !!light, !!buildingSprites);
  // Anything present when the board is built is already grown; later arrivals grow in.
  const initial = cache.fresh;
  cache.fresh = false;
  const seen = new Set<string>();
  const bornAt = (key: string) => {
    seen.add(key);
    let born = cache.born.get(key);
    if (born === undefined) {
      born = initial ? Number.NEGATIVE_INFINITY : now;
      cache.born.set(key, born);
    }
    return born;
  };
  const slotOf = (owner: string) =>
    world.players.find((p) => p.id === owner)?.slot ?? 0;
  const creepSources: CreepSource[] = [];
  const creepDetails = new Map<number, string>(
    world.players.map((p) => [p.slot, ""]),
  );
  const veins = new Map<string, string>();
  for (const s of world.structures) {
    const slot = slotOf(s.ownerId);
    const { x, y } = hexCenter(width, s.cell);
    const radius = CREEP_RADIUS[s.kind] * (s.connected ? 1 : 0.55);
    bornAt(`s${s.id}`);
    creepSources.push({ key: `s${s.id}`, slot, x, y, radius });
    if (!s.connected) continue;
    const key = `${s.id}:${s.cell}:${slot}:${s.kind}`;
    const detail =
      cache.veins.get(key) ??
      `<ellipse class="creep-sheen" cx="${x - radius * 0.12}" cy="${y - 2}" rx="${radius * 0.78}" ry="${radius * 0.5}" fill="url(#nd-creep-sheen-${slot})"/>` +
        `<g class="creep-veins">${veinMarkup(x, y, radius, s.id * 31 + slot)}</g>` +
        (s.kind === "brain"
          ? `<ellipse class="creep-ripple" cx="${x}" cy="${y + 2}" data-reach="${radius * 2.2}" fill="none" stroke="${TEAM_PALETTES[slot]?.light}" opacity="0"/>`
          : "");
    veins.set(key, detail);
    creepDetails.set(slot, creepDetails.get(slot) + detail);
  }
  cache.veins = veins;
  for (const p of world.players)
    for (const q of p.queue)
      if (q.paid) {
        const { x, y } = hexCenter(width, q.cell);
        creepSources.push({
          key: `q${p.slot}:${q.cell}`,
          slot: p.slot,
          x,
          y,
          radius:
            CREEP_RADIUS.site *
            (0.45 + 0.55 * (q.progress / Math.max(1, q.duration))),
        });
      }
  cache.creep.update(creepSources, creepDetails, initial, now);
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
  if (measured.scale !== null && buildingSprites)
    sprites = buildingSprites.resolve(
      measured.scale,
      world.players.map((player) => player.slot),
    );
  setMarkup(cache.castShadows, shadowMarkup(world, sprites));
  const neuronVisuals = new Map<number, NeuronVisual>();
  // Only structures and sites whose markup changed are re-parsed.
  const items = cache.structureItems.sync([
    ...structureItems(world, sprites, neuronVisuals, cache.memo),
    ...constructionItems(world, sprites),
  ]);
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
  setMarkup(
    cache.powerups,
    world.powerups
      .map((p) => {
        const { x, y } = hexCenter(width, p.cell);
        // Blink through the last five seconds before it fades away.
        return powerupMarkup(
          p.kind,
          p.cell,
          x,
          y,
          p.expiresAt - world.tick <= 100,
        );
      })
      .join(""),
  );
  if (world.tick !== cache.tick && !reducedMotion)
    for (const claimed of world.outcomes)
      if (
        claimed.type === "claimed" &&
        claimed.cell !== undefined &&
        isPowerupKind(claimed.reason) &&
        cache.pulses.length < 48
      ) {
        const { x, y } = hexCenter(width, claimed.cell);
        const style = POWERUP_STYLE[claimed.reason];
        const label = svg.ownerDocument.createElementNS(ns, "g");
        label.setAttribute("class", "claim-effect");
        label.innerHTML = claimLabelMarkup(
          POWERUP_PRESENTATION[claimed.reason].label,
          claimed.reason,
          x,
          y,
        );
        cache.effectLayer.append(label);
        cache.pulses.push({
          element: label,
          born: now,
          duration: 1600,
          animate: (t) => {
            label.setAttribute(
              "transform",
              `translate(0 ${(-t * 26).toFixed(1)})`,
            );
            label.setAttribute(
              "opacity",
              String(t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.85),
            );
          },
        });
        if (light) {
          const color = rgb(style.color);
          cache.light.flash(x, y - 16, now, 70, color, 1, 520);
          cache.light.burst(x, y - 16, now, world.tick * 7 + claimed.cell, {
            ...SPROUT(color),
            count: 34,
            speed: [30, 110],
            lift: [40, 120],
            gravity: 60,
          });
        }
      }
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
  // A Spore pod is one projectile: it flies to the primary target (the
  // shooter's hardest hit this tick) and its splash hits burst from there.
  const primaryHit = new Map<string, (typeof world.outcomes)[number]>();
  for (const outcome of world.outcomes)
    if (outcome.type === "damage" && outcome.fromCell !== undefined) {
      const shooter = `${outcome.playerId}:${outcome.fromCell}`;
      const best = primaryHit.get(shooter);
      if (!best || (outcome.amount ?? 0) > (best.amount ?? 0))
        primaryHit.set(shooter, outcome);
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
      const splash =
        outcome.type === "damage" &&
        weaponStyle(world, cache, outcome.playerId, outcome.fromCell) ===
          "spore" &&
        primaryHit.get(`${outcome.playerId}:${outcome.fromCell}`) !== outcome;
      const from =
        outcome.type === "damage" && outcome.fromCell !== undefined && !splash
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
          impactDelay: splash
            ? weaponFlightMs.spore
            : outcome.type === "destroyed" || outcome.type === "shielded"
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
      if (light) {
        const slot =
          world.players.find((p) => p.id === outcome.playerId)?.slot ?? 0;
        const team = rgb(TEAM_PALETTES[slot]!.glow);
        const arrival =
          outcome.type === "damage"
            ? weaponFlightMs[
                weaponStyle(world, cache, outcome.playerId, outcome.fromCell)
              ]
            : Math.max(
                0,
                ...hits.map(
                  (hit) =>
                    weaponFlightMs[
                      weaponStyle(world, cache, hit.playerId, hit.fromCell)
                    ],
                ),
              );
        const seed = world.tick * 977 + outcome.cell * 31;
        const hit = now + arrival;
        const fire: Rgb = [1, 0.55, 0.2];
        if (outcome.type === "damage") {
          if (from)
            cache.light.flash(from.x, from.y - 22, now, 22, team, 0.7, 150);
          const style = weaponStyle(
            world,
            cache,
            outcome.playerId,
            outcome.fromCell,
          );
          if (style === "spore") {
            cache.light.flash(at.x, at.y - 8, hit, 40, [0.5, 1, 0.4], 0.6, 420);
            cache.light.burst(at.x, at.y - 4, hit, seed, SPORES);
          } else {
            cache.light.flash(at.x, at.y - 10, hit, 34, fire, 0.75, 260);
            cache.light.burst(at.x, at.y - 6, hit, seed, SPARKS(fire));
          }
        } else if (outcome.type === "shielded")
          cache.light.flash(
            at.x,
            at.y - 14,
            hit,
            44,
            [0.45, 0.85, 1],
            0.8,
            320,
          );
        else if (outcome.type === "destroyed") {
          cache.light.flash(at.x, at.y - 12, hit, 110, fire, 1, 560);
          cache.light.burst(at.x, at.y, hit, seed, EMBERS);
          if (lostKind === "neuron")
            cache.light.burst(at.x, at.y, hit, seed + 1, CYTOPLASM(team));
        } else if (outcome.type === "constructed") {
          cache.light.flash(at.x, at.y - 6, now, 40, team, 0.55, 700);
          cache.light.burst(at.x, at.y, now, seed, SPROUT(team));
        }
      }
      if (lostKind === "neuron") {
        const burst = organicBurst(
          svg.ownerDocument,
          at,
          world.players.find((p) => p.id === outcome.playerId)?.slot ?? 0,
          world.tick * 131 + outcome.cell,
          Math.max(
            0,
            ...hits.map(
              (hit) =>
                weaponFlightMs[
                  weaponStyle(world, cache, hit.playerId, hit.fromCell)
                ],
            ),
          ),
        );
        cache.effectLayer.append(burst.element);
        cache.groundEffects.append(burst.ground);
        burst.animate(0);
        cache.pulses.push({
          element: burst.element,
          ground: burst.ground,
          born: now,
          duration: burst.duration,
          animate: burst.animate,
        });
      }
      if (from && outcome.fromCell !== undefined) {
        const length = Math.max(1, Math.hypot(at.x - from.x, at.y - from.y));
        cache.recoil.set(outcome.fromCell, {
          born: now,
          dx: ((from.x - at.x) / length) * 2.5,
          dy: ((from.y - at.y) / length) * 2.5,
        });
      }
    }
  // Solid silhouettes (structures, sites, terrain objects and persistent
  // wrecks) share ground-depth ordering; smoke/sparks remain above it. Other
  // items (cocoons) sit beneath them. Only out-of-place elements move, since
  // moving a node restarts its animations.
  const isBody = (element: Element) =>
    element.classList.contains("structure") ||
    element.classList.contains("construction-body");
  const bodies = [
    ...items.filter(isBody),
    ...cache.terrainObjects,
    ...cache.pulses.flatMap((p) => (p.body ? [p.body] : [])),
  ]
    .map((element) => ({
      element,
      depth: Number(
        element.getAttribute("data-cell") ?? element.getAttribute("data-depth"),
      ),
    }))
    .sort((a, b) => a.depth - b.depth)
    .map((body) => body.element);
  arrangeChildren(cache.structures, [
    ...items.filter((element) => !isBody(element)),
    ...bodies,
  ]);
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
      ".structure-neuron .neuron-body",
    ),
  ].flatMap((element) => {
    const holder = element.closest(".structure");
    const cell = Number(holder?.getAttribute("data-cell"));
    const visual = neuronVisuals.get(cell);
    const structure = world.structures.find((s) => s.cell === cell);
    if (!visual || !structure) return [];
    const born = bornAt(`s${structure.id}`);
    const dendrites = new Map(
      visual.form.dendrites
        .filter((d) => d.toward !== null)
        .map((d) => [d.key, bornAt(`s${structure.id}/${d.key}`)] as const),
    );
    return [
      neuronAnimation(element, visual, {
        born,
        dendrites,
        dormant: !structure.connected,
      }),
    ];
  });
  const structureBorn = new Map(
    world.structures.map((s) => [s.cell, bornAt(`s${s.id}`)]),
  );
  const growingLinks = [
    ...cache.links.querySelectorAll<SVGGElement>(".network-link"),
  ].flatMap((element) => {
    const from = Number(element.getAttribute("data-from")),
      to = Number(element.getAttribute("data-to"));
    const born = bornAt(`l${from}-${to}`);
    if (born === Number.NEGATIVE_INFINITY) return [];
    // Grow out of the older end toward the newer one.
    const forward =
      (structureBorn.get(to) ?? 0) >= (structureBorn.get(from) ?? 0);
    return [
      {
        born,
        forward,
        paths: [...element.querySelectorAll<SVGPathElement>("path")],
      },
    ];
  });
  for (const key of cache.born.keys())
    if (!seen.has(key)) cache.born.delete(key);
  const constructionAnimations = [
    ...cache.structures.querySelectorAll<SVGGElement>(".construction-body"),
  ].map(constructionAnimation);
  const damageAnimations = [
    ...cache.structures.querySelectorAll<SVGGElement>(".damage-plume"),
  ].map(damageAnimation);
  // Emissive light for this render: glows, axon signals and drifting spores.
  type Glow = {
    x: number;
    y: number;
    size: number;
    color: Rgb;
    alpha: number;
    sharpness: number;
    period: number;
    phase: number;
    swing: number;
  };
  const glows: Glow[] = [];
  const arena = boardSize(width, world.map.height);
  const pools: {
    x: number;
    y: number;
    size: number;
    color: Rgb;
    alpha: number;
  }[] = [];
  /** Buildings feed the creep: light pulses run out along their roots. */
  const rootPulses: {
    spine: readonly (readonly [number, number])[];
    color: Rgb;
    phase: number;
    key: number;
  }[] = [];
  const deposits: { x: number; y: number; biomass: boolean; index: number }[] =
    [];
  const mining: {
    from: readonly [number, number];
    to: readonly [number, number];
    color: Rgb;
    phase: number;
  }[] = [];
  const signals: {
    path: ReturnType<typeof networkPath>;
    color: Rgb;
    phase: number;
    key: number;
  }[] = [];
  if (light) {
    for (const s of world.structures) {
      const slot = slotOf(s.ownerId);
      const p = TEAM_PALETTES[slot]!;
      const { x, y } = hexCenter(width, s.cell);
      const phase = (s.cell * 0.618) % (Math.PI * 2);
      const dim = s.connected ? 1 : 0.25;
      if (s.connected && s.kind !== "neuron")
        buildingRoots(
          x,
          y + buildingFoot,
          slot,
          s.cell * 7 + 3,
          s.kind === "brain" ? 1.3 : 1,
        ).spines.forEach((spine, i) =>
          rootPulses.push({
            spine,
            color: rgb(p.light),
            phase: (s.cell * 0.37 + i * 0.29) % 1,
            key: decorKey(3, s.cell * 16 + i),
          }),
        );
      if (s.connected)
        pools.push({
          x,
          y,
          size: s.kind === "brain" ? 170 : 80,
          color: rgb(p.glow),
          alpha: s.kind === "brain" ? 0.09 : 0.045,
        });
      const visual = neuronVisuals.get(s.cell);
      if (visual) {
        const n = visual.form.nucleus;
        glows.push({
          x: x + n.dx,
          y: y - 4 + n.dy,
          size: visual.form.radius * 2.6,
          color: rgb(p.mid),
          alpha: 0.26 * dim,
          sharpness: 3,
          period: 620,
          phase: visual.form.phase,
          swing: 0.35,
        });
      } else if (s.kind === "brain")
        glows.push({
          x,
          y: y - 44,
          size: 62,
          color: rgb(p.glow),
          alpha: 0.5 * dim,
          sharpness: 2.2,
          period: 1600,
          phase,
          swing: 0.3,
        });
      else
        glows.push({
          x,
          y: s.kind === "spore" ? y + SPORE_POD.dy : y - 30,
          size: s.kind === "spore" ? 26 : 30,
          color: rgb(p.glow),
          alpha: (s.kind === "spore" ? 0.4 : 0.32) * dim,
          sharpness: 2.5,
          period: s.kind === "spore" ? 520 : 1100,
          phase,
          swing: s.kind === "spore" ? 0.45 : 0.25,
        });
    }
    for (const p of world.powerups) {
      const { x, y } = hexCenter(width, p.cell);
      glows.push({
        x,
        y: y - 16,
        size: 34,
        color: rgb(POWERUP_STYLE[p.kind].color),
        alpha: 0.55,
        sharpness: 2.4,
        period: 380,
        phase: p.id,
        swing: 0.35,
      });
    }
    world.map.cells.forEach((cell, index) => {
      if (cell.terrain !== "deposit") return;
      const { x, y } = hexCenter(width, index);
      glows.push({
        x,
        y: y - 8,
        size: 30,
        color: rgb(cell.resourceKind === "biomass" ? "#b6f25c" : "#c48cff"),
        alpha: 0.2,
        sharpness: 2.2,
        period: 2300,
        phase: index,
        swing: 0.4,
      });
      deposits.push({ x, y, biomass: cell.resourceKind === "biomass", index });
      // Every connected neighbour mines this deposit; show the harvest flowing in.
      for (const n of neighbors(world.map, index)) {
        const miner = world.structures.find((s) => s.cell === n && s.connected);
        if (!miner) continue;
        const to = hexCenter(width, n);
        mining.push({
          from: [x, y - 10],
          to: [to.x, to.y - 6],
          color: rgb(cell.resourceKind === "biomass" ? "#c8ff6a" : "#d9a8ff"),
          phase: ((index * 31 + n * 17) % 100) / 100,
        });
      }
    });
    for (const p of world.players)
      for (const q of p.queue)
        if (q.paid) {
          const { x, y } = hexCenter(width, q.cell);
          glows.push({
            x,
            y: y - 10,
            size: 26,
            color: rgb(TEAM_PALETTES[p.slot]!.light),
            alpha: 0.35,
            sharpness: 2.5,
            period: q.kind === "neuron" ? 420 : 900,
            phase: q.cell,
            swing: 0.45,
          });
        }
    for (const link of cache.links.querySelectorAll(
      ".network-link:not(.disconnected-link)",
    )) {
      const from = Number(link.getAttribute("data-from")),
        to = Number(link.getAttribute("data-to"));
      const owner = world.structures.find((s) => s.cell === from)?.ownerId;
      signals.push({
        path: networkPath(width, from, to),
        color: rgb(TEAM_PALETTES[owner ? slotOf(owner) : 0]!.light),
        phase: ((from * 7919 + to * 104729) % 1000) / 1000,
        key: decorKey(1, from * 1024 + to),
      });
    }
  }
  const brains = world.structures
    .filter((s) => s.kind === "brain" && s.connected)
    .flatMap((s) => {
      const art = cache.structures.querySelector<SVGGElement>(
        `.structure[data-cell="${s.cell}"] .building-art`,
      );
      const { x, y } = hexCenter(width, s.cell);
      return art ? [{ cell: s.cell, art, x, foot: y + buildingFoot }] : [];
    });
  let displayedSprites: Sprites | null = null;
  const frame = (frameNow: number, view: Measurement) => {
    // `view` was measured before this frame wrote to the DOM, so drawing
    // light never forces a synchronous layout.
    const lightView = view.light;
    if (light) cache.light.begin(lightView ?? undefined);
    // Camera/DPR and async raster changes also matter after authoritative
    // frames stop (for example at the result screen). Use the existing RAF.
    if (view.scale !== null && buildingSprites) {
      const resolved = buildingSprites.resolve(
        view.scale,
        world.players.map((player) => player.slot),
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
    for (const animateNeuron of neurons) animateNeuron(frameNow, reducedMotion);
    // Brains breathe: a slow swell anchored at the base of the sprite.
    for (const brain of brains)
      if (!cache.recoil.has(brain.cell)) {
        if (reducedMotion) brain.art.removeAttribute("transform");
        else {
          const breath = Math.sin(frameNow / 900 + brain.cell) * 0.018;
          brain.art.setAttribute(
            "transform",
            `translate(${brain.x} ${brain.foot}) scale(${(1 - breath * 0.6).toFixed(4)} ${(1 + breath).toFixed(4)}) translate(${-brain.x} ${-brain.foot})`,
          );
        }
      }
    for (const link of growingLinks) {
      const g = reducedMotion
        ? 1
        : Math.max(0, Math.min(1, (frameNow - link.born) / LINK_GROW_MS));
      for (const path of link.paths)
        if (g >= 1) {
          path.removeAttribute("pathLength");
          path.style.removeProperty("stroke-dasharray");
          path.style.removeProperty("stroke-dashoffset");
        } else {
          const eased = 1 - Math.pow(1 - g, 2);
          path.setAttribute("pathLength", "1");
          path.style.setProperty("stroke-dasharray", `${eased} 2`);
          path.style.setProperty(
            "stroke-dashoffset",
            link.forward ? "0" : String(-(1 - eased)),
          );
        }
    }
    cache.creep.animate(frameNow, reducedMotion);
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
      if (light) {
        const color = rgb(TEAM_PALETTES[m.slot]!.glow);
        cache.light.addTransient(x, y, m.builder ? 12 : 9, color, 0.45, 2.5);
        cache.light.addTransient(x, y, 3, [1, 1, 1], 0.8, 8);
      }
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
    if (light && lightView) drawLight(frameNow, lightView);
    else if (light) cache.light.step(frameNow, reducedMotion);
  };
  const drawLight = (frameNow: number, view: LightTransform) => {
    const field = cache.light;
    // Key light from the upper left (matching cast shadows) warms the arena.
    field.add(
      arena.width * 0.18,
      arena.height * 0.12,
      Math.max(arena.width, arena.height) * 0.75,
      [1, 0.82, 0.58],
      0.055,
      1,
    );
    // Each network spills its team colour onto the ground around it.
    for (const pool of pools)
      field.add(pool.x, pool.y, pool.size, pool.color, pool.alpha, 1.3);
    for (const g of glows) {
      const pulse = reducedMotion
        ? 1
        : 1 + g.swing * Math.sin(frameNow / g.period + g.phase);
      field.add(g.x, g.y, g.size, g.color, g.alpha * pulse, g.sharpness);
    }
    if (!reducedMotion) {
      // A signal runs along every live axon, a spark with a soft halo.
      for (const signal of signals) {
        const t = (frameNow / 1500 + signal.phase) % 1;
        const { x, y } = sampleNetworkPath(signal.path, t);
        const fade = Math.sin(t * Math.PI);
        field.addDecor(signal.key, x, y, 9, signal.color, 0.3 * fade, 2.5);
        field.addDecor(signal.key, x, y, 2.6, [1, 1, 1], 0.85 * fade, 8);
      }
      for (const [i, spore] of cache.spores.entries()) {
        const t = frameNow / 1000;
        const x = spore.x + Math.sin(t * spore.speed + spore.phase) * 26;
        const y =
          spore.y +
          Math.cos(t * spore.speed * 0.7 + spore.phase) * 14 -
          ((t * spore.rise) % 60);
        const twinkle = 0.5 + 0.5 * Math.sin(t * 2.3 + spore.phase * 3);
        field.addDecor(
          decorKey(2, i),
          x,
          y,
          spore.size,
          spore.color,
          0.16 * twinkle,
          5,
        );
      }
    }
    if (!reducedMotion) drawAmbient(field, frameNow);
    field.step(frameNow, reducedMotion);
    light!.draw(field.instances, field.size, view);
  };
  /** Blood in the vessels, twinkling crystals, spore puffs and harvest motes. */
  const drawAmbient = (field: LightField, frameNow: number) => {
    for (const root of rootPulses) {
      const t = (frameNow / 2200 + root.phase) % 1;
      if (t > 0.6) continue;
      const u = t / 0.6;
      const [x, y] = pointAlong(root.spine, u);
      field.addDecor(
        root.key,
        x,
        y,
        3.4,
        root.color,
        0.55 * Math.sin(u * Math.PI),
        6,
      );
    }
    const beat = heartbeat(frameNow);
    const travel = bloodTravel(frameNow, 34);
    const blood: Rgb = [0.8, 0.1, 0.16];
    cache.vessels.forEach((v, i) => {
      const length = v.lengths[v.lengths.length - 1]!;
      const spacing = v.width > 3 ? 28 : 40;
      const count = Math.floor(length / spacing);
      const offset = (travel * (v.width > 3 ? 1 : 0.7) + i * 13) % spacing;
      const size = v.width + 1.2;
      for (let c = 0; c < count; c++) {
        const [x, y] = vesselPoint(v, c * spacing + offset);
        field.addDecor(
          decorKey(4, i * 1024 + c),
          x,
          y,
          size,
          blood,
          0.05 + 0.14 * beat,
          3,
        );
      }
    });
    for (const d of deposits) {
      const t = frameNow / 1000 + d.index * 1.37;
      if (d.biomass) {
        // Three spores rise and drift from the pods, each on its own cycle.
        for (let k = 0; k < 3; k++) {
          const cycle = (t / 3.1 + k / 3) % 1;
          const x = d.x + Math.sin(t * 0.9 + k * 2.1) * 10 + (k - 1) * 8;
          const y = d.y - 16 - cycle * 34;
          const fade = Math.sin(cycle * Math.PI);
          field.addDecor(
            decorKey(5, d.index * 8 + k),
            x,
            y,
            2.4,
            [0.8, 1, 0.45],
            0.55 * fade,
            6,
          );
        }
      } else {
        // Sparkles blink at the crystal tips.
        for (let k = 0; k < 4; k++) {
          const blink = Math.max(0, Math.sin(t * (1.3 + k * 0.37) + k * 1.9));
          const sharp = blink ** 12;
          const angle = k * 1.6 + d.index;
          field.addDecor(
            decorKey(5, d.index * 8 + k),
            d.x + Math.cos(angle) * 12,
            d.y - 20 + Math.sin(angle) * 7,
            4.5,
            [1, 0.9, 1],
            0.9 * sharp,
            10,
          );
        }
      }
    }
    for (const [i, m] of mining.entries()) {
      // A mote every ~0.9 s travels from the deposit into its miner.
      for (let k = 0; k < 2; k++) {
        const u = (frameNow / 1800 + m.phase + k / 2) % 1;
        const lift = Math.sin(u * Math.PI) * 10;
        const x = m.from[0] + (m.to[0] - m.from[0]) * u,
          y = m.from[1] + (m.to[1] - m.from[1]) * u - lift;
        field.addDecor(
          decorKey(6, i * 2 + k),
          x,
          y,
          3,
          m.color,
          0.7 * Math.sin(u * Math.PI),
          6,
        );
      }
    }
  };
  // The render above wrote to the DOM; reuse its earlier measurement.
  frame(now, measured);
  return {
    animate: (frameNow: number) =>
      frame(frameNow, measure(svg, !!light, !!buildingSprites)),
  };
}

interface Measurement {
  /** Board units to canvas pixels, for the light layer. */
  light: LightTransform | null;
  /** Screen pixels per board unit, for sprite resolution. */
  scale: number | null;
}
/** Read the board's screen transform once; the canvas shares the board's box. */
function measure(
  svg: SVGSVGElement,
  light: boolean,
  sprites: boolean,
): Measurement {
  if (!light && !sprites) return { light: null, scale: null };
  const m = svg.getScreenCTM();
  if (!m) return { light: null, scale: null };
  const box = light ? svg.getBoundingClientRect() : null;
  return {
    light: box
      ? {
          a: m.a,
          b: m.b,
          c: m.c,
          d: m.d,
          e: m.e - box.left,
          f: m.f - box.top,
          width: box.width,
          height: box.height,
        }
      : null,
    scale: Math.max(Math.hypot(m.a, m.b), Math.hypot(m.c, m.d)),
  };
}
