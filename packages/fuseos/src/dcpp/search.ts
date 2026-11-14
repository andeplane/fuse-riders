import type { FuseTrack } from "../winamp/fuseTracks";
import { FUSE_MUSIC_GAMES } from "../winamp/fuseTracks";

import { GiB, KiB, MiB } from "./format";
import type { Random } from "./rng";
import { generateCatalogue } from "./generatedFiles";
import { createRandom, pick, randomInt } from "./rng";
import type { HubUser } from "./users";

export type FileType =
  | "any"
  | "audio"
  | "compressed"
  | "document"
  | "executable"
  | "picture"
  | "video"
  | "directory";

/** The File type drop-down, in DC++'s order. */
export const FILE_TYPES: readonly { value: FileType; label: string }[] = [
  { value: "any", label: "Any" },
  { value: "audio", label: "Audio" },
  { value: "compressed", label: "Compressed" },
  { value: "document", label: "Document" },
  { value: "executable", label: "Executable" },
  { value: "picture", label: "Picture" },
  { value: "video", label: "Video" },
  { value: "directory", label: "Directory" },
];

const EXTENSIONS: Record<Exclude<FileType, "any" | "directory">, string[]> = {
  audio: ["mp3", "mp2", "wav", "au", "aiff", "m4a", "ogg", "wma", "mid", "mod"],
  compressed: [
    "zip",
    "arj",
    "rar",
    "lzh",
    "gz",
    "z",
    "arc",
    "pak",
    "ace",
    "tgz",
  ],
  document: ["htm", "html", "doc", "txt", "nfo", "pdf", "md", "json", "yml"],
  executable: ["exe", "com", "bat", "msi"],
  picture: ["gif", "jpg", "jpeg", "bmp", "pcx", "png", "wmf", "psd", "svg"],
  video: ["mpg", "mpeg", "avi", "asf", "mov", "wmv", "vob", "ogm", "rm"],
};

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

export function matchesType(name: string, type: FileType): boolean {
  if (type === "any") return true;
  if (type === "directory") return false;
  return EXTENSIONS[type].includes(extensionOf(name));
}

/**
 * What finishing a download of a result does. None of them fetch anything:
 * - `joke`: an early-2000s file that never arrives (no slots, a timeout, or 99% then gone).
 * - `repo`: a file of the user's own C:\ drive (the fuse-games repository), opened in Notepad++.
 * - `track`: a Fuse soundtrack track, played in Winamp.
 */
export type Delivery =
  | { kind: "joke" }
  | { kind: "repo"; path: string }
  | { kind: "track"; trackId: string };

export type CatalogueFile = {
  name: string;
  /** Backslash-separated folder inside the sharer's share, ending in "\". */
  path: string;
  size: number;
  delivery: Delivery;
};

/** Everything the pretend network shares, from a fixed seed (see `generatedFiles.ts`). Nothing here is fetched. */
export const JOKE_FILES: readonly CatalogueFile[] = generateCatalogue(
  createRandom(2003),
);

export type SearchQuery = {
  text: string;
  sizeMode: "atLeast" | "atMost" | "any";
  size: number;
  type: FileType;
  onlyFreeSlots: boolean;
  /** The hubs ticked in the Hubs list; absent means every connected hub. */
  hubs?: readonly string[];
};

export type SearchResult = {
  id: string;
  nick: string;
  file: string;
  /** "avi", "mp3", ...; DC++ showed the extension in the Type column. */
  type: string;
  size: number;
  path: string;
  slots: { free: number; total: number };
  connection: string;
  hub: string;
  hubAddress: string;
  /** The sharer's (invented) address, the IP column. */
  ip: string;
  delivery: Delivery;
};

/** A stable made-up IP for a nick, so the same person keeps one address. */
export function fakeIp(nick: string): string {
  let hash = 2166136261;
  for (const char of nick)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  return `${62 + (hash % 150)}.${((hash >>> 8) % 254) + 1}.${((hash >>> 16) % 254) + 1}.${((hash >>> 24) % 254) + 1}`;
}

