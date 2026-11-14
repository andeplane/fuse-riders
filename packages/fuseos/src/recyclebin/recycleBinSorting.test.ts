import type { RecycleBinItem } from "./recycleBinItems";
import {
  DEFAULT_RECYCLE_BIN_SORT,
  sortRecycleBinItems,
  toggleSort,
} from "./recycleBinSorting";

function item(
  id: string,
  overrides: Partial<Omit<RecycleBinItem, "id">> = {},
): RecycleBinItem {
  return {
    id,
    name: `${id}.txt`,
    originalLocation: "C:\\",
    deletedAt: 0,
    type: "Text Document",
    size: 0,
    icon: "file",
    open: { kind: "locked" },
    ...overrides,
  };
}

describe(toggleSort.name, () => {
  it("flips the direction of the sorted column and sorts a new column ascending", () => {
    expect(toggleSort(DEFAULT_RECYCLE_BIN_SORT, "name")).toEqual({
      column: "name",
      direction: "desc",
    });
    expect(toggleSort({ column: "name", direction: "desc" }, "name")).toEqual(
      DEFAULT_RECYCLE_BIN_SORT,
    );
    expect(toggleSort({ column: "name", direction: "desc" }, "size")).toEqual({
      column: "size",
      direction: "asc",
    });
  });
});

describe(sortRecycleBinItems.name, () => {
  const items = [
    item("b", { name: "beta.avi", size: 5, deletedAt: 2, type: "Video Clip" }),
    item("a", { name: "Alpha.txt", size: 5, deletedAt: 3 }),
    item("c", {
      name: "gamma.zip",
      size: 1,
      deletedAt: 1,
      type: "WinZip File",
      originalLocation: "A:\\",
    }),
  ];
  const names = (sorted: RecycleBinItem[]) => sorted.map((entry) => entry.id);

  it("sorts by name case-insensitively, either way, without touching the input", () => {
    const input = [...items];
    expect(names(sortRecycleBinItems(input, DEFAULT_RECYCLE_BIN_SORT))).toEqual(
      ["a", "b", "c"],
    );
    expect(
      names(sortRecycleBinItems(input, { column: "name", direction: "desc" })),
    ).toEqual(["c", "b", "a"]);
    expect(input).toEqual(items);
  });

  it("sorts by every other column, breaking ties by name", () => {
    expect(
      names(sortRecycleBinItems(items, { column: "size", direction: "asc" })),
    ).toEqual(["c", "a", "b"]);
    expect(
      names(
        sortRecycleBinItems(items, { column: "deleted", direction: "asc" }),
      ),
    ).toEqual(["c", "b", "a"]);
    expect(
      names(sortRecycleBinItems(items, { column: "type", direction: "asc" })),
    ).toEqual(["a", "b", "c"]);
    expect(
      names(
        sortRecycleBinItems(items, { column: "location", direction: "desc" }),
      ),
    ).toEqual(["a", "b", "c"]);
  });
});
