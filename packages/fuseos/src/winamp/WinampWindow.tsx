import { useRef } from "react";

import { Win98Icon } from "../ui/icons";

import { useWinampViewModel } from "./useWinampViewModel";
import { WEBAMP_EMBED_SIZE } from "./webampLayout";

import "./winamp.css";

const LOADING_MESSAGE: Record<"loading" | "unavailable" | "error", string> = {
  loading: "Starting Winamp...",
  unavailable: "Winamp is not available in this preview.",
  error: "Winamp could not start.",
};

export function WinampWindow({ windowId }: { windowId: string }) {
  const { attachContainer, loadState, errorMessage, addFiles } =
    useWinampViewModel(windowId);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ready = loadState === "ready";
  const message =
    loadState === "error" && errorMessage
      ? `Winamp could not start: ${errorMessage}`
      : LOADING_MESSAGE[loadState === "ready" ? "loading" : loadState];

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        className="field-row flex shrink-0 items-center gap-2 p-1"
        role="toolbar"
        aria-label="Winamp"
      >
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={!ready}
        >
          Open files...
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          multiple
          aria-label="Open audio files"
          className="hidden"
          onChange={(event) => {
            if (event.target.files) addFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      <p className="shrink-0 px-1 pb-1 text-xs">
        Local files never leave this device.
      </p>
      <div
        className="sunken-panel relative min-h-0 flex-1 overflow-auto p-1"
        data-testid="winamp-body"
      >
        {/* Webamp centres all panels before mounting. A full-height flex node can be shorter
            than that stack, clipping the transport above the scroll origin. */}
        <div
          ref={attachContainer}
          data-testid="winamp-mount"
          className="winamp-embed mx-auto"
          style={{
            position: "relative",
            width: WEBAMP_EMBED_SIZE.width,
            height: WEBAMP_EMBED_SIZE.height,
            flexShrink: 0,
          }}
        />
        {!ready ? (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 p-6 text-center"
            role="status"
          >
            <Win98Icon name="winamp" size={32} />
            <p>{message}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
