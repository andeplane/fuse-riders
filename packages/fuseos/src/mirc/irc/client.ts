/**
 * One IRC connection: owns the transport, the timers (registration timeout, keepalive, reconnect with
 * backoff) and the session state, and turns what the user types into protocol lines. Everything it
 * touches outside itself — the socket, the clock, timers, randomness — comes in through `ClientDeps`.
 */
import { ircEquals } from "./casemap";
import type { InputAction } from "./input";
import { HELP_LINES, parseInput } from "./input";
import { formatCtcp, line, parseMessage, splitByBytes } from "./message";
import type { IrcNetwork } from "./networks";
import {
  connectUrl,
  demoChannelList,
  findNetwork,
  networkForHost,
} from "./networks";
import type { LineKind, SessionState } from "./session";
import {
  activate,
  addActiveLine,
  addLine,
  addLineEverywhere,
  channelId,
  displayPrefix,
  ensureWindow,
  findWindow,
  initialSession,
  isChannelName,
  LIST_ID,
  queryId,
  receive,
  STATUS_ID,
} from "./session";
import type { IrcConnection, IrcTransport } from "./transport";

export type TimerHandle = { readonly id: number };

export type Scheduler = {
  setTimeout: (callback: () => void, ms: number) => TimerHandle;
  clearTimeout: (handle: TimerHandle) => void;
};

export type ClientDeps = {
  transport: IrcTransport;
  scheduler: Scheduler;
  now: () => number;
  random: () => number;
  /** A WebSocket↔IRC bridge for networks without their own WebSocket listener (see docs/fuseos/mirc.md). Unset: none. */
  bridgeUrl?: string;
};

export type Identity = {
  nick: string;
  altNick: string;
  realName: string;
  /** The USER name (ident); defaults to a lower-cased nick. */
  ident?: string;
  /** Ask for user mode +i after connecting (mIRC's "Invisible mode"). */
  invisible?: boolean;
};

/** How long to wait for the welcome (001) after the socket opens. */
export const REGISTRATION_TIMEOUT_MS = 30_000;
/** How often the keepalive looks at the link. */
export const KEEPALIVE_INTERVAL_MS = 60_000;
/** Quiet this long and the client sends a PING... */
export const PING_AFTER_MS = 90_000;
/** ...and this long with no reply, it gives up on the link. */
export const PING_TIMEOUT_MS = 240_000;
export const MAX_RECONNECT_ATTEMPTS = 5;
export const DEFAULT_QUIT_MESSAGE = "Leaving";

/** Exponential backoff with jitter: 2s, 4s, 8s, ... capped at a minute, plus up to a second. */
export function reconnectDelay(attempt: number, random: () => number): number {
  return (
    Math.min(60_000, 2_000 * 2 ** Math.max(0, attempt - 1)) +
    Math.floor(random() * 1000)
  );
}

/** Room for `:nick!user@host PRIVMSG target :` in front of a 512-byte line. */
function messageBudget(target: string): number {
  return 510 - 100 - target.length - 12;
}

export class IrcClient {
  private state: SessionState;
  private readonly listeners = new Set<() => void>();
  private connection: IrcConnection | undefined;
  private serial = 0;
  private network: IrcNetwork | undefined;
  private identity: Identity;
  private attempt = 0;
  private quitting = false;
  private lastReceived = 0;
  private registrationTimer: TimerHandle | undefined;
  private keepaliveTimer: TimerHandle | undefined;
  private reconnectTimer: TimerHandle | undefined;

  constructor(
    private readonly deps: ClientDeps,
    identity: Identity,
  ) {
    this.identity = identity;
    this.state = initialSession(identity.nick, identity.altNick);
  }

  getState = (): SessionState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private set(next: SessionState) {
    if (next === this.state) return;
    this.state = next;
    for (const listener of [...this.listeners]) listener();
  }

  /** Adds lines to the Status window (the welcome banner, offline notes). */
  print(kind: LineKind, lines: readonly string[], windowId = STATUS_ID) {
    const now = this.deps.now();
    this.set(
      lines.reduce(
        (acc, text) => addLine(acc, windowId, kind, text, now),
        this.state,
      ),
    );
  }

  /** Changes the nick and alternative used for the next connection (the Connect options). */
  setIdentity(identity: Identity) {
    this.identity = identity;
    if (this.state.phase === "offline")
      this.set({
        ...this.state,
        nick: identity.nick,
        wantedNick: identity.nick,
        altNick: identity.altNick,
      });
  }

  activate(id: string) {
    this.set(activate(this.state, id));
  }

  get connected(): boolean {
    return this.connection !== undefined;
  }

  connect(network: IrcNetwork) {
    this.cancelReconnect();
    if (this.connection) this.closeLink(DEFAULT_QUIT_MESSAGE);
    this.network = network;
    this.attempt = 0;
    this.open();
  }

