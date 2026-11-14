import type { DesktopArea } from "../../desktop/displayModes";
import { Win98Icon } from "../../ui/icons";

import { resolutionLabel } from "./resolutionEmulation";

export type KeepSettingsDialogProps = {
  resolution: DesktopArea;
  secondsLeft: number;
  onKeep: () => void;
  onRevert: () => void;
};

/** The modal "Monitor Settings" box: Yes keeps the new resolution, No (or Escape, or the clock) puts the old one back. */
export function KeepSettingsDialog({
  resolution,
  secondsLeft,
  onKeep,
  onRevert,
}: KeepSettingsDialogProps) {
  return (
    <div
      className="win98 fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 2147482000 }}
      onKeyDown={(event) => {
        if (event.key === "Escape") onRevert();
      }}
    >
      <div
        className="window"
        role="dialog"
        aria-modal="true"
        aria-labelledby="keep-settings-title"
        style={{ width: 360 }}
      >
        <div className="title-bar">
          <div className="title-bar-text" id="keep-settings-title">
            Monitor Settings
          </div>
        </div>
        <div className="window-body flex flex-col gap-4">
          <div className="flex items-start gap-3">
            <Win98Icon name="info" size={32} />
            <p>
              FuseOS has resized your desktop to {resolutionLabel(resolution)}.
              Do you want to keep these settings?
            </p>
          </div>
          <p role="status" className="text-center">
            Reverting in {secondsLeft}{" "}
            {secondsLeft === 1 ? "second" : "seconds"}
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              className="default"
              onClick={onKeep}
              autoFocus
            >
              Yes
            </button>
            <button type="button" onClick={onRevert}>
              No
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
