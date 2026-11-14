/**
 * One running Napster client: the connection, the search, transfers, the Hot List, chat and the library, as an
 * immutable state behind a tiny store. Time only moves through the injected `every`/`after`, randomness only
 * through the injected source, so a test can drive a whole session by hand. Nothing leaves the page: there is
 * no server, searches are not recorded or reported, and "downloads" never fetch a byte.
 */
import { FUSE_TRACKS, fuseTrackArtist } from "../winamp/fuseTracks";

import type { ChatRoom } from "./chat";
import {
  appendLine,
  comingAndGoing,
  joinRoom,
  replyTo,
  strangerLine,
} from "./chat";
import type { NetworkStats, SearchQuery, SearchResult } from "./fakeNetwork";
import {
  browseUser,
  driftStats,
  initialStats,
  isBlankQuery,
  pick,
  searchNetwork,
} from "./fakeNetwork";
import type { NapsterDeps } from "./napsterDeps";
import { TICK_MS } from "./napsterDeps";
import { FAKE_USERS, OWN_USERNAME } from "./napsterCatalog";
import type { Delivery, Transfer } from "./transfers";
import {
  advanceTransfer,
  cancelTransfer,
  isFinished,
  startTransfer,
} from "./transfers";

export type NapsterTab = "chat" | "library" | "search" | "hotlist" | "transfer";

export type Connection = "connecting" | "online" | "offline" | "shutdown";

/** A file in "your" library: the shared Fuse soundtrack, then whatever finished downloading. */
export type LibraryFile = {
  id: string;
  filename: string;
  filesize: number;
  bitrate: number;
  frequency: number;
  length: number;
  delivery: Delivery;
  /** Shared with the network (the soundtrack) rather than freshly downloaded. */
  shared: boolean;
};

export type HotListEntry = { user: string; online: boolean };

export type NapsterState = {
  username: string;
  connection: Connection;
  tab: NapsterTab;
  stats: NetworkStats | undefined;
  search: {
    status: "idle" | "searching" | "done";
    /** What the results are for: a search, or browsing one user's files. */
    title: string;
    results: SearchResult[];
  };
  downloads: Transfer[];
  uploads: Transfer[];
  library: LibraryFile[];
  hotList: HotListEntry[];
  /** The Hot List user whose files show on the right, and those files (empty while they are offline). */
  browsing: { user: string; results: SearchResult[] } | undefined;
  rooms: ChatRoom[];
  activeRoom: string | undefined;
};

/** Where the client keeps what it shares and saves (the 2.0 beta default). */
export const MUSIC_FOLDER = "C:\\Program Files\\Napster\\Music\\";

export const CONNECT_MS = 2400;

/** How long "Searching..." lasts before the results land. */
export const SEARCH_MS = 1100;

export function baseName(path: string): string {
  return path.slice(path.lastIndexOf("\\") + 1);
}

function sharedSoundtrack(): LibraryFile[] {
  return FUSE_TRACKS.map((track) => ({
    id: `shared:${track.id}`,
    filename: `${MUSIC_FOLDER}${fuseTrackArtist(track)} - ${track.title}.mp3`,
    filesize: Math.round((128_000 * track.duration) / 8),
    bitrate: 128,
    frequency: 44100,
    length: Math.round(track.duration),
    delivery: { kind: "fuse", trackId: track.id },
    shared: true,
  }));
}

export function initialNapsterState(): NapsterState {
  return {
    username: OWN_USERNAME,
    connection: "connecting",
    tab: "search",
    stats: undefined,
    search: { status: "idle", title: "", results: [] },
    downloads: [],
    uploads: [],
    library: sharedSoundtrack(),
    hotList: [
      { user: "dialup_dan", online: true },
      { user: "bitrate_betty", online: false },
    ],
    browsing: undefined,
    rooms: [],
    activeRoom: undefined,
  };
}

/** Things that happen to the user rather than to the state: the views turn them into dialogs and sounds. */
export type NapsterEvent =
  | { kind: "connected" }
  | { kind: "shutdown" }
  | { kind: "downloaded"; file: LibraryFile };

export interface NapsterSession {
  getState(): NapsterState;
  subscribe(listener: () => void): () => void;
  onEvent(listener: (event: NapsterEvent) => void): () => void;
  connect(): void;
  disconnect(): void;
  setTab(tab: NapsterTab): void;
  search(query: SearchQuery): void;
  clearResults(): void;
  /** Starts a download per result; results already downloading are skipped, as the client did. */
  download(results: readonly SearchResult[]): void;
  cancel(transferId: string): void;
  clearFinished(): void;
  addToHotList(user: string): void;
  removeFromHotList(user: string): void;
  browse(user: string): void;
  joinRoom(name: string): void;
  leaveRoom(name: string): void;
  setActiveRoom(name: string): void;
  say(text: string): void;
  /** Stops every timer; the session is inert afterwards. */
  dispose(): void;
}

