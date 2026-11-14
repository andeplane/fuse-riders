/**
 * The pretend Napster network: searches, browsing a user's library and the network-wide totals, all made up from
 * the catalogue with an injected random source. Nothing here connects anywhere or touches audio; the same seed
 * gives the same results, which is what the tests lean on.
 */
import type { FuseTrack } from "../winamp/fuseTracks";
import { FUSE_TRACKS, fuseTrackArtist } from "../winamp/fuseTracks";

import type { CatalogSong, LineSpeed } from "./napsterCatalog";
import {
  BITRATES,
  CATALOG,
  FAKE_USERS,
  LINE_SPEEDS,
  METALLICA_DECOY,
  SAMPLE_RATES,
} from "./napsterCatalog";

/** A number in [0, 1); `Math.random` in production, seeded in tests. */
export type Random = () => number;

export type Comparison = "at least" | "equal to" | "at best";

export type NumericFilter = { comparison: Comparison; value: number };

/** The Advanced search filters; an absent one means "any". Line speed compares by its place in `LINE_SPEEDS`. */
export type SearchFilters = {
  bitrate?: NumericFilter;
  frequency?: NumericFilter;
  lineSpeed?: { comparison: Comparison; value: LineSpeed };
  ping?: NumericFilter;
};

export type SearchQuery = {
  artist: string;
  title: string;
  maxResults: number;
  filters: SearchFilters;
};

/** What a download of the result really is: a catalogue song, the Metallica decoy, or a Fuse soundtrack file. */
export type ResultSource =
  | { kind: "song"; song: CatalogSong }
  | { kind: "decoy" }
  | { kind: "fuse"; trackId: string };

export type SearchResult = {
  id: string;
  filename: string;
  /** Bytes. */
  filesize: number;
  bitrate: number;
  frequency: number;
  /** Seconds. */
  length: number;
  user: string;
  lineSpeed: LineSpeed;
  /** Milliseconds; undefined is the client's "N/A" (the host never answered the ping). */
  ping: number | undefined;
  source: ResultSource;
};

/** The totals the status bar shows: "1,328,754 files (5,512 GB) available in 4,287 libraries". */
export type NetworkStats = {
  files: number;
  gigabytes: number;
  libraries: number;
};

export function pick<T>(items: readonly T[], random: Random): T {
  const item = items[Math.floor(random() * items.length)];
  if (item === undefined) throw new Error("pick from an empty list");
  return item;
}

function between(min: number, max: number, random: Random): number {
  return min + Math.floor(random() * (max - min + 1));
}

/** Where a line speed sits on the client's traffic-light scale. */
export type SpeedClass = "fast" | "medium" | "slow";

export function speedClass(speed: LineSpeed): SpeedClass {
  const rank = LINE_SPEEDS.indexOf(speed);
  if (rank >= LINE_SPEEDS.indexOf("Cable")) return "fast";
  if (rank >= LINE_SPEEDS.indexOf("56K")) return "medium";
  return "slow";
}

/** A believable spread: lots of 56K, a fair amount of cable and DSL, a lucky few on a university T1. */
const SPEED_WEIGHTS: readonly LineSpeed[] = [
  "Unknown",
  "28.8",
  "33.6",
  "56K",
  "56K",
  "56K",
  "56K",
  "64K ISDN",
  "128K ISDN",
  "Cable",
  "Cable",
  "Cable",
  "DSL",
  "DSL",
  "T1",
  "T1",
  "T3+",
];

function pingFor(speed: LineSpeed, random: Random): number | undefined {
  if (random() < 0.08) return undefined;
  switch (speedClass(speed)) {
    case "fast":
      return between(15, 160, random);
    case "medium":
      return between(140, 420, random);
    case "slow":
      return between(380, 990, random);
  }
}

const FOLDERS = [
  "",
  "",
  "",
  "C:\\My Music\\",
  "C:\\My Documents\\My Music\\",
  "D:\\mp3\\",
  "C:\\WINDOWS\\Desktop\\New Folder\\",
  "E:\\stuff\\MUSIC\\",
  "C:\\Program Files\\Napster\\",
];

