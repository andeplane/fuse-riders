import type { Scheduler, TimerHandle } from "../irc/client";
import { ircEquals, ircLower } from "../irc/casemap";
import { BOLD, colorize } from "../irc/format";
import { line, parseCtcp, parseMessage } from "../irc/message";
import { demoChannelList } from "../irc/networks";
import type {
  IrcConnection,
  IrcTransport,
  TransportHandlers,
} from "../irc/transport";

import type { ChatTurn, RegularsBrain } from "./brain";
import {
  CCBS_SOURCE,
  describe,
  findTournament,
  latest,
  playerRecord,
  podium,
  ranked,
  seasons,
} from "./ccbs";
import type { Regular } from "./regulars";
import {
  DDR_CHANNEL,
  DDR_TOPIC,
  findRegular,
  REGULARS,
  regularsIn,
} from "./regulars";

/**
 * A pretend IRC server that runs in the page: FuseOS has no IRC backend, and browsers cannot reach the real
 * networks, so "connecting" lands here. It speaks the same protocol as a real server (registration, MOTD, JOIN
 * and NAMES, PRIVMSG, WHOIS, LIST, PING) so the client is the real one, and its regulars answer through
 * `RegularsBrain` (the shared language model, or canned lines).
 */
export type SimDeps = {
  scheduler: Scheduler;
  now: () => number;
  random: () => number;
  brain: RegularsBrain;
};

type SimChannel = {
  name: string;
  topic: string;
  topicBy: string;
  members: Map<string, { nick: string; prefix: string }>;
  history: ChatTurn[];
};

/** How long a regular "types" before a line appears, and the gap between idle chatter. */
export const TYPING_MS = { min: 1500, max: 4000 } as const;
export const IDLE_MS = { min: 45_000, max: 110_000 } as const;
export const COOLDOWN_MS = 6000;
const HISTORY = 10;

function between(
  range: { min: number; max: number },
  random: () => number,
): number {
  return Math.round(range.min + random() * (range.max - range.min));
}

export function simHost(networkId: string): string {
  return networkId.length > 0 ? `irc.${networkId}.sim` : "irc.fuseos.sim";
}

export class SimServer {
  private nick = "*";
  private user = "user";
  private registered = false;
  private away: string | undefined;
  private readonly channels = new Map<string, SimChannel>();
  private readonly timers = new Set<TimerHandle>();
  private readonly abort = new AbortController();
  private lastSpoke = new Map<string, number>();
  private idleTimer: TimerHandle | undefined;
  private stopped = false;

  constructor(
    private readonly deps: SimDeps,
    private readonly network: { id: string; name: string },
    private readonly emit: (text: string) => void,
    private readonly hangUp: (reason: string) => void,
  ) {
    const channelNames = new Set(REGULARS.flatMap((r) => r.channels));
    for (const name of channelNames) {
      const listed = demoChannelList().find((entry) =>
        ircEquals(entry.channel, name),
      );
      const channel: SimChannel = {
        name,
        topic: ircEquals(name, DDR_CHANNEL) ? DDR_TOPIC : (listed?.topic ?? ""),
        topicBy: ircEquals(name, DDR_CHANNEL) ? "RiChY" : "Op_Bot",
        members: new Map(),
        history: [],
      };
      for (const regular of regularsIn(name))
        channel.members.set(ircLower(regular.nick), {
          nick: regular.nick,
          prefix: regular.prefix,
        });
      this.channels.set(ircLower(name), channel);
    }
  }

  private get host(): string {
    return simHost(this.network.id);
  }

  private send(text: string) {
    if (!this.stopped) this.emit(text);
  }

  private numeric(code: string, ...params: string[]) {
    this.send(`:${this.host} ${line(code, this.nick, ...params)}`);
  }

  private later(ms: number, run: () => void) {
    const handle = this.deps.scheduler.setTimeout(() => {
      this.timers.delete(handle);
      if (!this.stopped) run();
    }, ms);
    this.timers.add(handle);
  }

  private prefixOf(regular: Regular): string {
    return `${regular.nick}!${regular.user}@${regular.host}`;
  }

  private get selfPrefix(): string {
    return `${this.nick}!${this.user}@fuseos.browser`;
  }

  stop() {
    this.stopped = true;
    this.abort.abort();
    for (const handle of this.timers) this.deps.scheduler.clearTimeout(handle);
    this.timers.clear();
  }

