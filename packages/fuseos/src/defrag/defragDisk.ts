/**
 * The disk Disk Defragmenter pretends to tidy: a row of clusters filled from a real file list (the C:
 * drive's manifest), scattered by a seeded generator, then put back in order one small run at a time.
 * Pure and deterministic: the same files and seed give the same mess and the same clean-up, step by step.
 * Nothing is ever moved anywhere but in this array.
 */

export type DefragFile = { path: string; size: number };

/** What a cluster looks like right now; the Legend names each one. */
export const CELL_STATES = [
  "free",
  "begin",
  "middle",
  "end",
  "optimized",
  "fixed",
  "bad",
  "reading",
  "writing",
] as const;

export type CellState = (typeof CELL_STATES)[number];

const CODE: Record<CellState, number> = {
  free: 0,
  begin: 1,
  middle: 2,
  end: 3,
  optimized: 4,
  fixed: 5,
  bad: 6,
  reading: 7,
  writing: 8,
};

const FREE = -1;
const FIXED = -2;
const BAD = -3;

/** How many clusters already in place one step confirms; a restarted pass races through what is tidy. */
export const VERIFY_PER_STEP = 12;
/** The longest run of clusters one read/write moves. */
export const MAX_RUN = 4;

export type DefragDiskOptions = {
  /** Clusters on the disk: one square each. */
  clusters: number;
  seed: number;
  /** Share of the disk holding data, 0..1. */
  usedFraction: number;
  /** Lists the "program files" first, so they end up at the start of the drive. */
  programsFirst?: (path: string) => boolean;
};

/** A small deterministic generator (mulberry32) in [0, 1). */
export function seededGenerator(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 0x100000000;
  };
}

