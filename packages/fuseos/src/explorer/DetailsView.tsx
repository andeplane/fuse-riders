import { formatSize } from "../disk/fileTypes";
import { Win98Icon } from "../ui/icons";

import type { EntryViewProps } from "./IconView";
import { entryContextMenu, ModifiedMark } from "./IconView";
import type { SortColumn, SortSpec } from "./sorting";
import { formatModified } from "./sorting";

export type DetailsViewProps = EntryViewProps & {
  sort: SortSpec;
  onSort: (column: SortColumn) => void;
};

const COLUMNS: { column: SortColumn; label: string; className: string }[] = [
  { column: "name", label: "Name", className: "explorer-col-name" },
  { column: "size", label: "Size", className: "explorer-col-size" },
  { column: "type", label: "Type", className: "explorer-col-type" },
  { column: "modified", label: "Modified", className: "explorer-col-modified" },
];

export function DetailsView({
  entries,
  selected,
  sort,
  onSelect,
  onOpen,
  onSort,
  onContextMenu,
}: DetailsViewProps) {
  return (
    <table className="explorer-details" aria-label="Details">
      <colgroup>
        {COLUMNS.map(({ column, className }) => (
          <col key={column} className={className} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {COLUMNS.map(({ column, label, className }) => {
            const direction =
              sort.column === column ? sort.direction : undefined;
            return (
              <th
                key={column}
                className={className}
                aria-sort={
                  direction === undefined
                    ? "none"
                    : direction === "asc"
                      ? "ascending"
                      : "descending"
                }
              >
                <button
                  type="button"
                  className="flat"
                  onClick={() => onSort(column)}
                >
                  <span>{label}</span>
                  {direction === undefined ? null : (
                    <span
                      className={`explorer-sort-arrow ${direction}`}
                      aria-hidden
                    />
                  )}
                </button>
              </th>
            );
          })}
          <th className="explorer-col-filler" aria-hidden />
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const isSelected = selected === entry.location;
          return (
            <tr
              key={entry.location}
              aria-selected={isSelected}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={entryContextMenu(entry, onContextMenu)}
            >
              <td className="explorer-col-name">
                <Win98Icon name={entry.icon} />
                <span className="explorer-item-label">
                  {entry.name}
                  <ModifiedMark entry={entry} />
                </span>
              </td>
              <td className="explorer-col-size">
                {entry.size === undefined ? "" : formatSize(entry.size)}
              </td>
              <td className="explorer-col-type">{entry.typeLabel}</td>
              <td className="explorer-col-modified">
                {formatModified(entry.modifiedAt)}
              </td>
              <td aria-hidden />
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