  /** A line from the client. */
  receive(text: string) {
    const message = parseMessage(text);
    if (!message || this.stopped) return;
    const [first = "", second = ""] = message.params;
    switch (message.command) {
      case "CAP":
        if (first.toUpperCase() === "LS")
          this.send(`:${this.host} CAP * LS :multi-prefix`);
        else if (first.toUpperCase() === "REQ")
          this.send(`:${this.host} CAP * ACK :${second}`);
        return;
      case "NICK":
        this.onNick(first);
        return;
      case "USER":
        this.user = first.replace(/[^A-Za-z0-9]/g, "").slice(0, 10) || "user";
        this.maybeWelcome();
        return;
      case "PING":
        this.send(`:${this.host} PONG ${this.host} :${first}`);
        return;
      case "PONG":
        return;
      case "QUIT":
        this.send(
          `ERROR :Closing Link: ${this.nick}[fuseos.browser] (Quit: ${first})`,
        );
        this.stop();
        this.hangUp("Quit");
        return;
    }
    if (!this.registered) {
      this.numeric("451", "You have not registered");
      return;
    }
    switch (message.command) {
      case "JOIN":
        for (const name of first.split(",")) this.onJoin(name);
        return;
      case "PART":
        for (const name of first.split(",")) this.onPart(name, second);
        return;
      case "PRIVMSG":
        this.onPrivmsg(first, second);
        return;
      case "NOTICE":
        return;
      case "TOPIC":
        this.onTopic(first, message.params.length > 1 ? second : undefined);
        return;
      case "MODE":
        this.onMode(first, message.params.slice(1));
        return;
      case "WHOIS":
        this.onWhois(message.params.at(-1) ?? first);
        return;
      case "LIST":
        this.onList();
        return;
      case "NAMES":
        this.names(first);
        return;
      case "AWAY":
        this.away = first.length > 0 ? first : undefined;
        if (this.away)
          this.numeric("306", "You have been marked as being away");
        else this.numeric("305", "You are no longer marked as being away");
        return;
      case "MOTD":
        this.motd();
        return;
      default:
        this.numeric("421", message.command, "Unknown command");
    }
  }

