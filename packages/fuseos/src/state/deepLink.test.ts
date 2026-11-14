import {
  deepLinkApp,
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
    ]);
  });

  it("opens the Phase D programs, the DOS Games folder and Run by name", () => {
    expect(
      deepLinkContents(
        [
          "recyclebin",
          "friends",
          "network",
          "halloffame",
          "taskmanager",
          "dialup",
          "explorer",
          "notepad",
          "dosgames",
          "run",
        ],
        games,
      ),
    ).toEqual([
      { kind: "recyclebin" },
      { kind: "friends" },
      { kind: "network" },
      { kind: "halloffame" },
      { kind: "taskmanager" },
      { kind: "dialup" },
      { kind: "explorer", location: "" },
      { kind: "notepadpp", paths: ["README.md"], activePath: "README.md" },
      { kind: "retroFolder" },
      { kind: "run" },
    ]);
    // A name from Object.prototype is not an app.
    expect(deepLinkApp("constructor")).toBeUndefined();
    expect(deepLinkApp("paint")).toEqual({ kind: "paint" });
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
