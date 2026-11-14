import { useCallback, useContext, useState } from "react";

import { DesktopIcon } from "../desktop/DesktopIcon";
import { DesktopUiContext } from "../desktop/desktopUiContext";
import { usePlaySystemSound } from "../sounds/useSystemSound";
import { ContextMenu } from "../windows/ContextMenu";
import type { MenuPosition } from "../windows/menuPosition";

import type { DeleteConfirmation } from "./ConfirmDeleteDialog";
import { ConfirmDeleteDialog } from "./ConfirmDeleteDialog";
import {
  binContents,
  RecycleBinStoreContext,
  useRecycleBinState,
  withoutItems,
} from "./recycleBinStore";
import { useOpenRecycleBin } from "./useOpenRecycleBin";

/** The id the desktop's selection and context menu state know this icon by. */
export const RECYCLE_BIN_ICON_ID = "recycle-bin";

/**
 * The Recycle Bin on the desktop: full or empty by what the bin holds, with the icon's own
 * context menu (Open, Empty Recycle Bin). Sits apart from the icon grid, at the bottom left,
 * where Windows 98 kept it.
 */
export function RecycleBinDesktopIcon() {
  const ui = useContext(DesktopUiContext);
  const store = useContext(RecycleBinStoreContext);
  const playSystemSound = usePlaySystemSound();
  const state = useRecycleBinState();
  const openBin = useOpenRecycleBin();
  const [confirmation, setConfirmation] = useState<DeleteConfirmation | null>(
    null,
  );
  // The menu is this icon's own: the desktop's generic icon menu (Open only) must not open beside it.
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const contents = binContents(state);

  return (
    <div
      className="absolute bottom-8 left-2 flex justify-center"
      style={{ width: ui.iconSpacingX }}
      role="list"
      aria-label="Recycle Bin icon"
    >
      <div role="listitem">
        <DesktopIcon
          label="Recycle Bin"
          icon={contents.length > 0 ? "recycleFull" : "recycle"}
          selected={ui.selectedIcon === RECYCLE_BIN_ICON_ID}
          onSelect={() => ui.setSelectedIcon(RECYCLE_BIN_ICON_ID)}
          onOpen={openBin}
          onContextMenu={(position) => {
            ui.setSelectedIcon(RECYCLE_BIN_ICON_ID);
            ui.setIconMenu(null);
            setMenu(position);
          }}
        />
      </div>
      {menu ? (
        <ContextMenu
          label="Recycle Bin menu"
          position={menu}
          items={[
            { label: "Open", bold: true, onSelect: openBin },
            { separator: true },
            {
              label: "Empty Recycle Bin",
              disabled: contents.length === 0,
              onSelect: () => {
                const only = contents.length === 1 ? contents[0] : undefined;
                setConfirmation(
                  only
                    ? { kind: "one", name: only.name }
                    : { kind: "many", count: contents.length },
                );
              },
            },
          ]}
          onClose={closeMenu}
        />
      ) : null}
      {confirmation ? (
        <ConfirmDeleteDialog
          confirmation={confirmation}
          onYes={() => {
            store.set(
              withoutItems(
                store.get(),
                contents.map((item) => item.id),
              ),
            );
            playSystemSound("recycle");
            setConfirmation(null);
          }}
          onNo={() => setConfirmation(null)}
        />
      ) : null}
    </div>
  );
}
