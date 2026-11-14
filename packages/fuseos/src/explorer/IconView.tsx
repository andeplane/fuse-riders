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

/** The three icon arrangements of View: 32px icons in a grid, 16px icons in rows, or 16px icons in columns. */
export type IconLayout = "large" | "small" | "list";

export const ICON_LAYOUT_LABELS: Record<IconLayout, string> = {
  large: "Large icons",
  small: "Small icons",
  list: "List",
};

export type IconViewProps = EntryViewProps & { layout: IconLayout };

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
      className="explorer-modified-mark"
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
  layout,
  onSelect,
  onOpen,
  onContextMenu,
}: IconViewProps) {
  return (
    <ul
      className={`explorer-icons explorer-icons-${layout}`}
      role="listbox"
      aria-label={ICON_LAYOUT_LABELS[layout]}
    >
      {entries.map((entry) => {
        const isSelected = selected === entry.location;
        return (
          <li
            key={entry.location}
            role="option"
            aria-selected={isSelected}
            className="explorer-icon-item"
            onClick={() => onSelect(entry)}
            onDoubleClick={() => onOpen(entry)}
            onContextMenu={entryContextMenu(entry, onContextMenu)}
          >
            <Win98Icon name={entry.icon} size={layout === "large" ? 32 : 16} />
            <span className="explorer-item-label">
              {entry.name}
              <ModifiedMark entry={entry} />
            </span>
          </li>
        );
      })}
    </ul>
  );
}
