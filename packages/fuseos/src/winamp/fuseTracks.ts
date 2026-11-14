/**
 * Every piece of file-backed music the Fuse games ship, as one Winamp playlist. Each entry is a file the site
 * serves (`path`, relative to the site base) with the games that play it; a file two games share appears once.
 * `tests/fuseos-music.test.ts` holds this list to the files on disk, so a game that adds, renames or drops a
 * track fails there until the catalogue follows. Games whose music is synthesised (Fuse Axe, Fuse Front, Fuse
 * Freight, Graveyard Shift, Fuse Craft, Hook Havok's own cues) have no file and are not listed.
 *
 * Plain data on purpose: no React, no `import.meta`, so the repo's node tests can import it as-is.
 */

/** The games with file-backed music, by portal id, with the names the portal shows. */
export const FUSE_MUSIC_GAMES = {
  "fuse-riders": "Fuse Riders",
  "ball-bros": "Ball Bros",
  "fuse-choppers": "Fuse Choppers",
  "hook-havok": "Hook Havok",
  "fuse-bombers": "Fuse Bombers",
  fuseball: "Fuseball",
  "fuse-volley": "Fuse Volley",
  "killer-fuse": "Killer Fuse",
  fusemania: "Fusemania",
} as const;

export type FuseMusicGameId = keyof typeof FUSE_MUSIC_GAMES;

export type FuseTrack = {
  /** Stable, unique across the catalogue; the file's own name where that is unique, else prefixed by its game. */
  id: string;
  title: string;
  /** The games that play this file, in the order they are credited. */
  games: readonly FuseMusicGameId[];
  /**
   * What Winamp shows as the artist instead of the game names: set for the catalogue five games share, whose
   * full credit ("Fuse Riders, Ball Bros, Fuse Choppers, Hook Havok, Fuse Bombers") would push the title out of
   * the 275px playlist row. The games still travel as the album, so Media Session and the test see them.
   */
  artist?: string;
  /** The served file, relative to the site base: `music/x.m4a` lives in `public/`, `killer-fuse/...` in that game's `public/`. */
  path: string;
  /** Seconds, measured once with ffprobe (see docs/fuseos/winamp.md); given up front so Webamp never fetches a file just to read its length. */
  duration: number;
};

/** The shared catalogue (`fuse-ui/assets` MUSIC_TRACKS) is "the radio" in every game that plays it. */
export const RADIO_ARTIST = "Fuse Radio";

/** Riders, Ball Bros, Choppers and Hook Havok cycle through the whole radio catalogue. */
const RADIO: readonly FuseMusicGameId[] = [
  "fuse-riders",
  "ball-bros",
  "fuse-choppers",
  "hook-havok",
];
/** Fuse Bombers picks four of the shared tracks for its lobby, rounds, sudden death and victory. */
const RADIO_AND_BOMBERS: readonly FuseMusicGameId[] = [
  ...RADIO,
  "fuse-bombers",
];

