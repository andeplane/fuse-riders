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
  { column: "name", label: "Name", className: "w-1/2" },
  { column: "size", label: "Size", className: "w-20 text-right" },
  { column: "type", label: "Type", className: "w-1/4" },
  { column: "modified", label: "Modified", className: "w-1/4" },
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
    <table className="interactive w-full" aria-label="Details">
      <thead>
        <tr>
          {COLUMNS.map(({ column, label, className }) => (
            <th
              key={column}
              className={className}
              aria-sort={
                sort.column === column
                  ? sort.direction === "asc"
                    ? "ascending"
                    : "descending"
                  : "none"
              }
            >
              <button
                type="button"
                className="flat w-full text-left"
                onClick={() => onSort(column)}
              >
                {label}
                {sort.column === column
                  ? sort.direction === "asc"
                    ? " ▲"
                    : " ▼"
                  : ""}
              </button>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => {
          const isSelected = selected === entry.location;
          return (
            <tr
              key={entry.location}
              className={isSelected ? "highlighted" : ""}
              aria-selected={isSelected}
              onClick={() => onSelect(entry)}
              onDoubleClick={() => onOpen(entry)}
              onContextMenu={entryContextMenu(entry, onContextMenu)}
            >
              <td className="truncate">
                <span className="mr-1 inline-block align-middle">
                  <Win98Icon name={entry.icon} />
                </span>
                {entry.name}
                <ModifiedMark entry={entry} />
              </td>
              <td className="text-right">
                {entry.size === undefined ? "" : formatSize(entry.size)}
              </td>
              <td>{entry.typeLabel}</td>
              <td>{formatModified(entry.modifiedAt)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
