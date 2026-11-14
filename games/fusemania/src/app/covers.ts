import { COVER_IDS } from "./packs-data.js";

/**
 * The songs that ship with a cover image, at `music/covers/<id>.jpg` under the site's base (512 by 512 JPEG).
 * The list is generated from the files in `public/music/covers/`. A song that is not in it (a new song whose
 * art is not made yet, a player's own simfile) wears the cover the song select draws from its id.
 */
export const COVERS: ReadonlySet<string> = new Set(COVER_IDS);

/** Site-relative path of a song's cover image, no leading slash, or undefined for a song without one. */
export const coverPath = (id: string): string | undefined =>
  COVERS.has(id) ? `music/covers/${id}.jpg` : undefined;
