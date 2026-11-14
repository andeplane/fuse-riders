import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { useWindowCommands } from "../windows/useWindowCommands";

import { fuseSoundtrack } from "./fuseTracks";
import type { MediaErrorInfo } from "./mediaErrorReporting";
import type { WebampPlayer } from "./webampPlayer";
import { createWinampControls } from "./winampControls";
import { WinampDepsContext } from "./winampDepsContext";
import { WinampRegistryContext } from "./winampRegistryContext";

export type WinampLoadState = "loading" | "unavailable" | "ready" | "error";

export type WinampViewModel = {
  /** Attach to the desktop-sized layer Webamp renders its windows into; detach with `null` on unmount. */
  attachContainer: (node: HTMLDivElement | null) => void;
  loadState: WinampLoadState;
  errorMessage: string | undefined;
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * A track failing to load looks identical, from Webamp's own API, whether the file is broken or the browser
 * refused the load (see `mediaErrorReporting.ts`); this names the likely cause either way.
 */
function playbackErrorMessage(name: string, info: MediaErrorInfo): string {
  if (info.cause === "csp") {
    return `Winamp could not play "${name}". The browser blocked local audio playback: this page's content security policy does not allow "${info.directive}" for local (blob:) files.`;
  }
  return `Winamp could not play "${name}". The browser blocked or failed to load this file.`;
}

/**
 * Loads Webamp on first mount, renders it frameless into the desktop layer with the Fuse soundtrack
 * queued (every game's file-backed music, `fuseTracks.ts`; queued, not playing, since nothing may
 * sound before the user presses something) and publishes its transport in the Winamp registry for
 * the Office Assistant. Webamp's own close button closes the desktop's Winamp entry and its own
 * minimize button minimizes it (the taskbar button brings it back); local files come in through
 * Webamp's own eject button. A track that fails to load shows a Win98 message box naming the likely
 * cause, since Webamp's own API cannot tell them apart. Reopening creates a fresh player.
 */
export function useWinampViewModel(windowId: string): WinampViewModel {
  const deps = useContext(WinampDepsContext);
  const registry = useContext(WinampRegistryContext);
  const commands = useWindowCommands();
  // 'unavailable' is derived, not stored: without a loader there is nothing to wait for or retry.
  const [readyState, setReadyState] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [errorMessage, setErrorMessage] = useState<string | undefined>(
    undefined,
  );
  const nodeRef = useRef<HTMLDivElement | null>(null);
  const loadState: WinampLoadState = deps.createPlayer
    ? readyState
    : "unavailable";

  useEffect(() => {
    const createPlayer = deps.createPlayer;
    if (!createPlayer) return undefined;
    const names = new Map<string, string>();
    // The track Webamp is currently trying to play, and the urls already reported (one raw failure can fire
    // more than one browser event; this keeps it to one dialog per track).
    let currentUrl: string | undefined;
    const reported = new Set<string>();
    let player: WebampPlayer | undefined;
    let cancelled = false;
    const subscriptions: (() => void)[] = [];
    subscriptions.push(
      deps.subscribeMediaErrors((info) => {
        if (!currentUrl || reported.has(currentUrl)) return;
        reported.add(currentUrl);
        const playing = player
          ?.getPlaylistTracks()
          .find((track) => track.url === currentUrl);
        const name =
          names.get(currentUrl) ?? playing?.defaultName ?? "this track";
        commands.showError("Winamp", playbackErrorMessage(name, info));
      }),
    );
    createPlayer()
      .then(async (created) => {
        if (cancelled) {
          created.dispose();
          return;
        }
        player = created;
        const { controls, dispose } = createWinampControls(created, names);
        subscriptions.push(dispose);
        subscriptions.push(
          created.onTrackDidChange((track) => {
            currentUrl = track?.url;
          }),
          created.onClose(() => commands.close(windowId)),
          created.onMinimize(() => commands.minimize(windowId)),
        );
        const queued = fuseSoundtrack(deps.base);
        queued.forEach(({ track, name }) => names.set(track.url, name));
        created.appendTracks(queued.map(({ track }) => track));
        if (nodeRef.current) await created.renderInto(nodeRef.current);
        if (cancelled) return;
        registry.set(windowId, controls);
        setReadyState("ready");
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setReadyState("error");
          setErrorMessage(describeError(error));
        }
      });
    return () => {
      cancelled = true;
      registry.delete(windowId);
      subscriptions.forEach((unsubscribe) => unsubscribe());
      player?.dispose();
      player = undefined;
    };
  }, [deps, registry, windowId, commands]);

  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
  }, []);

  return { attachContainer, loadState, errorMessage };
}
