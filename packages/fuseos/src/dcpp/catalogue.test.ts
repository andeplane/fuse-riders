import { FUSE_TRACKS } from "../winamp/fuseTracks";

import { buildFileList, countFiles, folderAt, userFileList } from "./fileList";
import { GiB, KiB, MiB } from "./format";
import { filterHubs, findHub, FUSEHUB, HUBS, publicHubs } from "./hubs";
import { createRandom } from "./rng";
import type { SearchQuery, SearchSource } from "./search";
import {
  extensionOf,
  JOKE_FILES,
  matchesText,
  matchesType,
  repoFiles,
  runSearch,
  sizeInBytes,
  trackFiles,
} from "./search";
import { generateUsers, selfUser, sortUsers } from "./users";

const query = (text: string, rest: Partial<SearchQuery> = {}): SearchQuery => ({
  text,
  sizeMode: "any",
  size: 0,
  type: "any",
  onlyFreeSlots: false,
  ...rest,
});

describe("the hub list", () => {
  it("lists every hub but the redirect target, and filters on name, description and address", () => {
    const listed = publicHubs(HUBS);
    expect(listed.map((hub) => hub.name)).toContain("FuseHub — Fuse Games fans");
    expect(listed.some((hub) => hub.unlisted)).toBe(false);
    expect(filterHubs(listed, "  ANIME ").map((hub) => hub.name)).toEqual([
      "Anime Planet",
    ]);
    expect(filterHubs(listed, "no-ip")).toHaveLength(1);
    expect(filterHubs(listed, "")).toHaveLength(listed.length);
    expect(findHub(HUBS, FUSEHUB)?.minShare).toBe(512 * MiB);
    expect(findHub(HUBS, "nowhere:411")).toBeUndefined();
  });
});

describe("hub users", () => {
  const hub = HUBS[0]!;

  it("puts the bot and the op first, keeps nicks unique and replays from the seed", () => {
    const users = generateUsers(createRandom(1), hub, 60);
    expect(users).toHaveLength(62);
    expect(users.slice(0, 2).map((user) => [user.nick, user.op])).toEqual([
      [hub.bot, true],
      [hub.op, true],
    ]);
    expect(new Set(users.map((user) => user.nick)).size).toBe(users.length);
    expect(generateUsers(createRandom(1), hub, 60)).toEqual(users);
    expect(users.slice(2).every((user) => user.shared >= hub.minShare)).toBe(
      true,
    );
    expect(
      users.some((user) => /^<\+\+ V:0\.40\d+,M:[AP],H:\d\/\d\/\d,S:\d/.test(user.tag)),
    ).toBe(true);
    expect(users.filter((user) => user.passive).every((user) => !user.tag.includes("M:A"))).toBe(true);
  });

  it("sorts ops first, then everyone alphabetically ignoring case", () => {
    const sorted = sortUsers([
      selfUser("zed", 0),
      selfUser("Adam", 0),
      { ...selfUser("op", 0), op: true },
    ]);
    expect(sorted.map((user) => user.nick)).toEqual(["op", "Adam", "zed"]);
  });

  it("gives up rather than loop when the names run out", () => {
    expect(generateUsers(() => 0, hub, 5).length).toBeLessThan(7);
  });
});

