/**
 * Extracts Elasto Mania v1.0 (`POT06`) levels into the compact table the Elasto Fuse engine builds its `LEVELS` from.
 *
 *   pnpm exec tsx scripts/elasto-fuse-levels.ts <dir-of-.lev>
 *
 * The POT06 layout is the one in `docs/design/elasto-fuse-mechanics.md` section 9, with the version-6 differences the
 * original loader (`TOPOL.CPP`, `topol::loadkulso`) applies: no two-byte id prefix, a 15-byte name, no LGR/ground/sky
 * names, no grass flag per polygon, and 20-byte objects (no gravity or animation). The loader seeks to absolute 0x64
 * for the polygon count, which is what the offsets below encode.
 *
 * Files are y-down; Elasto Fuse is y-up, so every y is negated here. Object type 1 is the flower, 2 an apple, 3 a
 * killer and 4 the start; the start's position is the left wheel centre and the original bike faces left.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MAGIC = "POT06";
const NAME_OFFSET = 0x29;
const NAME_LEN = 15;
const COUNT_OFFSET = 0x64;
const EOD_MARKER = 0x0067103a;
const EOF_MARKER = 0x00845d52;
const TOP10_BYTES = 688;

/** Apple, flower, killer: the three kinds a rider can touch, in the generated table's code order. */
const APPLE = 0,
  FLOWER = 1,
  KILLER = 2;
const OBJECT_KIND: Record<
  number,
  typeof APPLE | typeof FLOWER | typeof KILLER
> = { 1: FLOWER, 2: APPLE, 3: KILLER };

interface Parsed {
  name: string;
  polygons: [number, number][][];
  objects: { x: number; y: number; type: number }[];
}

const double = (data: Buffer, offset: number): number =>
  data.readDoubleLE(offset);
const int32 = (data: Buffer, offset: number): number =>
  data.readInt32LE(offset);

function parseLev(data: Buffer): Parsed {
  if (data.subarray(0, 5).toString("latin1") !== MAGIC)
    throw new Error(
      `not a POT06 level (magic ${data.subarray(0, 5)!.toString("latin1")})`,
    );

  const rawName = data.subarray(NAME_OFFSET, NAME_OFFSET + NAME_LEN);
  const name = rawName.toString("latin1").split("\0")[0]!.trim();

  const polygonCount = Math.trunc(double(data, COUNT_OFFSET));
  if (polygonCount < 1 || polygonCount > 300)
    throw new Error(`bad polygon count ${polygonCount}`);
  let offset = COUNT_OFFSET + 8;
  const polygons: [number, number][][] = [];
  for (let p = 0; p < polygonCount; p++) {
    const n = int32(data, offset);
    offset += 4;
    if (n < 3 || n > 1000) throw new Error(`bad vertex count ${n}`);
    const vertices: [number, number][] = [];
    for (let i = 0; i < n; i++) {
      vertices.push([double(data, offset), double(data, offset + 8)]);
      offset += 16;
    }
    polygons.push(vertices);
  }

  const objectCount = Math.trunc(double(data, offset));
  offset += 8;
  if (objectCount < 0 || objectCount > 52)
    throw new Error(`bad object count ${objectCount}`);
  const objects: { x: number; y: number; type: number }[] = [];
  for (let o = 0; o < objectCount; o++) {
    objects.push({
      x: double(data, offset),
      y: double(data, offset + 8),
      type: int32(data, offset + 16),
    });
    offset += 20;
  }

  if (data.length >= offset + 4 && int32(data, offset) === EOD_MARKER) {
    if (data.length !== offset + 4 + TOP10_BYTES + 4)
      throw new Error("top-ten block has an unexpected size");
    if (int32(data, offset + 4 + TOP10_BYTES) !== EOF_MARKER)
      throw new Error("EOF marker mismatch");
    offset += 4 + TOP10_BYTES + 4;
  }
  if (offset !== data.length)
    throw new Error(`${data.length - offset} unparsed trailing bytes`);

  return { name, polygons, objects };
}

const slug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "level";

/** A double as the shortest text that reads back as the same binary64. */
const num = (value: number): string =>
  Object.is(value, -0) ? "0" : String(value);

interface RawObject {
  kind: number;
  x: number;
  y: number;
}

function rawLevel(parsed: Parsed, id: string, fallbackName: string): string {
  const start = parsed.objects.find((object) => object.type === 4);
  if (!start) throw new Error("no start object");
  const objects: RawObject[] = [];
  for (const object of parsed.objects) {
    const kind = OBJECT_KIND[object.type];
    if (kind !== undefined) objects.push({ kind, x: object.x, y: -object.y });
  }
  if (!objects.some((object) => object.kind === FLOWER))
    throw new Error("no flower");
  const name = parsed.name || fallbackName;
  const polygons = parsed.polygons
    .map(
      (polygon) =>
        `[${polygon.flatMap(([x, y]) => [num(x), num(-y)]).join(",")}]`,
    )
    .join(",");
  const objectList = objects
    .map((object) => `[${object.kind},${num(object.x)},${num(object.y)}]`)
    .join(",");
  return `[${JSON.stringify(id)},${JSON.stringify(name)},[${polygons}],[${num(start.x)},${num(-start.y)}],[${objectList}]]`;
}

function main(): void {
  const directory = process.argv[2];
  if (!directory)
    throw new Error("usage: tsx scripts/elasto-fuse-levels.ts <dir-of-.lev>");

  const files = readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".lev"))
    .sort();
  if (files.length === 0) throw new Error(`no .lev files in ${directory}`);

  const rows: string[] = [];
  const ids = new Set<string>();
  for (const file of files) {
    const parsed = parseLev(readFileSync(join(directory, file)));
    const base = slug(file.slice(0, -4));
    let id = base,
      n = 2;
    while (ids.has(id)) id = `${base}-${n++}`;
    ids.add(id);
    try {
      rows.push(`  ${rawLevel(parsed, id, file.slice(0, -4))},`);
    } catch (error) {
      throw new Error(`${file}: ${(error as Error).message}`);
    }
  }

  const type = `
/** A level's touched objects: a kind code (0 apple, 1 flower, 2 killer) and its position in world units, y up. */
export type RawObjectKind = 0 | 1 | 2;
/** \`[id, name, polygons (flat x,y per polygon), start (left wheel centre), objects]\`, y up. */
export type RawLevel = readonly [
  id: string,
  name: string,
  polygons: readonly (readonly number[])[],
  start: readonly [number, number],
  objects: readonly (readonly [RawObjectKind, number, number])[],
];
`;
  const header = `// Generated by \`pnpm exec tsx scripts/elasto-fuse-levels.ts\` from Elasto Mania v1.0 (POT06) level files.
// Do not edit by hand; re-run the script to replace the set. Coordinates are y up, in Elasto Fuse world units.
${type}
export const RAW_LEVELS: readonly RawLevel[] = [
${rows.join("\n")}
];
`;
  const out = join(
    new URL(".", import.meta.url).pathname,
    "../games/elasto-fuse/src/engine/levels-data.ts",
  );
  writeFileSync(out, header);
  const bytes = Buffer.byteLength(header);
  console.log(
    `wrote ${files.length} levels (${(bytes / 1024 / 1024).toFixed(2)} MiB) to ${out}`,
  );
}

main();