/** `public/music/*.m4a`, in the order the games' radios play them. */
const RADIO_TRACKS: readonly Omit<FuseTrack, "artist">[] = [
  {
    id: "pixel-sax-parade",
    title: "Pixel Sax Parade",
    games: RADIO_AND_BOMBERS,
    path: "music/pixel-sax-parade.m4a",
    duration: 189.72,
  },
  {
    id: "coin-op-swing",
    title: "Coin Op Swing",
    games: RADIO_AND_BOMBERS,
    path: "music/coin-op-swing.m4a",
    duration: 167.6,
  },
  {
    id: "arcade-adventure",
    title: "Arcade Adventure",
    games: RADIO_AND_BOMBERS,
    path: "music/arcade-adventure.m4a",
    duration: 131.6,
  },
  {
    id: "forest-job",
    title: "Forest Job",
    games: RADIO,
    path: "music/forest-job.m4a",
    duration: 124.8,
  },
  {
    id: "neon-grid-chase",
    title: "Neon Grid Chase",
    games: RADIO,
    path: "music/neon-grid-chase.m4a",
    duration: 149.04,
  },
  {
    id: "final-chase",
    title: "Final Chase",
    games: RADIO_AND_BOMBERS,
    path: "music/final-chase.m4a",
    duration: 148.76,
  },
  {
    id: "reduced-noise-orchestra",
    title: "Reduced Noise Orchestra",
    games: RADIO,
    path: "music/reduced-noise-orchestra.m4a",
    duration: 169.08,
  },
  {
    id: "midnight-run",
    title: "Midnight Run",
    games: RADIO,
    path: "music/midnight-run.m4a",
    duration: 119.573,
  },
  {
    id: "fast-frontier-run",
    title: "Fast Frontier Run",
    games: RADIO,
    path: "music/fast-frontier-run.m4a",
    duration: 140.133,
  },
  {
    id: "snaky-blue",
    title: "Snaky Blue",
    games: RADIO,
    path: "music/snaky-blue.m4a",
    duration: 119.613,
  },
  {
    id: "arcade-blues",
    title: "Arcade Blues",
    games: RADIO,
    path: "music/arcade-blues.m4a",
    duration: 119.573,
  },
  {
    id: "snabby-jazz",
    title: "Snabby Jazz",
    games: RADIO,
    path: "music/snabby-jazz.m4a",
    duration: 202.8,
  },
  {
    id: "snaky-jazz",
    title: "Snaky Jazz",
    games: RADIO,
    path: "music/snaky-jazz.m4a",
    duration: 205.96,
  },
];

/** Each game's own songs, in `public/music/<game>/` or the game's own `public/`. */
const GAME_TRACKS: readonly FuseTrack[] = [
  {
    id: "neon-kickoff",
    title: "Neon Kickoff",
    games: ["fuseball"],
    path: "music/fuseball/neon-kickoff.mp3",
    duration: 162.194,
  },
  {
    id: "gadget-overdrive",
    title: "Gadget Overdrive",
    games: ["fuseball"],
    path: "music/fuseball/gadget-overdrive.mp3",
    duration: 167.993,
  },
  {
    id: "fuseball-sudden-death",
    title: "Sudden Death",
    games: ["fuseball"],
    path: "music/fuseball/sudden-death.mp3",
    duration: 130.038,
  },
  {
    id: "jelly-beach-bounce",
    title: "Jelly Beach Bounce",
    games: ["fuse-volley"],
    path: "music/fuse-volley/jelly-beach-bounce.mp3",
    duration: 83.67,
  },
  {
    id: "sandy-rally",
    title: "Sandy Rally",
    games: ["fuse-volley"],
    path: "music/fuse-volley/sandy-rally.mp3",
    duration: 126.851,
  },
  {
    id: "match-day",
    title: "Match Day",
    games: ["killer-fuse"],
    path: "killer-fuse/audio/music/match-day.mp3",
    duration: 132.049,
  },
  {
    id: "killer-fuse-victory",
    title: "Victory",
    games: ["killer-fuse"],
    path: "killer-fuse/audio/music/victory.mp3",
    duration: 55.118,
  },
  // Fusemania's DDR JAZZ MIX: Fuse's jazzy chiptune covers.
  {
    id: "ddr-jazz-mix-afronova",
    title: "Afronova (Extended Mix)",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/afronova.mp3",
    duration: 141.36,
  },
  {
    id: "ddr-jazz-mix-afronova-radio-edit",
    title: "Afronova (Radio Edit)",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/afronova-radio-edit.mp3",
    duration: 107.592,
  },
  {
    id: "ddr-jazz-mix-burning-heat",
    title: "Burning Heat",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/burning-heat.mp3",
    duration: 160.44,
  },
  {
    id: "ddr-jazz-mix-cant-stop-fallin-in-love",
    title: "Can't Stop Fallin' in Love",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/cant-stop-fallin-in-love.mp3",
    duration: 118.824,
  },
  {
    id: "ddr-jazz-mix-candy",
    title: "Candy",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/candy.mp3",
    duration: 142.704,
  },
  {
    id: "ddr-jazz-mix-electro-tuned",
    title: "Electro Tuned",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/electro-tuned.mp3",
    duration: 179.952,
  },
  {
    id: "ddr-jazz-mix-exotic-ethnic",
    title: "Exotic Ethnic",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/exotic-ethnic.mp3",
    duration: 155.16,
  },
  {
    id: "ddr-jazz-mix-paranoia-survivor-max",
    title: "Paranoia Survivor MAX",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/paranoia-survivor-max.mp3",
    duration: 162.792,
  },
  {
    id: "ddr-jazz-mix-rain-of-sorrow",
    title: "Rain of Sorrow (Fuse Mix)",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/rain-of-sorrow.mp3",
    duration: 131.232,
  },
  {
    id: "ddr-jazz-mix-rain-of-sorrow-night-mix",
    title: "Rain of Sorrow (Night Mix)",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/rain-of-sorrow-night-mix.mp3",
    duration: 134.04,
  },
  {
    id: "ddr-jazz-mix-the-legend-of-max",
    title: "The Legend of MAX",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/the-legend-of-max.mp3",
    duration: 180.0,
  },
  // Fusemania's ITG JAZZ MIX, then two more of its DDR JAZZ MIX.
  {
    id: "itg-jazz-mix-determinator",
    title: "Determinator",
    games: ["fusemania"],
    path: "music/itg-jazz-mix/determinator.mp3",
    duration: 177.624,
  },
  {
    id: "itg-jazz-mix-monolith",
    title: "Monolith",
    games: ["fusemania"],
    path: "music/itg-jazz-mix/monolith.mp3",
    duration: 159.6,
  },
  {
    id: "itg-jazz-mix-temple-of-boom",
    title: "Temple of Boom",
    games: ["fusemania"],
    path: "music/itg-jazz-mix/temple-of-boom.mp3",
    duration: 171.192,
  },
  {
    id: "ddr-jazz-mix-the-least-100sec",
    title: "The Least 100sec",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/the-least-100sec.mp3",
    duration: 118.44,
  },
  {
    id: "ddr-jazz-mix-xenon",
    title: "Xenon",
    games: ["fusemania"],
    path: "music/ddr-jazz-mix/xenon.mp3",
    duration: 159.624,
  },
];