  private onNick(wanted: string) {
    if (!/^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,29}$/.test(wanted)) {
      this.numeric("432", wanted, "Erroneous Nickname");
      return;
    }
    if (findRegular(wanted)) {
      this.numeric("433", wanted, "Nickname is already in use.");
      return;
    }
    const old = this.selfPrefix;
    const wasRegistered = this.registered;
    for (const channel of this.channels.values()) {
      const member = channel.members.get(ircLower(this.nick));
      if (!member) continue;
      channel.members.delete(ircLower(this.nick));
      channel.members.set(ircLower(wanted), { ...member, nick: wanted });
    }
    this.nick = wanted;
    if (wasRegistered) this.send(`:${old} NICK :${wanted}`);
    else this.maybeWelcome();
  }

  private maybeWelcome() {
    if (this.registered || this.nick === "*" || this.user === "user") return;
    this.registered = true;
    const host = this.host;
    this.numeric(
      "001",
      `Welcome to the ${this.network.name} IRC Network ${this.selfPrefix}`,
    );
    this.numeric(
      "002",
      `Your host is ${host}, running version fuseos-ircd-1.0`,
    );
    this.numeric(
      "003",
      "This server was created Sat Sep 1 2001 at 12:00:00 CET",
    );
    this.numeric("004", host, "fuseos-ircd-1.0", "iowx", "biklmnopstv");
    this.numeric(
      "005",
      "PREFIX=(ov)@+",
      "CHANTYPES=#&",
      "CHANMODES=b,k,l,imnpst",
      `NETWORK=${this.network.name.replace(/\s+/g, "")}`,
      "are supported by this server",
    );
    this.numeric(
      "251",
      `There are ${REGULARS.length + 1} users and 4321 invisible on 12 servers`,
    );
    this.numeric("254", String(this.channels.size), "channels formed");
    this.motd();
    this.send(`:${this.nick} MODE ${this.nick} :+i`);
  }

  private motd() {
    const lines = [
      `- ${this.host} Message of the Day -`,
      `- ${colorize("Welcome to", 2)} ${BOLD}${this.network.name}${BOLD} ${colorize("(simulated)", 4)}`,
      "-",
      "- This network runs inside FuseOS, in your browser. Web pages cannot open",
      "- IRC connections and FuseOS has no IRC server, so the people here are",
      "- simulated: the regulars talk through the same language model as Clippy",
      "- (or canned lines when your browser can't run it). Nothing you type leaves",
      "- this page.",
      "-",
      `- ${colorize("Try:", 3)} /join ${DDR_CHANNEL}  - Norwegian DDR, results from CCBS (!ccbs)`,
      "-      /list   /whois RiChY   /msg Andeplane hei",
      "-",
      `- Regulars are thinking with: ${this.deps.brain.describe()}`,
    ];
    this.numeric("375", lines[0] ?? "");
    for (const text of lines.slice(1)) this.numeric("372", text);
    this.numeric("376", "End of /MOTD command.");
  }

  private channel(name: string): SimChannel | undefined {
    return this.channels.get(ircLower(name));
  }

  private onJoin(name: string) {
    if (!/^[#&][^\s,\x07]{1,49}$/.test(name)) {
      this.numeric("403", name, "No such channel");
      return;
    }
    let channel = this.channel(name);
    if (!channel) {
      channel = {
        name,
        topic: "",
        topicBy: "",
        members: new Map(),
        history: [],
      };
      this.channels.set(ircLower(name), channel);
    }
    if (channel.members.has(ircLower(this.nick))) return;
    // The first one into an empty channel gets ops, as on a real network.
    channel.members.set(ircLower(this.nick), {
      nick: this.nick,
      prefix: channel.members.size === 0 ? "@" : "",
    });
    this.send(`:${this.selfPrefix} JOIN :${channel.name}`);
    if (channel.topic) {
      this.numeric("332", channel.name, channel.topic);
      this.numeric("333", channel.name, channel.topicBy, "1099000000");
    }
    this.names(channel.name);
    if (ircEquals(channel.name, DDR_CHANNEL)) this.greet(channel);
    this.scheduleIdle();
  }

  private names(name: string) {
    const channel = this.channel(name);
    if (channel) {
      const entries = [...channel.members.values()].map(
        (m) => `${m.prefix}${m.nick}`,
      );
      this.numeric("353", "=", channel.name, entries.join(" "));
    }
    this.numeric("366", name, "End of /NAMES list.");
  }

  private onPart(name: string, reason: string) {
    const channel = this.channel(name);
    if (!channel?.members.has(ircLower(this.nick))) {
      this.numeric("442", name, "You're not on that channel");
      return;
    }
    channel.members.delete(ircLower(this.nick));
    this.send(
      `:${this.selfPrefix} PART ${channel.name}${reason ? ` :${reason}` : ""}`,
    );
  }

  private onTopic(name: string, topic: string | undefined) {
    const channel = this.channel(name);
    if (!channel) {
      this.numeric("403", name, "No such channel");
      return;
    }
    if (topic === undefined) {
      if (channel.topic) this.numeric("332", channel.name, channel.topic);
      else this.numeric("331", channel.name, "No topic is set.");
      return;
    }
    if (channel.members.get(ircLower(this.nick))?.prefix !== "@") {
      this.numeric("482", channel.name, "You're not channel operator");
      return;
    }
    channel.topic = topic;
    channel.topicBy = this.nick;
    this.send(`:${this.selfPrefix} TOPIC ${channel.name} :${topic}`);
  }

  private onMode(target: string, changes: readonly string[]) {
    const channel = this.channel(target);
    if (!channel) {
      if (ircEquals(target, this.nick)) this.numeric("221", "+i");
      else this.numeric("403", target, "No such channel");
      return;
    }
    if (changes.length === 0) {
      this.numeric("324", channel.name, "+nt");
      return;
    }
    this.numeric("482", channel.name, "You're not channel operator");
  }

  private onWhois(nick: string) {
    const regular = findRegular(nick);
    if (ircEquals(nick, this.nick)) {
      this.numeric(
        "311",
        this.nick,
        this.user,
        "fuseos.browser",
        "*",
        "FuseOS user",
      );
      this.numeric("312", this.nick, this.host, "FuseOS simulated server");
    } else if (regular) {
      this.numeric(
        "311",
        regular.nick,
        regular.user,
        regular.host,
        "*",
        regular.realName,
      );
      const channels = regular.channels
        .map((c) => `${regular.prefix}${c}`)
        .join(" ");
      this.numeric("319", regular.nick, channels);
      this.numeric("312", regular.nick, this.host, "FuseOS simulated server");
      if (regular.away) this.numeric("301", regular.nick, regular.away);
      this.numeric(
        "317",
        regular.nick,
        String(Math.floor(this.deps.random() * 900)),
        "1099000000",
        "seconds idle, signon time",
      );
    } else {
      this.numeric("401", nick, "No such nick/channel");
    }
    this.numeric("318", nick, "End of /WHOIS list.");
  }

  private onList() {
    this.numeric("321", "Channel", "Users  Name");
    for (const channel of this.channels.values())
      this.numeric(
        "322",
        channel.name,
        String(channel.members.size),
        channel.topic,
      );
    for (const entry of demoChannelList())
      if (!this.channel(entry.channel))
        this.numeric("322", entry.channel, String(entry.users), entry.topic);
    this.numeric("323", "End of /LIST");
  }

  private say(regular: Regular, target: string, text: string) {
    this.send(`:${this.prefixOf(regular)} PRIVMSG ${target} :${text}`);
    const channel = this.channel(target);
    if (channel) this.remember(channel, regular.nick, text);
    this.lastSpoke.set(regular.nick, this.deps.now());
  }

  private remember(channel: SimChannel, nick: string, text: string) {
    channel.history.push({ nick, text });
    if (channel.history.length > HISTORY)
      channel.history.splice(0, channel.history.length - HISTORY);
  }

  private greet(channel: SimChannel) {
    const ccbs = findRegular("CCBSbot");
    const last = latest();
    if (ccbs && last)
      this.later(800, () =>
        this.send(
          `:${this.prefixOf(ccbs)} NOTICE ${this.nick} :Velkommen til ${channel.name}! Siste turnering: ${describe(last)}. Skriv !ccbs for kommandoer.`,
        ),
      );
    const greeter = findRegular("RiChY");
    if (greeter)
      this.later(between(TYPING_MS, this.deps.random) + 1500, () =>
        this.say(greeter, channel.name, `hei ${this.nick} :)`),
      );
  }

  private onPrivmsg(target: string, text: string) {
    const ctcp = parseCtcp(text);
    if (ctcp && ctcp.command !== "ACTION") {
      const regular = findRegular(target);
      if (regular && ctcp.command === "VERSION")
        this.later(600, () =>
          this.send(
            `:${this.prefixOf(regular)} NOTICE ${this.nick} :\x01VERSION mIRC v6.03 (simulated)\x01`,
          ),
        );
      return;
    }
    const body = ctcp ? `* ${this.nick} ${ctcp.args}` : text;
    const channel = this.channel(target);
    if (channel) {
      if (!channel.members.has(ircLower(this.nick))) {
        this.numeric("404", channel.name, "Cannot send to channel");
        return;
      }
      this.remember(channel, this.nick, body);
      if (text.startsWith("!") && channel.members.has("ccbsbot"))
        this.ccbs(channel.name, text);
      else this.reactInChannel(channel, body);
      return;
    }
    const regular = findRegular(target);
    if (!regular) {
      this.numeric("401", target, "No such nick/channel");
      return;
    }
    if (regular.nick === "CCBSbot") {
      this.ccbs(this.nick, text.startsWith("!") ? text : `!${text}`);
      return;
    }
    if (regular.away) {
      this.numeric("301", regular.nick, regular.away);
    }
    this.reply(regular, this.nick, [{ nick: this.nick, text: body }]);
  }

  private reactInChannel(channel: SimChannel, text: string) {
    const present = [...channel.members.values()]
      .map((member) => findRegular(member.nick))
      .filter(
        (regular): regular is Regular =>
          regular !== undefined && regular.lines.length > 0,
      );
    if (present.length === 0) return;
    const lower = text.toLowerCase();
    const mentioned = present.find((regular) =>
      lower.includes(regular.nick.toLowerCase()),
    );
    const now = this.deps.now();
    const rested = present.filter(
      (r) => now - (this.lastSpoke.get(r.nick) ?? -Infinity) > COOLDOWN_MS,
    );
    const speaker =
      mentioned ??
      (this.deps.random() < 0.6 && rested.length > 0
        ? rested[Math.floor(this.deps.random() * rested.length)]
        : undefined);
    if (speaker) this.reply(speaker, channel.name, channel.history);
  }

  private reply(
    regular: Regular,
    target: string,
    history: readonly ChatTurn[],
  ) {
    const started = this.deps.now();
    void this.deps.brain
      .reply(
        {
          regular,
          channel: target,
          userNick: this.nick,
          history: [...history],
        },
        this.abort.signal,
      )
      .then((text) => {
        if (!text || this.stopped) return;
        const waited = this.deps.now() - started;
        this.later(
          Math.max(0, between(TYPING_MS, this.deps.random) - waited),
          () => this.say(regular, target, text),
        );
      });
  }

  private scheduleIdle() {
    if (this.idleTimer) return;
    const handle = this.deps.scheduler.setTimeout(
      () => {
        this.timers.delete(handle);
        this.idleTimer = undefined;
        if (this.stopped) return;
        const channel = this.channel(DDR_CHANNEL);
        if (channel?.members.has(ircLower(this.nick))) {
          const idlers = regularsIn(DDR_CHANNEL).filter(
            (r) => r.lines.length > 0,
          );
          const regular =
            idlers[Math.floor(this.deps.random() * idlers.length)];
          const text =
            regular?.lines[
              Math.floor(this.deps.random() * regular.lines.length)
            ];
          if (regular && text) this.say(regular, channel.name, text);
        }
        this.scheduleIdle();
      },
      between(IDLE_MS, this.deps.random),
    );
    this.idleTimer = handle;
    this.timers.add(handle);
  }

  /** CCBSbot's commands: results from ccbs.sesse.net, cited, never voiced. */
  private ccbs(target: string, text: string) {
    const bot = findRegular("CCBSbot");
    if (!bot) return;
    const [command = "", ...rest] = text.trim().split(/\s+/);
    const arg = rest.join(" ");
    const out: string[] = [];
    switch (command.toLowerCase()) {
      case "!siste":
      case "!last": {
        const last = latest();
        if (last) out.push(`${BOLD}${describe(last)}${BOLD}`, podium(last, 3));
        break;
      }
      case "!turnering":
      case "!t":
      case "!tournament": {
        const found = arg ? findTournament(arg) : undefined;
        if (found)
          out.push(`${BOLD}${describe(found)}${BOLD}`, podium(found, 5));
        else
          out.push(
            `Fant ingen turnering for "${arg}". Prøv f.eks. !t cc 3 2004, !t reunion, !t nm05 single`,
          );
        break;
      }
      case "!spiller":
      case "!player": {
        const record = arg ? playerRecord(arg) : undefined;
        if (record) {
          const best = record.best
            ? ` Best: ${record.best.rank}. plass, ${record.best.tournament.name} (${record.best.tournament.date}).`
            : "";
          out.push(
            `${record.name}: ${record.events} rangerte turneringer, ${record.wins} seier(e), ${record.podiums} pallplass(er).${best}`,
          );
        } else out.push(`Fant ingen spiller "${arg}" i resultatlistene.`);
        break;
      }
      case "!sesonger":
      case "!seasons":
        out.push(`Sesonger: ${seasons().join(", ")}`);
        break;
      case "!vinnere":
      case "!winners": {
        const season = arg.toLowerCase();
        const events = ranked().filter(
          (t) => season.length > 0 && t.season.toLowerCase().includes(season),
        );
        if (events.length === 0)
          out.push(
            "Bruk: !vinnere <sesong>, f.eks. !vinnere challenge cup 2003",
          );
        else
          out.push(
            events.map((t) => `${t.name}: ${t.top[0]?.[0] ?? "?"}`).join(" | "),
          );
        break;
      }
      case "!ccbs":
      case "!help":
        out.push(
          "Kommandoer: !siste, !t <turnering>, !spiller <nick>, !sesonger, !vinnere <sesong>",
          `Kilde: ${CCBS_SOURCE}`,
        );
        break;
      default:
        return;
    }
    out.forEach((text, index) =>
      this.later(400 + index * 300, () =>
        this.say(bot, target, colorize(text, index === 0 ? 2 : 1)),
      ),
    );
  }
}