/** Every word must appear somewhere in the full path, as DC++'s substring search did. */
export function matchesText(full: string, text: string): boolean {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return false;
  const haystack = full.toLowerCase();
  return words.every((word) => haystack.includes(word));
}

export function matchesQuery(file: CatalogueFile, query: SearchQuery): boolean {
  if (!matchesText(`${file.path}${file.name}`, query.text)) return false;
  if (!matchesType(file.name, query.type)) return false;
  if (query.sizeMode === "atLeast" && file.size < query.size) return false;
  if (query.sizeMode === "atMost" && file.size > query.size) return false;
  return true;
}

/** The fuse-games repository as FuseHub members "share" it: their C:\ drive, files from the build manifest. */
export function repoFiles(
  files: readonly { path: string; size: number }[],
): CatalogueFile[] {
  return files.map((file) => {
    const cut = file.path.lastIndexOf("/");
    const folder =
      cut < 0 ? "" : `${file.path.slice(0, cut).replaceAll("/", "\\")}\\`;
    return {
      name: file.path.slice(cut + 1),
      path: `fuse-games\\${folder}`,
      size: file.size,
      delivery: { kind: "repo", path: file.path },
    };
  });
}

/** FuseBot's "Fuse Radio" folder: the soundtrack Winamp already knows. */
export function trackFiles(tracks: readonly FuseTrack[]): CatalogueFile[] {
  return tracks.map((track) => ({
    name: `${track.title}.${extensionOf(track.path) || "m4a"}`,
    path: track.artist
      ? "Fuse Radio\\"
      : `Fuse Radio\\${track.games.map((id) => FUSE_MUSIC_GAMES[id]).join(", ")}\\`,
    // About 128 kbps, which is what everyone ripped at.
    size: Math.round(track.duration * 16 * KiB),
    delivery: { kind: "track", trackId: track.id },
  }));
}

/** Results arrive as each user's client answers, not in share order: a seeded shuffle. */
function arrivalOrder<T>(random: Random, items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    const item = items[index];
    const other = items[swap];
    if (item === undefined || other === undefined) continue;
    items[index] = other;
    items[swap] = item;
  }
  return items;
}

/** One connected hub, with who is in it and what its people share. */
export type SearchSource = {
  hubName: string;
  hubAddress: string;
  users: readonly HubUser[];
  files: readonly CatalogueFile[];
};

/**
 * The results a search gets from the hubs you are connected to: every matching file, offered by one to
 * three of the hub's users (bots excluded), capped at `limit` like a real hub's flood protection.
 */
export function runSearch(
  random: Random,
  sources: readonly SearchSource[],
  query: SearchQuery,
  limit = 100,
): SearchResult[] {
  const results: SearchResult[] = [];
  for (const source of sources) {
    const sharers = source.users.filter((user) => user.shared > 0);
    const [first, ...rest] = sharers;
    if (!first) continue;
    const people: [HubUser, ...HubUser[]] = [first, ...rest];
    for (const file of source.files) {
      if (results.length >= limit) return arrivalOrder(random, results);
      if (!matchesQuery(file, query)) continue;
      const copies = randomInt(random, 1, 3);
      for (let copy = 0; copy < copies && results.length < limit; copy += 1) {
        const user = pick(random, people);
        if (query.onlyFreeSlots && user.slots.free === 0) continue;
        results.push({
          id: `${source.hubAddress}|${user.nick}|${file.path}${file.name}|${results.length}`,
          nick: user.nick,
          file: file.name,
          type: extensionOf(file.name),
          size: file.size,
          path: file.path,
          slots: user.slots,
          connection: user.connection,
          hub: source.hubName,
          hubAddress: source.hubAddress,
          ip: fakeIp(user.nick),
          delivery: file.delivery,
        });
      }
    }
  }
  return arrivalOrder(random, results);
}

/** "At least 700 MB" from the Size box and its unit. */
export function sizeInBytes(
  amount: string,
  unit: "B" | "kB" | "MB" | "GB",
): number {
  const value = Number.parseFloat(amount);
  if (!Number.isFinite(value) || value < 0) return 0;
  const factor = { B: 1, kB: KiB, MB: MiB, GB: GiB }[unit];
  return Math.round(value * factor);
}
