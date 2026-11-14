import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

import {
  FUSE_TRACKS,
  fuseTrackArtist,
  fuseTrackUrl,
} from "../winamp/fuseTracks";
import type { WebampTrack } from "../winamp/webampPlayer";
import type { WinampControls } from "../winamp/winampControls";
import { WinampDepsContext } from "../winamp/winampDepsContext";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";
import { useWindowCommands } from "../windows/useWindowCommands";

import { METALLICA_DECOY } from "./napsterCatalog";
import { NAPSTER_TITLE } from "./napsterFacts";
import { NapsterDepsContext } from "./napsterDeps";
import type {
  LibraryFile,
  NapsterSession,
  NapsterState,
} from "./napsterSession";
import { baseName, createNapsterSession } from "./napsterSession";

/** The notice that ended the party, in the client's dialog. */
export const COURT_ORDER_TITLE = "Napster";
export const COURT_ORDER_MESSAGE =
  "Due to a court order, Napster has been required to stop the sharing of copyrighted songs, and you have been disconnected from the Napster network. Your own files are still on your computer. Thank you for being part of the community.";

export const ABOUT_MESSAGE = `${NAPSTER_TITLE}. Copyright 1999-2000 napster, Inc. (FuseOS edition: nothing here connects to anything, and every "download" is either a joke or the Fuse soundtrack.) Due to a court order, some songs may be unavailable in your area.`;

/** "Eminem - Stan.mp3" as Winamp's artist and title; a name without a dash is all title. */
export function tagsFromFilename(filename: string): {
  artist: string;
  title: string;
} {
  const name = baseName(filename).replace(/\.mp3$/i, "");
  const dash = name.indexOf(" - ");
  return dash === -1
    ? { artist: "Unknown Artist", title: name }
    : { artist: name.slice(0, dash), title: name.slice(dash + 3) };
}

/**
 * The Winamp entry for a library file: the Fuse track it really is, under the name it was shared as. A
 * mislabelled download says so in its title. Undefined for the decoy, which plays nothing.
 */
export function winampFileFor(
  file: LibraryFile,
  base: string,
  serial: number,
): { track: WebampTrack; name: string } | undefined {
  const delivery = file.delivery;
  if (delivery.kind !== "fuse") return undefined;
  const track = FUSE_TRACKS.find((item) => item.id === delivery.trackId);
  if (!track) return undefined;
  const tags = tagsFromFilename(file.filename);
  const honest =
    tags.title.toLowerCase().includes(track.title.toLowerCase()) || file.shared;
  const title = honest ? tags.title : `${tags.title} (really: ${track.title})`;
  const name = `${tags.artist} - ${title}`;
  return {
    // A fragment keeps each copy apart in Winamp's name map from the soundtrack entry for the same file.
    track: {
      url: `${fuseTrackUrl(track, base)}#napster-${serial}`,
      defaultName: name,
      metaData: { artist: tags.artist, title, album: fuseTrackArtist(track) },
      duration: track.duration,
    },
    name,
  };
}

export type NapsterViewModel = {
  state: NapsterState;
  session: NapsterSession;
  /** Plays files in FuseOS's Winamp (opening it if needed); the decoy shows its warning instead. */
  play: (files: readonly LibraryFile[]) => void;
  /** Winamp's transport, for the Library's CD buttons; nothing happens while Winamp is closed. */
  transport: (action: "stop" | "previous" | "next") => void;
  showAbout: () => void;
  close: () => void;
};

export function useNapsterViewModel(windowId: string): NapsterViewModel {
  const deps = useContext(NapsterDepsContext);
  const winampDeps = useContext(WinampDepsContext);
  const winamp = useContext(WinampRegistryContext);
  const commands = useWindowCommands();
  const session = useMemo(() => createNapsterSession(deps), [deps]);
  const serial = useRef(0);

  useEffect(() => {
    const unsubscribe = session.onEvent((event) => {
      if (event.kind === "shutdown")
        commands.showError(COURT_ORDER_TITLE, COURT_ORDER_MESSAGE);
    });
    session.connect();
    return () => {
      unsubscribe();
      session.dispose();
    };
  }, [session, commands]);

  const state = useSyncExternalStore(session.subscribe, session.getState);

  const play = useCallback(
    (files: readonly LibraryFile[]) => {
      if (files.some((file) => file.delivery.kind === "decoy")) {
        commands.showError(
          METALLICA_DECOY.warningTitle,
          METALLICA_DECOY.warning,
        );
        return;
      }
      const queued = files.flatMap((file) => {
        serial.current += 1;
        const entry = winampFileFor(file, winampDeps.base, serial.current);
        return entry ? [entry] : [];
      });
      if (queued.length === 0) return;
      const start = (controls: WinampControls) => controls.playFiles(queued);
      const running = winamp.first();
      if (running) start(running);
      else {
        const unsubscribe = winamp.onRegister((controls) => {
          unsubscribe();
          start(controls);
        });
      }
      commands.open({ kind: "winamp" });
    },
    [commands, winamp, winampDeps.base],
  );

  const transport = useCallback(
    (action: "stop" | "previous" | "next") => winamp.first()?.[action](),
    [winamp],
  );

  const showAbout = useCallback(
    () => commands.showInfo("About Napster", ABOUT_MESSAGE),
    [commands],
  );
  const close = useCallback(
    () => commands.close(windowId),
    [commands, windowId],
  );

  return { state, session, play, transport, showAbout, close };
}