  private open() {
    const network = this.network;
    if (!network) return;
    const server = network.servers[0];
    const now = this.deps.now();
    const url = connectUrl(network, this.deps.bridgeUrl);
    const hostLabel = server ? `${server.host} (${server.port})` : network.name;
    let next: SessionState = {
      ...this.state,
      network: network.name,
      server: server ? `${server.host}:${server.port}` : "",
      nick: this.identity.nick,
      wantedNick: this.identity.nick,
      altNick: this.identity.altNick,
      nickAttempts: 0,
      userModes: "",
      support: { ...this.state.support, network: undefined },
      caps: [],
      capsOffered: [],
      pendingNames: {},
    };
    next = addLine(
      next,
      STATUS_ID,
      "info",
      `* Connecting to ${hostLabel}`,
      now,
    );
    if (!url) {
      next = network.browserNote.reduce(
        (acc, text) => addLine(acc, STATUS_ID, "error", text, now),
        next,
      );
      this.set(
        addLine(
          { ...next, phase: "offline" },
          STATUS_ID,
          "info",
          "* Disconnected",
          now,
        ),
      );
      return;
    }
    next = (network.connectNote ?? []).reduce(
      (acc, text) => addLine(acc, STATUS_ID, "info", text, now),
      next,
    );
    this.set({ ...next, phase: "connecting" });
    const serial = ++this.serial;
    this.quitting = false;
    this.lastReceived = now;
    this.connection = this.deps.transport.connect(url, {
      onOpen: () => {
        if (serial === this.serial) this.onOpen();
      },
      onLine: (text) => {
        if (serial === this.serial) this.onLine(text);
      },
      onClose: (reason) => {
        if (serial === this.serial) this.onClose(reason);
      },
    });
  }

  private onOpen() {
    const ident =
      (this.identity.ident ?? this.identity.nick)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .slice(0, 10) || "fuseos";
    this.set({ ...this.state, phase: "registering" });
    this.sendLine(line("CAP", "LS", "302"));
    this.sendLine(line("NICK", this.state.nick));
    this.sendLine(
      line("USER", ident, "0", "*", this.identity.realName || "FuseOS user"),
    );
    this.registrationTimer = this.deps.scheduler.setTimeout(() => {
      this.registrationTimer = undefined;
      if (this.state.phase !== "online")
        this.dropLink("Registration timed out");
    }, REGISTRATION_TIMEOUT_MS);
  }

  private onLine(text: string) {
    const message = parseMessage(text);
    if (!message) return;
    this.lastReceived = this.deps.now();
    const before = this.state.phase;
    const { state, send } = receive(
      this.state,
      message,
      this.deps.now(),
      this.deps.random,
    );
    this.set(state);
    for (const out of send) this.sendLine(out);
    if (before !== "online" && state.phase === "online") this.onRegistered();
  }

  private onRegistered() {
    this.attempt = 0;
    if (this.registrationTimer)
      this.deps.scheduler.clearTimeout(this.registrationTimer);
    this.registrationTimer = undefined;
    // Rejoin what was open before a reconnect, as mIRC's "rejoin channels" option did.
    for (const window of this.state.windows)
      if (window.kind === "channel") this.sendLine(line("JOIN", window.name));
    if (this.identity.invisible)
      this.sendLine(line("MODE", this.state.nick, "+i"));
    if (this.state.away) this.sendLine(line("AWAY", this.state.away));
    this.scheduleKeepalive();
  }

  private scheduleKeepalive() {
    this.keepaliveTimer = this.deps.scheduler.setTimeout(() => {
      this.keepaliveTimer = undefined;
      if (!this.connection) return;
      const quiet = this.deps.now() - this.lastReceived;
      if (quiet >= PING_TIMEOUT_MS) {
        this.dropLink(`Ping timeout: ${Math.round(quiet / 1000)} seconds`);
        return;
      }
      if (quiet >= PING_AFTER_MS) this.sendLine(line("PING", "fuseos"));
      this.scheduleKeepalive();
    }, KEEPALIVE_INTERVAL_MS);
  }

  private onClose(reason: string) {
    this.connection = undefined;
    this.clearLinkTimers();
    const now = this.deps.now();
    let next: SessionState = {
      ...this.state,
      phase: "offline",
      windows: this.state.windows.map((window) =>
        window.kind === "channel" ? { ...window, members: [] } : window,
      ),
    };
    next = addLineEverywhere(
      next,
      "error",
      `* Disconnected${reason ? ` (${reason})` : ""}`,
      now,
    );
    if (this.quitting || !this.network) {
      this.set(next);
      return;
    }
    this.attempt += 1;
    if (this.attempt > MAX_RECONNECT_ATTEMPTS) {
      this.set(
        addLine(
          next,
          STATUS_ID,
          "error",
          "* Giving up. Press the lightning bolt to connect again.",
          now,
        ),
      );
      return;
    }
    const delay = reconnectDelay(this.attempt, this.deps.random);
    this.set(
      addLine(
        next,
        STATUS_ID,
        "info",
        `* Retrying in ${Math.round(delay / 1000)} seconds (attempt ${this.attempt} of ${MAX_RECONNECT_ATTEMPTS})`,
        now,
      ),
    );
    this.reconnectTimer = this.deps.scheduler.setTimeout(() => {
      this.reconnectTimer = undefined;
      this.open();
    }, delay);
  }

