/**
 * The client's model of one IRC connection — windows, nicklists, topics, the list of channels — and the
 * pure reducer that folds server messages into it. No timers, sockets or randomness live here: the
 * reducer returns the lines to send back (PONG, CTCP replies, the next nick to try) and `client.ts`
 * does the sending.
 */
import { ircEquals, ircLower } from "./casemap";
import { stripFormatting } from "./format";
import type { IrcMessage } from "./message";
import { formatCtcp, line, parseCtcp } from "./message";

export type LineKind =
  | "text"
  | "own"
  | "action"
  | "notice"
  | "join"
  | "part"
  | "quit"
  | "kick"
  | "mode"
  | "topic"
  | "nick"
  | "info"
  | "error"
  | "motd"
  | "ctcp"
  | "whois"
  | "invite";

export type ChatLine = {
  id: number;
  /** Milliseconds since the epoch: the server's `time` tag when it sent one, otherwise receipt. */
  time: number;
  kind: LineKind;
  /** The text as drawn, mIRC control codes included (`<nick> hello`, `* Joins: nick (u@h)`). */
  text: string;
  /** The line mentions the user's nick (drawn as a highlight, and flags the window in the switchbar). */
  highlight?: boolean;
};

export type Member = {
  nick: string;
  /** Prefix symbols held, highest rank first (`@`, `@+`, `+`, or empty). */
  prefixes: string;
  /** user@host when the server told us (a JOIN, a WHO); used in the part and quit lines. */
  userhost?: string;
};

export type ChatWindowKind = "status" | "channel" | "query" | "list";

/** Switchbar colouring for a window that is not active: nothing new, an event, a message, a highlight. */
export type Activity = 0 | 1 | 2 | 3;

export type ChatWindow = {
  id: string;
  kind: ChatWindowKind;
  name: string;
  lines: readonly ChatLine[];
  topic: string;
  /** Channel modes without the leading `+` (`nt`, `ntk`). */
  modes: string;
  members: readonly Member[];
  /** Whether we are in the channel (a kicked or parted channel window stays open, greyed). */
  joined: boolean;
  activity: Activity;
};

export type ListEntry = { channel: string; users: number; topic: string };

export type ConnectionPhase =
  "offline" | "connecting" | "registering" | "online";

export type ServerSupport = {
  /** PREFIX=(qaohv)~&@%+ split into its mode letters and their symbols, highest first. */
  prefixModes: string;
  prefixSymbols: string;
  chantypes: string;
  /** CHANMODES=A,B,C,D: list modes, always-param, param-when-set, never-param. */
  chanmodes: readonly [string, string, string, string];
  network?: string;
};

export type SessionState = {
  phase: ConnectionPhase;
  /** The network chosen in the server list (EFnet, Ergo, ...). */
  network: string;
  /** host:port shown in the title and status lines. */
  server: string;
  nick: string;
  /** The nick asked for, and the alternative from the Connect options, for a collision during registration. */
  wantedNick: string;
  altNick: string;
  nickAttempts: number;
  userModes: string;
  away?: string;
  windows: readonly ChatWindow[];
  activeId: string;
  list: { entries: readonly ListEntry[]; demo: boolean; complete: boolean };
  support: ServerSupport;
  /** IRCv3 capabilities the server acknowledged. */
  caps: readonly string[];
  /** Capabilities offered in a multi-line CAP LS reply, still being collected. */
  capsOffered: readonly string[];
  /** NAMES replies collected for a channel until 366 ends them. */
  pendingNames: Readonly<Record<string, readonly Member[]>>;
  nextLineId: number;
};

export const STATUS_ID = "status";
export const LIST_ID = "list";
/** Each window keeps this many lines, like mIRC's buffer setting. */
export const MAX_LINES = 500;
/** The channels list is bounded however long the server's LIST is. */
export const MAX_LIST_ENTRIES = 5000;
/** The capabilities this client understands, requested when offered. */
export const WANTED_CAPS = ["multi-prefix", "server-time", "away-notify"];

export const DEFAULT_SUPPORT: ServerSupport = {
  prefixModes: "ov",
  prefixSymbols: "@+",
  chantypes: "#&",
  chanmodes: ["beI", "k", "l", "imnpst"],
};

export type Reduction = { state: SessionState; send: readonly string[] };

export function channelId(name: string): string {
  return `chan:${ircLower(name)}`;
}

export function queryId(nick: string): string {
  return `query:${ircLower(nick)}`;
}

