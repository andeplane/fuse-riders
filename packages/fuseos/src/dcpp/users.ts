import { GiB, MiB } from "./format";
import type { Hub } from "./hubs";
import type { Random } from "./rng";
import { pick, randomInt } from "./rng";

export type Connection =
  | "28.8Kbps"
  | "56Kbps"
  | "ISDN"
  | "Satellite"
  | "DSL"
  | "Cable"
  | "LAN(T1)"
  | "LAN(T3)";

export type HubUser = {
  nick: string;
  shared: number;
  description: string;
  /** The client tag, e.g. "<++ V:0.401,M:A,H:1/0/0,S:3>"; empty for clients that send none. */
  tag: string;
  connection: Connection;
  email: string;
  op: boolean;
  /** Passive mode (M:P): DC++ drew these users with a greyed icon. */
  passive: boolean;
  /** Free upload slots / total, for search results. */
  slots: { free: number; total: number };
};

const PREFIXES = [
  "",
  "",
  "",
  "[DSL]",
  "[NL]",
  "[SE]",
  "[DE]",
  "[UK]",
  "[NO]",
  "[FR]",
  "[PL]",
  "[2MBIT]",
] as const;

const NAMES = [
  "Neo_1999",
  "DarkAngel",
  "xXSniperXx",
  "mp3_junkie",
  "Kenshin",
  "DivX_Daddy",
  "slackware_guy",
  "BassHunter",
  "Lain",
  "Spike_Spiegel",
  "the_dude",
  "pixelpusher",
  "lurker42",
  "Gollum",
  "c0d3r",
  "blackmesa",
  "Trinity",
  "rave_on",
  "modem_mike",
  "SubZero",
  "frodo_lives",
  "nerdboy",
  "Vinyl_Junkie",
  "elite_leech",
  "Shinji",
  "cowboy_bebop",
  "Mandrake9",
  "fragmaster",
  "tetris_god",
  "MissMP3",
  "z0mbie",
  "Dj_Tiesto_Fan",
  "LANparty",
  "q3a_fragger",
  "radioactive",
  "s3cr3t",
  "Bjarne",
  "Ola_Nordmann",
  "kaffekopp",
  "snorre",
] as const;

const DESCRIPTIONS = [
  "",
  "",
  "",
  "no msgs please",
  "slots for friends only",
  "all my divx",
  "anime fansubs + OSTs",
  "real men share 100GB",
  "dont ask for slots",
  "at work, slow",
  "lots of mp3",
  "uploading 24/7",
  "Visit my homepage on geocities!",
  "on vacation",
  "1337",
] as const;

const CONNECTIONS = [
  "56Kbps",
  "DSL",
  "DSL",
  "Cable",
  "Cable",
  "Cable",
  "LAN(T1)",
  "LAN(T3)",
  "ISDN",
  "Satellite",
  "28.8Kbps",
] as const satisfies readonly Connection[];

const DOMAINS = [
  "hotmail.com",
  "yahoo.com",
  "lycos.com",
  "netscape.net",
  "gmx.de",
  "online.no",
] as const;

type Client = { tag: (mode: "A" | "P", hubs: string, slots: number) => string };

const CLIENTS: readonly [Client, ...Client[]] = [
  { tag: (m, h, s) => `<++ V:0.401,M:${m},H:${h},S:${s}>` },
  { tag: (m, h, s) => `<++ V:0.401,M:${m},H:${h},S:${s}>` },
  { tag: (m, h, s) => `<++ V:0.4034,M:${m},H:${h},S:${s}>` },
  { tag: (m, h, s) => `<++ V:0.306,M:${m},H:${h},S:${s}>` },
  { tag: (m, h, s) => `<DCGUI V:0.3.3,M:${m},H:${h},S:${s}>` },
  { tag: (m, h, s) => `<oDC V:5.20,M:${m},H:${h},S:${s}>` },
  { tag: (m, h, s) => `<++ V:0.4032,M:${m},H:${h},S:${s},L:15>` },
  { tag: () => "" },
];

/** The "H:normal/registered/op" hub counts of a period tag. */
function hubCounts(random: Random): string {
  return `${randomInt(random, 1, 6)}/${randomInt(random, 0, 2)}/${randomInt(random, 0, 1)}`;
}

function sharedFor(random: Random, hub: Hub): number {
  // Somewhere above the minimum (most people sat just over it), with the odd giant.
  const floor = Math.max(hub.minShare, 200 * MiB);
  const giant = random() < 0.08;
  const factor = giant ? 8 + random() * 30 : 1 + random() * 2.5;
  return Math.round(floor * factor + random() * 3 * GiB);
}

/**
 * A hub's user list: the hub bot and the op first (both with keys), then `count` invented regulars.
 * Nicks are unique within the hub; the same seed gives the same people.
 */
export function generateUsers(
  random: Random,
  hub: Hub,
  count: number,
): HubUser[] {
  const users: HubUser[] = [
    {
      nick: hub.bot,
      shared: 0,
      description: "Hub bot",
      tag: "",
      connection: "LAN(T3)",
      email: "",
      op: true,
      passive: false,
      slots: { free: 0, total: 0 },
    },
    {
      nick: hub.op,
      shared: sharedFor(random, hub),
      description: "Operator. PM me with problems",
      tag: `<++ V:0.401,M:A,H:1/0/3,S:5>`,
      connection: "LAN(T1)",
      email: "",
      op: true,
      passive: false,
      slots: { free: 2, total: 5 },
    },
  ];
  const taken = new Set(users.map((user) => user.nick));
  let guard = 0;
  while (users.length < count + 2 && guard < count * 20) {
    guard += 1;
    const base = pick(random, NAMES);
    const nick = `${pick(random, PREFIXES)}${base}${random() < 0.25 ? randomInt(random, 1, 99) : ""}`;
    if (taken.has(nick)) continue;
    taken.add(nick);
    const passive = random() < 0.2;
    const total = randomInt(random, 1, 6);
    users.push({
      nick,
      shared: sharedFor(random, hub),
      description: pick(random, DESCRIPTIONS),
      tag: pick(random, CLIENTS).tag(
        passive ? "P" : "A",
        hubCounts(random),
        total,
      ),
      connection: pick(random, CONNECTIONS),
      email:
        random() < 0.3
          ? `${base.toLowerCase().replace(/[^a-z0-9]/g, "")}@${pick(random, DOMAINS)}`
          : "",
      op: false,
      passive,
      slots: { free: random() < 0.6 ? 0 : randomInt(random, 0, total), total },
    });
  }
  return users;
}

/** The "Nick" column order DC++ used: ops first, then everyone, each alphabetically, case-insensitive. */
export function sortUsers(users: readonly HubUser[]): HubUser[] {
  return [...users].sort((a, b) =>
    a.op === b.op
      ? a.nick.toLowerCase().localeCompare(b.nick.toLowerCase())
      : a.op
        ? -1
        : 1,
  );
}

/** You, as the user list showed you to everyone else. */
export function selfUser(nick: string, shared: number): HubUser {
  return {
    nick,
    shared,
    description: "",
    tag: "<++ V:0.401,M:A,H:1/0/0,S:3>",
    connection: "DSL",
    email: "",
    op: false,
    passive: false,
    slots: { free: 3, total: 3 },
  };
}
