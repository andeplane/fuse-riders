/**
 * The Fuse portfolio's music as Fusemania songs: where each file lives in the repository and where the site serves
 * it. Titles are the ones the games that own the tracks show (`MUSIC_TRACKS` in `packages/fuse-ui/src/assets.ts`,
 * `games/fuse-volley/src/app/audio.ts`, `games/fuseball/src/app/audio.ts`, Killer Fuse's match and victory music).
 */
export interface SongSpec {
  /** The file's base name: unique, kebab-case. */
  readonly id: string;
  readonly title: string;
  readonly artist: string;
  /** The audio file, relative to the repository root. */
  readonly file: string;
  /** The site-relative URL of the audio, no leading slash. */
  readonly audio: string;
  /** The id of the pack (`PACKS`) the song select groups the song under. */
  readonly pack: string;
}

/**
 * The song packs, in the order the song select shows them. A pack with no songs yet is simply not shown.
 * A pack's audio lives in `public/music/<pack id>/`: see `packed` below.
 */
export const PACKS: readonly { readonly id: string; readonly name: string }[] =
  [
    { id: "fusemania", name: "FUSEMANIA" },
    { id: "ddr-jazz-mix", name: "DDR JAZZ MIX" },
    { id: "itg-jazz-mix", name: "ITG JAZZ MIX" },
  ];
const FUSE_PACK = "fusemania";

const radio = (id: string, title: string): SongSpec => ({
  id,
  title,
  artist: "Fuse",
  file: `public/music/${id}.m4a`,
  audio: `music/${id}.m4a`,
  pack: FUSE_PACK,
});
const game = (folder: string, id: string, title: string): SongSpec => ({
  id,
  title,
  artist: "Fuse",
  file: `public/music/${folder}/${id}.mp3`,
  audio: `music/${folder}/${id}.mp3`,
  pack: FUSE_PACK,
});
// `games/killer-fuse/public/` is served from the site root (the `gamePublic` plugin in vite.config.ts).
const killerFuse = (id: string, title: string): SongSpec => ({
  id,
  title,
  artist: "Fuse",
  file: `games/killer-fuse/public/killer-fuse/audio/music/${id}.mp3`,
  audio: `killer-fuse/audio/music/${id}.mp3`,
  pack: FUSE_PACK,
});
/**
 * A song of a pack other than the first: its audio is `public/music/<pack>/<id>.<ext>`. One line here, the audio
 * file there, and `pnpm exec tsx scripts/fusemania-charts.ts` charts it and puts it in the carousel under its pack.
 */
export const packed = (
  pack: string,
  id: string,
  title: string,
  artist = "Fuse",
  ext = "mp3",
): SongSpec => ({
  id,
  title,
  artist,
  file: `public/music/${pack}/${id}.${ext}`,
  audio: `music/${pack}/${id}.${ext}`,
  pack,
});

export const SONGS: readonly SongSpec[] = [
  radio("pixel-sax-parade", "Pixel Sax Parade"),
  radio("coin-op-swing", "Coin Op Swing"),
  radio("arcade-adventure", "Arcade Adventure"),
  radio("forest-job", "Forest Job"),
  radio("neon-grid-chase", "Neon Grid Chase"),
  radio("final-chase", "Final Chase"),
  radio("reduced-noise-orchestra", "Reduced Noise Orchestra"),
  radio("midnight-run", "Midnight Run"),
  radio("fast-frontier-run", "Fast Frontier Run"),
  radio("snaky-blue", "Snaky Blue"),
  radio("arcade-blues", "Arcade Blues"),
  radio("snabby-jazz", "Snabby Jazz"),
  radio("snaky-jazz", "Snaky Jazz"),
  game("fuse-volley", "jelly-beach-bounce", "Jelly Beach Bounce"),
  game("fuse-volley", "sandy-rally", "Sandy Rally"),
  game("fuseball", "neon-kickoff", "Neon Kickoff"),
  game("fuseball", "gadget-overdrive", "Gadget Overdrive"),
  game("fuseball", "sudden-death", "Sudden Death"),
  killerFuse("match-day", "Match Day"),
  killerFuse("victory", "Victory"),
  // DDR JAZZ MIX: Fuse's jazzy chiptune covers.
  packed("ddr-jazz-mix", "afronova", "Afronova (Extended Mix)"),
  packed("ddr-jazz-mix", "afronova-radio-edit", "Afronova (Radio Edit)"),
  packed("ddr-jazz-mix", "burning-heat", "Burning Heat"),
  packed(
    "ddr-jazz-mix",
    "cant-stop-fallin-in-love",
    "Can't Stop Fallin' in Love",
  ),
  packed("ddr-jazz-mix", "candy", "Candy"),
  packed("ddr-jazz-mix", "electro-tuned", "Electro Tuned"),
  packed("ddr-jazz-mix", "exotic-ethnic", "Exotic Ethnic"),
  packed("ddr-jazz-mix", "paranoia-survivor-max", "Paranoia Survivor MAX"),
  packed("ddr-jazz-mix", "rain-of-sorrow", "Rain of Sorrow (Fuse Mix)"),
  packed(
    "ddr-jazz-mix",
    "rain-of-sorrow-night-mix",
    "Rain of Sorrow (Night Mix)",
  ),
  packed("ddr-jazz-mix", "the-legend-of-max", "The Legend of MAX"),
  // ITG JAZZ MIX: Fuse's jazzy chiptune covers.
  packed("itg-jazz-mix", "determinator", "Determinator"),
  packed("itg-jazz-mix", "monolith", "Monolith"),
  packed("itg-jazz-mix", "temple-of-boom", "Temple of Boom"),
  packed("itg-jazz-mix", "the-least-100sec", "The Least 100sec"),
  packed("itg-jazz-mix", "xenon", "Xenon"),
];

export const songById = (id: string): SongSpec | undefined =>
  SONGS.find((song) => song.id === id);