export const FUSE_TRACKS: readonly FuseTrack[] = [
  ...RADIO_TRACKS.map((track) => ({ ...track, artist: RADIO_ARTIST })),
  ...GAME_TRACKS,
];

/** The games a track credits, by name: "Fuseball", or "Fuse Riders, Ball Bros, ...". */
export function fuseTrackGames(track: FuseTrack): string {
  return track.games.map((id) => FUSE_MUSIC_GAMES[id]).join(", ");
}

/** Winamp's artist field: the game, or the shared catalogue's own name (see `FuseTrack.artist`). */
export function fuseTrackArtist(track: FuseTrack): string {
  return track.artist ?? fuseTrackGames(track);
}

/** "Title (Artist)", what the Office Assistant reads out as the track's name. */
export function fuseTrackName(track: FuseTrack): string {
  return `${track.title} (${fuseTrackArtist(track)})`;
}

/**
 * Where the site serves a track from. `base` is Vite's `BASE_URL`: `/`, `/fuse-riders/` on Pages, or `./` in a
 * static preview, where the relative result resolves against the OS page the way every other asset does.
 */
export function fuseTrackUrl(track: FuseTrack, base: string): string {
  return base.endsWith("/") ? `${base}${track.path}` : `${base}/${track.path}`;
}

/** A Webamp playlist entry: url plus the tags and length Webamp would otherwise download part of the file to read. */
export type FuseSoundtrackTrack = {
  url: string;
  defaultName: string;
  metaData: { artist: string; title: string; album: string };
  duration: number;
};

/** The whole catalogue as Webamp tracks, each paired with its display name, for one site base. */
export function fuseSoundtrack(
  base: string,
): readonly { track: FuseSoundtrackTrack; name: string }[] {
  return FUSE_TRACKS.map((track) => ({
    track: {
      url: fuseTrackUrl(track, base),
      defaultName: track.title,
      metaData: {
        artist: fuseTrackArtist(track),
        title: track.title,
        album: fuseTrackGames(track),
      },
      duration: track.duration,
    },
    name: fuseTrackName(track),
  }));
}
