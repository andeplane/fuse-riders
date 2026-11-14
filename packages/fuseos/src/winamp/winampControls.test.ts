import { createFakeWebampPlayer } from "../__mocks__/webampPlayer";

import { createWinampControls } from "./winampControls";

describe(createWinampControls.name, () => {
  it("reports no track and not playing before anything is added", () => {
    const player = createFakeWebampPlayer();
    const { controls } = createWinampControls(player, new Map());
    expect(controls.status()).toEqual({
      trackCount: 0,
      tracks: [],
      currentTrack: undefined,
      playing: false,
    });
  });

  it("reports the track count, the playlist names, the current track name and whether it is playing", () => {
    const player = createFakeWebampPlayer();
    const names = new Map([
      ["blob:1", "one.mp3"],
      ["blob:2", "two.mp3"],
    ]);
    player.appendTracks([
      { url: "blob:1", defaultName: "one.mp3" },
      { url: "blob:2", defaultName: "two.mp3" },
    ]);
    const { controls } = createWinampControls(player, names);

    controls.play();
    expect(controls.status()).toEqual({
      trackCount: 2,
      tracks: ["one.mp3", "two.mp3"],
      currentTrack: "one.mp3",
      playing: true,
    });

    controls.pause();
    expect(controls.status()).toMatchObject({
      playing: false,
      currentTrack: "one.mp3",
    });

    controls.next();
    expect(controls.status()).toMatchObject({
      currentTrack: "two.mp3",
      playing: true,
    });

    controls.previous();
    expect(controls.status()).toMatchObject({ currentTrack: "one.mp3" });

    controls.stop();
    expect(controls.status().playing).toBe(false);
  });

  it("falls back to the raw url for a track with no recorded name", () => {
    const player = createFakeWebampPlayer();
    player.appendTracks([{ url: "https://files.test/track.mp3" }]);
    const { controls } = createWinampControls(player, new Map());
    expect(controls.status().tracks).toEqual(["https://files.test/track.mp3"]);
  });

  it("delegates transport controls to the player", () => {
    const player = createFakeWebampPlayer();
    const play = vi.spyOn(player, "play");
    const pause = vi.spyOn(player, "pause");
    const stop = vi.spyOn(player, "stop");
    const next = vi.spyOn(player, "nextTrack");
    const previous = vi.spyOn(player, "previousTrack");
    const { controls } = createWinampControls(player, new Map());

    controls.play();
    controls.pause();
    controls.stop();
    controls.next();
    controls.previous();

    expect(play).toHaveBeenCalledTimes(1);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalledTimes(1);
    expect(next).toHaveBeenCalledTimes(1);
    expect(previous).toHaveBeenCalledTimes(1);
  });

  it("stops tracking the current track once disposed", () => {
    const player = createFakeWebampPlayer();
    const names = new Map([["blob:1", "one.mp3"]]);
    player.appendTracks([{ url: "blob:1", defaultName: "one.mp3" }]);
    const { controls, dispose } = createWinampControls(player, names);
    controls.play();
    expect(controls.status().currentTrack).toBe("one.mp3");

    dispose();
    player.nextTrack();
    // The subscription is gone, so status still reflects what it saw before disposing.
    expect(controls.status().currentTrack).toBe("one.mp3");
  });
});