  private clearLinkTimers() {
    if (this.registrationTimer)
      this.deps.scheduler.clearTimeout(this.registrationTimer);
    if (this.keepaliveTimer)
      this.deps.scheduler.clearTimeout(this.keepaliveTimer);
    this.registrationTimer = undefined;
    this.keepaliveTimer = undefined;
  }

  private cancelReconnect() {
    if (this.reconnectTimer)
      this.deps.scheduler.clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }

  /** Ends the link without a QUIT (a timeout): onClose then decides whether to retry. */
  private dropLink(reason: string) {
    const connection = this.connection;
    if (!connection) return;
    // Retire the link first so the transport's own close report is ignored and ours is the one shown.
    this.serial += 1;
    connection.close();
    this.onClose(reason);
  }

  private closeLink(reason: string) {
    const connection = this.connection;
    if (!connection) return;
    this.quitting = true;
    connection.send(line("QUIT", reason));
    this.serial += 1;
    connection.close();
    this.onClose("");
  }

  /** /quit, the disconnect button, closing mIRC: says goodbye and does not reconnect. */
  disconnect(reason = DEFAULT_QUIT_MESSAGE) {
    this.cancelReconnect();
    if (this.connection) this.closeLink(reason);
  }

  dispose() {
    this.disconnect();
    this.cancelReconnect();
    this.clearLinkTimers();
    this.listeners.clear();
  }

  private sendLine(text: string) {
    this.connection?.send(text);
  }

  private get online(): boolean {
    return this.state.phase === "online" && this.connection !== undefined;
  }

  /** Clears a window's text (mIRC's /clear). */
  clear(windowId: string) {
    this.set({
      ...this.state,
      windows: this.state.windows.map((window) =>
        window.id === windowId ? { ...window, lines: [] } : window,
      ),
    });
  }

  /** Closes a channel (parting it), query or list window. Status cannot be closed on its own. */
  closeWindow(windowId: string) {
    const window = findWindow(this.state, windowId);
    if (!window || window.kind === "status") return;
    if (window.kind === "channel" && window.joined && this.online)
      this.sendLine(line("PART", window.name, DEFAULT_QUIT_MESSAGE));
    const windows = this.state.windows.filter((w) => w.id !== windowId);
    const activeId =
      this.state.activeId === windowId
        ? (windows[windows.length - 1]?.id ?? STATUS_ID)
        : this.state.activeId;
    this.set(activate({ ...this.state, windows }, activeId));
  }

  /** Opens a query window for a nick (double-click in the nicklist) and makes it active. */
  openQuery(nick: string) {
    this.set(activate(ensureWindow(this.state, "query", nick), queryId(nick)));
  }

  /** Opens the Channels List: the server's LIST when online, a period-appropriate demo list when not. */
  list() {
    if (this.online) {
      this.sendLine(line("LIST"));
      this.set(
        activate(
          ensureWindow(
            {
              ...this.state,
              list: { entries: [], demo: false, complete: false },
            },
            "list",
            "Channels List",
          ),
          LIST_ID,
        ),
      );
      return;
    }
    this.set(
      activate(
        ensureWindow(
          {
            ...this.state,
            list: { entries: demoChannelList(), demo: true, complete: true },
          },
          "list",
          "Channels List",
        ),
        LIST_ID,
      ),
    );
  }

  join(channel: string) {
    this.perform({ type: "join", channel });
  }

  setAway(message: string | undefined) {
    this.perform(
      message === undefined ? { type: "away" } : { type: "away", message },
    );
  }

  /** What the user typed in a window's editbox. */
  submit(windowId: string, text: string) {
    const window = findWindow(this.state, windowId);
    if (!window) return;
    const action = parseInput(text, {
      kind: window.kind,
      name: window.kind === "status" ? "" : window.name,
    });
    if (action) this.perform(action, windowId);
  }

  private notConnected(command: string) {
    this.set(
      addActiveLine(
        this.state,
        "error",
        `* /${command}: not connected to server`,
        this.deps.now(),
      ),
    );
  }

  private echo(windowId: string, kind: LineKind, text: string) {
    this.set(addLine(this.state, windowId, kind, text, this.deps.now()));
  }

