import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { DesktopIconArt } from "../desktop/DesktopIcon";
import type { FuseGame } from "../fusegames/registry";
import { FuseGamesContext } from "../fusegames/registry";
import { useWindowCommands } from "../windows/useWindowCommands";

import type { RecentRoom, RecentRoomTarget } from "./recentRooms";
import { RecentRoomsStoreContext } from "./recentRooms";
import { isRoomCode, normalizeRoomCode, ROOM_CODE_LENGTH } from "./roomCode";
import type { RoomListing } from "./roomDirectory";
import { RoomDirectoryContext } from "./roomDirectory";
import { useRoomLauncher } from "./roomLauncher";

/** Where the window is: the neighborhood itself, Entire Network, or one game's workgroup. */
export type NetworkLocation =
  { kind: "root" } | { kind: "entire" } | { kind: "workgroup"; gameId: string };

export type NetworkView = "icons" | "details";

/** One entry in the right-hand pane. */
export type NetworkItem = {
  id: string;
  label: string;
  icon: DesktopIconArt;
  /** Details view columns: what kind of thing, and when it was last played (recent rooms only). */
  type: string;
  lastPlayed?: number;
  open: () => void;
  /** Present on recent rooms: forgets the room. */
  forget?: () => void;
};

export type JoinDialogState = {
  gameId: string;
  code: string;
  error: string | null;
};

export type NetworkViewModel = {
  location: NetworkLocation;
  /** Breadcrumb the address bar shows, root first. */
  path: string[];
  items: NetworkItem[];
  selectedId: string | null;
  select: (id: string | null) => void;
  /** Opens the selected item (Enter, File > Open). */
  openSelected: () => void;
  view: NetworkView;
  setView: (view: NetworkView) => void;
  go: (location: NetworkLocation) => void;
  /** One level up; no-op at the root. */
  up: () => void;
  canGoUp: boolean;
  /** What the status bar says about live rooms at this location, if anything. */
  liveStatus: string | null;
  /** Re-asks the room directory (View > Refresh). */
  refresh: () => void;
  workgroups: readonly FuseGame[];
  recentRooms: readonly RecentRoom[];
  joinDialog: JoinDialogState | null;
  openJoinDialog: (gameId?: string) => void;
  closeJoinDialog: () => void;
  setJoinGame: (gameId: string) => void;
  setJoinCode: (code: string) => void;
  /** Validates the dialog and joins; keeps the dialog open with an error otherwise. */
  submitJoin: () => void;
  /** Joins a known room straight away (a recent room, a listed room). */
  join: (room: RecentRoomTarget) => void;
  forgetRoom: (room: RecentRoomTarget) => void;
  clearRecentRooms: () => void;
  close: () => void;
  about: () => void;
};

export const ROOT_LABEL = "Network Neighborhood";
export const ENTIRE_NETWORK_LABEL = "Entire Network";
export const JOIN_ROOM_LABEL = "Join room...";

export const INVALID_CODE_MESSAGE =
  "A room code is two letters and two digits, like AB42.";
export const NO_GAMES_MESSAGE =
  "No Fuse games are installed on this desktop, so there is nothing to join.";

const ABOUT_TEXT =
  "Browse the Fuse games as workgroups, rejoin a room you played recently, or join a friend's room by its code. Rooms you join are remembered in this browser only.";

function recentItem(
  room: RecentRoom,
  gameName: string,
  labelWithGame: boolean,
  join: (room: RecentRoomTarget) => void,
  forget: (room: RecentRoomTarget) => void,
): NetworkItem {
  return {
    id: `room:${room.gameId}:${room.code}`,
    label: labelWithGame
      ? `${gameName} room ${room.code}`
      : `Room ${room.code}`,
    icon: "computer",
    type: "Recent room",
    lastPlayed: room.lastSeen,
    open: () => join(room),
    forget: () => forget(room),
  };
}

