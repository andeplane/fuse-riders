import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import {
  createPlayOptions,
  lengthLabel,
  sessionLine,
  speedLabel,
  type OptionsState,
  type PlayOptionsOptions,
} from "../src/app/options.js";
import { MAX_SPEED, MIN_SPEED, SPEEDS, parsePrefs } from "../src/app/prefs.js";
import { SESSION_LENGTHS } from "../src/online/game.js";

const state = (over: Partial<OptionsState> = {}): OptionsState => ({
  speed: 1.5,
  host: true,
  songs: 1,
  random: false,
  ...over,
});
function setup(over: Partial<PlayOptionsOptions> = {}) {
  const { document } = parseHTML("<html><body></body></html>");
  const asked: unknown[][] = [];
  const options = createPlayOptions({
    document,
    lengths: SESSION_LENGTHS,
    onSpeed: (speed) => asked.push(["speed", speed]),
    onRandomSong: () => asked.push(["random song"]),
    onSongs: (songs) => asked.push(["songs", songs]),
    onOrder: (random) => asked.push(["order", random]),
    ...over,
  });
  document.body.append(options.element);
  const all = (selector: string) => [
    ...options.element.querySelectorAll<HTMLButtonElement>(selector),
  ];
  const pressed = (selector: string) =>
    all(selector)
      .filter((node) => node.getAttribute("aria-pressed") === "true")
      .map((node) => node.textContent);
  return { options, asked, all, pressed };
}

test("the speeds on offer are the eight asked for, each one a speed the settings keep", () => {
  assert.deepEqual(SPEEDS, [0.5, 1, 1.5, 2, 2.5, 3, 4, 5]);
  assert.equal(Math.min(...SPEEDS), MIN_SPEED);
  assert.equal(Math.max(...SPEEDS), MAX_SPEED);
  for (const speed of SPEEDS) assert.equal(parsePrefs({ speed }).speed, speed);
  assert.equal(speedLabel(0.5), "0.5x");
  assert.equal(speedLabel(5), "5x");
  assert.equal(lengthLabel(1), "1 SONG");
  assert.equal(lengthLabel(10), "10 SONGS");
});

test("a chip per speed: the player's own is lit, and a click asks for another", () => {
  const { options, asked, all, pressed } = setup();
  options.update(state());
  assert.deepEqual(
    all(".fm-option-speed").map((node) => node.textContent),
    ["0.5x", "1x", "1.5x", "2x", "2.5x", "3x", "4x", "5x"],
  );
  assert.deepEqual(pressed(".fm-option-speed"), ["1.5x"]);
  all(".fm-option-speed")[7]!.click();
  assert.deepEqual(asked, [["speed", 5]]);
  // The click reports; the chip follows the state the page answers with.
  assert.deepEqual(pressed(".fm-option-speed"), ["1.5x"]);
  options.update(state({ speed: 5 }));
  assert.deepEqual(pressed(".fm-option-speed"), ["5x"]);
  // A speed from the slider between two chips lights none.
  options.update(state({ speed: 1.75 }));
  assert.deepEqual(pressed(".fm-option-speed"), []);
  // A guest's speed is their own: the chips stay live.
  options.update(state({ host: false }));
  assert.ok(all(".fm-option-speed").every((node) => !node.disabled));
});

test("the session is the host's: how many songs, and who chooses them", () => {
  const { options, asked, all, pressed } = setup();
  options.update(state());
  assert.deepEqual(
    all(".fm-option-songs").map((node) => node.textContent),
    ["1 SONG", "3 SONGS", "5 SONGS", "10 SONGS"],
  );
  assert.deepEqual(pressed(".fm-option-songs"), ["1 SONG"]);
  const order =
    options.element.querySelector<HTMLElement>(".fm-options-order")!;
  // One song has nothing to order.
  assert.equal(order.hidden, true);
  all(".fm-option-songs")[2]!.click();
  assert.deepEqual(asked, [["songs", 5]]);
  options.update(state({ songs: 5 }));
  assert.equal(order.hidden, false);
  assert.deepEqual(pressed(".fm-option-order"), ["HOST PICKS"]);
  all(".fm-option-order")[1]!.click();
  assert.deepEqual(asked[1], ["order", true]);
  options.update(state({ songs: 5, random: true }));
  assert.deepEqual(pressed(".fm-option-order"), ["RANDOM"]);

  // The host has the chips and no summary line.
  const songs =
      options.element.querySelector<HTMLElement>(".fm-options-songs")!,
    summary = options.element.querySelector<HTMLElement>(
      ".fm-options-summary",
    )!;
  assert.equal(songs.hidden, false);
  assert.equal(summary.hidden, true);

  // A guest reads the host's choice as one line and has no chips to press.
  options.update(state({ songs: 5, random: true, host: false }));
  assert.equal(songs.hidden, true);
  assert.equal(order.hidden, true);
  assert.equal(summary.hidden, false);
  assert.equal(summary.querySelector("b")?.textContent, "5 SONGS · RANDOM");
  assert.ok(
    [...all(".fm-option-songs"), ...all(".fm-option-order")].every(
      (node) => node.disabled,
    ),
  );
  options.update(state({ songs: 3, host: false }));
  assert.equal(summary.querySelector("b")?.textContent, "3 SONGS · HOST PICKS");
  assert.equal(sessionLine(1, true), "1 SONG", "one song has no order");
  // The speed stays every player's own.
  assert.equal(all(".fm-option-speed").length > 0, true);
  assert.equal(
    options.element.querySelector<HTMLElement>(".fm-options-speed")!.hidden,
    false,
  );
});

test("RANDOM SONG is the host's, and gone where the room draws the songs itself", () => {
  const { options, asked, all } = setup();
  const random = all(".fm-option-random")[0]!;
  options.update(state());
  assert.equal(random.hidden, false);
  random.click();
  assert.deepEqual(asked, [["random song"]]);
  options.update(state({ host: false }));
  assert.equal(random.hidden, true);
  options.update(state({ songs: 3, random: true }));
  assert.equal(random.hidden, true);
  options.update(state({ songs: 3, random: false }));
  assert.equal(random.hidden, false);
});

test("a solo select has the speed and the random song, and no session", () => {
  const { options, all } = setup({ lengths: undefined });
  options.update(state());
  assert.equal(all(".fm-option-speed").length, 8);
  assert.equal(all(".fm-option-random").length, 1);
  assert.equal(all(".fm-option-songs").length, 0);
  assert.equal(options.element.querySelector(".fm-options-order"), null);
});
