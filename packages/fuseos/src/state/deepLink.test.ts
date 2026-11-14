import {
  deepLinkContents,
  deepLinkRedirect,
  parseOpenParam,
  withoutOpenParam,
} from "./deepLink";

const games = {
  has: (id: string) => id === "fuseball" || id === "fuse-riders",
};

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
        [
          "fuseball",
          "doom",
          "paint",
          "winamp",
          "settings",
          "about",
          "fusteam",
          "mycomputer",
          "explorer",
          "nope",
        ],
        games,
      ),
    ).toEqual([
      { kind: "fusegame", gameId: "fuseball" },
      { kind: "retro", game: "doom" },
      { kind: "paint" },
      { kind: "winamp" },
      { kind: "controlpanel", applet: "home" },
      { kind: "about" },
      { kind: "launcher" },
      { kind: "explorer", location: "" },
      { kind: "explorer", location: "" },
    ]);
  });

  it("prefers a Fuse game over a retro game of the same id", () => {
    expect(deepLinkContents(["doom"], { has: (id) => id === "doom" })).toEqual([
      { kind: "fusegame", gameId: "doom" },
    ]);
  });
});

describe(deepLinkRedirect.name, () => {
  const pages = {
    find: (id: string) => (id === "fuseball" ? { id } : undefined),
    embedUrl: (game: { id: string }) => `/fuse-riders/${game.id}/?mute`,
  };

  it("sends a tab-mode device straight to the first game a link names", () => {
    expect(deepLinkRedirect(["fuseball", "paint"], pages, "tab")).toBe(
      "/fuse-riders/fuseball/?mute",
    );
  });

  it("stays on the desktop in window mode, for apps, retro games, unknown ids and no ids", () => {
    expect(deepLinkRedirect(["fuseball"], pages, "window")).toBeUndefined();
    expect(
      deepLinkRedirect(["paint", "fuseball"], pages, "tab"),
    ).toBeUndefined();
    expect(deepLinkRedirect(["doom"], pages, "tab")).toBeUndefined();
    expect(deepLinkRedirect([], pages, "tab")).toBeUndefined();
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
