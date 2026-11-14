import {
  isRoomCode,
  normalizeRoomCode,
  roomCodeInUrl,
  roomUrl,
} from "./roomCode";

describe(isRoomCode.name, () => {
  it("accepts two capitals and two digits only", () => {
    expect(isRoomCode("AB42")).toBe(true);
    expect(isRoomCode("ZZ00")).toBe(true);
    expect(isRoomCode("ab42")).toBe(false);
    expect(isRoomCode("AB4")).toBe(false);
    expect(isRoomCode("ABCD")).toBe(false);
    expect(isRoomCode("1234")).toBe(false);
    expect(isRoomCode(" AB42")).toBe(false);
    expect(isRoomCode(42)).toBe(false);
    expect(isRoomCode(null)).toBe(false);
  });
});

describe(normalizeRoomCode.name, () => {
  it("trims and upper-cases what was typed without validating it", () => {
    expect(normalizeRoomCode("  ab42 ")).toBe("AB42");
    expect(normalizeRoomCode("xyz")).toBe("XYZ");
  });
});

describe(roomUrl.name, () => {
  it("adds ?room= to a plain game URL and &room= after an existing query", () => {
    expect(roomUrl("/fuse-riders/fuseball/", "AB42")).toBe(
      "/fuse-riders/fuseball/?room=AB42",
    );
    expect(roomUrl("./fuseball/?mute", "AB42")).toBe(
      "./fuseball/?mute&room=AB42",
    );
  });
});

describe(roomCodeInUrl.name, () => {
  it("reads a valid room from a page's query, upper-casing it", () => {
    expect(roomCodeInUrl("?room=AB42")).toBe("AB42");
    expect(roomCodeInUrl("?mute&room=ab42&display=1")).toBe("AB42");
  });

  it("is null without a room or with one the service would never issue", () => {
    expect(roomCodeInUrl("")).toBeNull();
    expect(roomCodeInUrl("?solo=1")).toBeNull();
    expect(roomCodeInUrl("?room=")).toBeNull();
    expect(roomCodeInUrl("?room=nope")).toBeNull();
  });
});
