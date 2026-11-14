/**
 * What the user typed in a window's editbox, as an action for the client: plain text is said to the
 * window's channel or query, `/command args` is one of mIRC's aliases, `//` escapes a leading slash, and
 * an unknown `/command` goes to the server as typed (mIRC's behaviour, so /mode, /invite, /oper work).
 */

export type InputContext = {
  kind: "status" | "channel" | "query" | "list";
  /** The channel or the query's nick; empty in Status. */
  name: string;
};

export type InputAction =
  | { type: "say"; target: string; text: string }
  | { type: "action"; target: string; text: string }
  | { type: "msg"; target: string; text: string }
  | { type: "notice"; target: string; text: string }
  | { type: "query"; nick: string; text?: string }
  | { type: "ctcp"; target: string; command: string; args: string }
  | { type: "join"; channel: string; key?: string }
  | { type: "part"; channel: string; reason?: string }
  | { type: "hop"; channel: string }
  | { type: "nick"; nick: string }
  | { type: "whois"; nick: string }
  | { type: "quit"; reason?: string }
  | { type: "server"; network?: string }
  | { type: "disconnect" }
  | { type: "list" }
  | { type: "clear" }
  | { type: "close" }
  | { type: "away"; message?: string }
  | { type: "topic"; channel: string; topic?: string }
  | { type: "raw"; line: string }
  | { type: "help" }
  | { type: "error"; text: string };

function needs(command: string): InputAction {
  return { type: "error", text: `* /${command}: insufficient parameters` };
}

/** `"nick some text"` into `["nick", "some text"]`, keeping the text's own spacing. */
function splitFirst(value: string): [string, string] {
  const space = value.indexOf(" ");
  return space === -1
    ? [value, ""]
    : [value.slice(0, space), value.slice(space + 1)];
}

function rest(words: readonly string[], from: number): string {
  return words.slice(from).join(" ");
}