  private say(target: string, text: string, kind: "own" | "action") {
    const isChannel = isChannelName(target, this.state.support);
    const windowId = isChannel ? channelId(target) : queryId(target);
    const window = findWindow(this.state, windowId);
    const self = window?.members.find((member) =>
      ircEquals(member.nick, this.state.nick),
    );
    const shown = `${self ? displayPrefix(self) : ""}${this.state.nick}`;
    const pieces = splitByBytes(
      text,
      messageBudget(target) - (kind === "action" ? 9 : 0),
    );
    for (const piece of pieces) {
      this.sendLine(
        line(
          "PRIVMSG",
          target,
          kind === "action" ? formatCtcp("ACTION", piece) : piece,
        ),
      );
      const echoed =
        kind === "action"
          ? `* ${this.state.nick} ${piece}`
          : `<${shown}> ${piece}`;
      if (window)
        this.echo(windowId, kind === "action" ? "action" : "own", echoed);
      else this.echo(this.state.activeId, "own", `-> *${target}* ${piece}`);
    }
  }

  private perform(action: InputAction, windowId = this.state.activeId) {
    const now = this.deps.now();
    switch (action.type) {
      case "error":
        this.set(addActiveLine(this.state, "error", action.text, now));
        return;
      case "help":
        this.print("info", HELP_LINES, this.state.activeId);
        return;
      case "clear":
        this.clear(windowId);
        return;
      case "close":
        this.closeWindow(windowId);
        return;
      case "list":
        this.list();
        return;
      case "server": {
        const network = action.network
          ? (findNetwork(action.network) ?? networkForHost(action.network))
          : this.network;
        if (!network) {
          this.set(
            addActiveLine(
              this.state,
              "error",
              "* /server: pick a network in File > Options > Servers",
              now,
            ),
          );
          return;
        }
        this.connect(network);
        return;
      }
      case "disconnect":
      case "quit":
        if (!this.connection) {
          this.cancelReconnect();
          this.notConnected(action.type);
          return;
        }
        this.disconnect(
          action.type === "quit"
            ? (action.reason ?? DEFAULT_QUIT_MESSAGE)
            : DEFAULT_QUIT_MESSAGE,
        );
        return;
      case "nick":
        if (this.online) this.sendLine(line("NICK", action.nick));
        else {
          this.identity = { ...this.identity, nick: action.nick };
          this.set(
            addActiveLine(
              { ...this.state, nick: action.nick, wantedNick: action.nick },
              "nick",
              `* Your nick is now ${action.nick}`,
              now,
            ),
          );
        }
        return;
      case "query":
        this.openQuery(action.nick);
        if (action.text !== undefined) {
          if (this.online) this.say(action.nick, action.text, "own");
          else this.notConnected("msg");
        }
        return;
      default:
        break;
    }
    if (!this.online) {
      this.notConnected(action.type === "say" ? "msg" : action.type);
      return;
    }
    switch (action.type) {
      case "say":
      case "msg":
        this.say(action.target, action.text, "own");
        return;
      case "action":
        this.say(action.target, action.text, "action");
        return;
      case "notice":
        this.sendLine(line("NOTICE", action.target, action.text));
        this.echo(
          this.state.activeId,
          "notice",
          `-> -${action.target}- ${action.text}`,
        );
        return;
      case "ctcp":
        this.sendLine(
          line(
            "PRIVMSG",
            action.target,
            formatCtcp(action.command, action.args),
          ),
        );
        this.echo(
          STATUS_ID,
          "ctcp",
          `-> [${action.target}] ${action.command}${action.args ? ` ${action.args}` : ""}`,
        );
        return;
      case "join":
        this.sendLine(
          action.key
            ? line("JOIN", action.channel, action.key)
            : line("JOIN", action.channel),
        );
        return;
      case "part":
        this.sendLine(
          line("PART", action.channel, action.reason ?? DEFAULT_QUIT_MESSAGE),
        );
        return;
      case "hop":
        this.sendLine(line("PART", action.channel, "Rejoining"));
        this.sendLine(line("JOIN", action.channel));
        return;
      case "whois":
        this.sendLine(line("WHOIS", action.nick, action.nick));
        return;
      case "away":
        this.sendLine(
          action.message ? line("AWAY", action.message) : line("AWAY"),
        );
        this.set(
          action.message
            ? { ...this.state, away: action.message }
            : { ...this.state, away: undefined },
        );
        return;
      case "topic":
        this.sendLine(
          action.topic === undefined
            ? line("TOPIC", action.channel)
            : line("TOPIC", action.channel, action.topic),
        );
        return;
      case "raw":
        this.sendLine(action.line);
        this.echo(STATUS_ID, "info", `-> Server: ${action.line}`);
        return;
    }
  }
}