export function initialSession(nick: string, altNick: string): SessionState {
  return {
    phase: "offline",
    network: "",
    server: "",
    nick,
    wantedNick: nick,
    altNick,
    nickAttempts: 0,
    userModes: "",
    windows: [
      {
        id: STATUS_ID,
        kind: "status",
        name: "Status",
        lines: [],
        topic: "",
        modes: "",
        members: [],
        joined: false,
        activity: 0,
      },
    ],
    activeId: STATUS_ID,
    list: { entries: [], demo: false, complete: false },
    support: DEFAULT_SUPPORT,
    caps: [],
    capsOffered: [],
    pendingNames: {},
    nextLineId: 1,
  };
}

export function isChannelName(name: string, support: ServerSupport): boolean {
  return name.length > 1 && support.chantypes.includes(name[0] as string);
}

export function findWindow(
  state: SessionState,
  id: string,
): ChatWindow | undefined {
  return state.windows.find((window) => window.id === id);
}

function updateWindow(
  state: SessionState,
  id: string,
  update: (window: ChatWindow) => ChatWindow,
): SessionState {
  return {
    ...state,
    windows: state.windows.map((window) =>
      window.id === id ? update(window) : window,
    ),
  };
}

/** Opens a channel, query or list window if it is not open yet. Does not activate it. */
export function ensureWindow(
  state: SessionState,
  kind: ChatWindowKind,
  name: string,
): SessionState {
  const id =
    kind === "channel"
      ? channelId(name)
      : kind === "query"
        ? queryId(name)
        : kind === "list"
          ? LIST_ID
          : STATUS_ID;
  if (findWindow(state, id)) return state;
  return {
    ...state,
    windows: [
      ...state.windows,
      {
        id,
        kind,
        name,
        lines: [],
        topic: "",
        modes: "",
        members: [],
        joined: false,
        activity: 0,
      },
    ],
  };
}

export function activate(state: SessionState, id: string): SessionState {
  if (!findWindow(state, id)) return state;
  return updateWindow({ ...state, activeId: id }, id, (window) => ({
    ...window,
    activity: 0,
  }));
}

function activityFor(kind: LineKind, highlight: boolean): Activity {
  if (highlight) return 3;
  return kind === "text" || kind === "action" || kind === "notice" ? 2 : 1;
}

/** Appends a line to a window (Status when the window is not open), bounded to MAX_LINES. */
export function addLine(
  state: SessionState,
  windowId: string,
  kind: LineKind,
  text: string,
  time: number,
  highlight = false,
): SessionState {
  const target = findWindow(state, windowId) ? windowId : STATUS_ID;
  const entry: ChatLine = { id: state.nextLineId, time, kind, text };
  if (highlight) entry.highlight = true;
  return updateWindow(
    { ...state, nextLineId: state.nextLineId + 1 },
    target,
    (window) => {
      const lines = [...window.lines, entry];
      const activity = activityFor(kind, highlight);
      return {
        ...window,
        lines:
          lines.length > MAX_LINES
            ? lines.slice(lines.length - MAX_LINES)
            : lines,
        activity:
          state.activeId === target
            ? 0
            : (Math.max(window.activity, activity) as Activity),
      };
    },
  );
}

/** A line in the active window (mIRC's default for notices, errors and whois replies). */
export function addActiveLine(
  state: SessionState,
  kind: LineKind,
  text: string,
  time: number,
): SessionState {
  // The Channels List shows no text, so what would land there goes to Status.
  const target = state.activeId === LIST_ID ? STATUS_ID : state.activeId;
  return addLine(state, target, kind, text, time);
}

/** Every window gets the line (a disconnect, your own nick change). */
export function addLineEverywhere(
  state: SessionState,
  kind: LineKind,
  text: string,
  time: number,
): SessionState {
  return state.windows.reduce(
    (acc, window) =>
      window.kind === "list" ? acc : addLine(acc, window.id, kind, text, time),
    state,
  );
}

export function rankOf(prefixes: string, support: ServerSupport): number {
  const first = prefixes[0];
  if (first === undefined) return support.prefixSymbols.length;
  const index = support.prefixSymbols.indexOf(first);
  return index === -1 ? support.prefixSymbols.length : index;
}

