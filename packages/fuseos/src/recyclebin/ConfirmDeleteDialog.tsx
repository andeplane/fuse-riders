import { useContext } from "react";
import { createPortal } from "react-dom";

import { displayColorFilter } from "../desktop/displayModes";
import { DesktopUiContext } from "../desktop/desktopUiContext";
import { Win98Icon } from "../ui/icons";

/** What is about to leave the bin for good: a single named file, or several. */
export type DeleteConfirmation =
  { kind: "one"; name: string } | { kind: "many"; count: number };

export type ConfirmDeleteDialogProps = {
  confirmation: DeleteConfirmation;
  onYes: () => void;
  onNo: () => void;
};

/** The dialog's title, as Windows 95 chose it by the number of files. */
export function confirmDeleteTitle(confirmation: DeleteConfirmation): string {
  return confirmation.kind === "one"
    ? "Confirm File Delete"
    : "Confirm Multiple File Delete";
}

export function confirmDeleteMessage(confirmation: DeleteConfirmation): string {
  return confirmation.kind === "one"
    ? `Are you sure you want to delete '${confirmation.name}'?`
    : `Are you sure you want to delete these ${confirmation.count} items?`;
}

/**
 * The "Are you sure you want to delete these N items?" box, centred over the whole desktop
 * (a portal, so it serves the desktop icon's context menu as well as the window's File menu).
 */
export function ConfirmDeleteDialog({
  confirmation,
  onYes,
  onNo,
}: ConfirmDeleteDialogProps) {
  const { colorMode } = useContext(DesktopUiContext);
  const title = confirmDeleteTitle(confirmation);
  return createPortal(
    <div
      className="win98 fixed inset-0 z-[80] flex items-center justify-center bg-black/10"
      style={{ filter: displayColorFilter(colorMode) }}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Escape") onNo();
      }}
    >
      <div className="window" style={{ width: 360 }}>
        <div className="title-bar">
          <div className="title-bar-text">{title}</div>
        </div>
        <div className="window-body flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Win98Icon name="recycleFull" size={32} />
            <p>{confirmDeleteMessage(confirmation)}</p>
          </div>
          <div className="flex justify-center gap-2">
            <button type="button" className="default" onClick={onYes} autoFocus>
              Yes
            </button>
            <button type="button" onClick={onNo}>
              No
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
