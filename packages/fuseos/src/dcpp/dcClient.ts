import type { FuseTrack } from "../winamp/fuseTracks";

import type { FileListFolder } from "./fileList";
import { userFileList } from "./fileList";
import { formatBytes } from "./format";
import type { Hub } from "./hubs";
import { findHub, FUSEHUB } from "./hubs";
import type { Random } from "./rng";
import { pick, randomInt } from "./rng";
import type {
  CatalogueFile,
  Delivery,
  SearchQuery,
  SearchResult,
} from "./search";
import { JOKE_FILES, repoFiles, runSearch, trackFiles } from "./search";
import type { HubUser } from "./users";
import { generateUsers, selfUser, sortUsers } from "./users";

/** A pending timer, opaque to the code that holds it. */
export type TimerHandle = unknown;

/** Everything the fake network needs from outside: time, timers and a seeded random source. */
export type DcClientDeps = {
  random: Random;
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
  hubs: readonly Hub[];
  tracks: readonly FuseTrack[];
};

export type ChatKind = "chat" | "status" | "me";

export type ChatLine = {
  id: number;
  time: number;
  kind: ChatKind;
  /** Absent for status lines ("*** Connected"). */
  nick?: string;
  text: string;
};

export type HubStatus = "connecting" | "connected" | "disconnected";

export type HubConnection = {
  address: string;
  hub: Hub;
  status: HubStatus;
  users: HubUser[];
  chat: ChatLine[];
  /** Where the hub asked you to go (Follow redirect). */
  redirect?: string;
  /** When the share check will kick you, if it will. */
  kickAt?: number;
};

export type TransferState =
  | "connecting"
  | "running"
  | "waiting"
  | "failed"
  | "done";

export type QueueItem = {
  id: string;
  file: string;
  path: string;
  size: number;
  nick: string;
  hub: string;
  hubAddress: string;
  delivery: Delivery;
  added: number;
  state: TransferState;
  downloaded: number;
  /** Bytes per second right now. */
  speed: number;
  /** What the Status column says. */
  status: string;
  /** The last error, for the Errors column. */
  error?: string;
  startedAt?: number;
  ip: string;
};

export type FinishedItem = {
  id: string;
  time: number;
  file: string;
  path: string;
  nick: string;
  hub: string;
  size: number;
  speed: number;
  delivery: Delivery;
};

export type ShareDir = { virtualName: string; directory: string; size: number };

export type SearchState = {
  status: "idle" | "searching" | "done";
  query?: SearchQuery;
  results: SearchResult[];
  message: string;
};

export type FileListView = {
  nick: string;
  hubAddress: string;
  root: FileListFolder;
};

export type DcState = {
  nick: string;
  shareDirs: ShareDir[];
  hubs: HubConnection[];
  queue: QueueItem[];
  finished: FinishedItem[];
  search: SearchState;
  fileLists: FileListView[];
  downloadedTotal: number;
  uploadedTotal: number;
  /** The newest line of the main status bar ("Search for 'x' sent", "File list downloaded"). */
  statusText: string;
};

/** What a finished download hands the desktop. */
export type DeliveryEvent = { item: FinishedItem };

const CHATTER = [
  "anyone got a free slot?? :(",
  "whats the min share here",
  "lol",
  "brb pizza",
  "can someone upload CD2 pls, stuck at 99%",
  "who is downloading from me at 0.4 kB/s??",
  "DC++ 0.401 is out, upgrade your clients ppl",
  "where do i get the hublist",
  "a/s/l?",
  "anyone seen the new Winamp skin?",
  "my ISP capped me at 5 GB/month, this is torture",
  "is it legal if i delete it after 24 hours",
  "why is everyone passive",
  "finally got my 512k ADSL!!!",
  "I have a 56k modem, be gentle",
  "hash checking... hash checking... hash checking...",
  "ops are sleeping, party time",
  "BRB, mom needs the phone line",
  "anybody playing UT2003 tonight?",
  "who wants to trade slots",
] as const;

const FUSEHUB_CHATTER = [
  "FuseBot shares the whole soundtrack, search 'fuse'",
  "Fuseball 5v5 tonight, who's in?",
  "I share my C:\\ and nobody has noticed yet",
  "Fuse Riders > Fuse Choppers, fight me",
  "search README, everyone has it lol",
] as const;