/** mIRC's nicklist order: ops, halfops, voices, then everyone, each alphabetical. */
export function sortMembers(
  members: readonly Member[],
  support: ServerSupport,
): Member[] {
  return [...members].sort(
    (a, b) =>
      rankOf(a.prefixes, support) - rankOf(b.prefixes, support) ||
      ircLower(a.nick).localeCompare(ircLower(b.nick)),
  );
}

/** Splits `@+nick` (multi-prefix) or `nick!user@host` (userhost-in-names) into a member. */
export function parseNamesEntry(entry: string, support: ServerSupport): Member {
  let index = 0;
  while (
    index < entry.length &&
    support.prefixSymbols.includes(entry[index] as string)
  )
    index += 1;
  const prefixes = orderPrefixes(entry.slice(0, index), support);
  const rest = entry.slice(index);
  const bang = rest.indexOf("!");
  return bang === -1
    ? { nick: rest, prefixes }
    : { nick: rest.slice(0, bang), prefixes, userhost: rest.slice(bang + 1) };
}

function orderPrefixes(prefixes: string, support: ServerSupport): string {
  return [...new Set(prefixes)]
    .sort(
      (a, b) =>
        support.prefixSymbols.indexOf(a) - support.prefixSymbols.indexOf(b),
    )
    .join("");
}

/** Shown in front of a nick in the nicklist and in `<@nick>` lines: the highest prefix held. */
export function displayPrefix(member: Member): string {
  return member.prefixes.slice(0, 1);
}

function setMembers(
  window: ChatWindow,
  members: Member[],
  support: ServerSupport,
) {
  return { ...window, members: sortMembers(members, support) };
}

function withMember(
  window: ChatWindow,
  member: Member,
  support: ServerSupport,
): ChatWindow {
  const rest = window.members.filter((m) => !ircEquals(m.nick, member.nick));
  return setMembers(window, [...rest, member], support);
}

function withoutMember(window: ChatWindow, nick: string): ChatWindow {
  return {
    ...window,
    members: window.members.filter((m) => !ircEquals(m.nick, nick)),
  };
}

export function parseISupport(
  support: ServerSupport,
  tokens: readonly string[],
): ServerSupport {
  let next = support;
  for (const token of tokens) {
    const eq = token.indexOf("=");
    const key = (eq === -1 ? token : token.slice(0, eq)).toUpperCase();
    const value = eq === -1 ? "" : token.slice(eq + 1);
    if (key === "PREFIX") {
      const match = /^\(([^)]*)\)(.*)$/.exec(value);
      if (match && match[1]?.length === match[2]?.length)
        next = {
          ...next,
          prefixModes: match[1] ?? "",
          prefixSymbols: match[2] ?? "",
        };
    } else if (key === "CHANTYPES" && value.length > 0)
      next = { ...next, chantypes: value };
    else if (key === "CHANMODES") {
      const [a = "", b = "", c = "", d = ""] = value.split(",");
      next = { ...next, chanmodes: [a, b, c, d] };
    } else if (key === "NETWORK" && value.length > 0)
      next = { ...next, network: value };
  }
  return next;
}

export type ModeChange = { adding: boolean; mode: string; param?: string };

/** Splits `+ov-k alice bob key` into one change per letter, giving each the parameter it takes. */
export function parseModeChanges(
  modes: string,
  params: readonly string[],
  support: ServerSupport,
): ModeChange[] {
  const changes: ModeChange[] = [];
  let adding = true;
  let next = 0;
  const [listModes, always, whenSet] = support.chanmodes;
  for (const mode of modes) {
    if (mode === "+" || mode === "-") {
      adding = mode === "+";
      continue;
    }
    const takesParam =
      support.prefixModes.includes(mode) ||
      listModes.includes(mode) ||
      always.includes(mode) ||
      (adding && whenSet.includes(mode));
    const change: ModeChange = { adding, mode };
    if (takesParam && next < params.length) change.param = params[next++];
    changes.push(change);
  }
  return changes;
}

function applyChannelModes(
  window: ChatWindow,
  changes: readonly ModeChange[],
  support: ServerSupport,
): ChatWindow {
  let modes = window.modes;
  let members = [...window.members];
  for (const change of changes) {
    const prefixIndex = support.prefixModes.indexOf(change.mode);
    if (prefixIndex !== -1 && change.param !== undefined) {
      const symbol = support.prefixSymbols[prefixIndex] as string;
      const target = change.param;
      members = members.map((member) => {
        if (!ircEquals(member.nick, target)) return member;
        const without = member.prefixes.replace(symbol, "");
        return {
          ...member,
          prefixes: change.adding
            ? orderPrefixes(without + symbol, support)
            : without,
        };
      });
      continue;
    }
    // List modes (bans, exceptions) are not channel state worth showing in the title.
    if (support.chanmodes[0].includes(change.mode)) continue;
    modes = change.adding
      ? modes.includes(change.mode)
        ? modes
        : modes + change.mode
      : modes.replace(change.mode, "");
  }
  return { ...window, modes, members: sortMembers(members, support) };
}

