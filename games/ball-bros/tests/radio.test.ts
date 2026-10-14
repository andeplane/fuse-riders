import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createRadio, type MusicPlayer } from "../src/app/radio.js";
import { avatarChoice, chosenAvatar, AVATAR_KEY } from "../src/app/avatars.js";
import { safeStore } from "../src/app/session.js";
import { MUSIC_TRACKS } from "fuse-ui/assets";

class Player implements MusicPlayer {
  src = "";
  volume = 0;
  onended: MusicPlayer["onended"] = null;
  onerror: MusicPlayer["onerror"] = null;
  plays = 0;
  pauses = 0;
  loads = 0;
  fail = false;
  reject?: () => void;
  deferred = false;
  play() {
    this.plays++;
    return this.deferred
      ? new Promise<void>((_resolve, reject) => {
          this.reject = () => reject(new Error("late"));
        })
      : this.fail
        ? Promise.reject(new Error("blocked"))
        : Promise.resolve();
  }
  pause() {
    this.pauses++;
  }
  load() {
    this.loads++;
  }
}

test("radio is opt-in, advances shared tracks, suppresses controllers and disposes playback", async () => {
  const { document } = parseHTML("<html><body></body></html>");
  const player = new Player(),
    radio = createRadio(document, "/arcade/", player);
  const [toggle, next] = radio.element.querySelectorAll("button");
  assert.equal(player.plays, 0);
  assert.equal(player.src, "/arcade/music/pixel-sax-parade.m4a");
  next!.click();
  assert.equal(player.plays, 0);
  assert.match(player.src, /coin-op/);
  toggle!.click();
  assert.equal(player.plays, 1);
  const audio = document.createElement("audio");
  player.onended!.call(audio, new Event("ended"));
  assert.equal(player.plays, 2);
  for (let i = 0; i < MUSIC_TRACKS.length; i++) next!.click();
  assert.match(player.src, /arcade-adventure/);
  toggle!.click();
  assert.equal(toggle!.textContent, "RADIO OFF");
  radio.enable(false);
  toggle!.click();
  assert.equal(radio.element.hidden, true);
  radio.enable(true);
  player.fail = true;
  toggle!.click();
  await Promise.resolve();
  assert.match(radio.element.textContent!, /unavailable.*retry/);
  player.fail = false;
  toggle!.click();
  player.onerror!.call(audio, new Event("error"));
  assert.match(radio.element.textContent!, /Track unavailable/);
  player.deferred = true;
  toggle!.click();
  radio.destroy();
  player.reject!();
  await Promise.resolve();
  assert.equal(player.src, "");
  assert.equal(player.loads, 1);
  assert.equal(player.onended, null);
  assert.equal(player.onerror, null);
  assert.equal(toggle!.onclick, null);
});

test("stale play rejection does not stop a newer track or a disabled radio", async () => {
  const { document } = parseHTML("<html><body></body></html>");
  const player = new Player(),
    radio = createRadio(document, "/", player);
  const [toggle, next] = radio.element.querySelectorAll("button");
  player.deferred = true;
  toggle!.click();
  const reject = player.reject!;
  player.deferred = false;
  next!.click();
  reject();
  await Promise.resolve();
  assert.equal(toggle!.textContent, "RADIO ON");
  radio.enable(false);
  assert.equal(toggle!.textContent, "RADIO OFF");
  radio.destroy();
});

test("core picker persists a valid portrait and rejects unknown stored identities", () => {
  const { document, window } = parseHTML("<html><body></body></html>");
  const store = safeStore(() => {
    throw new Error("storage blocked");
  });
  store.setItem(AVATAR_KEY, "bad");
  assert.equal(chosenAvatar(store), "fox");
  const choice = avatarChoice(document, store),
    select = choice.querySelector("select")!;
  select.querySelector<HTMLOptionElement>('option[value="dragon"]')!.selected =
    true;
  select.dispatchEvent(new window.Event("change"));
  assert.equal(chosenAvatar(store), "dragon");
  assert.match(
    choice.querySelector<HTMLElement>(".avatar-preview")!.style
      .backgroundPosition,
    /50% 50%/,
  );
});