export const KICK_DELAY_MS = 30_000;
export const CONNECT_DELAY_MS = 800;
export const CHECK_DELAY_MS = 1_500;
export const FAKE_SHARE_DELAY_MS = 8_000;
export const SEARCH_DELAY_MS = 900;
export const TICK_MS = 500;
/** How many results a search keeps, like a hub's flood limit. */
export const SEARCH_LIMIT = 500;
const MAX_CHAT = 300;

const shareTotal = (dirs: readonly ShareDir[]) =>
  dirs.reduce((sum, dir) => sum + dir.size, 0);

/**
 * The pretend Direct Connect network. Holds the client's whole state, drives hubs, searches and transfers
 * with the injected timers and random source, and tells listeners whenever anything changed. Nothing here
 * opens a socket: every hub, user and file is made up (see `hubs.ts`, `users.ts` and `search.ts`).
 */
export class DcClient {
  private state: DcState;
  private readonly listeners = new Set<() => void>();
  private readonly deliveryListeners = new Set<
    (event: DeliveryEvent) => void
  >();
  /** Pending timers per owner key ("hub:<address>", "transfer:<id>", "search"), so closing cancels them. */
  private readonly timers = new Map<string, Set<TimerHandle>>();
  private repo: readonly { path: string; size: number }[] = [];
  private lineId = 0;
  private itemId = 0;
  private ticking: TimerHandle | undefined;

  constructor(private readonly deps: DcClientDeps) {
    this.state = {
      nick: `fuse_user${randomInt(deps.random, 100, 999)}`,
      shareDirs: [],
      hubs: [],
      queue: [],
      finished: [],
      search: { status: "idle", results: [], message: "" },
      fileLists: [],
      downloadedTotal: 0,
      uploadedTotal: 0,
      statusText: "",
    };
  }

  // --- store plumbing -------------------------------------------------------------------------

  getState = (): DcState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  onDelivered(listener: (event: DeliveryEvent) => void): () => void {
    this.deliveryListeners.add(listener);
    return () => {
      this.deliveryListeners.delete(listener);
    };
  }

