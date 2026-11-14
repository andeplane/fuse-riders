import type { HallOfFameEntry } from "./leaderboard";
import {
  DEFAULT_SORT,
  defaultDirection,
  MAX_LEADERBOARD_ENTRIES,
  parseHallOfFameEntry,
  parseLeaderboard,
  sortEntries,
  toggleSort,
} from "./leaderboard";

const entry = (overrides: Partial<HallOfFameEntry> = {}): HallOfFameEntry => ({
  rank: 1,
  name: "Ace",
  elo: 1042,
  games: 7,
  rounds: 7,
  ...overrides,
});

describe(parseHallOfFameEntry.name, () => {
  it("accepts a server entry and keeps only the known fields", () => {
    expect(
      parseHallOfFameEntry({
        rank: 2,
        publicId: "a".repeat(20),
        name: "Bea",
        avatarId: "robot",
        elo: 999.6,
        games: 3,
        rounds: 2,
        you: true,
        extra: "ignored",
      }),
    ).toEqual({
      rank: 2,
      publicId: "a".repeat(20),
      name: "Bea",
      avatarId: "robot",
      elo: 1000,
      games: 3,
      rounds: 2,
      you: true,
    });
    expect(
      parseHallOfFameEntry({ rank: 1, name: "Cy", elo: 1000, games: 1 }),
    ).toEqual({ rank: 1, name: "Cy", elo: 1000, games: 1 });
  });

  it.each<[string, unknown]>([
    ["nothing", undefined],
    ["an array", []],
    ["a zero rank", { rank: 0, name: "A", elo: 1000, games: 1 }],
    ["a fractional rank", { rank: 1.5, name: "A", elo: 1000, games: 1 }],
    ["a blank name", { rank: 1, name: "  ", elo: 1000, games: 1 }],
    ["a long name", { rank: 1, name: "x".repeat(65), elo: 1000, games: 1 }],
    ["a numeric name", { rank: 1, name: 7, elo: 1000, games: 1 }],
    ["an infinite elo", { rank: 1, name: "A", elo: Infinity, games: 1 }],
    ["an absurd elo", { rank: 1, name: "A", elo: 1e7, games: 1 }],
    ["negative games", { rank: 1, name: "A", elo: 1000, games: -1 }],
    [
      "more rounds than games",
      { rank: 1, name: "A", elo: 1000, games: 1, rounds: 2 },
    ],
    ["a false you", { rank: 1, name: "A", elo: 1000, games: 1, you: false }],
    [
      "an empty avatar",
      { rank: 1, name: "A", elo: 1000, games: 1, avatarId: "" },
    ],
    [
      "a numeric publicId",
      { rank: 1, name: "A", elo: 1000, games: 1, publicId: 5 },
    ],
  ])("refuses %s", (_label, raw) => {
    expect(parseHallOfFameEntry(raw)).toBeUndefined();
  });
});

describe(parseLeaderboard.name, () => {
  it("parses the players list in rank order", () => {
    expect(
      parseLeaderboard({
        players: [
          { rank: 1, name: "A", elo: 1100, games: 2 },
          { rank: 1, name: "B", elo: 1100, games: 2 },
          { rank: 3, name: "C", elo: 900, games: 2 },
        ],
      }),
    ).toHaveLength(3);
    expect(parseLeaderboard({ players: [] })).toEqual([]);
  });

  it("refuses a body that is not a leaderboard, one bad entry, ranks going backwards and too many entries", () => {
    expect(parseLeaderboard(null)).toBeUndefined();
    expect(parseLeaderboard({ players: "many" })).toBeUndefined();
    expect(parseLeaderboard([])).toBeUndefined();
    expect(
      parseLeaderboard({
        players: [{ rank: 1, name: "A", elo: 1100, games: 2 }, { rank: 2 }],
      }),
    ).toBeUndefined();
    expect(
      parseLeaderboard({
        players: [
          { rank: 2, name: "A", elo: 1100, games: 2 },
          { rank: 1, name: "B", elo: 1200, games: 2 },
        ],
      }),
    ).toBeUndefined();
    expect(
      parseLeaderboard({
        players: Array.from(
          { length: MAX_LEADERBOARD_ENTRIES + 1 },
          (_, i) => ({
            rank: i + 1,
            name: `P${i}`,
            elo: 1000,
            games: 1,
          }),
        ),
      }),
    ).toBeUndefined();
  });
});

describe("sorting", () => {
  const board: HallOfFameEntry[] = [
    entry({ rank: 1, name: "zed", elo: 1200, games: 10, rounds: 9 }),
    entry({ rank: 2, name: "Amy", elo: 1100, games: 12, rounds: 12 }),
    entry({ rank: 3, name: "bob", elo: 1000, games: 12 }),
  ];
  const names = (sort: Parameters<typeof sortEntries>[1]) =>
    sortEntries(board, sort).map((e) => e.name);

  it("starts by rank, flips a sorted column and gives each column its natural first direction", () => {
    expect(DEFAULT_SORT).toEqual({ column: "rank", direction: "asc" });
    expect(defaultDirection("rank")).toBe("asc");
    expect(defaultDirection("name")).toBe("asc");
    expect(defaultDirection("elo")).toBe("desc");
    expect(toggleSort(DEFAULT_SORT, "rank")).toEqual({
      column: "rank",
      direction: "desc",
    });
    expect(toggleSort(DEFAULT_SORT, "games")).toEqual({
      column: "games",
      direction: "desc",
    });
    expect(toggleSort({ column: "games", direction: "desc" }, "games")).toEqual(
      { column: "games", direction: "asc" },
    );
  });

  it("sorts by every column, case-insensitively by name, with ties kept in rank order and missing rounds as zero", () => {
    expect(names({ column: "rank", direction: "desc" })).toEqual([
      "bob",
      "Amy",
      "zed",
    ]);
    expect(names({ column: "name", direction: "asc" })).toEqual([
      "Amy",
      "bob",
      "zed",
    ]);
    expect(names({ column: "elo", direction: "asc" })).toEqual([
      "bob",
      "Amy",
      "zed",
    ]);
    expect(names({ column: "games", direction: "desc" })).toEqual([
      "Amy",
      "bob",
      "zed",
    ]);
    expect(names({ column: "rounds", direction: "asc" })).toEqual([
      "bob",
      "zed",
      "Amy",
    ]);
    expect(board.map((e) => e.name)).toEqual(["zed", "Amy", "bob"]);
  });
});