/** The many ways one song was named by the people who ripped it. */
export function chaoticFilename(song: CatalogSong, random: Random): string {
  const { artist, title } = song;
  const variants = [
    `${artist} - ${title}.mp3`,
    `${artist} - ${title}.mp3`,
    `${artist.toLowerCase()} - ${title.toLowerCase()}.mp3`,
    `${title} - ${artist}.mp3`,
    `${artist.replace(/ /g, "_")}_-_${title.replace(/ /g, "_")}.mp3`,
    `${String(between(1, 14, random)).padStart(2, "0")} - ${title}.mp3`,
    `${title}.mp3`,
    `${artist} - ${title} (live).mp3`,
    `${artist} - ${title} (remix).mp3`,
    `${artist} - ${title} [radio edit].mp3`,
    `${artist.toUpperCase()} - ${title.toUpperCase()}.MP3`,
    `${artist}-${title}-ripped by ${pick(FAKE_USERS, random)}.mp3`,
  ];
  return `${pick(FOLDERS, random)}${pick(variants, random)}`;
}

/** How a Fuse soundtrack file turns up on other people's drives. */
export function fuseFilename(track: FuseTrack, random: Random): string {
  const artist = fuseTrackArtist(track);
  const slug = track.title.toLowerCase().replace(/ /g, "_");
  const variants = [
    `${artist} - ${track.title}.mp3`,
    `${artist} - ${track.title} (DJ ${pick(FAKE_USERS, random)} remix).mp3`,
    `${slug}_FINAL_v2.mp3`,
    `${track.title} [320kbps REAL].mp3`,
    `Track ${String(between(1, 20, random)).padStart(2, "0")}.mp3`,
    `${artist} - ${track.title} (radio edit).mp3`,
    `${track.title} - ${artist} (NOT FAKE!!!).mp3`,
  ];
  return `${pick(FOLDERS, random)}${pick(variants, random)}`;
}

function bytesFor(bitrate: number, seconds: number, random: Random): number {
  // A little ID3 and padding noise so equal songs do not share a size.
  return Math.round((bitrate * 1000 * seconds) / 8) + between(0, 4096, random);
}

function result(
  id: string,
  filename: string,
  length: number,
  source: ResultSource,
  random: Random,
): SearchResult {
  const bitrate = pick(BITRATES, random);
  const lineSpeed = pick(SPEED_WEIGHTS, random);
  return {
    id,
    filename,
    filesize: bytesFor(bitrate, length, random),
    bitrate,
    frequency: pick(SAMPLE_RATES, random),
    length,
    user: pick(FAKE_USERS, random),
    lineSpeed,
    ping: pingFor(lineSpeed, random),
    source,
  };
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((word) => word.length > 0);
}

function matches(haystack: string, needle: readonly string[]): boolean {
  const lower = haystack.toLowerCase();
  return needle.every((word) => lower.includes(word));
}

function compare(actual: number, filter: NumericFilter | undefined): boolean {
  if (!filter) return true;
  switch (filter.comparison) {
    case "at least":
      return actual >= filter.value;
    case "equal to":
      return actual === filter.value;
    case "at best":
      return actual <= filter.value;
  }
}

/** Whether a result passes the Advanced filters. An unanswered ping passes only a filter that is not set. */
export function passesFilters(
  item: SearchResult,
  filters: SearchFilters,
): boolean {
  const speed = filters.lineSpeed;
  return (
    compare(item.bitrate, filters.bitrate) &&
    compare(item.frequency, filters.frequency) &&
    (speed === undefined ||
      compare(LINE_SPEEDS.indexOf(item.lineSpeed), {
        comparison: speed.comparison,
        value: LINE_SPEEDS.indexOf(speed.value),
      })) &&
    (filters.ping === undefined ||
      (item.ping !== undefined && compare(item.ping, filters.ping)))
  );
}

/** Whether the query is empty: Napster refused to search for nothing. */
export function isBlankQuery(query: Pick<SearchQuery, "artist" | "title">) {
  return words(query.artist).length === 0 && words(query.title).length === 0;
}

/**
 * A search across "the network": each matching catalogue song shared by several imaginary users under its
 * many names, the Fuse soundtrack for anything that names it (or "fuse"), and, for Metallica, the decoy near
 * the top. A query nothing knows still finds a few files named after what was typed, because someone always
 * had it. Results come back in the order hosts answered, filtered, at most `maxResults`.
 */
