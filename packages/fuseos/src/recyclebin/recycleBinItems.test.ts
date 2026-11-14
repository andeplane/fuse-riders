import {
  formatDeletedAt,
  formatRecycleBinSize,
  FUSE_VOLLEY_GAME_ID,
  RECYCLE_BIN_ITEMS,
} from "./recycleBinItems";

describe("RECYCLE_BIN_ITEMS", () => {
  it("has unique ids and names, and every video is an .avi or .mpg", () => {
    const ids = RECYCLE_BIN_ITEMS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = RECYCLE_BIN_ITEMS.map((item) => item.name);
    expect(new Set(names).size).toBe(names.length);
    for (const item of RECYCLE_BIN_ITEMS) {
      if (item.open.kind === "video") expect(item.name).toMatch(/\.(avi|mpg)$/);
      else expect(item.name).not.toMatch(/\.(avi|mpg)$/);
    }
  });

  it("includes the promised classics and exactly one video that is really Fuse Volley", () => {
    const names = RECYCLE_BIN_ITEMS.map((item) => item.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "old_netcode_v1.ts",
        "bug_free_code.exe",
        "LAN_server_RIP.zip",
        "Debbie_Does_Netcode.avi",
        "Hot_Singles_In_Your_Lobby.mpg",
        "Fuse_Volley_Beach_Edition_UNCUT.avi",
      ]),
    );
    const launching = RECYCLE_BIN_ITEMS.filter(
      (item) => item.open.kind === "video" && item.open.launches,
    );
    expect(launching.map((item) => item.name)).toEqual([
      "Fuse_Volley_Beach_Edition_UNCUT.avi",
    ]);
    expect(launching[0]?.open).toEqual({
      kind: "video",
      launches: FUSE_VOLLEY_GAME_ID,
    });
  });

  it("keeps the joke names to innuendo: nothing explicit anywhere in the catalogue", () => {
    const banned = /\b(sex|porn|xxx|nude|naked|nsfw)\b/i;
    for (const item of RECYCLE_BIN_ITEMS) {
      expect(item.name).not.toMatch(banned);
      expect(item.originalLocation).not.toMatch(banned);
      expect(item.type).not.toMatch(banned);
    }
  });
});

describe(formatRecycleBinSize.name, () => {
  it("rounds up to whole kilobytes with thousands separators", () => {
    expect(formatRecycleBinSize(0)).toBe("0KB");
    expect(formatRecycleBinSize(1)).toBe("1KB");
    expect(formatRecycleBinSize(1024)).toBe("1KB");
    expect(formatRecycleBinSize(1025)).toBe("2KB");
    expect(formatRecycleBinSize(697 * 1024 * 1024)).toBe("713,728KB");
  });
});

describe(formatDeletedAt.name, () => {
  it("formats like Explorer's details view, in UTC so it never depends on the machine", () => {
    expect(formatDeletedAt(Date.UTC(1998, 10, 13, 23, 45))).toBe(
      "11/13/1998 11:45 PM",
    );
    expect(formatDeletedAt(Date.UTC(1998, 3, 1, 0, 0))).toBe(
      "4/1/1998 12:00 AM",
    );
  });
});