  private set(next: Partial<DcState>): void {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  private schedule(owner: string, ms: number, callback: () => void): void {
    const owned = this.timers.get(owner) ?? new Set<TimerHandle>();
    this.timers.set(owner, owned);
    const handle = this.deps.setTimeout(() => {
      owned.delete(handle);
      callback();
    }, ms);
    owned.add(handle);
  }

  private cancel(owner: string): void {
    this.timers.get(owner)?.forEach((handle) => this.deps.clearTimeout(handle));
    this.timers.delete(owner);
  }

  /** Stops every timer; the window calls this when it closes. */
  dispose(): void {
    for (const owner of [...this.timers.keys()]) this.cancel(owner);
    if (this.ticking !== undefined) this.deps.clearTimeout(this.ticking);
    this.ticking = undefined;
    this.listeners.clear();
    this.deliveryListeners.clear();
  }

  /** A line for the main status bar ("Hub list downloaded"). */
  note(text: string): void {
    this.set({ statusText: text });
  }

  // --- sharing ---------------------------------------------------------------------------------

  /** The C:\ drive's files (the build manifest), for the share size and FuseHub's search results. */
  setRepoFiles(files: readonly { path: string; size: number }[]): void {
    this.repo = files;
    const size = files.reduce((sum, file) => sum + file.size, 0);
    if (this.state.shareDirs.some((dir) => dir.directory === "C:\\"))
      this.setShareDirs(
        this.state.shareDirs.map((dir) =>
          dir.directory === "C:\\" ? { ...dir, size } : dir,
        ),
      );
  }

  /** What sharing C:\ would add: the whole repository. */
  repoSize(): number {
    return this.repo.reduce((sum, file) => sum + file.size, 0);
  }

  shared(): number {
    return shareTotal(this.state.shareDirs);
  }

  setNick(nick: string): void {
    const trimmed = nick.trim().replace(/[\s$|<>]/g, "_");
    if (trimmed) this.set({ nick: trimmed });
  }

  setShareDirs(dirs: ShareDir[]): void {
    this.set({ shareDirs: dirs });
    const shared = this.shared();
    for (const connection of this.state.hubs) {
      if (connection.status !== "connected") continue;
      this.updateHub(connection.address, (hub) => ({
        ...hub,
        users: hub.users.map((user) =>
          user.nick === this.state.nick ? { ...user, shared } : user,
        ),
      }));
      this.checkShare(connection.address);
    }
  }

  // --- hubs ------------------------------------------------------------------------------------

  private hubKey(address: string) {
    return `hub:${address}`;
  }

  connection(address: string): HubConnection | undefined {
    return this.state.hubs.find((hub) => hub.address === address);
  }

  private updateHub(
    address: string,
    patch: (hub: HubConnection) => HubConnection,
  ): void {
    this.set({
      hubs: this.state.hubs.map((hub) =>
        hub.address === address ? patch(hub) : hub,
      ),
    });
  }

  private line(
    address: string,
    kind: ChatKind,
    text: string,
    nick?: string,
  ): void {
    const entry: ChatLine = {
      id: (this.lineId += 1),
      time: this.deps.now(),
      kind,
      text,
      ...(nick === undefined ? {} : { nick }),
    };
    this.updateHub(address, (hub) => ({
      ...hub,
      chat: [...hub.chat, entry].slice(-MAX_CHAT),
    }));
  }

  /** Opens a hub (or reconnects a dropped one). Unknown addresses fail like a dead dyndns name. */
  connect(address: string): void {
    const hub = findHub(this.deps.hubs, address);
    const existing = this.connection(address);
    if (existing && existing.status !== "disconnected") return;
    this.cancel(this.hubKey(address));
    const fallback: Hub = {
      name: address,
      description: "",
      address,
      users: 0,
      shared: 0,
      minShare: 0,
      rule: "open",
      bot: "Hub",
      op: "Hub",
      motd: [],
    };
    const connection: HubConnection = {
      address,
      hub: hub ?? fallback,
      status: "connecting",
      users: [],
      chat: existing?.chat ?? [],
    };
    this.set({
      hubs: existing
        ? this.state.hubs.map((entry) =>
            entry.address === address ? connection : entry,
          )
        : [...this.state.hubs, connection],
    });
    this.line(address, "status", `*** Connecting to ${address}...`);
    this.schedule(this.hubKey(address), CONNECT_DELAY_MS, () => {
      if (!hub) {
        this.line(address, "status", "*** Connection timeout");
        this.disconnected(address);
        return;
      }
      this.connected(hub);
    });
  }

  private connected(hub: Hub): void {
    const address = hub.address;
    this.line(address, "status", "*** Connected");
    if (hub.rule === "full" && hub.redirectTo) {
      this.line(
        address,
        "chat",
        `This hub is full (${hub.users}/${hub.users}). Please try ${hub.redirectTo}`,
        hub.bot,
      );
      this.line(
        address,
        "status",
        `*** Redirect request received to a hub that's already connected or full. Use Follow redirect to go to ${hub.redirectTo}`,
      );
      this.updateHub(address, (entry) => ({
        ...entry,
        redirect: hub.redirectTo,
      }));
      this.disconnected(address);
      return;
    }
    const users = sortUsers([
      ...generateUsers(this.deps.random, hub, Math.min(hub.users, 250)),
      selfUser(this.state.nick, this.shared()),
    ]);
    this.updateHub(address, (entry) => ({
      ...entry,
      status: "connected",
      users,
    }));
    for (const text of hub.motd) this.line(address, "chat", text, hub.bot);
    this.schedule(this.hubKey(address), CHECK_DELAY_MS, () =>
      this.checkShare(address),
    );
    this.chatter(address);
  }

  private chatter(address: string): void {
    this.schedule(
      this.hubKey(address),
      randomInt(this.deps.random, 4_000, 12_000),
      () => {
        const connection = this.connection(address);
        if (!connection || connection.status !== "connected") return;
        const talkers = connection.users.filter(
          (user) => !user.op && user.nick !== this.state.nick,
        );
        const [first, ...rest] = talkers;
        if (first) {
          const lines =
            connection.address === FUSEHUB
              ? [...CHATTER, ...FUSEHUB_CHATTER]
              : [...CHATTER];
          const text = lines[Math.floor(this.deps.random() * lines.length)];
          if (text) this.line(address, "chat", text, pick(this.deps.random, [first, ...rest]).nick);
        }
        this.chatter(address);
      },
    );
  }

  private checkShare(address: string): void {
    const connection = this.connection(address);
    if (!connection || connection.status !== "connected") return;
    const { hub } = connection;
    if (hub.rule === "open" || hub.rule === "full") return;
    const shared = this.shared();
    const key = `${this.hubKey(address)}:kick`;
    if (shared < hub.minShare) {
      if (connection.kickAt !== undefined) return;
      this.line(
        address,
        "chat",
        `${this.state.nick}: You must share at least ${formatBytes(hub.minShare)} to stay in this hub. You share ${formatBytes(shared)}. Kicking in 30s`,
        hub.bot,
      );
      this.updateHub(address, (entry) => ({
        ...entry,
        kickAt: this.deps.now() + KICK_DELAY_MS,
      }));
      this.schedule(key, KICK_DELAY_MS, () =>
        this.kick(
          address,
          hub.bot,
          `Share below minimum (${formatBytes(this.shared())} / ${formatBytes(hub.minShare)})`,
        ),
      );
      return;
    }
    if (connection.kickAt !== undefined) {
      this.cancel(key);
      this.updateHub(address, (entry) => {
        const { kickAt: _kickAt, ...rest } = entry;
        return rest;
      });
      this.line(
        address,
        "chat",
        `Share check passed: ${formatBytes(shared)}. Welcome, ${this.state.nick}!`,
        hub.bot,
      );
    }
    if (hub.rule === "fake-share") this.fakeShareCheck(address);
    else if (hub.address === FUSEHUB && shared > 0)
      this.line(
        address,
        "chat",
        `${this.state.nick}: Type 'fuse' or 'README' in Search. Our slots are always free.`,
        hub.bot,
      );
  }

  private fakeShareCheck(address: string): void {
    const connection = this.connection(address);
    if (!connection) return;
    const { hub } = connection;
    const key = `${this.hubKey(address)}:kick`;
    this.cancel(key);
    this.schedule(key, FAKE_SHARE_DELAY_MS, () => {
      this.line(
        address,
        "chat",
        `Browsing ${this.state.nick}'s file list...`,
        hub.op,
      );
      this.schedule(key, 3_000, () => {
        const files = this.repo.length;
        this.line(
          address,
          "chat",
          files > 0
            ? `${files} files of .ts, .md and .json in a folder called fuse-games? That is a git repository, not a share.`
            : "Your file list is empty. Nice try.",
          hub.op,
        );
        this.kick(address, hub.op, "Fake share");
      });
    });
  }

  private kick(address: string, by: string, reason: string): void {
    // The NMDC kick as DC++ printed it: the kicker announces it in main chat, then the hub drops you.
    this.line(
      address,
      "chat",
      `${by} is kicking ${this.state.nick} because: ${reason}`,
      by,
    );
    this.disconnected(address);
  }

  private disconnected(address: string): void {
    this.cancel(this.hubKey(address));
    this.cancel(`${this.hubKey(address)}:kick`);
    this.updateHub(address, (entry) => {
      const { kickAt: _kickAt, ...rest } = entry;
      return { ...rest, status: "disconnected", users: [] };
    });
    this.line(address, "status", "*** Disconnected");
  }

  /** Reconnect (the toolbar's Reconnect on the active hub). */
  reconnect(address: string): void {
    const connection = this.connection(address);
    if (!connection) return;
    if (connection.status !== "disconnected") this.disconnected(address);
    this.connect(address);
  }

  /** Follow redirect: goes where a full hub pointed. */
  followRedirect(address: string): string | undefined {
    const target = this.connection(address)?.redirect;
    if (target) this.connect(target);
    return target;
  }

  closeHub(address: string): void {
    this.cancel(this.hubKey(address));
    this.cancel(`${this.hubKey(address)}:kick`);
    this.set({ hubs: this.state.hubs.filter((hub) => hub.address !== address) });
  }

  /** Main chat. `/clear` empties the window; everything else is said out loud. */
  sendChat(address: string, text: string): void {
    const message = text.trim();
    const connection = this.connection(address);
    if (!message || !connection) return;
    if (message === "/clear") {
      this.updateHub(address, (entry) => ({ ...entry, chat: [] }));
      return;
    }
    if (connection.status !== "connected") {
      this.line(address, "status", "*** Not connected");
      return;
    }
    if (message.startsWith("/me ")) {
      this.line(address, "me", message.slice(4), this.state.nick);
      return;
    }
    this.line(address, "chat", message, this.state.nick);
    if (message.startsWith("+help"))
      this.schedule(this.hubKey(address), 400, () =>
        this.line(
          address,
          "chat",
          "Commands: +help, +rules, +myinfo. That is all, this bot is from 2002.",
          connection.hub.bot,
        ),
      );
    else if (message.startsWith("+rules"))
      this.schedule(this.hubKey(address), 400, () =>
        this.line(
          address,
          "chat",
          `Min share ${formatBytes(connection.hub.minShare)}. No fakers. Be nice.`,
          connection.hub.bot,
        ),
      );
    else if (message.startsWith("+myinfo"))
      this.schedule(this.hubKey(address), 400, () =>
        this.line(
          address,
          "chat",
          `${this.state.nick}: share ${formatBytes(this.shared())}, tag <++ V:0.401,M:A,H:1/0/0,S:3>`,
          connection.hub.bot,
        ),
      );
  }

  /** The files a connected hub's people share: FuseHub has the repository and the soundtrack. */
  private hubFiles(address: string): CatalogueFile[] {
    if (address === FUSEHUB)
      return [
        ...trackFiles(this.deps.tracks),
        ...repoFiles(this.repo),
        ...JOKE_FILES,
      ];
    return [...JOKE_FILES];
  }

  // --- search ----------------------------------------------------------------------------------

  search(query: SearchQuery): void {
    this.cancel("search");
    const text = query.text.trim();
    if (!text) return;
    const sources = this.state.hubs
      .filter(
        (hub) =>
          hub.status === "connected" &&
          (query.hubs === undefined || query.hubs.includes(hub.address)),
      )
      .map((hub) => ({
        hubName: hub.hub.name,
        hubAddress: hub.address,
        users: hub.users.filter((user) => user.nick !== this.state.nick),
        files: this.hubFiles(hub.address),
      }));
    if (sources.length === 0) {
      this.set({
        search: {
          status: "done",
          query,
          results: [],
          message: "You are not connected to any hubs",
        },
        statusText: "You are not connected to any hubs",
      });
      return;
    }
    this.set({
      search: {
        status: "searching",
        query,
        results: [],
        message: `Searching for ${text}...`,
      },
      statusText: `Searching for ${text}...`,
    });
    this.schedule("search", SEARCH_DELAY_MS, () => {
      const results = runSearch(
        this.deps.random,
        sources,
        { ...query, text },
        SEARCH_LIMIT,
      );
      this.set({
        search: {
          status: "done",
          query,
          results,
          message: `${results.length} item${results.length === 1 ? "" : "s"}`,
        },
        statusText: `Search for '${text}' done, ${results.length} results`,
      });
    });
  }

  // --- file lists ------------------------------------------------------------------------------

  /** Get file list: a made-up tree of what that person shares. */
  openFileList(nick: string, hubAddress: string): FileListView {
    const existing = this.state.fileLists.find(
      (list) => list.nick === nick && list.hubAddress === hubAddress,
    );
    if (existing) return existing;
    const view: FileListView = {
      nick,
      hubAddress,
      root: userFileList(this.deps.random, this.hubFiles(hubAddress)),
    };
    this.set({
      fileLists: [...this.state.fileLists, view],
      statusText: `File list of ${nick} downloaded`,
    });
    return view;
  }

  closeFileList(nick: string, hubAddress: string): void {
    this.set({
      fileLists: this.state.fileLists.filter(
        (list) => !(list.nick === nick && list.hubAddress === hubAddress),
      ),
    });
  }

  // --- downloads -------------------------------------------------------------------------------

  /** Adds a file to the Download Queue and starts it. */
  download(source: {
    file: string;
    path: string;
    size: number;
    nick: string;
    hub: string;
    hubAddress: string;
    delivery: Delivery;
  }): QueueItem {
    const duplicate = this.state.queue.find(
      (item) =>
        item.file === source.file &&
        item.path === source.path &&
        item.state !== "done",
    );
    if (duplicate) return duplicate;
    const item: QueueItem = {
      ...source,
      id: `q${(this.itemId += 1)}`,
      added: this.deps.now(),
      state: "connecting",
      downloaded: 0,
      speed: 0,
      status: "Connecting...",
      ip: `${randomInt(this.deps.random, 62, 217)}.${randomInt(this.deps.random, 1, 254)}.${randomInt(this.deps.random, 1, 254)}.${randomInt(this.deps.random, 1, 254)}`,
    };
    this.set({
      queue: [...this.state.queue, item],
      statusText: `Added ${source.file} to the download queue`,
    });
    this.start(item.id);
    return item;
  }

  private patchItem(id: string, patch: Partial<QueueItem>): void {
    this.set({
      queue: this.state.queue.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      ),
    });
  }

