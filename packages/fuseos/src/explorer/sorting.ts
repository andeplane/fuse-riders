import type { DiskEntry } from "../disk/diskEntries";

export type SortColumn = "name" | "size" | "type" | "modified";
export type SortDirection = "asc" | "desc";
export type SortSpec = { column: SortColumn; direction: SortDirection };

export const DEFAULT_SORT: SortSpec = { column: "name", direction: "asc" };

const compareNames = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function compareBy(a: DiskEntry, b: DiskEntry, column: SortColumn): number {
  switch (column) {
    case "name":
      return compareNames(a.name, b.name);
    case "size":
      return (a.size ?? -1) - (b.size ?? -1);
    case "type":
      return compareNames(a.typeLabel, b.typeLabel);
    case "modified":
      return (a.modifiedAt ?? "").localeCompare(b.modifiedAt ?? "");
  }
}

/** Windows ordering: drives and folders stay above files whichever column sorts. */
export function sortEntries(
  entries: readonly DiskEntry[],
  sort: SortSpec,
): DiskEntry[] {
  const factor = sort.direction === "asc" ? 1 : -1;
  const rank = (entry: DiskEntry) => (entry.kind === "file" ? 1 : 0);
  return [...entries].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    const byColumn = compareBy(a, b, sort.column);
    if (byColumn !== 0) return byColumn * factor;
    return compareNames(a.name, b.name) * factor;
  });
}

export function toggleSort(current: SortSpec, column: SortColumn): SortSpec {
  if (current.column === column)
    return { column, direction: current.direction === "asc" ? "desc" : "asc" };
  return { column, direction: "asc" };
}

/** Explorer's Modified column, in UTC so a listing reads the same on every machine: "8/14/97 3:12 AM". */
export function formatModified(iso: string | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    timeZone: "UTC",
    year: "2-digit",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
