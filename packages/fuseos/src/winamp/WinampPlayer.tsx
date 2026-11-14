import { Win98Icon } from "../ui/icons";

import { useWinampViewModel } from "./useWinampViewModel";

import "./winamp.css";

const STATUS_MESSAGE: Record<"loading" | "unavailable" | "error", string> = {
  loading: "Starting Winamp...",
  unavailable: "Winamp is not available in this preview.",
  error: "Winamp could not start.",
};

export type WinampPlayerProps = {
  /** The desktop's Winamp entry: what the taskbar button and the single-instance rule refer to. */
  windowId: string;
  /** Minimized from the taskbar or Webamp's own button: the player keeps playing, out of sight. */
  minimized: boolean;
  /** The window manager's z-index for the Winamp entry (10 + its place in the stacking order), like any other window. */
  zIndex: number;
  /** Called when the pointer goes down on one of Webamp's windows, so Winamp comes to the front and gets its taskbar button pressed. */
  onFocus: () => void;
};

/**
 * Winamp on the desktop, exactly as Webamp draws it: no FuseOS frame, title or buttons around it.
 * A desktop-sized layer that lets the pointer through everywhere but Webamp's windows (winamp.css),
 * into which Webamp renders and drags its main, equalizer and playlist windows. Until Webamp has
 * loaded (or when it cannot), a small Win98 panel says so in the middle of the desktop.
 */
export function WinampPlayer({
  windowId,
  minimized,
  zIndex,
  onFocus,
}: WinampPlayerProps) {
  const { attachContainer, loadState, errorMessage } =
    useWinampViewModel(windowId);
  const message =
    loadState === "error" && errorMessage
      ? `Winamp could not start: ${errorMessage}`
      : STATUS_MESSAGE[loadState === "ready" ? "loading" : loadState];

  return (
    <div
      className="winamp-layer absolute inset-0"
      style={{
        zIndex,
        display: minimized ? "none" : undefined,
      }}
      role="region"
      aria-label="Winamp"
      aria-hidden={minimized}
      onPointerDownCapture={onFocus}
      data-testid="winamp-layer"
    >
      {/* Webamp requires a non-static position on its mount and centres its windows in it; inline so it holds without the stylesheet. */}
      <div
        ref={attachContainer}
        data-testid="winamp-mount"
        style={{ position: "absolute", inset: 0 }}
      />
      {loadState !== "ready" ? (
        <div
          className="winamp-status window absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2 p-4 text-center"
          role="status"
        >
          <Win98Icon name="winamp" size={32} />
          <p>{message}</p>
        </div>
      ) : null}
    </div>
  );
}