export function createNapsterSession(deps: NapsterDeps): NapsterSession {
  let state = initialNapsterState();
  const listeners = new Set<() => void>();
  const eventListeners = new Set<(event: NapsterEvent) => void>();
  const cancels = new Set<() => void>();
  let ticker: (() => void) | undefined;
  let disposed = false;
  let transferCount = 0;
  let lineCount = 0;
  const nextLineId = () => (lineCount += 1);

  const set = (next: NapsterState) => {
    state = next;
    [...listeners].forEach((listener) => listener());
  };
  const update = (patch: (current: NapsterState) => NapsterState) =>
    set(patch(state));
  const emit = (event: NapsterEvent) =>
    [...eventListeners].forEach((listener) => listener(event));
  const after = (ms: number, callback: () => void) => {
    const cancel = deps.after(ms, () => {
      cancels.delete(cancel);
      callback();
    });
    cancels.add(cancel);
  };

  const online = () => state.connection === "online";

  function stopTicker() {
    ticker?.();
    ticker = undefined;
  }

  function dropConnection(connection: "offline" | "shutdown") {
    stopTicker();
    cancels.forEach((cancel) => cancel());
    cancels.clear();
    update((current) => ({
      ...current,
      connection,
      stats: undefined,
      search:
        current.search.status === "searching"
          ? { ...current.search, status: "done" }
          : current.search,
      downloads: current.downloads.map((transfer) =>
        isFinished(transfer)
          ? transfer
          : { ...transfer, phase: "error", rate: 0 },
      ),
      uploads: current.uploads.map(cancelTransfer),
      rooms: [],
      activeRoom: undefined,
      browsing: undefined,
      hotList: current.hotList.map((entry) => ({ ...entry, online: false })),
    }));
  }

  function tick() {
    const random = deps.random;
    if (random() < deps.shutdownChance) {
      dropConnection("shutdown");
      emit({ kind: "shutdown" });
      return;
    }
    const finishedBefore = new Set(
      state.downloads.filter(isFinished).map((transfer) => transfer.id),
    );
    let next: NapsterState = {
      ...state,
      stats: state.stats && driftStats(state.stats, random),
      downloads: state.downloads.map((transfer) =>
        advanceTransfer(transfer, TICK_MS, random),
      ),
      uploads: state.uploads.map((transfer) =>
        advanceTransfer(transfer, TICK_MS, random),
      ),
    };
    // Someone out there wants your Fuse soundtrack now and then.
    if (random() < 0.04 && next.uploads.length < 6) {
      const file = pick(
        next.library.filter((item) => item.shared),
        random,
      );
      transferCount += 1;
      const upload = startTransfer(
        `u${transferCount}`,
        {
          id: file.id,
          filename: file.filename,
          filesize: file.filesize,
          bitrate: file.bitrate,
          frequency: file.frequency,
          length: file.length,
          user: pick(FAKE_USERS, random),
          lineSpeed: "56K",
          ping: undefined,
          source: { kind: "fuse", trackId: file.id },
        },
        random,
      );
      next = { ...next, uploads: [...next.uploads, upload] };
    }
    // Chat rooms carry on whether or not anyone is looking.
    next = {
      ...next,
      rooms: next.rooms.map((room) => {
        const roll = random();
        if (roll < 0.3)
          return appendLine(
            room,
            strangerLine(room, state.username, random, nextLineId()),
          );
        if (roll < 0.36)
          return comingAndGoing(room, state.username, random, nextLineId());
        return room;
      }),
    };
    // Hot List friends dial in and hang up.
    if (random() < 0.05 && next.hotList.length > 0) {
      const index = Math.floor(random() * next.hotList.length);
      next = {
        ...next,
        hotList: next.hotList.map((entry, at) =>
          at === index ? { ...entry, online: !entry.online } : entry,
        ),
      };
    }
    const delivered: LibraryFile[] = [];
    next.downloads.forEach((transfer) => {
      if (
        transfer.phase !== "complete" ||
        finishedBefore.has(transfer.id) ||
        transfer.fate.kind !== "complete"
      )
        return;
      delivered.push({
        id: `dl:${transfer.id}`,
        filename: `${MUSIC_FOLDER}${baseName(transfer.filename)}`,
        filesize: transfer.filesize,
        bitrate: transfer.bitrate,
        frequency: transfer.frequency,
        length: transfer.length,
        delivery: transfer.fate.delivery,
        shared: false,
      });
    });
    if (delivered.length > 0)
      next = { ...next, library: [...next.library, ...delivered] };
    set(next);
    delivered.forEach((file) => emit({ kind: "downloaded", file }));
  }

  const session: NapsterSession = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    connect() {
      if (disposed || state.connection === "online") return;
      update((current) => ({ ...current, connection: "connecting" }));
      after(CONNECT_MS, () => {
        update((current) => ({
          ...current,
          connection: "online",
          stats: initialStats(deps.random),
          hotList: current.hotList.map((entry, index) => ({
            ...entry,
            online: index === 0,
          })),
        }));
        stopTicker();
        ticker = deps.every(TICK_MS, tick);
        session.joinRoom("#napster");
        deps.playChime();
        emit({ kind: "connected" });
      });
    },
    disconnect() {
      if (state.connection === "offline" || state.connection === "shutdown")
        return;
      dropConnection("offline");
    },
    setTab(tab) {
      update((current) => ({ ...current, tab }));
    },
    search(query) {
      if (!online() || isBlankQuery(query)) return;
      const title = [query.artist.trim(), query.title.trim()]
        .filter((part) => part.length > 0)
        .join(" - ");
      update((current) => ({
        ...current,
        search: { status: "searching", title, results: [] },
      }));
      after(SEARCH_MS + Math.floor(deps.random() * 900), () => {
        const results = searchNetwork(query, deps.random);
        update((current) => ({
          ...current,
          search: { status: "done", title, results },
        }));
      });
    },
    clearResults() {
      update((current) => ({
        ...current,
        search: { status: "idle", title: "", results: [] },
      }));
    },
    download(results) {
      if (!online() || results.length === 0) return;
      const active = new Set(
        state.downloads
          .filter((transfer) => !isFinished(transfer))
          .map((transfer) => `${transfer.user}|${transfer.filename}`),
      );
      const started = results.flatMap((item) => {
        const key = `${item.user}|${item.filename}`;
        if (active.has(key)) return [];
        active.add(key);
        transferCount += 1;
        return [startTransfer(`d${transferCount}`, item, deps.random)];
      });
      update((current) => ({
        ...current,
        downloads: [...current.downloads, ...started],
      }));
    },
    cancel(transferId) {
      update((current) => ({
        ...current,
        downloads: current.downloads.map((transfer) =>
          transfer.id === transferId ? cancelTransfer(transfer) : transfer,
        ),
        uploads: current.uploads.map((transfer) =>
          transfer.id === transferId ? cancelTransfer(transfer) : transfer,
        ),
      }));
    },
    clearFinished() {
      update((current) => ({
        ...current,
        downloads: current.downloads.filter(
          (transfer) => !isFinished(transfer),
        ),
        uploads: current.uploads.filter((transfer) => !isFinished(transfer)),
      }));
    },
    addToHotList(user) {
      if (state.hotList.some((entry) => entry.user === user)) return;
      update((current) => ({
        ...current,
        hotList: [...current.hotList, { user, online: online() }],
      }));
    },
    removeFromHotList(user) {
      update((current) => ({
        ...current,
        hotList: current.hotList.filter((entry) => entry.user !== user),
        browsing:
          current.browsing?.user === user ? undefined : current.browsing,
      }));
    },
    browse(user) {
      const entry = state.hotList.find((item) => item.user === user);
      update((current) => ({
        ...current,
        browsing: {
          user,
          results:
            online() && entry?.online ? browseUser(user, deps.random) : [],
        },
      }));
    },
    joinRoom(name) {
      if (!online()) return;
      if (state.rooms.some((room) => room.name === name)) {
        session.setActiveRoom(name);
        return;
      }
      const room = joinRoom(name, state.username, deps.random, nextLineId);
      update((current) => ({
        ...current,
        rooms: [...current.rooms, room],
        activeRoom: name,
      }));
    },
    leaveRoom(name) {
      update((current) => {
        const rooms = current.rooms.filter((room) => room.name !== name);
        return {
          ...current,
          rooms,
          activeRoom:
            current.activeRoom === name
              ? rooms[rooms.length - 1]?.name
              : current.activeRoom,
        };
      });
    },
    setActiveRoom(name) {
      update((current) => ({ ...current, activeRoom: name }));
    },
    say(text) {
      const trimmed = text.trim();
      const name = state.activeRoom;
      if (!online() || !name || trimmed.length === 0) return;
      update((current) => ({
        ...current,
        rooms: current.rooms.map((room) =>
          room.name === name
            ? appendLine(room, {
                id: nextLineId(),
                kind: "message",
                user: current.username,
                text: trimmed.slice(0, 300),
                own: true,
              })
            : room,
        ),
      }));
      after(800 + Math.floor(deps.random() * 2400), () => {
        update((current) => ({
          ...current,
          rooms: current.rooms.map((room) => {
            if (room.name !== name) return room;
            const reply = replyTo(
              room,
              current.username,
              deps.random,
              nextLineId(),
            );
            return reply ? appendLine(room, reply) : room;
          }),
        }));
      });
    },
    dispose() {
      disposed = true;
      stopTicker();
      cancels.forEach((cancel) => cancel());
      cancels.clear();
      listeners.clear();
      eventListeners.clear();
    },
  };
  return session;
}
