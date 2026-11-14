import type { CellState, DefragFile } from "./defragDisk";
import {
  CELL_STATES,
  clusterPaths,
  DefragDisk,
  hashSeed,
  seededGenerator,
} from "./defragDisk";

const FILES: readonly DefragFile[] = [
  { path: "README.md", size: 4_000 },
  { path: "games/fuseball/index.html", size: 30_000 },
  { path: "packages/fuseos/src/App.tsx", size: 60_000 },
  { path: "packages/fuseos/src/main.tsx", size: 0 },
  { path: "public/music/theme.mp3", size: 200_000 },
];

const OPTIONS = { clusters: 600, seed: 42, usedFraction: 0.6 };

function count(cells: Uint8Array): Record<CellState, number> {
  const totals: Record<CellState, number> = {
    free: 0,
    begin: 0,
    middle: 0,
    end: 0,
    optimized: 0,
    fixed: 0,
    bad: 0,
    reading: 0,
    writing: 0,
  };
  cells.forEach((code) => {
    const state = CELL_STATES[code];
    if (state) totals[state] += 1;
  });
  return totals;
}

function runToEnd(disk: DefragDisk): number {
  let steps = 0;
  while (!disk.done) {
    disk.step();
    steps += 1;
    if (steps > 100_000) throw new Error("the defragmenter never finished");
  }
  return steps;
}

describe("seededGenerator and hashSeed", () => {
  it("repeat for the same seed, differ for another and stay inside [0, 1)", () => {
    const first = seededGenerator(7);
    const again = seededGenerator(7);
    const other = seededGenerator(8);
    const values = Array.from({ length: 50 }, () => first());
    expect(Array.from({ length: 50 }, () => again())).toEqual(values);
    expect(Array.from({ length: 50 }, () => other())).not.toEqual(values);
    expect(values.every((value) => value >= 0 && value < 1)).toBe(true);
  });

  it("turns a commit sha into a stable seed", () => {
    expect(hashSeed("abc")).toBe(hashSeed("abc"));
    expect(hashSeed("abc")).not.toBe(hashSeed("abd"));
    expect(hashSeed("")).toBe(0x811c9dc5);
  });
});

describe("clusterPaths", () => {
  it("gives each file a share of the clusters in proportion to its size, in path order", () => {
    const paths = clusterPaths(FILES, 100);
    expect(paths).toHaveLength(100);
    expect(paths[0]).toBe("README.md");
    expect(paths[99]).toBe("public/music/theme.mp3");
    const share = (path: string) =>
      paths.filter((entry) => entry === path).length;
    expect(share("public/music/theme.mp3")).toBeGreaterThan(
      share("packages/fuseos/src/App.tsx"),
    );
    expect(share("packages/fuseos/src/App.tsx")).toBeGreaterThan(
      share("games/fuseball/index.html"),
    );
    expect([...paths].sort()).toEqual(paths);
  });

  it("lists program files first when asked", () => {
    const paths = clusterPaths(FILES, 100, (path) => path.startsWith("games/"));
    expect(paths[0]).toBe("games/fuseball/index.html");
    expect(paths[99]).toBe("public/music/theme.mp3");
  });

  it("has nothing to name on an empty drive", () => {
    expect(clusterPaths([], 3)).toEqual(["", "", ""]);
  });
});