export function searchNetwork(
  query: SearchQuery,
  random: Random,
): SearchResult[] {
  const artistWords = words(query.artist);
  const titleWords = words(query.title);
  if (artistWords.length === 0 && titleWords.length === 0) return [];
  const results: SearchResult[] = [];
  let next = 0;
  const nextId = () => `r${(next += 1)}`;

  const songs = CATALOG.filter(
    (song) =>
      matches(song.artist, artistWords) && matches(song.title, titleWords),
  );
  if (artistWords.includes("metallica"))
    results.push(
      result(
        nextId(),
        METALLICA_DECOY.filename,
        between(240, 330, random),
        { kind: "decoy" },
        random,
      ),
    );
  for (const song of songs) {
    const copies = between(2, 9, random);
    for (let copy = 0; copy < copies; copy += 1)
      results.push(
        result(
          nextId(),
          chaoticFilename(song, random),
          song.length + between(-2, 2, random),
          { kind: "song", song },
          random,
        ),
      );
  }

  const fuseWords = [...artistWords, ...titleWords].filter(
    (word) => word !== "fuse",
  );
  const namesFuse = artistWords.includes("fuse") || titleWords.includes("fuse");
  const fuseTracks = FUSE_TRACKS.filter(
    (track) =>
      (namesFuse || fuseWords.length > 0) &&
      matches(`${fuseTrackArtist(track)} ${track.title}`, fuseWords),
  );
  for (const track of fuseTracks) {
    const copies = between(1, 3, random);
    for (let copy = 0; copy < copies; copy += 1)
      results.push(
        result(
          nextId(),
          fuseFilename(track, random),
          Math.round(track.duration),
          { kind: "fuse", trackId: track.id },
          random,
        ),
      );
  }

  if (results.length === 0) {
    const song: CatalogSong = {
      artist: query.artist.trim() || "Unknown Artist",
      title: query.title.trim() || "Track 1",
      length: between(150, 330, random),
    };
    const copies = between(2, 6, random);
    for (let copy = 0; copy < copies; copy += 1)
      results.push(
        result(
          nextId(),
          chaoticFilename(song, random),
          song.length + between(-3, 3, random),
          { kind: "song", song },
          random,
        ),
      );
  }

  // Hosts answer in their own time: shuffle, but keep the decoy where people kept clicking it.
  const [first, ...rest] = results;
  const shuffled = shuffle(rest, random);
  const ordered =
    first?.source.kind === "decoy"
      ? [first, ...shuffled]
      : shuffle(results, random);
  return ordered
    .filter((item) => passesFilters(item, query.filters))
    .slice(0, Math.max(1, query.maxResults));
}

export function shuffle<T>(items: readonly T[], random: Random): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    const held = copy[index] as T;
    copy[index] = copy[other] as T;
    copy[other] = held;
  }
  return copy;
}

/** What browsing a Hot List user shows: a dozen or so songs from their (imaginary) drive, all on their one line. */
export function browseUser(user: string, random: Random): SearchResult[] {
  const count = between(8, 16, random);
  const lineSpeed = pick(SPEED_WEIGHTS, random);
  const ping = pingFor(lineSpeed, random);
  const songs = shuffle(CATALOG, random).slice(0, count);
  return songs.map((song, index) => ({
    ...result(
      `${user}:${index}`,
      chaoticFilename(song, random),
      song.length,
      { kind: "song", song },
      random,
    ),
    user,
    lineSpeed,
    ping,
  }));
}

/** The totals right after connecting. */
export function initialStats(random: Random): NetworkStats {
  const libraries = between(3800, 5200, random);
  const files = libraries * between(280, 340, random);
  return { files, libraries, gigabytes: Math.round(files / 241) };
}

/** The totals a moment later: libraries come and go as people dial in and hang up. */
export function driftStats(stats: NetworkStats, random: Random): NetworkStats {
  const libraries = Math.max(1200, stats.libraries + between(-40, 45, random));
  const files = Math.max(
    100_000,
    stats.files + between(-12_000, 13_000, random),
  );
  return { files, libraries, gigabytes: Math.round(files / 241) };
}

/** "1,328,754": the client's thousands separators, whatever the browser's locale. */
export function formatCount(value: number): string {
  return String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** "3:51", the Length column. */
export function formatLength(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}
