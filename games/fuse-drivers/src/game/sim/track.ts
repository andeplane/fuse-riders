import { config, SURFACE_KINDS, type SurfaceKind } from "./config.js";
import { cos, hypot, sin } from "./deterministic-math.js";

export interface Point {
  x: number;
  y: number;
}
export interface Segment {
  a: Point;
  b: Point;
}
/** A wall: a segment that also carries its box, so a truck rejects a distant one in four comparisons. */
export interface Wall extends Segment {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** Ignored while a truck is on a bridge (ADR 003). */ under?: boolean;
  /** Deck railing: ignored by trucks that are not on the bridge. */ deck?: boolean;
}
export interface Bridge {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Side of the rectangle whose crossing sets onBridge. */ entry:
    "left" | "right" | "top" | "bottom";
}
export interface Checkpoint {
  a: Point;
  b: Point;
  mid: Point;
}
export interface Spawn extends Point {
  heading: number;
}

/** Parsed track: absolute world coordinates, gameplay layers only (ADR 003). */
export interface Track {
  name: string;
  cols: number;
  rows: number;
  tile: number;
  /** Row-major surface grid; null means off-track infield (treated as dirt). */
  surface: (SurfaceKind | null)[];
  walls: Wall[];
  checkpoints: Checkpoint[];
  spawns: Spawn[];
  waypoints: Point[];
  items: Point[];
  bridges: Bridge[];
}

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null;
const num = (v: unknown, what: string): number => {
  if (typeof v !== "number" || !Number.isFinite(v))
    throw new Error(`track: ${what} must be a finite number`);
  return v;
};

function layer(
  json: Json,
  name: string,
  type: "tilelayer" | "objectgroup",
  required: boolean,
): Json | undefined {
  const layers = Array.isArray(json.layers) ? (json.layers as unknown[]) : [];
  const found = layers.find(
    (l): l is Json => isObj(l) && l.name === name && l.type === type,
  );
  if (!found && required)
    throw new Error(`track: missing required ${type} layer "${name}"`);
  return found;
}

function points(obj: Json, key: "polyline" | "polygon"): Point[] | undefined {
  const raw = obj[key];
  if (!Array.isArray(raw)) return undefined;
  const ox = num(obj.x, "object x");
  const oy = num(obj.y, "object y");
  const rot = (num(obj.rotation ?? 0, "object rotation") * Math.PI) / 180;
  const c = cos(rot),
    si = sin(rot);
  return raw.map((p, i) => {
    if (!isObj(p)) throw new Error(`track: bad ${key} point ${i}`);
    const x = num(p.x, "point x"),
      y = num(p.y, "point y");
    return { x: ox + x * c - y * si, y: oy + x * si + y * c };
  });
}

function objects(json: Json, name: string, required: boolean): Json[] {
  const l = layer(json, name, "objectgroup", required);
  if (!l) return [];
  return (Array.isArray(l.objects) ? (l.objects as unknown[]) : []).filter(
    isObj,
  );
}

