import type { ReactNode } from "react";
import { useState } from "react";

export type Column<T> = {
  key: string;
  label: string;
  width: number;
  align?: "left" | "right";
  render: (row: T) => ReactNode;
  /** Sort key; absent means the column does not sort. */
  sort?: (row: T) => string | number;
};

export type ListViewProps<T> = {
  label: string;
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  selected?: string;
  onSelect?: (key: string) => void;
  onOpen?: (row: T) => void;
  onContextMenu?: (row: T, position: { x: number; y: number }) => void;
  /** Extra class per row (colours for the queue, bold for ops). */
  rowClass?: (row: T) => string | undefined;
  className?: string;
};

/**
 * A Win32 report-mode ListView: raised header buttons over a white, sunken field of 16px rows, a navy
 * selection, click-to-sort headers with the little arrow. Columns keep their pixel widths and the field
 * scrolls both ways, as the common control did.
 */
export function ListView<T>({
  label,
  columns,
  rows,
  rowKey,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
  rowClass,
  className,
}: ListViewProps<T>) {
  const [sort, setSort] = useState<{ key: string; up: boolean } | null>(null);
  const sortColumn = columns.find((column) => column.key === sort?.key);
  const sorted =
    sort && sortColumn?.sort
      ? [...rows].sort((a, b) => {
          const left = sortColumn.sort?.(a) ?? "";
          const right = sortColumn.sort?.(b) ?? "";
          const order =
            typeof left === "number" && typeof right === "number"
              ? left - right
              : String(left).localeCompare(String(right));
          return sort.up ? order : -order;
        })
      : rows;
  const width = columns.reduce((sum, column) => sum + column.width, 0);
  return (
    <div className={`dc-list ${className ?? ""}`}>
      <table role="grid" aria-label={label} style={{ width }}>
        <colgroup>
          {columns.map((column) => (
            <col key={column.key} style={{ width: column.width }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                aria-sort={
                  sort?.key === column.key
                    ? sort.up
                      ? "ascending"
                      : "descending"
                    : undefined
                }
                className={column.align === "right" ? "dc-right" : undefined}
                onClick={() => {
                  if (!column.sort) return;
                  setSort((current) =>
                    current?.key === column.key
                      ? { key: column.key, up: !current.up }
                      : { key: column.key, up: true },
                  );
                }}
              >
                {column.label}
                {sort?.key === column.key ? (
                  <span className="dc-sort" aria-hidden>
                    {sort.up ? "▲" : "▼"}
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const key = rowKey(row);
            return (
              <tr
                key={key}
                aria-selected={selected === key}
                className={rowClass?.(row)}
                onMouseDown={() => onSelect?.(key)}
                onDoubleClick={() => onOpen?.(row)}
                onContextMenu={(event) => {
                  if (!onContextMenu) return;
                  event.preventDefault();
                  onSelect?.(key);
                  onContextMenu(row, { x: event.clientX, y: event.clientY });
                }}
              >
                {columns.map((column) => (
                  <td
                    key={column.key}
                    className={
                      column.align === "right" ? "dc-right" : undefined
                    }
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
