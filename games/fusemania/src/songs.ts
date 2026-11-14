import { createLibrary, type Library } from "./engine/index.js";
import { CHARTNET_DATA } from "./engine/chartnet-data.js";
import { SONGS_DATA } from "./engine/songs-data.js";

/**
 * The songs every copy of the game ships with: the whole Fuse soundtrack with its generated charts. A room is played
 * on this library on every device, which is what the engine's `RULES` vouches for.
 *
 * Each song also offers ChartNet's charts (`scripts/chartnet`: a rhythm learned from published charts, with the
 * generator's arrows) after its own, for playtesting the two side by side.
 */
export const LIBRARY: Library = createLibrary(
  SONGS_DATA.map((song) => ({
    ...song,
    ssc: song.ssc + (CHARTNET_DATA[song.id] ?? ""),
  })),
);
export { SONGS_DATA };