/** The channel a command applies to: its first argument when that names a channel, else the window's. */
function channelArg(
  args: readonly string[],
  context: InputContext,
): { channel: string; used: boolean } | undefined {
  const first = args[0];
  if (first !== undefined && /^[#&!+]/.test(first))
    return { channel: first, used: true };
  if (context.kind === "channel") return { channel: context.name, used: false };
  return undefined;
}

export function parseInput(
  raw: string,
  context: InputContext,
): InputAction | undefined {
  const text = raw.replace(/[\r\n]+/g, " ");
  if (text.trim().length === 0) return undefined;
  if (!text.startsWith("/")) {
    if (context.kind === "channel" || context.kind === "query")
      return { type: "say", target: context.name, text };
    return {
      type: "error",
      text: "* You're not on a channel. Type /join #channel to join one.",
    };
  }
  // `//cmd` was mIRC's "evaluate identifiers" form; with no scripting here it is just `/cmd`.
  const words = text.replace(/^\/+/, "").split(" ");
  const command = (words[0] ?? "").toLowerCase();
  const args = words.slice(1).filter((word) => word.length > 0);
  const argText = rest(words, 1).replace(/^ +/, "");
  switch (command) {
    case "me":
    case "action":
      if (context.kind !== "channel" && context.kind !== "query")
        return { type: "error", text: "* /me: not on a channel or in a query" };
      if (argText.length === 0) return needs(command);
      return { type: "action", target: context.name, text: argText };
    case "msg":
    case "privmsg":
    case "m": {
      const [target, body] = splitFirst(argText);
      if (target.length === 0 || body.length === 0) return needs("msg");
      return { type: "msg", target, text: body };
    }
    case "notice": {
      const [target, body] = splitFirst(argText);
      if (target.length === 0 || body.length === 0) return needs(command);
      return { type: "notice", target, text: body };
    }
    case "query":
    case "q": {
      const nick = args[0];
      if (nick === undefined) return needs("query");
      const body = rest(args, 1);
      return body.length > 0
        ? { type: "query", nick, text: body }
        : { type: "query", nick };
    }
    case "ctcp": {
      const [target, ctcpCommand] = args;
      if (target === undefined || ctcpCommand === undefined)
        return needs(command);
      return {
        type: "ctcp",
        target,
        command: ctcpCommand.toUpperCase(),
        args: rest(args, 2),
      };
    }
    case "join":
    case "j": {
      const channel = args[0];
      if (channel === undefined) return needs("join");
      const name = /^[#&!+]/.test(channel) ? channel : `#${channel}`;
      return args[1] === undefined
        ? { type: "join", channel: name }
        : { type: "join", channel: name, key: args[1] };
    }
    case "part":
    case "leave": {
      const target = channelArg(args, context);
      if (!target) return needs("part");
      const reason = rest(args, target.used ? 1 : 0);
      return reason.length > 0
        ? { type: "part", channel: target.channel, reason }
        : { type: "part", channel: target.channel };
    }
    case "hop": {
      if (context.kind !== "channel") return needs(command);
      return { type: "hop", channel: context.name };
    }
    case "nick":
      if (args[0] === undefined) return needs(command);
      return { type: "nick", nick: args[0] };
    case "whois":
    case "wi":
      if (args[0] === undefined) {
        if (context.kind === "query")
          return { type: "whois", nick: context.name };
        return needs("whois");
      }
      return { type: "whois", nick: args[0] };
    case "quit":
    case "exit":
      return argText.length > 0
        ? { type: "quit", reason: argText }
        : { type: "quit" };
    case "server":
    case "connect":
      return args[0] === undefined
        ? { type: "server" }
        : { type: "server", network: args[0] };
    case "disconnect":
      return { type: "disconnect" };
    case "list":
      return { type: "list" };
    case "clear":
    case "cls":
      return { type: "clear" };
    case "close":
      return { type: "close" };
    case "away":
      return argText.length > 0
        ? { type: "away", message: argText }
        : { type: "away" };
    case "back":
      return { type: "away" };
    case "topic": {
      const target = channelArg(args, context);
      if (!target) return needs(command);
      const topic = rest(args, target.used ? 1 : 0);
      return topic.length > 0
        ? { type: "topic", channel: target.channel, topic }
        : { type: "topic", channel: target.channel };
    }
    case "op":
    case "deop":
    case "voice":
    case "devoice": {
      if (context.kind !== "channel" || args.length === 0)
        return needs(command);
      const sign = command.startsWith("de") ? "-" : "+";
      const letter = command.endsWith("op") ? "o" : "v";
      return {
        type: "raw",
        line: `MODE ${context.name} ${sign}${letter.repeat(args.length)} ${args.join(" ")}`,
      };
    }
    case "kick": {
      const target = channelArg(args, context);
      const victims = target ? args.slice(target.used ? 1 : 0) : [];
      const victim = victims[0];
      if (!target || victim === undefined) return needs(command);
      const reason = rest(victims, 1);
      return {
        type: "raw",
        line: `KICK ${target.channel} ${victim} :${reason || victim}`,
      };
    }
    case "raw":
    case "quote":
      if (argText.length === 0) return needs(command);
      return { type: "raw", line: argText };
    case "help":
      return { type: "help" };
    case "":
      return undefined;
    default:
      return {
        type: "raw",
        line: `${command.toUpperCase()}${argText ? ` ${argText}` : ""}`,
      };
  }
}

/** The command help shown for /help: what this client understands. */
export const HELP_LINES: readonly string[] = [
  "Commands:",
  "  /server [network]   connect (no name: the network picked in Options)",
  "  /join #channel      /part [#channel] [reason]   /hop",
  "  /msg nick text      /query nick   /notice nick text",
  "  /me action          /nick newnick   /whois nick",
  "  /topic [text]       /op /deop /voice /devoice nick   /kick nick [reason]",
  "  /away [message]     /back   /list   /clear   /close",
  "  /ctcp nick VERSION  /quit [message]   /raw LINE",
  "Ctrl+B bold, Ctrl+K colour, Ctrl+U underline, Ctrl+R reverse, Ctrl+O plain.",
];
