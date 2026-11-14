import { Win98Icon } from "../ui/icons";
import type { MenuDef } from "../windows/MenuBar";
import { MenuBar } from "../windows/MenuBar";

import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import { formatDeletedAt, formatRecycleBinSize } from "./recycleBinItems";
import type { RecycleBinColumn } from "./recycleBinSorting";
import { useRecycleBinViewModel } from "./useRecycleBinViewModel";

export type RecycleBinWindowProps = { windowId: string };

const COLUMNS: {
  column: RecycleBinColumn;
  label: string;
  className: string;
}[] = [
  { column: "name", label: "Name", className: "w-[34%]" },
  { column: "location", label: "Original Location", className: "w-[30%]" },
  { column: "deleted", label: "Date Deleted", className: "w-[16%]" },
  { column: "type", label: "Type", className: "w-[12%]" },
  { column: "size", label: "Size", className: "w-[8%] text-right" },
];

/** The Recycle Bin as Windows 95 showed it: a details list with the bin's own five columns. */
export function RecycleBinWindow({ windowId }: RecycleBinWindowProps) {
  const vm = useRecycleBinViewModel(windowId);
  const empty = vm.items.length === 0;
  const none = vm.selected.size === 0;
  const menus: MenuDef[] = [
    {
      label: "File",
      items: [
        { label: "Restore", onSelect: vm.restoreSelected, disabled: none },
        { label: "Delete", onSelect: vm.deleteSelected, disabled: none },
        { separator: true },
        { label: "Empty Recycle Bin", onSelect: vm.emptyBin, disabled: empty },
        { separator: true },
        { label: "Close", onSelect: vm.close },
      ],
    },
    {
      label: "Edit",
      items: [
        {
          label: "Select All",
          shortcut: "Ctrl+A",
          onSelect: vm.selectAll,
          disabled: empty,
        },
        {
          label: "Invert Selection",
          onSelect: vm.invertSelection,
          disabled: empty,
        },
      ],
    },
    {
      label: "View",
      items: [
        { label: "Large Icons", disabled: true },
        { label: "Small Icons", disabled: true },
        { label: "List", disabled: true },
        { label: "Details", checked: true, onSelect: () => undefined },
      ],
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <MenuBar menus={menus} />
      <div
        className="sunken-panel m-1 min-h-0 flex-1 overflow-auto bg-white"
        onKeyDown={(event) => {
          if (event.key === "a" && (event.ctrlKey || event.metaKey)) {
            event.preventDefault();
            vm.selectAll();
          }
        }}
      >
        <table className="interactive w-full" aria-label="Deleted files">
          <thead>
            <tr>
              {COLUMNS.map(({ column, label, className }) => (
                <th
                  key={column}
                  className={className}
                  aria-sort={
                    vm.sort.column === column
                      ? vm.sort.direction === "asc"
                        ? "ascending"
                        : "descending"
                      : "none"
                  }
                >
                  <button
                    type="button"
                    className="flat w-full text-left"
                    onClick={() => vm.sortBy(column)}
                  >
                    {label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {vm.items.map((item) => {
              const selected = vm.selected.has(item.id);
              return (
                <tr
                  key={item.id}
                  className={selected ? "highlighted" : ""}
                  aria-selected={selected}
                  tabIndex={0}
                  onClick={(event) =>
                    vm.select(item.id, event.ctrlKey || event.metaKey)
                  }
                  onDoubleClick={() => vm.open(item)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") vm.open(item);
                    if (event.key === " ") {
                      event.preventDefault();
                      vm.select(item.id, true);
                    }
                  }}
                >
                  <td className="max-w-0 truncate">
                    <span className="mr-1 inline-block align-middle">
                      <Win98Icon name={item.icon} />
                    </span>
                    {item.name}
                  </td>
                  <td className="max-w-0 truncate">{item.originalLocation}</td>
                  <td>{formatDeletedAt(item.deletedAt)}</td>
                  <td className="max-w-0 truncate">{item.type}</td>
                  <td className="text-right">
                    {formatRecycleBinSize(item.size)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {empty ? (
          <p className="p-4 text-center text-[grey]">
            The Recycle Bin is empty. Nothing was ever really here.
          </p>
        ) : null}
      </div>
      <footer className="status-bar shrink-0">
        <p className="status-bar-field">{vm.statusText}</p>
        <p className="status-bar-field w-1/3">{vm.statusDetail}</p>
      </footer>
      {vm.pendingDelete ? (
        <ConfirmDeleteDialog
          confirmation={vm.pendingDelete.confirmation}
          onYes={vm.confirmDelete}
          onNo={vm.cancelDelete}
        />
      ) : null}
    </div>
  );
}