/**
 * The transport for the simulated networks: each connection is a fresh `SimServer`. Lines travel through a
 * zero-delay timer in both directions, like a socket, so the client never re-enters itself.
 */
export function createSimTransport(
  deps: SimDeps,
  networkFor: (url: string) => { id: string; name: string },
): IrcTransport {
  return {
    connect(url: string, handlers: TransportHandlers): IrcConnection {
      const network = networkFor(url);
      let open = true;
      const inbox: string[] = [];
      let flushing = false;
      const flush = () => {
        flushing = false;
        while (open && inbox.length > 0)
          handlers.onLine(inbox.shift() as string);
      };
      const deliver = (text: string) => {
        if (!open) return;
        inbox.push(text);
        if (flushing) return;
        flushing = true;
        deps.scheduler.setTimeout(flush, 0);
      };
      const close = (reason: string) => {
        if (!open) return;
        open = false;
        server.stop();
        handlers.onClose(reason);
      };
      const server: SimServer = new SimServer(
        deps,
        network,
        deliver,
        (reason) => deps.scheduler.setTimeout(() => close(reason), 0),
      );
      deps.scheduler.setTimeout(() => {
        if (!open) return;
        handlers.onOpen();
        deliver(
          `:${simHost(network.id)} NOTICE * :*** Looking up your hostname...`,
        );
        deliver(
          `:${simHost(network.id)} NOTICE * :*** Found your hostname (fuseos.browser)`,
        );
      }, 300);
      return {
        send: (text) => {
          if (open) server.receive(text);
        },
        close: () => close("Disconnected"),
      };
    },
  };
}