/** Pure parser: hand it parsed Tiled JSON with embedded tilesets. Throws naming the offending layer. */
export function parseTrack(input: unknown, name = "track"): Track {
  if (!isObj(input)) throw new Error("track: not an object");
  const cols = num(input.width, "width");
  const rows = num(input.height, "height");
  const tile = num(input.tilewidth, "tilewidth");
  if (tile !== config.tile || input.tileheight !== config.tile)
    throw new Error(`track: tile size must be ${config.tile}`);
  if (
    cols * tile !== config.world.width ||
    rows * tile !== config.world.height - 4
  )
    throw new Error(
      `track: map must be ${config.world.width / config.tile}x${(config.world.height - 4) / config.tile} tiles`,
    );

  const gidToSurface = new Map<number, SurfaceKind>();
  for (const ts of Array.isArray(input.tilesets)
    ? (input.tilesets as unknown[])
    : []) {
    if (!isObj(ts) || typeof ts.source === "string")
      throw new Error("track: tilesets must be embedded");
    const first = num(ts.firstgid, "firstgid");
    for (const t of Array.isArray(ts.tiles) ? (ts.tiles as unknown[]) : []) {
      if (!isObj(t)) continue;
      const props = Array.isArray(t.properties)
        ? (t.properties as unknown[])
        : [];
      const sp = props.find((p): p is Json => isObj(p) && p.name === "surface");
      if (!sp) continue;
      if (!SURFACE_KINDS.includes(sp.value as SurfaceKind))
        throw new Error(`track: unknown surface "${String(sp.value)}"`);
      gidToSurface.set(first + num(t.id, "tile id"), sp.value as SurfaceKind);
    }
  }

  const surfaceLayer = layer(input, "surface", "tilelayer", true)!;
  const data = surfaceLayer.data;
  if (!Array.isArray(data) || data.length !== cols * rows)
    throw new Error("track: surface layer data size mismatch");
  const surface = (data as unknown[]).map((gid, i) => {
    const g = num(gid, `surface gid ${i}`) & 0x1fffffff;
    if (g === 0) return null;
    const s = gidToSurface.get(g);
    if (!s) throw new Error(`track: surface gid ${g} has no surface property`);
    return s;
  });

  const walls: Wall[] = [];
  for (const o of objects(input, "walls", true)) {
    const pts = points(o, "polyline") ?? points(o, "polygon");
    if (!pts || pts.length < 2)
      throw new Error("track: wall objects must be polylines or polygons");
    const flag = (name: string) =>
      (Array.isArray(o.properties) ? (o.properties as unknown[]) : []).some(
        (p) => isObj(p) && p.name === name && p.value === true,
      ) || undefined;
    const under = flag("under"),
      deck = flag("deck");
    const first = pts[0]!; // The length check above guarantees a first point.
    let prev = first;
    for (const p of pts.slice(1)) {
      walls.push(wall(prev, p, under, deck));
      prev = p;
    }
    if (o.polygon) walls.push(wall(prev, first, under, deck));
  }

  const checkpoints: Checkpoint[] = objects(input, "checkpoints", true).map(
    (o, i) => {
      const pts = points(o, "polyline");
      if (!pts || pts.length !== 2)
        throw new Error(`track: checkpoint ${i} must be a two-point polyline`);
      const a = pts[0]!,
        b = pts[1]!; // Exactly two points, checked above.
      return { a, b, mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    },
  );
  if (checkpoints.length < 2)
    throw new Error("track: need at least two checkpoints");
  checkpoints.forEach((c, i) => {
    if (hypot(c.b.x - c.a.x, c.b.y - c.a.y) < 1)
      throw new Error(`track: checkpoint ${i} is zero-length`);
    const prev =
      checkpoints[(i - 1 + checkpoints.length) % checkpoints.length]!; // An index modulo the length.
    if (hypot(c.mid.x - prev.mid.x, c.mid.y - prev.mid.y) < 1)
      throw new Error(`track: checkpoints ${i} and its predecessor coincide`);
  });

  const spawns = objects(input, "spawns", true).map((o) => {
    if (o.point !== true)
      throw new Error("track: spawns must be point objects");
    return {
      x: num(o.x, "spawn x"),
      y: num(o.y, "spawn y"),
      heading: (num(o.rotation ?? 0, "spawn rotation") * Math.PI) / 180,
    };
  });
  if (spawns.length !== 5) throw new Error("track: need exactly five spawns");

  const wps = objects(input, "waypoints", true);
  if (wps.length !== 1)
    throw new Error("track: waypoints must contain exactly one polygon");
  const waypoints = points(wps[0]!, "polygon"); // Exactly one object, checked above.
  if (!waypoints || waypoints.length < 3)
    throw new Error("track: waypoints must be one closed polygon");

  const items = objects(input, "items", false).map((o) => ({
    x: num(o.x, "item x"),
    y: num(o.y, "item y"),
  }));

  const bridges = objects(input, "bridges", false).map((o) => {
    const x0 = num(o.x, "bridge x"),
      y0 = num(o.y, "bridge y");
    const props = Array.isArray(o.properties)
      ? (o.properties as unknown[])
      : [];
    const entry = props.find(
      (p): p is Json => isObj(p) && p.name === "entry",
    )?.value;
    if (
      entry !== "left" &&
      entry !== "right" &&
      entry !== "top" &&
      entry !== "bottom"
    )
      throw new Error(
        "track: bridge needs an entry property (left|right|top|bottom)",
      );
    return {
      x0,
      y0,
      x1: x0 + num(o.width, "bridge width"),
      y1: y0 + num(o.height, "bridge height"),
      entry: entry as Bridge["entry"],
    };
  });

  return {
    name,
    cols,
    rows,
    tile,
    surface,
    walls,
    checkpoints,
    spawns,
    waypoints,
    items,
    bridges,
  };
}

/** A wall segment with the box a truck uses to skip it without measuring the distance. */
function wall(
  a: Point,
  b: Point,
  under: true | undefined,
  deck: true | undefined,
): Wall {
  return {
    a,
    b,
    minX: Math.min(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxX: Math.max(a.x, b.x),
    maxY: Math.max(a.y, b.y),
    ...(under ? { under } : {}),
    ...(deck ? { deck } : {}),
  };
}

export function insideAnyBridge(track: Track, p: Point): boolean {
  return track.bridges.some(
    (b) => p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1,
  );
}

export function surfaceAt(track: Track, x: number, y: number): SurfaceKind {
  const c = Math.floor(x / track.tile);
  const r = Math.floor(y / track.tile);
  if (c < 0 || r < 0 || c >= track.cols || r >= track.rows) return "dirt";
  return track.surface[r * track.cols + c] ?? "dirt";
}