describe("DefragDisk", () => {
  it("builds the same fragmented drive for the same seed and another for another", () => {
    const first = new DefragDisk(FILES, OPTIONS).cells();
    expect(new DefragDisk(FILES, OPTIONS).cells()).toEqual(first);
    expect(new DefragDisk(FILES, { ...OPTIONS, seed: 43 }).cells()).not.toEqual(
      first,
    );
  });

  it("starts as a mess: data of every region scattered, with free space, a swap file and bad clusters", () => {
    const disk = new DefragDisk(FILES, OPTIONS);
    const totals = count(disk.cells());
    expect(disk.clusters).toBe(600);
    expect(disk.used).toBe(360);
    expect(totals.begin + totals.middle + totals.end).toBe(360);
    expect(totals.begin).toBeGreaterThan(0);
    expect(totals.middle).toBeGreaterThan(0);
    expect(totals.end).toBeGreaterThan(0);
    expect(totals.optimized).toBe(0);
    expect(totals.fixed).toBeGreaterThan(0);
    expect(totals.bad).toBeGreaterThan(0);
    expect(totals.free).toBe(600 - 360 - totals.fixed - totals.bad);
    expect(disk.percent).toBe(0);
    expect(disk.done).toBe(false);
    // Fragmented: data and free space alternate many times along the disk.
    const cells = disk.cells();
    let switches = 0;
    for (let index = 1; index < cells.length; index += 1)
      if ((cells[index] === 0) !== (cells[index - 1] === 0)) switches += 1;
    expect(switches).toBeGreaterThan(20);
  });

  it("reads green and writes red while it works, and loses no cluster on the way", () => {
    const disk = new DefragDisk(FILES, OPTIONS);
    const fixed = count(disk.cells()).fixed;
    const bad = count(disk.cells()).bad;
    const seen = new Set<CellState>();
    let previous = 0;
    while (!disk.done) {
      disk.step();
      const totals = count(disk.cells());
      CELL_STATES.forEach((state) => {
        if (totals[state] > 0) seen.add(state);
      });
      // Without the head, every data cluster is accounted for at every beat.
      const plain = count(disk.cells(false));
      expect(plain.reading + plain.writing).toBe(0);
      expect(plain.begin + plain.middle + plain.end + plain.optimized).toBe(
        360,
      );
      expect(plain.fixed).toBe(fixed);
      expect(plain.bad).toBe(bad);
      expect(disk.percent).toBeGreaterThanOrEqual(previous);
      previous = disk.percent;
    }
    expect(seen).toContain("reading");
    expect(seen).toContain("writing");
    expect(disk.percent).toBe(100);
  });

  it("ends with every data cluster optimized and packed at the front, around what cannot move", () => {
    const disk = new DefragDisk(FILES, OPTIONS);
    runToEnd(disk);
    const cells = disk.cells();
    const totals = count(cells);
    expect(totals.optimized).toBe(360);
    expect(totals.begin + totals.middle + totals.end).toBe(0);
    const states = [...cells].map((code) => CELL_STATES[code]);
    const lastData = states.lastIndexOf("optimized");
    // Nothing free before the last data cluster: only data, the swap file and bad clusters.
    expect(states.slice(0, lastData).includes("free")).toBe(false);
    expect(disk.currentFile).toBe("public/music/theme.mp3");
    // A finished drive stays finished.
    disk.step();
    expect(disk.done).toBe(true);
  });

  it("names the file under the head, in drive order", () => {
    const disk = new DefragDisk(FILES, OPTIONS);
    expect(disk.currentFile).toBe("README.md");
    const names: string[] = [disk.currentFile];
    while (!disk.done) {
      disk.step();
      if (names[names.length - 1] !== disk.currentFile)
        names.push(disk.currentFile);
    }
    expect(names).toEqual([
      "README.md",
      "games/fuseball/index.html",
      "packages/fuseos/src/App.tsx",
      "public/music/theme.mp3",
    ]);
  });

  it("starts over when another program writes to the disk, and confirms what is still in order quickly", () => {
    const disk = new DefragDisk(FILES, OPTIONS);
    let steps = 0;
    while (disk.percent < 60) {
      disk.step();
      steps += 1;
    }
    disk.disturb(10);
    expect(disk.percent).toBe(0);
    expect(count(disk.cells()).optimized).toBe(0);
    const totals = count(disk.cells());
    expect(totals.begin + totals.middle + totals.end).toBe(360);
    let again = 0;
    while (disk.percent < 60) {
      disk.step();
      again += 1;
    }
    expect(again).toBeLessThan(steps);
    runToEnd(disk);
    expect(count(disk.cells()).optimized).toBe(360);
  });

  it("can be disturbed mid-move without leaving a cluster half-written", () => {
    const disk = new DefragDisk(FILES, OPTIONS);
    // Stop on a read: the write that follows is still pending.
    while (count(disk.cells()).reading === 0) disk.step();
    disk.disturb(5);
    const plain = count(disk.cells());
    expect(plain.reading + plain.writing).toBe(0);
    expect(plain.begin + plain.middle + plain.end).toBe(360);
    runToEnd(disk);
    expect(count(disk.cells()).optimized).toBe(360);
  });

  it("keeps room to work on a nearly full disk, and handles a disk of one file", () => {
    const full = new DefragDisk(FILES, { ...OPTIONS, usedFraction: 1 });
    expect(full.used).toBeLessThan(600);
    runToEnd(full);
    expect(count(full.cells()).optimized).toBe(full.used);
    full.disturb(1000);
    runToEnd(full);
    expect(count(full.cells()).optimized).toBe(full.used);

    const tiny = new DefragDisk([{ path: "a.txt", size: 1 }], {
      clusters: 40,
      seed: 1,
      usedFraction: 0,
    });
    expect(tiny.used).toBe(1);
    runToEnd(tiny);
    expect(tiny.percent).toBe(100);
  });
});