describe("search", () => {
  const people = generateUsers(createRandom(3), HUBS[0]!, 20);
  const source: SearchSource = {
    hubName: "Hub",
    hubAddress: "hub:411",
    users: people,
    files: JOKE_FILES,
  };

  it("matches every word anywhere in the path, case-insensitively, and nothing for an empty query", () => {
    expect(matchesText("MP3\\Trance\\DJ Kilobyte.mp3", "kilobyte trance")).toBe(true);
    expect(matchesText("MP3\\Trance\\DJ Kilobyte.mp3", "kilobyte rock")).toBe(false);
    expect(matchesText("anything", "   ")).toBe(false);
  });

  it("knows the file type groups by extension", () => {
    expect(extensionOf("a.b.MP3")).toBe("mp3");
    expect(extensionOf("README")).toBe("");
    expect(matchesType("x.avi", "video")).toBe(true);
    expect(matchesType("x.avi", "audio")).toBe(false);
    expect(matchesType("x.avi", "any")).toBe(true);
    expect(matchesType("x", "directory")).toBe(false);
  });

  it("returns plausible results with user, slots, connection and hub, filtered by size and type", () => {
    // Plain substring search, as DC++ did it: "iso" also finds "Episode".
    expect(runSearch(createRandom(5), [source], query("iso")).map((row) => row.file)).toContain(
      "Star.Battles.Episode.2.TS.SVCD-GRP.mpg",
    );
    const iso = runSearch(createRandom(5), [source], query("linux iso"));
    expect(iso.length).toBeGreaterThan(4);
    expect(iso.every((row) => row.type === "iso" && row.hub === "Hub")).toBe(true);
    expect(iso.every((row) => row.nick !== HUBS[0]!.bot)).toBe(true);
    const big = runSearch(createRandom(5), [source], query("avi", { sizeMode: "atLeast", size: 700 * MiB }));
    expect(big.every((row) => row.size >= 700 * MiB)).toBe(true);
    const small = runSearch(createRandom(5), [source], query("avi", { sizeMode: "atMost", size: 2 * MiB }));
    expect(small.map((row) => row.file)).toContain("dancing_baby.avi");
    expect(small.every((row) => row.size <= 2 * MiB)).toBe(true);
    const audio = runSearch(createRandom(5), [source], query("mp3", { type: "audio" }));
    expect(audio.every((row) => row.type === "mp3")).toBe(true);
    const free = runSearch(createRandom(5), [source], query("linux", { onlyFreeSlots: true }));
    expect(free.every((row) => row.slots.free > 0)).toBe(true);
    expect(runSearch(createRandom(5), [source], query("e"), 3)).toHaveLength(3);
    expect(runSearch(createRandom(5), [{ ...source, users: [] }], query("linux"))).toEqual([]);
  });

  it("turns the repository and the soundtrack into shared files that deliver something harmless", () => {
    const repo = repoFiles([
      { path: "README.md", size: 10 },
      { path: "packages/fuseos/src/App.tsx", size: 20 },
    ]);
    expect(repo.map((file) => [file.path, file.name])).toEqual([
      ["fuse-games\\", "README.md"],
      ["fuse-games\\packages\\fuseos\\src\\", "App.tsx"],
    ]);
    expect(repo[1]?.delivery).toEqual({ kind: "repo", path: "packages/fuseos/src/App.tsx" });
    const tracks = trackFiles(FUSE_TRACKS);
    expect(tracks).toHaveLength(FUSE_TRACKS.length);
    expect(tracks[0]?.path).toBe("Fuse Radio\\");
    expect(tracks.some((file) => file.path !== "Fuse Radio\\")).toBe(true);
    expect(tracks[0]?.delivery).toEqual({ kind: "track", trackId: FUSE_TRACKS[0]?.id });
  });

  it("reads the size box in its unit", () => {
    expect(sizeInBytes("1.5", "KiB")).toBe(1536);
    expect(sizeInBytes("700", "MiB")).toBe(700 * MiB);
    expect(sizeInBytes("2", "GiB")).toBe(2 * GiB);
    expect(sizeInBytes("12", "B")).toBe(12);
    expect(sizeInBytes("lots", "MiB")).toBe(0);
    expect(sizeInBytes("-1", "KiB")).toBe(0);
    expect(KiB).toBe(1024);
  });
});

describe("file lists", () => {
  it("builds a sorted folder tree with sizes and finds folders by path", () => {
    const root = buildFileList([
      { name: "b.mp3", path: "MP3\\Rock\\", size: 5, delivery: { kind: "joke" } },
      { name: "a.mp3", path: "MP3\\Rock\\", size: 7, delivery: { kind: "joke" } },
      { name: "x.avi", path: "Movies\\", size: 100, delivery: { kind: "joke" } },
      { name: "top.txt", path: "", size: 1, delivery: { kind: "joke" } },
    ]);
    expect(root.size).toBe(113);
    expect(root.folders.map((folder) => folder.name)).toEqual(["Movies", "MP3"]);
    const rock = folderAt(root, "MP3\\Rock\\");
    expect(rock?.files.map((file) => file.name)).toEqual(["a.mp3", "b.mp3"]);
    expect(rock?.size).toBe(12);
    expect(folderAt(root, "")).toBe(root);
    expect(folderAt(root, "Nope\\")).toBeUndefined();
    expect(countFiles(root)).toBe(4);
  });

  it("gives another user a seeded pick of the hub's files plus the usual filler", () => {
    const list = userFileList(createRandom(9), JOKE_FILES);
    expect(folderAt(list, "Incomplete\\")?.files).toHaveLength(1);
    expect(countFiles(list)).toBeGreaterThan(9);
    expect(userFileList(createRandom(9), JOKE_FILES)).toEqual(list);
    // Even unlucky dice leave something to browse.
    expect(countFiles(userFileList(() => 0.99, JOKE_FILES))).toBe(JOKE_FILES.length + 9);
  });
});