export function useNetworkViewModel(windowId: string): NetworkViewModel {
  const commands = useWindowCommands();
  const registry = useContext(FuseGamesContext);
  const recentStore = useContext(RecentRoomsStoreContext);
  const directory = useContext(RoomDirectoryContext);
  const launcher = useRoomLauncher();

  const recentRooms = useSyncExternalStore(
    useCallback(
      (listener: () => void) => recentStore.subscribe(listener),
      [recentStore],
    ),
    () => recentStore.list(),
  );

  const [location, setLocation] = useState<NetworkLocation>({ kind: "root" });
  const [view, setView] = useState<NetworkView>("icons");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [joinDialog, setJoinDialog] = useState<JoinDialogState | null>(null);
  const [listing, setListing] = useState<RoomListing | "loading" | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  const workgroupId = location.kind === "workgroup" ? location.gameId : null;
  useEffect(() => {
    if (workgroupId === null) {
      setListing(null);
      return undefined;
    }
    let cancelled = false;
    setListing("loading");
    directory.listRooms(workgroupId).then(
      (result) => {
        if (!cancelled) setListing(result);
      },
      (error: unknown) => {
        if (!cancelled)
          setListing({
            kind: "error",
            message:
              error instanceof Error ? error.message : "Could not list rooms.",
          });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [workgroupId, directory, refreshCount]);

  const go = useCallback((next: NetworkLocation) => {
    setLocation(next);
    setSelectedId(null);
  }, []);

  const join = useCallback(
    (room: RecentRoomTarget) => {
      const result = launcher.join(room);
      if (!result.ok)
        commands.showError(
          ROOT_LABEL,
          `The game "${room.gameId}" is not installed on this FuseOS.`,
        );
    },
    [launcher, commands],
  );

  const forgetRoom = useCallback(
    (room: RecentRoomTarget) => recentStore.remove(room),
    [recentStore],
  );

  const openJoinDialog = useCallback(
    (gameId?: string) => {
      const first = gameId ?? workgroupId ?? registry.games[0]?.id;
      if (first === undefined) {
        commands.showError(ROOT_LABEL, NO_GAMES_MESSAGE);
        return;
      }
      setJoinDialog({ gameId: first, code: "", error: null });
    },
    [workgroupId, registry.games, commands],
  );

  const items = useMemo((): NetworkItem[] => {
    const gameName = (id: string) => registry.find(id)?.name ?? id;
    switch (location.kind) {
      case "root":
        return [
          {
            id: "entire",
            label: ENTIRE_NETWORK_LABEL,
            icon: "network",
            type: "Entire Network",
            open: () => go({ kind: "entire" }),
          },
          ...recentRooms.map((room) =>
            recentItem(room, gameName(room.gameId), true, join, forgetRoom),
          ),
        ];
      case "entire":
        return registry.games.map((game) => ({
          id: `workgroup:${game.id}`,
          label: game.name,
          icon: { kind: "tile", mark: game.mark, accent: game.accent },
          type: "Workgroup",
          open: () => go({ kind: "workgroup", gameId: game.id }),
        }));
      case "workgroup": {
        const live =
          listing !== null && listing !== "loading" && listing.kind === "rooms"
            ? listing.rooms
            : [];
        const recentCodes = new Set(
          recentRooms
            .filter((room) => room.gameId === location.gameId)
            .map((room) => room.code),
        );
        return [
          {
            id: "join",
            label: JOIN_ROOM_LABEL,
            icon: "network",
            type: "Join a room by code",
            open: () => openJoinDialog(location.gameId),
          },
          ...recentRooms
            .filter((room) => room.gameId === location.gameId)
            .map((room) =>
              recentItem(room, gameName(room.gameId), false, join, forgetRoom),
            ),
          ...live
            .filter((room) => !recentCodes.has(room.code))
            .map((room): NetworkItem => ({
              id: `live:${room.code}`,
              label: `Room ${room.code}`,
              icon: "computer",
              type:
                room.members === undefined
                  ? "Open room"
                  : `Open room, ${room.members} playing`,
              open: () => join({ gameId: location.gameId, code: room.code }),
            })),
        ];
      }
    }
  }, [
    location,
    recentRooms,
    registry,
    listing,
    go,
    join,
    forgetRoom,
    openJoinDialog,
  ]);

  const path = useMemo(() => {
    switch (location.kind) {
      case "root":
        return [ROOT_LABEL];
      case "entire":
        return [ROOT_LABEL, ENTIRE_NETWORK_LABEL];
      case "workgroup":
        return [
          ROOT_LABEL,
          ENTIRE_NETWORK_LABEL,
          registry.find(location.gameId)?.name ?? location.gameId,
        ];
    }
  }, [location, registry]);

  const liveStatus = useMemo((): string | null => {
    if (location.kind !== "workgroup" || listing === null) return null;
    if (listing === "loading") return "Looking for open rooms...";
    switch (listing.kind) {
      case "unsupported":
        return listing.reason;
      case "error":
        return `Could not list rooms: ${listing.message}`;
      case "rooms":
        return listing.rooms.length === 0
          ? "No open rooms right now."
          : `${listing.rooms.length} open room(s).`;
    }
  }, [location, listing]);

  const submitJoin = useCallback(() => {
    if (!joinDialog) return;
    const code = normalizeRoomCode(joinDialog.code);
    if (!isRoomCode(code)) {
      setJoinDialog({ ...joinDialog, code, error: INVALID_CODE_MESSAGE });
      return;
    }
    const result = launcher.join({ gameId: joinDialog.gameId, code });
    if (!result.ok) {
      setJoinDialog({
        ...joinDialog,
        code,
        error: `The game "${joinDialog.gameId}" is not installed on this FuseOS.`,
      });
      return;
    }
    setJoinDialog(null);
  }, [joinDialog, launcher]);

  return {
    location,
    path,
    items,
    selectedId,
    select: setSelectedId,
    openSelected: () => items.find((item) => item.id === selectedId)?.open(),
    view,
    setView,
    go,
    up: () => {
      if (location.kind === "workgroup") go({ kind: "entire" });
      else if (location.kind === "entire") go({ kind: "root" });
    },
    canGoUp: location.kind !== "root",
    liveStatus,
    refresh: () => setRefreshCount((count) => count + 1),
    workgroups: registry.games,
    recentRooms,
    joinDialog,
    openJoinDialog,
    closeJoinDialog: () => setJoinDialog(null),
    setJoinGame: (gameId) =>
      setJoinDialog((dialog) => dialog && { ...dialog, gameId, error: null }),
    setJoinCode: (code) =>
      setJoinDialog(
        (dialog) =>
          dialog && {
            ...dialog,
            code: normalizeRoomCode(code).slice(0, ROOM_CODE_LENGTH),
            error: null,
          },
      ),
    submitJoin,
    join,
    forgetRoom,
    clearRecentRooms: () => recentStore.clear(),
    close: () => commands.close(windowId),
    about: () => commands.showInfo(`About ${ROOT_LABEL}`, ABOUT_TEXT),
  };
}

/** "Today 14:02", "Yesterday", "25 Jun 1998": enough to tell rooms apart. */
export function formatLastPlayed(lastSeen: number, nowMs: number): string {
  const date = new Date(lastSeen);
  const today = new Date(nowMs);
  const sameDay =
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate();
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  if (sameDay) return `Today ${time}`;
  const dayMs = 24 * 60 * 60 * 1000;
  if (nowMs - lastSeen < 2 * dayMs && nowMs > lastSeen)
    return `Yesterday ${time}`;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
