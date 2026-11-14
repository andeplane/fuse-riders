import { useCallback, useContext, useEffect, useRef, useState } from "react";

import { useWindowCommands } from "../windows/useWindowCommands";

import { FUSE_TRACKS, fuseSoundtrack } from "./fuseTracks";
import type { MediaErrorInfo } from "./mediaErrorReporting";
import type { WebampPlayer } from "./webampPlayer";
import { createWinampControls } from "./winampControls";
import { WinampDepsContext } from "./winampDepsContext";
import { WinampRegistryContext } from "./winampRegistryContext";

export type WinampLoadState = "loading" | "unavailable" | "ready" | "error";

export type WinampViewModel = {
  /** Attach to the element Webamp renders its skinned player into; detach with `null` on unmount. */
  attachContainer: (node: HTMLDivElement | null) => void;
  loadState: WinampLoadState;
  errorMessage: string | undefined;
  /** How many tracks the Fuse soundtrack holds, for the window's caption. */
  soundtrackLength: number;
  /** Adds locally picked files to the playlist as object URLs; unless something is already playing, the first of them starts. */
  addFiles: (files: FileList | File[]) => void;
  /** Replaces whatever is queued with the Fuse soundtrack and plays it from the top (a button press, so autoplay rules allow it). */
  playSoundtrack: () => void;
  close: () => void;
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
 * Loads Webamp on first mount, renders it into the window body with the Fuse soundtrack queued (every game's
 * file-backed music, `fuseTracks.ts`; queued, not playing, since nothing may sound before the user presses
 * something) and publishes its transport in the Winamp registry for the Office Assistant. Local files the user
 * picks join the queue as object URLs, revoked when the window closes or the soundtrack replaces them. Reopening
 * creates a fresh player. A track that fails to load shows a Win98 message box naming the likely cause, since
 * Webamp's own API cannot tell them apart.
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
  const playerRef = useRef<WebampPlayer | undefined>(undefined);
  const urlsRef = useRef<Set<string>>(new Set());
  const namesRef = useRef<Map<string, string>>(new Map());
  const nodeRef = useRef<HTMLDivElement | null>(null);
  // The track Webamp is currently trying to play, and the urls already reported (one raw failure can fire
  // more than one browser event; this keeps it to one dialog per track).
  const currentUrlRef = useRef<string | undefined>(undefined);
  const doneUrlsRef = useRef<Set<string>>(new Set());
  const loadState: WinampLoadState = deps.createPlayer
    ? readyState
    : "unavailable";

  useEffect(() => {
    const createPlayer = deps.createPlayer;
    if (!createPlayer) return undefined;
    const urls = urlsRef.current;
    const names = namesRef.current;
    let cancelled = false;
    let controlsDispose: (() => void) | undefined;
    let unsubscribeTrack: (() => void) | undefined;
    const unsubscribeErrors = deps.subscribeMediaErrors((info) => {
      const url = currentUrlRef.current;
      if (!url || doneUrlsRef.current.has(url)) return;
      doneUrlsRef.current.add(url);
      commands.showError(
        "Winamp",
        playbackErrorMessage(names.get(url) ?? "this track", info),
      );
    });
    createPlayer()
      .then(async (player) => {
        if (cancelled) {
          player.dispose();
          return;
        }
        playerRef.current = player;
        const { controls, dispose } = createWinampControls(player, names);
        controlsDispose = dispose;
        unsubscribeTrack = player.onTrackDidChange((track) => {
          currentUrlRef.current = track?.url;
        });
        registry.set(windowId, controls);
        const queued = fuseSoundtrack(deps.base);
        queued.forEach(({ track, name }) => names.set(track.url, name));
        player.appendTracks(queued.map(({ track }) => track));
        if (nodeRef.current) await player.renderInto(nodeRef.current);
        if (!cancelled) setReadyState("ready");
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
      controlsDispose?.();
      unsubscribeTrack?.();
      unsubscribeErrors();
      playerRef.current?.dispose();
      playerRef.current = undefined;
      urls.forEach((url) => deps.revokeObjectURL(url));
      urls.clear();
      names.clear();
    };
  }, [deps, registry, windowId, commands]);

  const attachContainer = useCallback((node: HTMLDivElement | null) => {
    nodeRef.current = node;
  }, []);

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const player = playerRef.current;
      const list = Array.from(files);
      if (!player || list.length === 0) return;
      const firstIndex = player.getPlaylistTracks().length;
      const tracks = list.map((file) => {
        const url = deps.createObjectURL(file);
        urlsRef.current.add(url);
        namesRef.current.set(url, file.name);
        return { url, defaultName: file.name };
      });
      player.appendTracks(tracks);
      // Picking a file is a gesture, so it may sound; but never interrupt a track that is already playing.
      if (player.getMediaStatus() !== "PLAYING") {
        player.setCurrentTrack(firstIndex);
        player.play();
      }
    },
    [deps],
  );

  const playSoundtrack = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const queued = fuseSoundtrack(deps.base);
    // The local files leave the playlist, so their object URLs can go too; the names map keeps every url it has
    // seen, which costs nothing and keeps a late error for one of them attributable.
    urlsRef.current.forEach((url) => deps.revokeObjectURL(url));
    urlsRef.current.clear();
    doneUrlsRef.current.clear();
    queued.forEach(({ track, name }) => namesRef.current.set(track.url, name));
    player.setTracksToPlay(queued.map(({ track }) => track));
  }, [deps]);

  return {
    attachContainer,
    loadState,
    errorMessage,
    soundtrackLength: FUSE_TRACKS.length,
    addFiles,
    playSoundtrack,
    close: () => commands.close(windowId),
  };
}
