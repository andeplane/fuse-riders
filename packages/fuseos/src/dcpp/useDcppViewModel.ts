import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import { useDiskManifest } from "../disk/useDisk";
import { useOpenInNotepad } from "../notepadpp/useOpenInNotepad";
import { fuseTrackName } from "../winamp/fuseTracks";
import type { WinampRegistry } from "../winamp/winampRegistry";
import { WinampRegistryContext } from "../winamp/winampRegistryContext";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { DcState, DeliveryEvent } from "./dcClient";
import { DcClient } from "./dcClient";
import { clientDeps, DcppDepsContext } from "./dcppDeps";
import type { DcppDeps } from "./dcppDeps";

/** One MDI child, shown as a tab along the bottom of the window. */
export type Frame =
  | { kind: "publicHubs" }
  | { kind: "favorites" }
  | { kind: "hub"; address: string }
  | { kind: "search" }
  | { kind: "queue" }
  | { kind: "finished" }
  | { kind: "notepad" }
  | { kind: "fileList"; nick: string; hubAddress: string };

export function frameKey(frame: Frame): string {
  switch (frame.kind) {
    case "hub":
      return `hub:${frame.address}`;
    case "fileList":
      return `fileList:${frame.hubAddress}:${frame.nick}`;
    default:
      return frame.kind;
  }
}

const SINGLE_TITLES = {
  publicHubs: "Public Hubs",
  favorites: "Favorite Hubs",
  search: "Search",
  queue: "Download Queue",
  finished: "Finished Downloads",
  notepad: "Notepad",
} as const;

/** The tab text: the hub's name for a hub, "nick" for a file list. */
export function frameTitle(frame: Frame, state: DcState): string {
  switch (frame.kind) {
    case "hub":
      return (
        state.hubs.find((hub) => hub.address === frame.address)?.hub.name ??
        frame.address
      );
    case "fileList":
      return `${frame.nick}`;
    default:
      return SINGLE_TITLES[frame.kind];
  }
}

/**
 * Plays a downloaded soundtrack track: steps the running Winamp's playlist to it and presses Play. Winamp
 * only exposes its transport, so the track is found by name, never more than one lap of the playlist.
 */
export function playTrack(registry: WinampRegistry, name: string): void {
  const run = () => {
    const controls = registry.first();
    if (!controls) return;
    controls.play();
    const { trackCount } = controls.status();
    for (
      let step = 0;
      step < trackCount && controls.status().currentTrack !== name;
      step += 1
    )
      controls.next();
  };
  if (registry.first()) {
    run();
    return;
  }
  const unsubscribe = registry.onRegister(() => {
    unsubscribe();
    run();
  });
}

export type DcppViewModel = {
  client: DcClient;
  state: DcState;
  frames: Frame[];
  active: Frame | undefined;
  activeKey: string | undefined;
  openFrame: (frame: Frame) => void;
  closeFrame: (key: string) => void;
  activate: (key: string) => void;
  connect: (address: string) => void;
  /** Toolbar Reconnect: the active hub, if any. */
  reconnect: () => void;
  /** Toolbar Follow redirect: the active hub's redirect, if it has one. */
  followRedirect: () => void;
  openFileList: (nick: string, hubAddress: string) => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  aboutOpen: boolean;
  setAboutOpen: (open: boolean) => void;
  /** Re-delivers a finished download (double-click in Finished Downloads). */
  openFinished: (id: string) => void;
  repoReady: boolean;
  notepadText: string;
  setNotepadText: (text: string) => void;
};

function useClient(deps: DcppDeps): DcClient {
  const [client] = useState(() => new DcClient(clientDeps(deps)));
  useEffect(() => () => client.dispose(), [client]);
  return client;
}

export function useDcppViewModel(): DcppViewModel {
  const deps = useContext(DcppDepsContext);
  const registry = useContext(WinampRegistryContext);
  const commands = useWindowCommands();
  const openInNotepad = useOpenInNotepad();
  const client = useClient(deps);
  const state = useSyncExternalStore(client.subscribe, client.getState);
  const manifest = useDiskManifest();

  const repoFiles =
    manifest.status === "ready" ? manifest.manifest.files : undefined;
  useEffect(() => {
    if (repoFiles) client.setRepoFiles(repoFiles);
  }, [client, repoFiles]);

  const [frames, setFrames] = useState<Frame[]>([{ kind: "publicHubs" }]);
  const [activeKey, setActiveKey] = useState<string | undefined>("publicHubs");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [notepadText, setNotepadText] = useState("");

  const deliver = useCallback(
    ({ item }: DeliveryEvent) => {
      const { delivery } = item;
      if (delivery.kind === "repo") openInNotepad(delivery.path);
      else if (delivery.kind === "track") {
        const track = deps.tracks.find((entry) => entry.id === delivery.trackId);
        if (!track) return;
        commands.open({ kind: "winamp" });
        playTrack(registry, fuseTrackName(track));
      }
    },
    [openInNotepad, deps.tracks, commands, registry],
  );

  useEffect(() => client.onDelivered(deliver), [client, deliver]);

  const openFrame = useCallback((frame: Frame) => {
    const key = frameKey(frame);
    setFrames((current) =>
      current.some((entry) => frameKey(entry) === key)
        ? current
        : [...current, frame],
    );
    setActiveKey(key);
  }, []);

  const closeFrame = useCallback(
    (key: string) => {
      const frame = frames.find((entry) => frameKey(entry) === key);
      if (!frame) return;
      if (frame.kind === "hub") client.closeHub(frame.address);
      if (frame.kind === "fileList")
        client.closeFileList(frame.nick, frame.hubAddress);
      const index = frames.indexOf(frame);
      const rest = frames.filter((entry) => entry !== frame);
      setFrames(rest);
      if (activeKey === key) {
        const next = rest[Math.min(index, rest.length - 1)];
        setActiveKey(next ? frameKey(next) : undefined);
      }
    },
    [frames, activeKey, client],
  );

  const connect = useCallback(
    (address: string) => {
      client.connect(address);
      openFrame({ kind: "hub", address });
    },
    [client, openFrame],
  );

  const active = frames.find((frame) => frameKey(frame) === activeKey);

  const reconnect = useCallback(() => {
    if (active?.kind === "hub") client.reconnect(active.address);
  }, [active, client]);

  const followRedirect = useCallback(() => {
    if (active?.kind !== "hub") return;
    const target = client.connection(active.address)?.redirect;
    if (!target) return;
    connect(target);
  }, [active, client, connect]);

  const openFileList = useCallback(
    (nick: string, hubAddress: string) => {
      client.openFileList(nick, hubAddress);
      openFrame({ kind: "fileList", nick, hubAddress });
    },
    [client, openFrame],
  );

  const openFinished = useCallback(
    (id: string) => {
      const item = state.finished.find((entry) => entry.id === id);
      if (item) deliver({ item });
    },
    [state.finished, deliver],
  );

  return useMemo(
    () => ({
      client,
      state,
      frames,
      active,
      activeKey,
      openFrame,
      closeFrame,
      activate: setActiveKey,
      connect,
      reconnect,
      followRedirect,
      openFileList,
      settingsOpen,
      setSettingsOpen,
      aboutOpen,
      setAboutOpen,
      openFinished,
      repoReady: manifest.status === "ready",
      notepadText,
      setNotepadText,
    }),
    [
      client,
      state,
      frames,
      active,
      activeKey,
      openFrame,
      closeFrame,
      connect,
      reconnect,
      followRedirect,
      openFileList,
      settingsOpen,
      aboutOpen,
      openFinished,
      manifest.status,
      notepadText,
    ],
  );
}
