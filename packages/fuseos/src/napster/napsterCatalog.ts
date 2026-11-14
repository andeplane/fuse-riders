import { SONG_TABLE } from "./napsterSongs";

/**
 * Everything the fake Napster network "knows": the songs its imaginary users share, the users themselves, the
 * chat rooms and the chatter. Plain data, no React. Song titles and artists are real turn-of-the-millennium
 * releases (that is the joke); nothing here is audio, and nothing is ever fetched. Every username is invented.
 */

/** One song as the network knows it; lengths are seconds. */
export type CatalogSong = {
  artist: string;
  title: string;
  length: number;
};

/** "Artist|Title|m:ss" lines (`napsterSongs.ts`) as songs. */
export function parseSongTable(table: string): CatalogSong[] {
  return table
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [artist = "", title = "", time = "0:00"] = line.split("|");
      const [minutes = "0", seconds = "0"] = time.split(":");
      return {
        artist,
        title,
        length: Number(minutes) * 60 + Number(seconds),
      };
    });
}

export const CATALOG: readonly CatalogSong[] = parseSongTable(SONG_TABLE);

/** The username every search result, transfer and chat line uses for "you". */
export const OWN_USERNAME = "fuse_rider98";

/** The hand-picked regulars: Hot List friends and the chat room's loudest. */
export const REGULARS: readonly string[] = [
  "xXdarkangelXx",
  "phatbeatz2000",
  "skaterboi_99",
  "mp3_overlord",
  "dialup_dan",
  "sk8rgrl2k",
  "the_real_dj_toast",
  "lanparty_larry",
  "cdburner_v2",
  "winamp_whipz",
  "bitrate_betty",
  "modem_screech",
  "y2k_survivor",
  "frosted_tips_77",
  "geocities_gary",
  "leet_h4x0r",
  "trancegod_99",
  "nu_metal_nick",
  "dorm_server_3",
  "kazaa_karen",
  "ripped_by_ripper",
  "boyband_fan4ever",
  "napster_ninja",
  "goth_kitty_xx",
  "subwoofer_sam",
  "flannel_phil",
  "dsl_dave",
  "t1_tina",
];

const HANDLE_STARTS = [
  "dark",
  "phat",
  "sk8",
  "mp3",
  "cyber",
  "techno",
  "punk",
  "emo",
  "rave",
  "metal",
  "funky",
  "lazy",
  "crazy",
  "lil",
  "big",
  "mad",
  "silent",
  "evil",
  "happy",
  "j00",
  "neo",
  "matrix",
  "pixel",
  "sonic",
  "turbo",
  "mega",
  "ultra",
  "hyper",
  "jungle",
  "acid",
  "disco",
  "grunge",
  "ska",
  "dub",
  "bass",
];

const HANDLE_ENDS = [
  "angel",
  "boy",
  "grrl",
  "dude",
  "master",
  "lord",
  "king",
  "queen",
  "ninja",
  "monkey",
  "kitten",
  "dragon",
  "wizard",
  "rider",
  "surfer",
  "hacker",
  "freak",
  "junkie",
  "head",
  "rat",
  "fiend",
  "fan",
  "kid",
];

const HANDLE_TAILS = [
  "",
  "",
  "",
  "99",
  "2000",
  "2k",
  "_v2",
  "01",
  "_x",
  "xx",
  "1984",
  "77",
  "_uk",
  "_ca",
  "4life",
];

/**
 * Every handle on the fake network: the regulars plus a few hundred made from the parts people glued together in
 * 2000 ("darkangel99", "sk8rkid_x"). Invented, deterministic, and nobody's real name.
 */
export const FAKE_USERS: readonly string[] = [
  ...REGULARS,
  ...HANDLE_STARTS.flatMap((start, index) =>
    HANDLE_ENDS.filter((_, end) => (end + index) % 3 === 0).map(
      (end, at) =>
        `${start}${end}${HANDLE_TAILS[(index * 7 + at * 5) % HANDLE_TAILS.length] ?? ""}`,
    ),
  ),
];

/** The line speeds the 2000 client knew, slowest first; the dot colour follows from it. */
export const LINE_SPEEDS = [
  "Unknown",
  "14.4",
  "28.8",
  "33.6",
  "56K",
  "64K ISDN",
  "128K ISDN",
  "Cable",
  "DSL",
  "T1",
  "T3+",
] as const;

export type LineSpeed = (typeof LINE_SPEEDS)[number];

/** The bitrates real rips came in; 128 most of all. */
export const BITRATES = [
  64, 96, 112, 128, 128, 128, 128, 128, 128, 128, 160, 160, 192, 256, 320,
];

export const SAMPLE_RATES = [44100, 44100, 44100, 44100, 22050, 48000];

/**
 * The famous fake: a "leaked live track" that is really the band telling you off. Searching any of these
 * words alongside Metallica surfaces it near the top.
 */
export const METALLICA_DECOY = {
  filename: "Metallica - I Disappear (live).mp3",
  warningTitle: "Metallica",
  warning:
    "This is not the song. This file was shared to remind you that downloading a band's music without paying for it hurts the band.",
} as const;

/** Chat rooms on the server's channel list, with a rough head count each. */
export const CHAT_ROOMS: readonly { name: string; topic: string }[] = [
  { name: "#napster", topic: "Welcome to Napster! Be nice. No spam." },
  { name: "#alternative", topic: "flannel is not dead" },
  { name: "#hiphop", topic: "Westside. Eastside. Dialup side." },
  { name: "#electronica", topic: "unce unce unce" },
  { name: "#metal", topic: "turn it up. no fakes." },
  { name: "#pop", topic: "Britney vs Christina: the eternal debate" },
  { name: "#help", topic: "Firewalled? Read the FAQ before asking." },
];

/** What strangers say in a room, in the voice of a 2000 chat room. `{user}` is another user, `{song}` a song. */
export const CHAT_LINES: readonly string[] = [
  "anyone got {song}??",
  "a/s/l",
  "lol",
  "my download keeps saying Remotely Queued >:(",
  "who is sharing {song} at 160 or better",
  "{user} ur upload is so slow",
  "brb mom needs the phone line",
  "DONT download that metallica live track its a fake",
  "napster is the best thing ever invented",
  "my cdburner made a coaster again",
  "anyone want to trade? i have 4000 songs",
  "{user}: thx for {song}!!",
  "is the server down or is it just me",
  "56k ppl dont download from me pls",
  "how do i unfirewall",
  "y does everything sound like a robot at 64kbps",
  "heard theyre gonna shut us down lol never gonna happen",
  "just got a CABLE modem!!! 30k/s baby",
  "{user} add me to ur hot list",
  "anyone else on a LAN at college",
  "Transfer Error! again. classic",
  "who else is listening in winamp",
  "{song} is my jam",
  ":)",
  "rofl",
  "bbl",
];