function messageTime(message: IrcMessage, now: number): number {
  const tag = message.tags.time;
  if (typeof tag !== "string") return now;
  const parsed = Date.parse(tag);
  return Number.isNaN(parsed) ? now : parsed;
}

function mentions(text: string, nick: string): boolean {
  if (nick.length === 0) return false;
  const plain = ircLower(stripFormatting(text));
  const target = ircLower(nick);
  let from = 0;
  for (;;) {
    const at = plain.indexOf(target, from);
    if (at === -1) return false;
    const before = plain[at - 1];
    const after = plain[at + target.length];
    const boundary = (char: string | undefined) =>
      char === undefined || !/[a-z0-9{}|^_\-`]/.test(char);
    if (boundary(before) && boundary(after)) return true;
    from = at + 1;
  }
}

function userhostOf(message: IrcMessage): string {
  const prefix = message.prefix;
  if (!prefix?.user && !prefix?.host) return "";
  return `${prefix.user ?? "*"}@${prefix.host ?? "*"}`;
}

/** The text of a numeric reply after our own nick, joined as the server meant it. */
function numericText(message: IrcMessage): string {
  return message.params.slice(1).join(" ");
}

function formatDuration(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}day${days === 1 ? "" : "s"}`);
  if (hours > 0) parts.push(`${hours}hr${hours === 1 ? "" : "s"}`);
  if (minutes > 0) parts.push(`${minutes}min${minutes === 1 ? "" : "s"}`);
  parts.push(`${secs}sec${secs === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** The next nick to try when ours is taken while registering: the alternative, then underscores, then Guest####. */
export function nextNickAttempt(
  state: SessionState,
  random: () => number,
): string {
  const attempt = state.nickAttempts;
  if (
    attempt === 0 &&
    state.altNick.length > 0 &&
    !ircEquals(state.altNick, state.nick)
  )
    return state.altNick;
  if (attempt < 3)
    return `${state.wantedNick.slice(0, 13)}${"_".repeat(attempt + 1)}`;
  return guestNick(random);
}

export function guestNick(random: () => number): string {
  return `Guest${String(Math.floor(random() * 10000)).padStart(4, "0")}`;
}

export const CTCP_VERSION_REPLY = "mIRC-style client for FuseOS (fusegames.ai)";

function onPrivmsg(
  state: SessionState,
  message: IrcMessage,
  now: number,
  notice: boolean,
): Reduction {
  const [target = "", text = ""] = message.params;
  const from = message.prefix?.nick ?? "";
  const time = messageTime(message, now);
  const ctcp = parseCtcp(text);
  const toChannel = isChannelName(target, state.support);
  const serverNotice = !message.prefix?.user && !message.prefix?.host;

  if (ctcp && ctcp.command !== "ACTION") {
    if (notice)
      return {
        state: addActiveLine(
          state,
          "ctcp",
          `[${from} ${ctcp.command} reply]: ${ctcp.args}`,
          time,
        ),
        send: [],
      };
    const shown = addLine(
      state,
      STATUS_ID,
      "ctcp",
      `[${from} ${ctcp.command}]${ctcp.args ? ` ${ctcp.args}` : ""}`,
      time,
    );
    const reply =
      ctcp.command === "VERSION"
        ? formatCtcp("VERSION", CTCP_VERSION_REPLY)
        : ctcp.command === "PING"
          ? formatCtcp("PING", ctcp.args)
          : ctcp.command === "TIME"
            ? formatCtcp("TIME", new Date(now).toString())
            : ctcp.command === "CLIENTINFO"
              ? formatCtcp("CLIENTINFO", "ACTION CLIENTINFO PING TIME VERSION")
              : undefined;
    // Never answer a channel-wide CTCP (it makes the whole channel flood the sender).
    return {
      state: shown,
      send: reply && !toChannel && from ? [line("NOTICE", from, reply)] : [],
    };
  }

  if (notice) {
    if (state.phase !== "online" || serverNotice || target === "*")
      return {
        state: addLine(state, STATUS_ID, "notice", `-${from}- ${text}`, time),
        send: [],
      };
    const windowId = toChannel ? channelId(target) : state.activeId;
    return {
      state: addLine(
        state,
        windowId,
        "notice",
        toChannel ? `-${from}:${target}- ${text}` : `-${from}- ${text}`,
        time,
      ),
      send: [],
    };
  }

  const body = ctcp ? ctcp.args : text;
  let next = state;
  let windowId: string;
  if (toChannel) windowId = channelId(target);
  else {
    // A private message opens (or reuses) a query window named after the sender.
    next = ensureWindow(next, "query", from);
    windowId = queryId(from);
  }
  const window = findWindow(next, windowId);
  const member = window?.members.find((m) => ircEquals(m.nick, from));
  const shownNick = `${member ? displayPrefix(member) : ""}${from}`;
  const highlight = !toChannel || mentions(body, state.nick);
  return {
    state: addLine(
      next,
      windowId,
      ctcp ? "action" : "text",
      ctcp ? `* ${from} ${body}` : `<${shownNick}> ${body}`,
      time,
      highlight,
    ),
    send: [],
  };
}

function onJoin(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const channel = message.params[0] ?? "";
  const nick = message.prefix?.nick ?? "";
  const time = messageTime(message, now);
  const id = channelId(channel);
  if (ircEquals(nick, state.nick)) {
    let next = ensureWindow(state, "channel", channel);
    next = updateWindow(next, id, (window) => ({
      ...window,
      name: channel,
      joined: true,
      members: [],
      topic: "",
      modes: "",
    }));
    next = activate(next, id);
    return addLine(next, id, "join", `* Now talking in ${channel}`, time);
  }
  const userhost = userhostOf(message);
  const member: Member = userhost
    ? { nick, prefixes: "", userhost }
    : { nick, prefixes: "" };
  const next = updateWindow(state, id, (window) =>
    withMember(window, member, state.support),
  );
  return addLine(
    next,
    id,
    "join",
    `* ${nick}${userhost ? ` (${userhost})` : ""} has joined ${channel}`,
    time,
  );
}

function onPart(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const [channel = "", reason] = message.params;
  const nick = message.prefix?.nick ?? "";
  const id = channelId(channel);
  const time = messageTime(message, now);
  const userhost = userhostOf(message);
  if (ircEquals(nick, state.nick)) {
    const next = updateWindow(state, id, (window) => ({
      ...window,
      joined: false,
      members: [],
    }));
    return addLine(next, id, "part", `* You have left ${channel}`, time);
  }
  const next = updateWindow(state, id, (window) => withoutMember(window, nick));
  return addLine(
    next,
    id,
    "part",
    `* ${nick}${userhost ? ` (${userhost})` : ""} has left ${channel}${reason ? ` (${reason})` : ""}`,
    time,
  );
}

function onQuit(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const nick = message.prefix?.nick ?? "";
  const reason = message.params[0] ?? "";
  const time = messageTime(message, now);
  const userhost = userhostOf(message);
  let next = state;
  for (const window of state.windows) {
    const present =
      (window.kind === "channel" &&
        window.members.some((m) => ircEquals(m.nick, nick))) ||
      (window.kind === "query" && ircEquals(window.name, nick));
    if (!present) continue;
    if (window.kind === "channel")
      next = updateWindow(next, window.id, (w) => withoutMember(w, nick));
    next = addLine(
      next,
      window.id,
      "quit",
      `* ${nick}${userhost ? ` (${userhost})` : ""} has quit IRC (${reason})`,
      time,
    );
  }
  return next;
}

function onNick(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const oldNick = message.prefix?.nick ?? "";
  const newNick = message.params[0] ?? "";
  const time = messageTime(message, now);
  const self = ircEquals(oldNick, state.nick);
  let next: SessionState = self ? { ...state, nick: newNick } : state;
  for (const window of state.windows) {
    const inChannel =
      window.kind === "channel" &&
      window.members.some((m) => ircEquals(m.nick, oldNick));
    const isQuery = window.kind === "query" && ircEquals(window.name, oldNick);
    if (!self && !inChannel && !isQuery) continue;
    if (window.kind === "status" && !self) continue;
    if (inChannel)
      next = updateWindow(next, window.id, (w) =>
        setMembers(
          w,
          w.members.map((m) =>
            ircEquals(m.nick, oldNick) ? { ...m, nick: newNick } : m,
          ),
          state.support,
        ),
      );
    if (isQuery) {
      const newId = queryId(newNick);
      next = {
        ...updateWindow(next, window.id, (w) => ({
          ...w,
          id: newId,
          name: newNick,
        })),
        activeId: next.activeId === window.id ? newId : next.activeId,
      };
    }
    if (window.kind === "list") continue;
    next = addLine(
      next,
      isQuery ? queryId(newNick) : window.id,
      "nick",
      self
        ? `* Your nick is now ${newNick}`
        : `* ${oldNick} is now known as ${newNick}`,
      time,
    );
  }
  return next;
}

function onKick(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const [channel = "", victim = "", reason = ""] = message.params;
  const by = message.prefix?.nick ?? "";
  const id = channelId(channel);
  const time = messageTime(message, now);
  if (ircEquals(victim, state.nick)) {
    const next = updateWindow(state, id, (window) => ({
      ...window,
      joined: false,
      members: [],
    }));
    return addLine(
      next,
      id,
      "kick",
      `* You were kicked from ${channel} by ${by} (${reason})`,
      time,
    );
  }
  const next = updateWindow(state, id, (window) =>
    withoutMember(window, victim),
  );
  return addLine(
    next,
    id,
    "kick",
    `* ${victim} was kicked by ${by} (${reason})`,
    time,
  );
}

function onMode(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const [target = "", modes = "", ...params] = message.params;
  const by = message.prefix?.nick ?? "";
  const time = messageTime(message, now);
  const text = [modes, ...params].join(" ");
  if (!isChannelName(target, state.support)) {
    // Our own user modes (+i, +w): tracked for the title, shown in Status.
    let userModes = state.userModes;
    let adding = true;
    for (const mode of modes) {
      if (mode === "+" || mode === "-") adding = mode === "+";
      else if (adding && !userModes.includes(mode)) userModes += mode;
      else if (!adding) userModes = userModes.replace(mode, "");
    }
    return addLine(
      { ...state, userModes },
      STATUS_ID,
      "mode",
      `* ${by} sets mode: ${text}`,
      time,
    );
  }
  const id = channelId(target);
  const changes = parseModeChanges(modes, params, state.support);
  const next = updateWindow(state, id, (window) =>
    applyChannelModes(window, changes, state.support),
  );
  return addLine(next, id, "mode", `* ${by} sets mode: ${text}`, time);
}

function onTopic(
  state: SessionState,
  message: IrcMessage,
  now: number,
): SessionState {
  const [channel = "", topic = ""] = message.params;
  const id = channelId(channel);
  const next = updateWindow(state, id, (window) => ({ ...window, topic }));
  return addLine(
    next,
    id,
    "topic",
    `* ${message.prefix?.nick ?? ""} changes topic to '${topic}'`,
    messageTime(message, now),
  );
}

function onCap(state: SessionState, message: IrcMessage): Reduction {
  const sub = (message.params[1] ?? "").toUpperCase();
  // `CAP * LS * :a b` continues; `CAP * LS :c d` is the last line.
  const more = message.params[2] === "*";
  const list = (message.params[more ? 3 : 2] ?? "")
    .split(" ")
    .filter((cap) => cap.length > 0)
    .map((cap) => cap.split("=")[0] as string);
  if (sub === "LS") {
    const offered = [...state.capsOffered, ...list];
    if (more) return { state: { ...state, capsOffered: offered }, send: [] };
    const wanted = WANTED_CAPS.filter((cap) => offered.includes(cap));
    return {
      state: { ...state, capsOffered: [] },
      send:
        wanted.length > 0 && state.phase === "registering"
          ? [line("CAP", "REQ", wanted.join(" "))]
          : state.phase === "registering"
            ? [line("CAP", "END")]
            : [],
    };
  }
  if (sub === "ACK" || sub === "NAK") {
    const caps =
      sub === "ACK"
        ? [
            ...new Set([
              ...state.caps,
              ...list.filter((c) => !c.startsWith("-")),
            ]),
          ]
        : state.caps;
    return {
      state: { ...state, caps },
      send: state.phase === "registering" ? [line("CAP", "END")] : [],
    };
  }
  return { state, send: [] };
}

function onNumeric(
  state: SessionState,
  message: IrcMessage,
  now: number,
  random: () => number,
): Reduction {
  const time = messageTime(message, now);
  const params = message.params;
  const text = numericText(message);
  const status = (kind: LineKind, value: string, s = state) =>
    addLine(s, STATUS_ID, kind, value, time);
  const active = (kind: LineKind, value: string, s = state) =>
    addActiveLine(s, kind, value, time);
  switch (message.command) {
    case "001": {
      const nick = params[0] ?? state.nick;
      return {
        state: status("info", params[1] ?? text, {
          ...state,
          phase: "online",
          nick,
          nickAttempts: 0,
        }),
        send: [],
      };
    }
    case "005": {
      const support = parseISupport(state.support, params.slice(1, -1));
      return { state: status("info", text, { ...state, support }), send: [] };
    }
    case "375":
    case "372":
    case "376":
      return { state: status("motd", params[1] ?? ""), send: [] };
    case "221":
      return {
        state: { ...state, userModes: (params[1] ?? "").replace(/^\+/, "") },
        send: [],
      };
    case "301": {
      const [, nick = "", reason = ""] = params;
      const window = findWindow(state, queryId(nick));
      return {
        state: addLine(
          state,
          window ? window.id : state.activeId,
          "whois",
          `${nick} is away: ${reason}`,
          time,
        ),
        send: [],
      };
    }
    case "305":
      return {
        state: active("info", `* ${params[1] ?? ""}`, {
          ...state,
          away: undefined,
        }),
        send: [],
      };
    case "306":
      return { state: active("info", `* ${params[1] ?? ""}`), send: [] };
    case "311": {
      const [, nick = "", user = "", host = "", , realname = ""] = params;
      return {
        state: active("whois", `${nick} is ${user}@${host} * ${realname}`),
        send: [],
      };
    }
    case "312": {
      const [, nick = "", server = "", info = ""] = params;
      return {
        state: active("whois", `${nick} using ${server} ${info}`),
        send: [],
      };
    }
    case "313":
    case "330":
    case "338":
    case "378":
    case "671":
      return { state: active("whois", params.slice(1).join(" ")), send: [] };
    case "317": {
      const [, nick = "", idle = "0", signon] = params;
      const since =
        signon && /^\d+$/.test(signon)
          ? `, signon: ${new Date(Number(signon) * 1000).toUTCString()}`
          : "";
      return {
        state: active(
          "whois",
          `${nick} has been idle ${formatDuration(Number(idle))}${since}`,
        ),
        send: [],
      };
    }
    case "318":
      return {
        state: active("whois", `${params[1] ?? ""} End of /WHOIS list.`),
        send: [],
      };
    case "319":
      return {
        state: active("whois", `${params[1] ?? ""} on ${params[2] ?? ""}`),
        send: [],
      };
    case "321": {
      const next = ensureWindow(
        { ...state, list: { entries: [], demo: false, complete: false } },
        "list",
        "Channels List",
      );
      return { state: next, send: [] };
    }
    case "322": {
      const [, channel = "", users = "0", topic = ""] = params;
      if (state.list.entries.length >= MAX_LIST_ENTRIES)
        return { state, send: [] };
      const next = ensureWindow(state, "list", "Channels List");
      return {
        state: {
          ...next,
          list: {
            ...next.list,
            demo: false,
            entries: [
              ...next.list.entries,
              { channel, users: Number(users) || 0, topic },
            ],
          },
        },
        send: [],
      };
    }
    case "323":
      return {
        state: { ...state, list: { ...state.list, complete: true } },
        send: [],
      };
    case "324": {
      const [, channel = "", modes = "", ...rest] = params;
      const id = channelId(channel);
      const changes = parseModeChanges(modes, rest, state.support);
      const next = updateWindow(state, id, (window) =>
        applyChannelModes({ ...window, modes: "" }, changes, state.support),
      );
      return { state: next, send: [] };
    }
    case "329":
      return { state, send: [] };
    case "331":
      return {
        state: addLine(
          state,
          channelId(params[1] ?? ""),
          "topic",
          "* No topic is set",
          time,
        ),
        send: [],
      };
    case "332": {
      const [, channel = "", topic = ""] = params;
      const id = channelId(channel);
      const next = updateWindow(state, id, (window) => ({ ...window, topic }));
      return {
        state: addLine(next, id, "topic", `* Topic is '${topic}'`, time),
        send: [],
      };
    }
    case "333": {
      const [, channel = "", setter = "", when] = params;
      const date =
        when && /^\d+$/.test(when)
          ? ` on ${new Date(Number(when) * 1000).toUTCString()}`
          : "";
      return {
        state: addLine(
          state,
          channelId(channel),
          "topic",
          `* Set by ${setter.split("!")[0] ?? setter}${date}`,
          time,
        ),
        send: [],
      };
    }
    case "353": {
      const channel = params[2] ?? "";
      const id = channelId(channel);
      const entries = (params[3] ?? "")
        .split(" ")
        .filter((entry) => entry.length > 0)
        .map((entry) => parseNamesEntry(entry, state.support));
      return {
        state: {
          ...state,
          pendingNames: {
            ...state.pendingNames,
            [id]: [...(state.pendingNames[id] ?? []), ...entries],
          },
        },
        send: [],
      };
    }
    case "366": {
      const id = channelId(params[1] ?? "");
      const pending = state.pendingNames[id];
      const { [id]: _done, ...rest } = state.pendingNames;
      const next = pending
        ? updateWindow(state, id, (window) =>
            setMembers(window, [...pending], state.support),
          )
        : state;
      return { state: { ...next, pendingNames: rest }, send: [] };
    }
    case "401":
    case "403":
    case "404":
    case "406":
    case "441":
    case "442":
    case "443":
    case "471":
    case "473":
    case "474":
    case "475":
    case "477":
    case "482":
      return {
        state: active("error", `* ${params.slice(1).join(" ")}`),
        send: [],
      };
    case "421":
      return {
        state: active("error", `* ${params[1] ?? ""}: Unknown command`),
        send: [],
      };
    case "432":
    case "433":
    case "436": {
      const taken = params[1] ?? "";
      if (state.phase === "registering") {
        const nick = nextNickAttempt(state, random);
        const next = status(
          "error",
          `* ${taken} ${params[2] ?? "Nickname is already in use"}, trying ${nick}`,
          {
            ...state,
            nick,
            nickAttempts: state.nickAttempts + 1,
          },
        );
        return { state: next, send: [line("NICK", nick)] };
      }
      return {
        state: active(
          "error",
          `* ${taken}: ${params[2] ?? "Nickname is already in use"}`,
        ),
        send: [],
      };
    }
    case "900":
    case "903":
      return {
        state: status("info", params[params.length - 1] ?? ""),
        send: [],
      };
    default: {
      // Errors (4xx/5xx) go where the user is looking; the rest of the welcome burst is Status.
      const code = Number(message.command);
      if (code >= 400 && code < 600)
        return { state: active("error", `* ${text}`), send: [] };
      return { state: status("info", text), send: [] };
    }
  }
}

/** Folds one server message into the session. `random` is only used to pick a Guest nick on a collision. */
export function receive(
  state: SessionState,
  message: IrcMessage,
  now: number,
  random: () => number,
): Reduction {
  const time = messageTime(message, now);
  switch (message.command) {
    case "PING":
      return { state, send: [line("PONG", ...message.params)] };
    case "PONG":
      return { state, send: [] };
    case "CAP":
      return onCap(state, message);
    case "PRIVMSG":
      return onPrivmsg(state, message, now, false);
    case "NOTICE":
      return onPrivmsg(state, message, now, true);
    case "JOIN":
      return { state: onJoin(state, message, now), send: [] };
    case "PART":
      return { state: onPart(state, message, now), send: [] };
    case "QUIT":
      return { state: onQuit(state, message, now), send: [] };
    case "NICK":
      return { state: onNick(state, message, now), send: [] };
    case "KICK":
      return { state: onKick(state, message, now), send: [] };
    case "MODE":
      return { state: onMode(state, message, now), send: [] };
    case "TOPIC":
      return { state: onTopic(state, message, now), send: [] };
    case "INVITE":
      return {
        state: addActiveLine(
          state,
          "invite",
          `* ${message.prefix?.nick ?? ""} invites you to join ${message.params[1] ?? ""}`,
          time,
        ),
        send: [],
      };
    case "AWAY":
      // away-notify: someone in a shared channel went away or came back; mIRC did not show these.
      return { state, send: [] };
    case "ERROR":
      return {
        state: addLine(
          state,
          STATUS_ID,
          "error",
          `* ${message.params[0] ?? "Closing link"}`,
          time,
        ),
        send: [],
      };
    default:
      if (/^\d{3}$/.test(message.command))
        return onNumeric(state, message, now, random);
      return { state, send: [] };
  }
}
