import { PACKS_DATA } from "./packs-data.js";

/**
 * Song packs: the groups the song select's carousel shows its songs in. A pack is presentation only: the engine's
 * library and a room's log know songs, never packs.
 *
 * The packs and their songs are generated (`packs-data.ts`) from `scripts/lib/fusemania/songs.ts`: to add a song
 * to a pack, see "Adding a song" in `games/fusemania/charts/README.md`.
 */
export interface SongPack {
  readonly id: string;
  /** As the carousel shows it. */
  readonly name: string;
  /** The pack's songs, by id, in carousel order. */
  readonly songs: readonly string[];
}

/** The pack of a simfile the player loaded themselves. */
export const OWN_PACK = { id: "own", name: "YOUR SIMFILE" } as const;

/**
 * The packs of `songs`, in pack order, each holding only the songs that are in `songs`. `own` names the song the
 * player loaded: it gets a pack to itself, last. A bundled song that no pack names joins the first pack, and a
 * pack without songs is left out.
 */
export function packsOf(
  songs: readonly { readonly id: string }[],
  own?: string,
  packs: readonly SongPack[] = PACKS_DATA,
): SongPack[] {
  const have = new Set(songs.map((song) => song.id));
  const named = new Set(packs.flatMap((pack) => pack.songs));
  const stray = songs
    .map((song) => song.id)
    .filter((id) => id !== own && !named.has(id));
  const result = packs.map((pack, index) => ({
    ...pack,
    songs: [
      ...pack.songs.filter((id) => id !== own && have.has(id)),
      ...(index === 0 ? stray : []),
    ],
  }));
  if (packs.length === 0 && stray.length > 0)
    result.push({ id: "songs", name: "SONGS", songs: stray });
  if (own !== undefined && have.has(own))
    result.push({ ...OWN_PACK, songs: [own] });
  return result.filter((pack) => pack.songs.length > 0);
}
