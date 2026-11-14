import type { DiskEntry } from "../disk/diskEntries";

import {
  DEFAULT_SORT,
  formatModified,
  sortEntries,
  toggleSort,
} from "./sorting";

const entry = (
  name: string,
  kind: DiskEntry["kind"],
  extra: Partial<DiskEntry> = {},
): DiskEntry => ({
  location: `C:/${name}`,
  name,
  kind,
  icon: "file",
  typeLabel: kind === "file" ? "File" : "File Folder",
  modified: false,
  ...extra,
});

const entries = [
  entry("b.txt", "file", {
    size: 300,
    typeLabel: "Text Document",
    modifiedAt: "2026-01-02T00:00:00Z",
  }),
  entry("zeta", "folder", { modifiedAt: "2026-01-03T00:00:00Z" }),
  entry("a10.ts", "file", {
    size: 100,
    typeLabel: "TypeScript Source",
    modifiedAt: "2026-01-01T00:00:00Z",
  }),
  entry("a2.ts", "file", {
    size: 200,
    typeLabel: "TypeScript Source",
    modifiedAt: "2026-01-04T00:00:00Z",
  }),
  entry("alpha", "folder", { modifiedAt: "2026-01-05T00:00:00Z" }),
];

describe(sortEntries.name, () => {
  it("keeps folders above files and sorts names numerically, case-insensitively", () => {
    expect(sortEntries(entries, DEFAULT_SORT).map((e) => e.name)).toEqual([
      "alpha",
      "zeta",
      "a2.ts",
      "a10.ts",
      "b.txt",
    ]);
  });

  it("sorts descending without moving files above folders", () => {
    expect(
      sortEntries(entries, { column: "name", direction: "desc" }).map(
        (e) => e.name,
      ),
    ).toEqual(["zeta", "alpha", "b.txt", "a10.ts", "a2.ts"]);
  });

  it("sorts by size, type and modified, breaking ties by name", () => {
    expect(
      sortEntries(entries, { column: "size", direction: "asc" }).map(
        (e) => e.name,
      ),
    ).toEqual(["alpha", "zeta", "a10.ts", "a2.ts", "b.txt"]);
    expect(
      sortEntries(entries, { column: "type", direction: "asc" }).map(
        (e) => e.name,
      ),
    ).toEqual(["alpha", "zeta", "b.txt", "a2.ts", "a10.ts"]);
    expect(
      sortEntries(entries, { column: "modified", direction: "desc" }).map(
        (e) => e.name,
      ),
    ).toEqual(["alpha", "zeta", "a2.ts", "b.txt", "a10.ts"]);
  });

  it("does not mutate its input", () => {
    const copy = [...entries];
    sortEntries(entries, DEFAULT_SORT);
    expect(entries).toEqual(copy);
  });
});

describe(toggleSort.name, () => {
  it("flips the direction on the same column and starts ascending on a new one", () => {
    expect(toggleSort(DEFAULT_SORT, "name")).toEqual({
      column: "name",
      direction: "desc",
    });
    expect(toggleSort({ column: "name", direction: "desc" }, "name")).toEqual(
      DEFAULT_SORT,
    );
    expect(toggleSort({ column: "name", direction: "desc" }, "size")).toEqual({
      column: "size",
      direction: "asc",
    });
  });
});

describe(formatModified.name, () => {
  it("formats in UTC with a two-digit year, and nothing for missing or bad dates", () => {
    expect(formatModified("1997-08-14T03:12:00Z")).toBe("8/14/97, 3:12 AM");
    expect(formatModified(undefined)).toBe("");
    expect(formatModified("not a date")).toBe("");
  });
});
