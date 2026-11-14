import { GiB, MiB, TiB } from "./format";

/**
 * How a fake hub treats you once you are in:
 * - `share-check`: the hub bot warns when your share is under `minShare` and kicks you 30 s later
 *   unless you share enough in time (FuseHub, the [EU] hub).
 * - `fake-share`: the share check passes, then an op "browses" your file list and kicks you for a fake
 *   share, because a git repository is not what anyone came for.
 * - `full`: the hub is full and redirects you to `redirectTo`.
 * - `open`: no rules at all.
 */
export type HubRule = "share-check" | "fake-share" | "full" | "open";

export type Hub = {
  name: string;
  description: string;
  /** "dchub://host:port" without the scheme, as the Public Hubs list showed it. */
  address: string;
  users: number;
  /** Total shared, in bytes, as the hublist reported it. */
  shared: number;
  /** Minimum share in bytes; 0 for none. */
  minShare: number;
  rule: HubRule;
  /** The bot that talks for the hub (MOTD, share checks, kicks). */
  bot: string;
  /** The op who does the kicking for `fake-share`, and sits in the user list with a key. */
  op: string;
  motd: readonly string[];
  /** Where a full hub sends you: another hub's address. */
  redirectTo?: string;
  /** Not on the public list (only reached by a redirect). */
  unlisted?: boolean;
};

export const FUSEHUB = "fusehub.no-ip.org:411";
export const LINUX_HUB = "linuxiso.dyndns.org:411";
export const LINUX_HUB_2 = "linuxiso2.dyndns.org:4111";

/** Every hub this pretend network knows. None of them exist; the addresses are invented. */
export const HUBS: readonly Hub[] = [
  {
    name: "[EU] Movies & Music 100GB+ min share",
    description: "DivX, MP3, VCD. 100 GB min share, 3 slots min. No passive users! No fakers!",
    address: "eu-movies.myftp.org:411",
    users: 1873,
    shared: 412 * TiB,
    minShare: 100 * GiB,
    rule: "share-check",
    bot: "[BOT]Hub-Security",
    op: "[OP]Morpheus",
    motd: [
      "Welcome to [EU] Movies & Music, running YnHub 1.033",
      "RULES: 100 GB minimum share. 3 slots minimum. No passive mode. No incomplete files.",
      "Your tag is checked on login. Fakers get a 24 h ban.",
      "Visit our forum at www.eu-movies-hub.tk for the hub list and FAQ!",
    ],
  },
  {
    name: "Anime Planet",
    description: "Fansubs, OSTs and AMVs. 5 GB min. Be nice, no hentai in main chat",
    address: "animeplanet.dns2go.com:411",
    users: 642,
    shared: 61 * TiB,
    minShare: 5 * GiB,
    rule: "share-check",
    bot: "Anime-Bot",
    op: "[OP]Sakura",
    motd: [
      "Konnichiwa and welcome to Anime Planet!",
      "Min share 5 GB of anime/OST/manga. Releases from #animeplanet on EFnet.",
      "Fansubs only, no licensed R1 DVDs please.",
    ],
  },
  {
    name: "Linux ISO Lovers",
    description: "Distros, source tarballs and kernel trees. Debian, Slackware, Mandrake, RedHat 9",
    address: LINUX_HUB,
    users: 500,
    shared: 18 * TiB,
    minShare: 1 * GiB,
    rule: "full",
    bot: "Tux",
    op: "[OP]penguin",
    motd: ["Welcome to Linux ISO Lovers."],
    redirectTo: LINUX_HUB_2,
  },
  {
    name: "Linux ISO Lovers #2",
    description: "Overflow hub for Linux ISO Lovers. No min share",
    address: LINUX_HUB_2,
    users: 37,
    shared: 2 * TiB,
    minShare: 0,
    rule: "open",
    bot: "Tux2",
    op: "[OP]penguin",
    motd: [
      "Welcome to Linux ISO Lovers #2, the overflow hub.",
      "Yes, they really are Linux ISOs. Seed what you leech.",
    ],
    unlisted: true,
  },
  {
    name: "Retro Gaming Vault",
    description: "ROMs? Never heard of it. Homebrew, demos and abandonware. 256 MB min",
    address: "retrovault.servegame.com:411",
    users: 211,
    shared: 9 * TiB,
    minShare: 256 * MiB,
    rule: "fake-share",
    bot: "VaultKeeper",
    op: "[OP]Bitmaster",
    motd: [
      "Welcome to the Retro Gaming Vault!",
      "Min share 256 MB. Ops check file lists. Fake shares are kicked on sight.",
    ],
  },
  {
    name: "FuseHub — Fuse Games fans",
    description: "Fuse Riders, Fuseball and the soundtrack. 512 MB min share",
    address: FUSEHUB,
    users: 58,
    shared: 740 * GiB,
    minShare: 512 * MiB,
    rule: "share-check",
    bot: "FuseBot",
    op: "[OP]fuse_admin",
    motd: [
      "Welcome to FuseHub, home of the Fuse Games fans!",
      "Minimum share 512 MB. Share your C:\\ like everyone else, we won't tell.",
      "FuseBot shares the official soundtrack in 'Fuse Radio'. Slots are free for hub members.",
      "Type +help for bot commands. Play at fusegames.ai!",
    ],
  },
  {
    name: "DSL Kings",
    description: "Cable & DSL only. No modems. 20 GB min share, 4 slots",
    address: "dslkings.ath.cx:411",
    users: 925,
    shared: 98 * TiB,
    minShare: 20 * GiB,
    rule: "share-check",
    bot: "[BOT]KingBot",
    op: "[OP]Bandwidth",
    motd: ["DSL Kings: if you are on a modem, turn back now."],
  },
  {
    name: "Chill Out Lounge",
    description: "Ambient, trance, downtempo. Friendly chat, no min share",
    address: "chilllounge.homeip.net:411",
    users: 143,
    shared: 6 * TiB,
    minShare: 0,
    rule: "open",
    bot: "Lounge-Bot",
    op: "[OP]Mellow",
    motd: ["Welcome to the Chill Out Lounge. Kick back and relax."],
  },
];

export function findHub(
  hubs: readonly Hub[],
  address: string,
): Hub | undefined {
  return hubs.find((hub) => hub.address === address);
}

/** What the Public Hubs list shows: every hub not hidden behind a redirect. */
export function publicHubs(hubs: readonly Hub[]): Hub[] {
  return hubs.filter((hub) => !hub.unlisted);
}

/** Case-insensitive match on name, description and address (the Filter box). */
export function filterHubs(hubs: readonly Hub[], filter: string): Hub[] {
  const needle = filter.trim().toLowerCase();
  if (!needle) return [...hubs];
  return hubs.filter((hub) =>
    `${hub.name} ${hub.description} ${hub.address}`
      .toLowerCase()
      .includes(needle),
  );
}
