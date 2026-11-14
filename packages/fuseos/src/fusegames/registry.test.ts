import { FIXTURE_GAMES } from "../__mocks__/renderWithProviders";

import { createFuseGameRegistry, EMPTY_FUSE_GAMES } from "./registry";

describe(createFuseGameRegistry.name, () => {
  it("lists the portal games and finds them by id", () => {
    const registry = createFuseGameRegistry({
      games: FIXTURE_GAMES,
      base: "/",
      muted: false,
    });
    expect(registry.games.map((game) => game.id)).toEqual([
      "fuseball",
      "fuse-riders",
      "fuse-birds",
    ]);
    expect(registry.find("fuseball")?.name).toBe("Fuseball");
    expect(registry.has("fuse-riders")).toBe(true);
    expect(registry.find("pong")).toBeUndefined();
    expect(registry.has("pong")).toBe(false);
  });

  it("embeds a game under the site base, muted when the OS is", () => {
    const game = FIXTURE_GAMES[0];
    expect(game).toBeDefined();
    if (!game) return;
    const plain = createFuseGameRegistry({
      games: FIXTURE_GAMES,
      base: "/fuse-riders/",
      muted: false,
    });
    expect(plain.embedUrl(game)).toBe("/fuse-riders/fuseball/");
    expect(plain.screenshotUrl(game)).toBe("/fuse-riders/gallery/fuseball.jpg");
    const muted = createFuseGameRegistry({
      games: FIXTURE_GAMES,
      base: "./",
      muted: true,
    });
    expect(muted.embedUrl(game)).toBe("./fuseball/?mute");
    const empty = createFuseGameRegistry({
      games: FIXTURE_GAMES,
      base: "",
      muted: false,
    });
    expect(empty.embedUrl(game)).toBe("./fuseball/");
  });

  it("has no screenshot for a game that ships none, and an empty default registry", () => {
    const registry = createFuseGameRegistry({
      games: FIXTURE_GAMES,
      base: "/",
      muted: false,
    });
    const riders = registry.find("fuse-riders");
    expect(riders && registry.screenshotUrl(riders)).toBeUndefined();
    expect(EMPTY_FUSE_GAMES.games).toEqual([]);
  });

  it("serves a game's desktop icon at both sizes under the base, and none for a game without one", () => {
    const registry = createFuseGameRegistry({
      games: FIXTURE_GAMES,
      base: "/fuse-riders/",
      muted: false,
    });
    const fuseball = registry.find("fuseball");
    expect(fuseball && registry.icon(fuseball)).toEqual({
      kind: "image",
      src: "/fuse-riders/fuseos/game-icons/fuseball.png",
      smallSrc: "/fuse-riders/fuseos/game-icons/fuseball-16.png",
    });
    const riders = registry.find("fuse-riders");
    expect(riders && registry.icon(riders)).toBeUndefined();
  });
});