  private item(id: string): QueueItem | undefined {
    return this.state.queue.find((item) => item.id === id);
  }

  /**
   * Plays one attempt. Harmless files (the repository, the soundtrack) arrive in a few seconds; everything
   * else fails the way 2003 did: no slots, a timeout, or a crawl to 99% and a disconnect.
   */
  private start(id: string): void {
    const key = `transfer:${id}`;
    this.cancel(key);
    this.patchItem(id, {
      state: "connecting",
      status: "Connecting...",
      speed: 0,
    });
    const item = this.item(id);
    if (!item) return;
    if (item.delivery.kind !== "joke") {
      this.schedule(key, 1_000, () => {
        const speed = randomInt(this.deps.random, 40, 400) * 1024;
        this.patchItem(id, {
          state: "running",
          startedAt: this.deps.now(),
          speed,
        });
        this.ensureTicking();
      });
      return;
    }
    const roll = this.deps.random();
    if (roll < 0.35) {
      this.schedule(key, 1_500, () =>
        this.fail(id, "No slots available", "waiting"),
      );
    } else if (roll < 0.6) {
      this.schedule(key, 5_000, () => this.fail(id, "Connection timeout"));
    } else {
      this.schedule(key, 1_200, () => {
        const current = this.item(id);
        if (!current) return;
        // Fast enough to watch it crawl to 99% in 15-25 s, whatever the size.
        const seconds = randomInt(this.deps.random, 15, 25);
        this.patchItem(id, {
          state: "running",
          startedAt: this.deps.now(),
          speed: Math.max(1, Math.round((current.size * 0.99) / seconds)),
        });
        this.ensureTicking();
      });
    }
  }