/** A stable number for a string (FNV-1a), so a commit's sha seeds its own fragmentation. */
export function hashSeed(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

type Phase = {
  kind: "reading" | "writing";
  cells: number[];
  apply?: () => void;
};

export class DefragDisk {
  readonly clusters: number;
  /** Clusters holding data. */
  readonly used: number;
  /** What each physical cluster holds: a logical cluster index, or FREE, FIXED or BAD. */
  private readonly slots: Int32Array;
  /** Where each logical cluster belongs once the drive is in order. */
  private readonly targets: Int32Array;
  /** Where each logical cluster is right now. */
  private readonly position: Int32Array;
  private readonly optimized: Uint8Array;
  private readonly paths: string[];
  private readonly random: () => number;
  private frontier = 0;
  private phases: Phase[] = [];
  private active: Phase | undefined;

  constructor(files: readonly DefragFile[], options: DefragDiskOptions) {
    const random = seededGenerator(options.seed);
    this.random = random;
    this.clusters = options.clusters;
    this.slots = new Int32Array(options.clusters).fill(FREE);
    this.optimized = new Uint8Array(options.clusters);

    // A swap file that never moves, and a few clusters the surface scan gave up on.
    const fixedStart = Math.floor(options.clusters * (0.3 + random() * 0.3));
    const fixedLength = Math.max(1, Math.floor(options.clusters * 0.006));
    for (let offset = 0; offset < fixedLength; offset += 1)
      this.slots[fixedStart + offset] = FIXED;
    for (let index = 0; index < 3; index += 1) {
      const at = Math.floor(options.clusters * (0.35 + random() * 0.6));
      if (this.slots[at] === FREE) this.slots[at] = BAD;
    }

    const usable: number[] = [];
    this.slots.forEach((value, index) => {
      if (value === FREE) usable.push(index);
    });
    // Always a little room to shuffle clusters through.
    this.used = Math.max(
      1,
      Math.min(
        usable.length - 2 * MAX_RUN,
        Math.round(options.clusters * options.usedFraction),
      ),
    );
    this.targets = Int32Array.from(usable.slice(0, this.used));
    this.position = new Int32Array(this.used);
    this.paths = clusterPaths(files, this.used, options.programsFirst);

    // Fragments: short runs, most displaced a little, some thrown anywhere.
    const system = Math.min(this.used, Math.floor(this.used * 0.04));
    type Fragment = { start: number; length: number; key: number };
    const fragments: Fragment[] = [];
    for (let start = system; start < this.used;) {
      const length = Math.min(
        this.used - start,
        1 + Math.floor(random() * random() * 9),
      );
      const stray = random() < 0.3;
      fragments.push({
        start,
        length,
        key: stray
          ? random() * this.used
          : start + (random() - 0.5) * this.used * 0.45,
      });
      start += length;
    }
    fragments.sort((a, b) => a.key - b.key || a.start - b.start);

    // Laid along the disk with gaps; about a third of the free space stays as one stretch at the end.
    let gapBudget = Math.floor((usable.length - this.used) * 0.65);
    let cursor = 0;
    const place = (logical: number) => {
      const slot = usable[cursor] ?? 0;
      cursor += 1;
      this.slots[slot] = logical;
      this.position[logical] = slot;
    };
    for (let logical = 0; logical < system; logical += 1) place(logical);
    for (const fragment of fragments) {
      if (gapBudget > 0 && random() < 0.45) {
        const gap = Math.min(gapBudget, 1 + Math.floor(random() * 3));
        cursor += gap;
        gapBudget -= gap;
      }
      for (let offset = 0; offset < fragment.length; offset += 1)
        place(fragment.start + offset);
    }
  }

  /** Whole percent of the data in its final place. */
  get percent(): number {
    return Math.floor((this.frontier / this.used) * 100);
  }

  get done(): boolean {
    return this.frontier >= this.used && !this.active;
  }

  /** The file whose clusters are being moved, or the last one when the drive is done. */
  get currentFile(): string {
    return this.paths[Math.min(this.frontier, this.used - 1)] ?? "";
  }

  /**
   * Advances one beat: confirm clusters already in place, or show the next read, or the next write.
   * A run is read (green), then written at the front of the drive (red); whatever was in the way is
   * first read and written out to free space.
   */
  step(): void {
    if (this.active) {
      this.active.apply?.();
      this.active = undefined;
    }
    const next = this.phases.shift();
    if (next) {
      this.active = next;
      return;
    }
    let verified = 0;
    while (
      this.frontier < this.used &&
      verified < VERIFY_PER_STEP &&
      this.position[this.frontier] === this.targets[this.frontier]
    ) {
      this.optimized[this.position[this.frontier] ?? 0] = 1;
      this.frontier += 1;
      verified += 1;
    }
    if (verified > 0 || this.frontier >= this.used) return;
    this.planRun();
    this.active = this.phases.shift();
  }

  private planRun(): void {
    const start = this.frontier;
    const end = Math.min(
      this.used,
      start + 1 + Math.floor(this.random() * MAX_RUN),
    );
    const runTargets: number[] = [];
    for (let logical = start; logical < end; logical += 1)
      runTargets.push(this.targets[logical] ?? 0);

    // Whatever sits where the run belongs, and is not part of the run, moves out to free space first.
    const evacuees = runTargets
      .map((slot) => this.slots[slot] ?? FREE)
      .filter((logical) => logical >= end);
    if (evacuees.length > 0) {
      const from = evacuees.map((logical) => this.position[logical] ?? 0);
      const to: number[] = [];
      for (
        let slot = (runTargets[runTargets.length - 1] ?? 0) + 1;
        to.length < evacuees.length && slot < this.clusters;
        slot += 1
      )
        if (this.slots[slot] === FREE) to.push(slot);
      this.phases.push(
        { kind: "reading", cells: from },
        {
          kind: "writing",
          cells: to,
          apply: () => {
            from.forEach((slot) => {
              this.slots[slot] = FREE;
            });
            evacuees.forEach((logical, index) => {
              const slot = to[index] ?? 0;
              this.slots[slot] = logical;
              this.position[logical] = slot;
            });
          },
        },
      );
    }

    // Evacuation only moves clusters outside the run, so the run's own places are known now.
    const sources: number[] = [];
    for (let logical = start; logical < end; logical += 1)
      sources.push(this.position[logical] ?? 0);
    this.phases.push(
      { kind: "reading", cells: sources },
      {
        kind: "writing",
        cells: runTargets,
        apply: () => {
          sources.forEach((slot) => {
            this.slots[slot] = FREE;
          });
          runTargets.forEach((slot, index) => {
            this.slots[slot] = start + index;
            this.position[start + index] = slot;
            this.optimized[slot] = 1;
          });
          this.frontier = end;
        },
      },
    );
  }

  /**
   * Another program wrote to the disk: `count` clusters land somewhere new and the pass starts over.
   * What is already in order is confirmed quickly on the way back.
   */
  disturb(count: number): void {
    if (this.active) {
      this.active.apply?.();
      this.active = undefined;
    }
    // Finish the move in flight so no cluster is left half-written.
    for (const phase of this.phases) phase.apply?.();
    this.phases = [];
    const free: number[] = [];
    this.slots.forEach((value, index) => {
      if (value === FREE) free.push(index);
    });
    for (
      let moved = 0;
      moved < count && free.length > MAX_RUN * 2;
      moved += 1
    ) {
      const logical = Math.floor(this.random() * this.used);
      const pick = Math.floor(this.random() * free.length);
      const to = free[pick] ?? 0;
      const from = this.position[logical] ?? 0;
      this.slots[from] = FREE;
      this.slots[to] = logical;
      this.position[logical] = to;
      free[pick] = from;
    }
    this.optimized.fill(0);
    this.frontier = 0;
  }

  /** One code per cluster (an index into `CELL_STATES`); `showHead` off leaves out the read/write flashes. */
  cells(showHead = true): Uint8Array {
    const cells = new Uint8Array(this.clusters);
    const third = this.used / 3;
    for (let slot = 0; slot < this.clusters; slot += 1) {
      const value = this.slots[slot] ?? FREE;
      if (value === FREE) cells[slot] = CODE.free;
      else if (value === FIXED) cells[slot] = CODE.fixed;
      else if (value === BAD) cells[slot] = CODE.bad;
      else if (this.optimized[slot]) cells[slot] = CODE.optimized;
      else
        cells[slot] =
          value < third
            ? CODE.begin
            : value < third * 2
              ? CODE.middle
              : CODE.end;
    }
    if (showHead && this.active) {
      const code = CODE[this.active.kind];
      for (const slot of this.active.cells) cells[slot] = code;
    }
    return cells;
  }
}

/** The file each logical cluster belongs to: the drive's bytes cut into `count` equal clusters, in path order. */
export function clusterPaths(
  files: readonly DefragFile[],
  count: number,
  programsFirst?: (path: string) => boolean,
): string[] {
  const ordered = [...files].sort((a, b) => {
    const left = programsFirst?.(a.path) ? 0 : 1;
    const right = programsFirst?.(b.path) ? 0 : 1;
    if (left !== right) return left - right;
    return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
  });
  // An empty file still has a directory entry to shuffle.
  const sizes = ordered.map((file) => Math.max(1, file.size));
  const total = sizes.reduce((sum, size) => sum + size, 0);
  const paths: string[] = [];
  let index = 0;
  let end = sizes[0] ?? 0;
  for (let cluster = 0; cluster < count; cluster += 1) {
    const middle = ((cluster + 0.5) * total) / count;
    while (end <= middle && index < ordered.length - 1) {
      index += 1;
      end += sizes[index] ?? 0;
    }
    paths.push(ordered[index]?.path ?? "");
  }
  return paths;
}
