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

export const CATALOG: readonly CatalogSong[] = [
  { artist: "Metallica", title: "Enter Sandman", length: 331 },
  { artist: "Metallica", title: "Nothing Else Matters", length: 388 },
  { artist: "Metallica", title: "Master of Puppets", length: 515 },
  { artist: "Metallica", title: "Fuel", length: 269 },
  { artist: "Dr. Dre", title: "Still D.R.E.", length: 270 },
  { artist: "Dr. Dre", title: "Forgot About Dre", length: 222 },
  { artist: "Eminem", title: "My Name Is", length: 268 },
  { artist: "Eminem", title: "The Real Slim Shady", length: 284 },
  { artist: "Eminem", title: "Stan", length: 404 },
  { artist: "Blink-182", title: "All the Small Things", length: 168 },
  { artist: "Blink-182", title: "What's My Age Again", length: 148 },
  { artist: "Limp Bizkit", title: "Rollin'", length: 213 },
  { artist: "Limp Bizkit", title: "Nookie", length: 289 },
  { artist: "Britney Spears", title: "...Baby One More Time", length: 211 },
  { artist: "Britney Spears", title: "Oops!... I Did It Again", length: 211 },
  { artist: "NSYNC", title: "Bye Bye Bye", length: 200 },
  { artist: "Backstreet Boys", title: "I Want It That Way", length: 213 },
  { artist: "Christina Aguilera", title: "Genie in a Bottle", length: 217 },
  { artist: "Santana", title: "Smooth", length: 295 },
  { artist: "Red Hot Chili Peppers", title: "Californication", length: 321 },
  { artist: "Red Hot Chili Peppers", title: "Scar Tissue", length: 215 },
  { artist: "Radiohead", title: "Karma Police", length: 264 },
  { artist: "Radiohead", title: "Paranoid Android", length: 383 },
  { artist: "Radiohead", title: "Idioteque", length: 309 },
  { artist: "Moby", title: "Porcelain", length: 241 },
  { artist: "Moby", title: "Natural Blues", length: 252 },
  { artist: "Eiffel 65", title: "Blue (Da Ba Dee)", length: 284 },
  { artist: "Darude", title: "Sandstorm", length: 225 },
  { artist: "Daft Punk", title: "One More Time", length: 320 },
  { artist: "Daft Punk", title: "Around the World", length: 429 },
  {
    artist: "The Offspring",
    title: "Pretty Fly (For a White Guy)",
    length: 188,
  },
  { artist: "Smash Mouth", title: "All Star", length: 200 },
  { artist: "Sugar Ray", title: "Every Morning", length: 219 },
  { artist: "Lou Bega", title: "Mambo No. 5", length: 220 },
  { artist: "Ricky Martin", title: "Livin' la Vida Loca", length: 243 },
  { artist: "Destiny's Child", title: "Say My Name", length: 271 },
  { artist: "TLC", title: "No Scrubs", length: 214 },
  { artist: "Coldplay", title: "Yellow", length: 269 },
  { artist: "Coldplay", title: "Trouble", length: 273 },
  { artist: "Creed", title: "Higher", length: 316 },
  { artist: "Creed", title: "With Arms Wide Open", length: 274 },
  { artist: "Matchbox Twenty", title: "Bent", length: 256 },
  { artist: "Third Eye Blind", title: "Semi-Charmed Life", length: 268 },
  { artist: "Everclear", title: "Father of Mine", length: 233 },
  { artist: "Vertical Horizon", title: "Everything You Want", length: 241 },
  { artist: "Fatboy Slim", title: "Praise You", length: 323 },
  { artist: "Fatboy Slim", title: "The Rockafeller Skank", length: 401 },
  { artist: "The Prodigy", title: "Firestarter", length: 280 },
  { artist: "Beastie Boys", title: "Intergalactic", length: 231 },
  { artist: "Rage Against the Machine", title: "Guerrilla Radio", length: 206 },
  { artist: "Korn", title: "Freak on a Leash", length: 255 },
  { artist: "Godsmack", title: "Voodoo", length: 280 },
  { artist: "Papa Roach", title: "Last Resort", length: 199 },
  { artist: "Linkin Park", title: "One Step Closer", length: 155 },
  { artist: "Linkin Park", title: "In the End", length: 216 },
  {
    artist: "Green Day",
    title: "Good Riddance (Time of Your Life)",
    length: 153,
  },
  { artist: "Weezer", title: "Buddy Holly", length: 159 },
  { artist: "Nirvana", title: "Smells Like Teen Spirit", length: 301 },
  { artist: "Foo Fighters", title: "Learn to Fly", length: 238 },
  { artist: "Bloodhound Gang", title: "The Bad Touch", length: 260 },
  { artist: "Chumbawamba", title: "Tubthumping", length: 278 },
  { artist: "Semisonic", title: "Closing Time", length: 273 },
  { artist: "Savage Garden", title: "Truly Madly Deeply", length: 278 },
  { artist: "Madonna", title: "Ray of Light", length: 321 },
  { artist: "Madonna", title: "Music", length: 225 },
  { artist: "Cher", title: "Believe", length: 239 },
  { artist: "Will Smith", title: "Gettin' Jiggy wit It", length: 228 },
  { artist: "Outkast", title: "Ms. Jackson", length: 270 },
  { artist: "Wu-Tang Clan", title: "C.R.E.A.M.", length: 252 },
  { artist: "Notorious B.I.G.", title: "Hypnotize", length: 229 },
  { artist: "2Pac", title: "California Love", length: 285 },
  { artist: "Coolio", title: "Gangsta's Paradise", length: 240 },
  { artist: "Aqua", title: "Barbie Girl", length: 197 },
  { artist: "Vengaboys", title: "We Like to Party", length: 223 },
  { artist: "ATB", title: "9 PM (Till I Come)", length: 196 },
  { artist: "Sonique", title: "It Feels So Good", length: 238 },
  { artist: "Shaggy", title: "It Wasn't Me", length: 227 },
  { artist: "U2", title: "Beautiful Day", length: 246 },
  { artist: "Oasis", title: "Wonderwall", length: 258 },
  { artist: "Oasis", title: "Don't Look Back in Anger", length: 288 },
  { artist: "Blur", title: "Song 2", length: 122 },
  { artist: "The Verve", title: "Bitter Sweet Symphony", length: 358 },
  { artist: "Garbage", title: "Only Happy When It Rains", length: 236 },
  { artist: "No Doubt", title: "Don't Speak", length: 263 },
  { artist: "Alanis Morissette", title: "Ironic", length: 229 },
  { artist: "Hanson", title: "MMMBop", length: 268 },
  { artist: "Spice Girls", title: "Wannabe", length: 173 },
  { artist: "Celine Dion", title: "My Heart Will Go On", length: 280 },
  { artist: "Madison Avenue", title: "Don't Call Me Baby", length: 230 },
  { artist: "Modjo", title: "Lady (Hear Me Tonight)", length: 307 },
  { artist: "Mr. Oizo", title: "Flat Beat", length: 228 },
  { artist: "Bomfunk MC's", title: "Freestyler", length: 306 },
  { artist: "Alice Deejay", title: "Better Off Alone", length: 214 },
];

/** The username every search result, transfer and chat line uses for "you". */
export const OWN_USERNAME = "fuse_rider98";

/**
 * Invented handles in the style of the time. None is a real person's; "_v2" and "2k" suffixes because the
 * good name was always taken.
 */
export const FAKE_USERS: readonly string[] = [
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
