import type { RecycleBinItem } from "./recycleBinItems";

export type RecycleBinColumn =
  "name" | "location" | "deleted" | "type" | "size";

export type RecycleBinSort = {
  column: RecycleBinColumn;
  direction: "asc" | "desc";
};

export const DEFAULT_RECYCLE_BIN_SORT: RecycleBinSort = {
  column: "name",
  direction: "asc",
};

/** Clicking the sorted column flips it; clicking another sorts ascending by it, as Explorer does. */
export function toggleSort(
  sort: RecycleBinSort,
  column: RecycleBinColumn,
): RecycleBinSort {
  if (sort.column !== column) return { column, direction: "asc" };
  return { column, direction: sort.direction === "asc" ? "desc" : "asc" };
}

function compare(
  a: RecycleBinItem,
  b: RecycleBinItem,
  column: RecycleBinColumn,
): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    case "location":
      return a.originalLocation.localeCompare(b.originalLocation, "en", {
        sensitivity: "base",
      });
    case "deleted":
      return a.deletedAt - b.deletedAt;
    case "type":
      return a.type.localeCompare(b.type, "en", { sensitivity: "base" });
    case "size":
      return a.size - b.size;
  }
}

/** A sorted copy; ties fall back to the name so the order is total. */
export function sortRecycleBinItems(
  items: readonly RecycleBinItem[],
  sort: RecycleBinSort,
): RecycleBinItem[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return [...items].sort(
    (a, b) =>
      sign * compare(a, b, sort.column) ||
      (sort.column === "name" ? 0 : compare(a, b, "name")),
  );
}
