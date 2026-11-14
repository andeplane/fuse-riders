/**
 * What published charts do, as numbers: `games/fusemania/charts/reference-patterns.json` holds rates and frequencies
 * measured over 480 simfiles (no chart content). The generator aims at them and `compare` reports how close it gets.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Frequencies by name: shares that add up to one, or one rate per name. */
export type Table = Readonly<Record<string, number>>;

export interface Percentiles {
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/** One bucket of the reference: the charts of one family and difficulty. */
export interface Reference {
  /** Per-chart numbers (`nps`, `peak`, `jump_share`, ...) as percentiles over the bucket's charts. */
  scalars: Readonly<Record<string, Percentiles>>;
  /** Pooled frequencies (`quant`, `gap`, `jump_pair`, `trigram_8th`, ...). */
  tables: Readonly<Record<string, Table>>;
  /** Notes per tenth of a chart, relative to its mean. */
  densityCurve: readonly number[];
}

const PATH = fileURLToPath(
  new URL(
    "../../../games/fusemania/charts/reference-patterns.json",
    import.meta.url,
  ),
);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseBucket(bucket: Record<string, unknown>): Reference {
  const scalars: Record<string, Percentiles> = {};
  const tables: Record<string, Table> = {};
  let densityCurve: number[] = [];
  for (const [key, value] of Object.entries(bucket)) {
    if (Array.isArray(value)) {
      if (key === "density_curve")
        densityCurve = value.filter(
          (item): item is number => typeof item === "number",
        );
      continue;
    }
    if (!isRecord(value)) continue;
    const numbers: Record<string, number> = {};
    for (const [name, item] of Object.entries(value))
      if (typeof item === "number") numbers[name] = item;
    const { p25, p50, p75, p90 } = numbers;
    if (
      p25 !== undefined &&
      p50 !== undefined &&
      p75 !== undefined &&
      p90 !== undefined
    )
      scalars[key] = { p25, p50, p75, p90 };
    else tables[key] = numbers;
  }
  return { scalars, tables, densityCurve };
}

let buckets: Map<string, Reference> | undefined;

/** The reference bucket `<family>:<difficulty>`, e.g. `itg:hard`. */
export function referenceBucket(name: string): Reference {
  if (!buckets) {
    const data: unknown = JSON.parse(readFileSync(PATH, "utf8"));
    if (!isRecord(data) || !isRecord(data.buckets))
      throw new Error(`${PATH}: no buckets`);
    buckets = new Map();
    for (const [key, bucket] of Object.entries(data.buckets))
      if (isRecord(bucket)) buckets.set(key, parseBucket(bucket));
  }
  const found = buckets.get(name);
  if (!found) throw new Error(`${PATH}: no bucket "${name}"`);
  return found;
}

/** In The Groove is the model: its charts are written for flow, which is what a keyboard wants too. */
export const referenceFor = (difficulty: string): Reference =>
  referenceBucket(`itg:${difficulty.toLowerCase()}`);

export const ARROWS = "LDUR";

/** The three speeds patterns are counted at. A swung pair's long and short halves count as an eighth and a sixteenth. */
export type Speed = "4th" | "8th" | "16th";

export const speedOf = (gapBeats: number): Speed =>
  gapBeats <= 0.34 ? "16th" : gapBeats <= 0.7 ? "8th" : "4th";

/** The reference's name for the gap between two rows. */
export function gapClass(gapBeats: number): string {
  if (gapBeats <= 0.34) return "16th";
  if (gapBeats <= 0.7) return "8th";
  if (gapBeats <= 0.85) return "dotted8th";
  if (gapBeats <= 1.2) return "4th";
  if (gapBeats <= 1.7) return "dotted4th";
  if (gapBeats <= 2.2) return "half";
  return "long";
}