  private fail(id: string, error: string, state: TransferState = "failed") {
    this.patchItem(id, { state, status: error, error, speed: 0 });
  }

  private ensureTicking(): void {
    if (this.ticking !== undefined) return;
    this.ticking = this.deps.setTimeout(() => {
      this.ticking = undefined;
      this.tick();
    }, TICK_MS);
  }

  private tick(): void {
    let running = false;
    for (const item of this.state.queue) {
      if (item.state !== "running") continue;
      const step = Math.round((item.speed * TICK_MS) / 1000);
      // A joke download stops dead at 99%: the other end always disconnects there.
      const ceiling =
        item.delivery.kind === "joke"
          ? Math.floor(item.size * 0.99)
          : item.size;
      const downloaded = Math.min(ceiling, item.downloaded + step);
      const gained = downloaded - item.downloaded;
      this.set({ downloadedTotal: this.state.downloadedTotal + gained });
      if (downloaded >= ceiling) {
        if (item.delivery.kind === "joke") {
          this.patchItem(item.id, { downloaded });
          this.fail(
            item.id,
            pick(this.deps.random, [
              "Disconnected",
              "File not available",
              "Connection closed by remote user",
            ]),
          );
        } else this.complete(item.id, downloaded);
        continue;
      }
      running = true;
      const percent = ((downloaded / item.size) * 100).toFixed(1);
      const seconds = Math.round(
        (this.deps.now() - (item.startedAt ?? this.deps.now())) / 1000,
      );
      this.patchItem(item.id, {
        downloaded,
        status: `Downloaded ${formatBytes(downloaded)} (${percent}%) in ${seconds}s`,
      });
    }
    if (running) this.ensureTicking();
  }

