import { scriptedRandom, seededRandom } from "../__mocks__/seededRandom";
import { FUSE_TRACKS } from "../winamp/fuseTracks";

import type { SearchQuery, SearchResult } from "./fakeNetwork";
import {
  browseUser,
  chaoticFilename,
  driftStats,
  formatCount,
  formatLength,
  fuseFilename,
  initialStats,
  isBlankQuery,
  passesFilters,
  pick,
  searchNetwork,
  shuffle,
  speedClass,
} from "./fakeNetwork";
import { CATALOG, FAKE_USERS, METALLICA_DECOY } from "./napsterCatalog";

function query(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return { artist: "", title: "", maxResults: 100, filters: {}, ...overrides };
}

function sample(overrides: Partial<SearchResult> = {}): SearchResult {
  return {
    id: "r1",
    filename: "Blur - Song 2.mp3",
    filesize: 1_950_000,
    bitrate: 128,
    frequency: 44100,
    length: 122,
    user: "dialup_dan",
    lineSpeed: "56K",
    ping: 250,
    source: {
      kind: "song",
      song: { artist: "Blur", title: "Song 2", length: 122 },
    },
    ...overrides,
  };
}

describe(searchNetwork.name, () => {
  it("finds a song under its many names, shared by invented users, the same way for the same seed", () => {
    const first = searchNetwork(query({ artist: "blur" }), seededRandom(7));
    const again = searchNetwork(query({ artist: "blur" }), seededRandom(7));
    expect(first).toEqual(again);
    expect(first.length).toBeGreaterThanOrEqual(2);
    for (const item of first) {
      expect(item.source).toEqual({
        kind: "song",
        song: CATALOG.find((song) => song.title === "Song 2"),
      });
      expect(FAKE_USERS).toContain(item.user);
      expect(item.filename.toLowerCase()).toMatch(/song.2/);
    }
  });

  it("puts the Metallica decoy at the top of any Metallica search", () => {
    const results = searchNetwork(
      query({ artist: "Metallica", title: "" }),
      seededRandom(3),
    );
    expect(results[0]?.filename).toBe(METALLICA_DECOY.filename);
    expect(results[0]?.source).toEqual({ kind: "decoy" });
    expect(results.length).toBeGreaterThan(4);
  });

  it("matches the title field against titles only", () => {
    const results = searchNetwork(
      query({ title: "sandstorm" }),
      seededRandom(5),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(
      results.every(
        (item) =>
          item.source.kind === "song" && item.source.song.artist === "Darude",
      ),
    ).toBe(true);
  });

  it("serves the Fuse soundtrack for 'fuse', and a single track for its own name", () => {
    const all = searchNetwork(query({ artist: "fuse" }), seededRandom(11));
    const tracks = new Set(
      all.flatMap((item) =>
        item.source.kind === "fuse" ? [item.source.trackId] : [],
      ),
    );
    expect(tracks.size).toBe(FUSE_TRACKS.length);
    const one = searchNetwork(query({ title: "pixel sax" }), seededRandom(11));
    expect(
      one.every(
        (item) =>
          item.source.kind === "fuse" &&
          item.source.trackId === "pixel-sax-parade",
      ),
    ).toBe(true);
  });

  it("still finds something named after an unknown query, because someone always had it", () => {
    const results = searchNetwork(
      query({ artist: "Zzyzx Unheard", title: "Nobody Song" }),
      seededRandom(1),
    );
    expect(results.length).toBeGreaterThanOrEqual(2);
    expect(results[0]?.source).toMatchObject({
      kind: "song",
      song: { artist: "Zzyzx Unheard", title: "Nobody Song" },
    });
    const artistOnly = searchNetwork(
      query({ artist: "qqqq" }),
      seededRandom(1),
    );
    expect(artistOnly[0]?.source).toMatchObject({
      song: { artist: "qqqq", title: "Track 1" },
    });
    const titleOnly = searchNetwork(query({ title: "qqqq" }), seededRandom(1));
    expect(titleOnly[0]?.source).toMatchObject({
      song: { artist: "Unknown Artist" },
    });
  });

  it("returns nothing for a blank query and caps the rest at Max Results", () => {
    expect(searchNetwork(query({ artist: "  " }), seededRandom(1))).toEqual([]);
    expect(isBlankQuery({ artist: " ", title: "-" })).toBe(true);
    expect(isBlankQuery({ artist: "a", title: "" })).toBe(false);
    expect(
      searchNetwork(query({ artist: "fuse", maxResults: 3 }), seededRandom(1)),
    ).toHaveLength(3);
    expect(
      searchNetwork(query({ artist: "fuse", maxResults: 0 }), seededRandom(1)),
    ).toHaveLength(1);
  });

  it("applies the Advanced filters to what comes back", () => {
    const results = searchNetwork(
      query({
        artist: "fuse",
        filters: {
          bitrate: { comparison: "at least", value: 160 },
          lineSpeed: { comparison: "at least", value: "Cable" },
        },
      }),
      seededRandom(19),
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((item) => item.bitrate >= 160)).toBe(true);
    expect(results.every((item) => speedClass(item.lineSpeed) === "fast")).toBe(
      true,
    );
  });
});

describe(passesFilters.name, () => {
  it("compares at least, equal to and at best", () => {
    const item = sample();
    expect(
      passesFilters(item, { bitrate: { comparison: "equal to", value: 128 } }),
    ).toBe(true);
    expect(
      passesFilters(item, {
        frequency: { comparison: "at best", value: 22050 },
      }),
    ).toBe(false);
    expect(
      passesFilters(item, {
        lineSpeed: { comparison: "at best", value: "56K" },
      }),
    ).toBe(true);
    expect(
      passesFilters(item, { ping: { comparison: "at best", value: 300 } }),
    ).toBe(true);
  });

  it("lets an unanswered ping through only when no ping filter is set", () => {
    const item = sample({ ping: undefined });
    expect(passesFilters(item, {})).toBe(true);
    expect(
      passesFilters(item, { ping: { comparison: "at least", value: 0 } }),
    ).toBe(false);
  });
});

describe(speedClass.name, () => {
  it("sorts lines into the traffic light", () => {
    expect(speedClass("T1")).toBe("fast");
    expect(speedClass("Cable")).toBe("fast");
    expect(speedClass("56K")).toBe("medium");
    expect(speedClass("128K ISDN")).toBe("medium");
    expect(speedClass("28.8")).toBe("slow");
    expect(speedClass("Unknown")).toBe("slow");
  });
});

describe("filenames", () => {
  it("names a song every way the era did, and the Fuse tracks too", () => {
    const random = seededRandom(42);
    const song = CATALOG[0];
    if (!song) throw new Error("empty catalogue");
    const names = new Set(
      Array.from({ length: 200 }, () => chaoticFilename(song, random)),
    );
    expect(names.size).toBeGreaterThan(15);
    expect([...names].some((name) => name.startsWith("C:\\"))).toBe(true);
    expect([...names].some((name) => name.endsWith(".MP3"))).toBe(true);
    const track = FUSE_TRACKS[0];
    if (!track) throw new Error("no tracks");
    const fuseNames = Array.from({ length: 100 }, () =>
      fuseFilename(track, random),
    );
    expect(fuseNames.some((name) => name.includes("NOT FAKE"))).toBe(true);
    expect(fuseNames.every((name) => name.endsWith(".mp3"))).toBe(true);
  });
});

describe(browseUser.name, () => {
  it("lists a user's files, all theirs and all on their one line", () => {
    const files = browseUser("dialup_dan", seededRandom(9));
    expect(files.length).toBeGreaterThanOrEqual(8);
    expect(new Set(files.map((item) => item.user))).toEqual(
      new Set(["dialup_dan"]),
    );
    expect(new Set(files.map((item) => item.lineSpeed)).size).toBe(1);
  });
});

describe("network totals", () => {
  it("starts in the thousands of libraries and drifts a little each tick", () => {
    const random = seededRandom(4);
    const stats = initialStats(random);
    expect(stats.libraries).toBeGreaterThanOrEqual(3800);
    expect(stats.gigabytes).toBe(Math.round(stats.files / 241));
    const next = driftStats(stats, random);
    expect(Math.abs(next.libraries - stats.libraries)).toBeLessThanOrEqual(45);
    expect(
      driftStats({ files: 0, gigabytes: 0, libraries: 0 }, scriptedRandom([0])),
    ).toEqual({ files: 100_000, gigabytes: 415, libraries: 1200 });
  });

  it("formats counts and lengths the client's way", () => {
    expect(formatCount(1328754)).toBe("1,328,754");
    expect(formatCount(12)).toBe("12");
    expect(formatLength(231)).toBe("3:51");
    expect(formatLength(-4)).toBe("0:00");
  });
});

describe("helpers", () => {
  it("picks and shuffles with the given random source", () => {
    expect(pick(["a", "b", "c"], scriptedRandom([0.99]))).toBe("c");
    expect(() => pick([], scriptedRandom([0]))).toThrow("empty");
    expect(shuffle([1, 2, 3], scriptedRandom([0]))).toEqual([2, 3, 1]);
  });
});
