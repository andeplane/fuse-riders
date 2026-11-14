import {
  MemoryRoomDirectory,
  NO_ROOM_LISTING_REASON,
  UNSUPPORTED_ROOM_DIRECTORY,
} from "./roomDirectory";

describe("UNSUPPORTED_ROOM_DIRECTORY", () => {
  it("says the service lists no rooms, for every game", async () => {
    await expect(
      UNSUPPORTED_ROOM_DIRECTORY.listRooms("fuseball"),
    ).resolves.toEqual({ kind: "unsupported", reason: NO_ROOM_LISTING_REASON });
  });
});

describe(MemoryRoomDirectory.name, () => {
  it("answers per game, empty for games it was not told about, and remembers what was asked", async () => {
    const directory = new MemoryRoomDirectory({
      fuseball: {
        kind: "rooms",
        rooms: [{ gameId: "fuseball", code: "AB42" }],
      },
    });
    await expect(directory.listRooms("fuseball")).resolves.toEqual({
      kind: "rooms",
      rooms: [{ gameId: "fuseball", code: "AB42" }],
    });
    await expect(directory.listRooms("fuse-riders")).resolves.toEqual({
      kind: "rooms",
      rooms: [],
    });
    expect(directory.calls).toEqual(["fuseball", "fuse-riders"]);
  });
});