  private complete(id: string, downloaded: number): void {
    const item = this.item(id);
    if (!item) return;
    const finished: FinishedItem = {
      id: item.id,
      time: this.deps.now(),
      file: item.file,
      path: item.path,
      nick: item.nick,
      hub: item.hub,
      size: item.size,
      speed: item.speed,
      delivery: item.delivery,
    };
    this.set({
      queue: this.state.queue.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              downloaded,
              state: "done",
              speed: 0,
              status: "Download finished, idle...",
            }
          : entry,
      ),
      finished: [...this.state.finished, finished],
      statusText: `${item.file} finished downloading`,
    });
    this.deliveryListeners.forEach((listener) => listener({ item: finished }));
  }

  /** Retry a failed or waiting item (Search for alternates was too 2004). */
  retry(id: string): void {
    const item = this.item(id);
    if (!item || item.state === "done" || item.state === "running") return;
    this.start(id);
  }

  /** Removes from the queue (and the Transfers pane); a running one is cancelled. */
  remove(id: string): void {
    this.cancel(`transfer:${id}`);
    this.set({ queue: this.state.queue.filter((item) => item.id !== id) });
  }

  /** Clear the queue of finished rows (DC++ hid those from the Transfers pane by itself). */
  removeFinished(): void {
    this.set({
      queue: this.state.queue.filter((item) => item.state !== "done"),
    });
  }

  clearFinished(): void {
    this.set({ finished: [] });
  }
}
