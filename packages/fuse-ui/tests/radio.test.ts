import test from "node:test";
import assert from "node:assert/strict";
import { createRadio, type MusicPlayer } from "../src/radio.js";
import { MUSIC_TRACKS } from "../src/assets.js";
import { page, event } from "./dom-fixture.js";
function player() {
  let plays = 0,
    pauses = 0;
  const media: MusicPlayer = {
    src: "",
    volume: 0,
    onended: null,
    onerror: null,
    play: async () => {
      plays++;
    },
    pause: () => {
      pauses++;
    },
    load() {},
  };
  return {
    media,
    get plays() {
      return plays;
    },
    get pauses() {
      return pauses;
    },
  };
}
test("radio is opt-in, uses base path/catalog, adjusts volume, pauses and tears down", () => {
  const { document, window } = page(),
    p = player(),
    radio = createRadio(document, "/party/", p.media);
  assert.equal(p.media.src, "");
  assert.equal(p.plays, 0);
  const [play, next] = radio.element.querySelectorAll("button");
  play!.click();
  assert.equal(p.plays, 1);
  assert.equal(p.media.src, "/party/" + MUSIC_TRACKS[0].path.slice(1));
  next!.click();
  assert.equal(p.media.src, "/party/" + MUSIC_TRACKS[1].path.slice(1));
  const volume = radio.element.querySelector("input")!;
  volume.value = "42";
  volume.dispatchEvent(event(window, "input"));
  assert.equal(p.media.volume, 0.42);
  radio.pause();
  assert.ok(p.pauses > 0);
  radio.destroy();
  assert.equal(p.media.src, "");
  assert.equal(p.media.onended, null);
  assert.equal(p.media.onerror, null);
});
test("muted preview never selects or starts media; stale rejected play does not overwrite newer selection", async () => {
  const { document } = page(),
    p = player(),
    radio = createRadio(document, "/", p.media, true);
  for (const button of radio.element.querySelectorAll("button")) {
    assert.equal(button.disabled, true);
    button.click();
  }
  assert.equal(p.media.src, "");
  assert.equal(p.plays, 0);
  radio.destroy();
  let reject: (reason?: unknown) => void = () => {};
  p.media.play = () => new Promise<void>((_r, j) => (reject = j));
  const active = createRadio(document, "/", p.media);
  const [play, next] = active.element.querySelectorAll("button");
  play!.click();
  const firstReject = reject;
  next!.click();
  firstReject(new Error("old"));
  await Promise.resolve();
  assert.equal(play!.textContent, "Pause radio");
  reject(new Error("current"));
  await Promise.resolve();
  assert.equal(play!.textContent, "Play radio");
  assert.ok(active.element.textContent?.includes("Playback unavailable"));
  active.destroy();
});
