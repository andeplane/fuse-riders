import {
  FUSE_MUSIC_GAMES,
  FUSE_TRACKS,
  fuseSoundtrack,
  fuseTrackArtist,
  fuseTrackGames,
  fuseTrackName,
  fuseTrackUrl,
  RADIO_ARTIST,
} from "./fuseTracks";

describe("the Fuse soundtrack catalogue", () => {
  it("lists every file-backed track once, with a unique id, a title, a game and a length", () => {
    const ids = FUSE_TRACKS.map((track) => track.id);
    const paths = FUSE_TRACKS.map((track) => track.path);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(paths).size).toBe(paths.length);
    for (const track of FUSE_TRACKS) {
      expect(track.title).not.toBe("");
      expect(track.games.length).toBeGreaterThan(0);
      expect(track.duration).toBeGreaterThan(0);
      // Relative to the site base: a leading slash would break the `./` static preview.
      expect(track.path).not.toMatch(/^\//);
    }
  });

  it("credits every music game and no other", () => {
    const credited = new Set(FUSE_TRACKS.flatMap((track) => track.games));
    expect([...credited].sort()).toEqual(Object.keys(FUSE_MUSIC_GAMES).sort());
  });

  it("names a game's own track after the game, and the shared catalogue after the radio with the games as its album", () => {
    const sharedTrack = FUSE_TRACKS.find(
      (track) => track.id === "coin-op-swing",
    );
    const ownTrack = FUSE_TRACKS.find((track) => track.id === "sandy-rally");
    if (!sharedTrack || !ownTrack) throw new Error("missing fixture tracks");
    expect(fuseTrackArtist(sharedTrack)).toBe(RADIO_ARTIST);
    expect(fuseTrackGames(sharedTrack)).toBe(
      "Fuse Riders, Ball Bros, Fuse Choppers, Hook Havok, Fuse Bombers",
    );
    expect(fuseTrackArtist(ownTrack)).toBe("Fuse Volley");
    expect(fuseTrackGames(ownTrack)).toBe("Fuse Volley");
    expect(fuseTrackName(ownTrack)).toBe("Sandy Rally (Fuse Volley)");
    expect(fuseTrackName(sharedTrack)).toBe("Coin Op Swing (Fuse Radio)");
    // Only the shared catalogue is renamed; every game's own song keeps its game.
    const renamed = FUSE_TRACKS.filter((track) => track.artist !== undefined);
    expect(renamed).toHaveLength(13);
    expect(
      renamed.every(
        (track) =>
          track.path.startsWith("music/") && !track.path.includes("/", 6),
      ),
    ).toBe(true);
  });

  it("resolves a track against the site base, whether that is absolute, under a prefix or relative", () => {
    const track = FUSE_TRACKS.find((entry) => entry.id === "neon-kickoff");
    if (!track) throw new Error("missing fixture track");
    expect(fuseTrackUrl(track, "/")).toBe("/music/fuseball/neon-kickoff.mp3");
    expect(fuseTrackUrl(track, "/fuse-riders/")).toBe(
      "/fuse-riders/music/fuseball/neon-kickoff.mp3",
    );
    expect(fuseTrackUrl(track, "./")).toBe("./music/fuseball/neon-kickoff.mp3");
    // A base without its trailing slash still gets one.
    expect(fuseTrackUrl(track, "/fuse-riders")).toBe(
      "/fuse-riders/music/fuseball/neon-kickoff.mp3",
    );
  });

  it("builds Webamp tracks with their tags and length given, so nothing is fetched to read them", () => {
    const soundtrack = fuseSoundtrack("/fuse-riders/");
    expect(soundtrack).toHaveLength(FUSE_TRACKS.length);
    expect(soundtrack[0]).toEqual({
      track: {
        url: "/fuse-riders/music/pixel-sax-parade.m4a",
        defaultName: "Pixel Sax Parade",
        metaData: {
          artist: "Fuse Radio",
          title: "Pixel Sax Parade",
          album:
            "Fuse Riders, Ball Bros, Fuse Choppers, Hook Havok, Fuse Bombers",
        },
        duration: 189.72,
      },
      name: "Pixel Sax Parade (Fuse Radio)",
    });
    const killerFuse = soundtrack.find(({ name }) =>
      name.startsWith("Match Day"),
    );
    expect(killerFuse).toEqual({
      track: {
        url: "/fuse-riders/killer-fuse/audio/music/match-day.mp3",
        defaultName: "Match Day",
        metaData: {
          artist: "Killer Fuse",
          title: "Match Day",
          album: "Killer Fuse",
        },
        duration: 132.049,
      },
      name: "Match Day (Killer Fuse)",
    });
  });
});
