import { deepLinkContents, parseOpenParam, withoutOpenParam } from "./deepLink";

const games = { has: (id: string) => id === "fuseball" || id === "fuse-riders" };

describe(parseOpenParam.name, () => {
  it("reads a comma separated, case insensitive, deduplicated list", () => {
    expect(parseOpenParam("")).toEqual([]);
    expect(parseOpenParam("?mute")).toEqual([]);
    expect(parseOpenParam("?open=")).toEqual([]);
    expect(parseOpenParam("?open=Fuseball,%20paint,fuseball,,doom")).toEqual([
      "fuseball",
      "paint",
      "doom",
    ]);
  });
});

describe(deepLinkContents.name, () => {
  it("maps ids to Fuse games, retro games and apps, dropping unknown ones", () => {
    expect(
      deepLinkContents(
        ["fuseball", "doom", "paint", "winamp", "settings", "about", "nope"],
        games,
      ),
    ).toEqual([
      { kind: "fusegame", gameId: "fuseball" },
      { kind: "retro", game: "doom" },
      { kind: "paint" },
      { kind: "winamp" },
      { kind: "controlpanel", applet: "home" },
      { kind: "about" },
    ]);
  });

  it("prefers a Fuse game over a retro game of the same id", () => {
    expect(
      deepLinkContents(["doom"], { has: (id) => id === "doom" }),
    ).toEqual([{ kind: "fusegame", gameId: "doom" }]);
  });
});

describe(withoutOpenParam.name, () => {
  it("drops only the open parameter and keeps the rest of the address", () => {
    expect(
      withoutOpenParam("https://fuse.test/fuse-riders/?mute&open=paint#top"),
    ).toBe("https://fuse.test/fuse-riders/?mute=#top");
    expect(withoutOpenParam("https://fuse.test/?open=paint")).toBe(
      "https://fuse.test/",
    );
  });
});
