import type { MouseEvent } from "react";

import type { DiskEntry } from "../disk/diskEntries";
import { Win98Icon } from "../ui/icons";
import type { MenuPosition } from "../windows/menuPosition";
import { menuPositionAt } from "../windows/menuPosition";

export type EntryViewProps = {
  entries: readonly DiskEntry[];
  /** Location of the selected entry. */
  selected: string | null;
  onSelect: (entry: DiskEntry) => void;
  onOpen: (entry: DiskEntry) => void;
  /** Right click on an entry, with the pointer position in viewport coordinates. */
  onContextMenu: (entry: DiskEntry, position: MenuPosition) => void;
};

export const MODIFIED_LABEL = "Saved copy on this computer";

/** Right click selects and opens the entry's menu; the pane behind must not also open its own. */
export function entryContextMenu(
  entry: DiskEntry,
  onContextMenu: (entry: DiskEntry, position: MenuPosition) => void,
) {
  return (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    onContextMenu(entry, menuPositionAt(event));
  };
}

export function ModifiedMark({ entry }: { entry: DiskEntry }) {
  return entry.modified ? (
    <span
      className="ml-0.5 font-bold text-[navy]"
      role="img"
      aria-label={MODIFIED_LABEL}
      title={MODIFIED_LABEL}
    >
      *
    </span>
  ) : null;
}

export function IconView({
  entries,
  selected,
  onSelect,
  onOpen,
  onContextMenu,
}: EntryViewProps) {
  return (
    <ul
      className="flex flex-wrap content-start gap-1 p-2"
      role="listbox"
      aria-label="Large icons"
    >
      {entries.map((entry) => {
        const isSelected = selected === entry.location;
        return (
          <li
            key={entry.location}
            role="option"
            aria-selected={isSelected}
            className="flex w-20 cursor-default flex-col items-center gap-1 p-1 text-center"
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={entryContextMenu(entry, onContextMenu)}
          >
            <Win98Icon name={entry.icon} size={32} />
            <span
              className={`max-w-full break-words px-0.5 leading-tight ${isSelected ? "selected-label" : ""}`}
            >
              {entry.name}
              <ModifiedMark entry={entry} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
