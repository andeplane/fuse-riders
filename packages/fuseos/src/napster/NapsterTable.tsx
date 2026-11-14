import type { ReactNode } from "react";
import { useState } from "react";

export type Column<T> = {
  key: string;
  label: string;
  /** Pixels; the last column takes what is left. */
  width: number;
  align?: "left" | "right" | "center";
  render: (row: T) => ReactNode;
  /** What clicking the header sorts by; absent means the column does not sort. */
  sortValue?: (row: T) => string | number;
};

export type NapsterTableProps<T> = {
  label: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  selected: readonly string[];
  onSelect: (keys: string[]) => void;
  onOpen?: (row: T) => void;
  /** Drawn left of the first column: the line-speed dot, a transfer arrow. */
  marker?: (row: T) => ReactNode;
  empty?: string;
};

/**
 * The client's list views: a grey header of push-button columns over white rows, the selection in navy. Click
 * selects one row, Ctrl+click toggles, Shift+click extends; a double click (or Enter) opens. Headers sort.
 */
export function NapsterTable<T>({
  label,
  columns,
  rows,
  rowKey,
  selected,
  onSelect,
  onOpen,
  marker,
  empty,
}: NapsterTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; descending: boolean }>();
  const [anchor, setAnchor] = useState<string>();
  const sortColumn = columns.find((column) => column.key === sort?.key);
  const sortValue = sortColumn?.sortValue;
  const ordered = sortValue
    ? [...rows].sort((a, b) => {
        const left = sortValue(a);
        const right = sortValue(b);
        const order = left < right ? -1 : left > right ? 1 : 0;
        return sort?.descending ? -order : order;
      })
    : rows;
  const keys = ordered.map(rowKey);

  const choose = (
    key: string,
    event: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean },
  ) => {
    if (event.shiftKey && anchor !== undefined && keys.includes(anchor)) {
      const from = keys.indexOf(anchor);
      const to = keys.indexOf(key);
      onSelect(keys.slice(Math.min(from, to), Math.max(from, to) + 1));
      return;
    }
    setAnchor(key);
    if (event.ctrlKey || event.metaKey)
      onSelect(
        selected.includes(key)
          ? selected.filter((item) => item !== key)
          : [...selected, key],
      );
    else onSelect([key]);
  };

  return (
    <div className="napster-list" role="grid" aria-label={label}>
      <div className="napster-list-head" role="row">
        {columns.map((column) => (
          <button
            type="button"
            role="columnheader"
            key={column.key}
            className="napster-list-header"
            style={{ width: column.width, textAlign: column.align ?? "left" }}
            aria-sort={
              sort?.key === column.key
                ? sort.descending
                  ? "descending"
                  : "ascending"
                : undefined
            }
            onClick={() => {
              if (!column.sortValue) return;
              setSort((current) => ({
                key: column.key,
                descending: current?.key === column.key && !current.descending,
              }));
            }}
          >
            {column.label}
          </button>
        ))}
      </div>
      <div className="napster-list-body">
        {ordered.length === 0 && empty ? (
          <div className="napster-list-empty">{empty}</div>
        ) : null}
        {ordered.map((row) => {
          const key = rowKey(row);
          const isSelected = selected.includes(key);
          return (
            <div
              key={key}
              role="row"
              aria-selected={isSelected}
              tabIndex={-1}
              className={`napster-list-row${isSelected ? " selected" : ""}`}
              onMouseDown={(event) => choose(key, event)}
              onDoubleClick={() => onOpen?.(row)}
              onKeyDown={(event) => {
                if (event.key === "Enter") onOpen?.(row);
              }}
            >
              {columns.map((column, index) => (
                <div
                  role="gridcell"
                  key={column.key}
                  className="napster-list-cell"
                  style={{
                    width: column.width,
                    textAlign: column.align ?? "left",
                  }}
                >
                  {index === 0 && marker ? marker(row) : null}
                  {column.render(row)}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
