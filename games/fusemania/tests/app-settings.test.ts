import test from "node:test";
import assert from "node:assert/strict";
import { parseHTML } from "linkedom";
import { createGameAudio, type OscillatorLike } from "fuse-ui/game-audio";
import { createAudioRig } from "fuse-ui/game-audio-fake";
import {
  MAX_AUDIO_MS,
  MAX_KEYS,
  MAX_OFFSET_MS,
  MAX_SPEED,
  MAX_VISUAL_MS,
  MIN_SPEED,
  defaultPrefs,
  type Action,
  type Prefs,
} from "../src/app/prefs.js";
import {
  BEAT_MS,
  CALIBRATION_CLICKS,
  CALIBRATION_LOOP_MS,
  COUNT_IN,
  EFFECTS_OFF,
  INTERRUPTED,
  SOUND_LOCKED,
  SOUND_OFF,
  audioText,
  calibrationText,
  createSettingsPanel,
  offsetText,
  signedMs,
  speedText,
  visualText,
} from "../src/app/settings.js";

/** The audio clock is this many seconds ahead of `performance.now()` in these tests. */
const SKEW = 3.2;
/** The output latency the fake context reports, in seconds. */
const LAG = 0.05;

interface Setup {
  state?: AudioContextState;
  forceMute?: boolean;
  prefs?: Prefs;
}

/** A panel on a linkedom page, a real `GameAudio` on a fake context that records every tone, and timers run by hand. */
function harness(setup: Setup = {}) {
  const { document: raw, window } = parseHTML(
    "<!doctype html><html><body></body></html>",
  );
  const document = raw as unknown as Document;
  const rig = createAudioRig(setup.state);
  const tones: { at: number; frequency: number; type: OscillatorType }[] = [];
  rig.context.outputLatency = LAG;
  rig.context.createOscillator = (): OscillatorLike => {
    const voice: OscillatorLike = {
      connect: () => undefined,
      disconnect: () => undefined,
      type: "sine",
      frequency: {
        value: 0,
        setValueAtTime(value) {
          this.value = value;
        },
        linearRampToValueAtTime() {},
        exponentialRampToValueAtTime() {},
        cancelScheduledValues() {},
      },
      start(at) {
        tones.push({ at, frequency: voice.frequency.value, type: voice.type });
      },
      stop() {},
    };
    return voice;
  };
  const audio = createGameAudio(rig.deps, {
    forceMute: setup.forceMute === true,
  });

  let perf = 5000;
  const tune = () => {
    rig.context.currentTime = perf / 1000 + SKEW;
  };
  tune();
  const loops: { run: () => void; ms: number; live: boolean }[] = [];
  let prefs = setup.prefs ?? defaultPrefs();
  const changes: Prefs[] = [];
  const panel = createSettingsPanel({
    document,
    prefs: () => prefs,
    onChange(next) {
      changes.push(next);
      prefs = next;
    },
    audio,
    now: () => perf,
    every(run, ms) {
      const loop = { run, ms, live: true };
      loops.push(loop);
      return () => {
        loop.live = false;
      };
    },
  });
  document.body.append(panel.element);

  const fire = (
    target: EventTarget,
    type: string,
    fields: Record<string, unknown> = {},
  ): Event => {
    const result = new window.Event(type, { bubbles: true, cancelable: true });
    for (const [key, value] of Object.entries(fields))
      Object.defineProperty(result, key, { value });
    target.dispatchEvent(result);
    return result;
  };
  const one = <E extends Element = HTMLElement>(selector: string): E => {
    const found = panel.element.querySelector<E>(selector);
    assert.ok(found, `no ${selector}`);
    return found;
  };
  const shown = (element: Element) => element.closest("[hidden]") === null;
  /** The visible button with this text or accessible name. */
  const named = (name: string): HTMLButtonElement => {
    const found = [...panel.element.querySelectorAll("button")].find(
      (button) =>
        shown(button) &&
        (button.textContent === name ||
          button.getAttribute("aria-label") === name),
    );
    assert.ok(found, `no visible button "${name}"`);
    return found;
  };
  const has = (name: string) =>
    [...panel.element.querySelectorAll("button")].some(
      (button) => shown(button) && button.textContent === name,
    );
  const row = (action: Action) => one(`[data-action="${action}"]`);
  return {
    document,
    audio,
    rig,
    tones,
    loops,
    panel,
    changes,
    one,
    shown,
    named,
    has,
    get perf() {
      return perf;
    },
    get prefs() {
      return prefs;
    },
    /** The preferences change behind the panel's back. */
    set prefs(next: Prefs) {
      prefs = next;
    },
    /** Time passes, and every running loop has its turn. */
    pass(ms: number) {
      perf += ms;
      tune();
      for (const loop of [...loops]) if (loop.live) loop.run();
    },
    live: () => loops.filter((loop) => loop.live).length,
    /** A key press on the page, as the browser reports it. */
    key: (code: string, fields: Record<string, unknown> = {}) =>
      fire(document, "keydown", { code, ...fields }),
    fire,
    add: (action: Action) =>
      row(action).querySelector<HTMLButtonElement>(".fm-settings-add")!,
    chips: (action: Action) =>
      [...row(action).querySelectorAll(".fm-settings-chip-label")].map(
        (chip) => chip.textContent,
      ),
    /** Moves a slider the way a drag does. */
    slide(input: HTMLInputElement, value: number) {
      input.value = String(value);
      fire(input, "input");
    },
    range: (key: "offsetMs" | "visualMs" | "audioMs") =>
      one<HTMLInputElement>(`[data-offset="${key}"] input`),
    value: (key: "offsetMs" | "visualMs" | "audioMs") =>
      one(`[data-offset="${key}"] .fm-settings-value`).textContent,
    note: () => one(".fm-settings-calibration .fm-settings-note").textContent,
    result: () => one(".fm-settings-result").textContent ?? "",
    count: () => one(".fm-settings-count").textContent,
  };
}
type Harness = ReturnType<typeof harness>;

/**
 * Plays a whole calibration: presses CALIBRATE (or RETRY), then taps `error(n)` ms after the n-th counted click is
 * heard, by key or on the pad; `undefined` skips that click. Returns once the panel is no longer busy.
 */
function tapAlong(
  h: Harness,
  error: (index: number) => number | undefined,
  options: { start?: string; pad?: boolean } = {},
): void {
  const from = h.tones.length;
  h.named(options.start ?? "CALIBRATE").click();
  const done = new Set<number>();
  for (let step = 0; step < 400 && h.panel.busy; step++) {
    h.pass(CALIBRATION_LOOP_MS);
    h.tones.slice(from).forEach((tone, index) => {
      if (index < COUNT_IN || done.has(index)) return;
      const miss = error(index - COUNT_IN);
      const at = (tone.at + LAG - SKEW) * 1000 + (miss ?? 0);
      if (at > h.perf) return;
      done.add(index);
      if (miss === undefined) return;
      if (options.pad)
        h.fire(h.one(".fm-settings-pad"), "pointerdown", { timeStamp: at });
      else h.key("KeyF", { timeStamp: at });
    });
  }
  assert.equal(h.panel.busy, false, "the calibration ended");
}

// ---- what it shows ----

test("the panel shows the keys, the scroll and the offsets as they are, with named controls", () => {
  const h = harness();
  assert.deepEqual(h.chips("left"), ["A", "J", "←"]);
  assert.deepEqual(h.chips("down"), ["S", "K", "↓"]);
  assert.deepEqual(h.chips("up"), ["W", "I", "↑"]);
  assert.deepEqual(h.chips("right"), ["D", "L", "→"]);
  assert.deepEqual(h.chips("item"), ["SPACE"]);
  assert.match(
    h.panel.element.textContent ?? "",
    /Both hands work: WASD and IJKL are the same four arrows\./,
  );
  assert.match(
    h.panel.element.textContent ?? "",
    /Raise it if arrows reach the targets after the beat/,
  );
  assert.equal(h.one(".fm-settings-value").textContent, "1.5x");
  assert.equal(h.named("TARGETS ON TOP").getAttribute("aria-pressed"), "true");
  assert.equal(
    h.named("TARGETS AT BOTTOM").getAttribute("aria-pressed"),
    "false",
  );
  assert.equal(h.value("offsetMs"), "0 ms");
  assert.equal(h.value("visualMs"), "0 ms");
  assert.equal(h.panel.busy, false);

  // Every slider is a range with a label of its own, and every button has a name.
  const ranges = [...h.panel.element.querySelectorAll("input")];
  assert.equal(ranges.length, 4);
  for (const range of ranges) {
    assert.equal(range.type, "range");
    const label = h.panel.element.querySelector(`label[for="${range.id}"]`);
    assert.ok(label?.textContent, `a label for ${range.id}`);
    assert.ok(range.getAttribute("aria-valuetext"));
  }
  assert.deepEqual(
    [...h.panel.element.querySelectorAll("label")].map(
      (label) => label.textContent,
    ),
    ["SPEED", "INPUT OFFSET", "AUDIO OFFSET", "VISUAL OFFSET"],
  );
  const speed = h.one<HTMLInputElement>("input");
  assert.deepEqual(
    ["min", "max", "step"].map((name) => speed.getAttribute(name)),
    [String(MIN_SPEED), String(MAX_SPEED), "0.25"],
  );
  assert.deepEqual(
    ["min", "max", "step"].map((name) =>
      h.range("offsetMs").getAttribute(name),
    ),
    [String(-MAX_OFFSET_MS), String(MAX_OFFSET_MS), "5"],
  );
  assert.deepEqual(
    ["min", "max", "step"].map((name) =>
      h.range("visualMs").getAttribute(name),
    ),
    [String(-MAX_VISUAL_MS), String(MAX_VISUAL_MS), "5"],
  );
  assert.deepEqual(
    ["min", "max", "step"].map((name) => h.range("audioMs").getAttribute(name)),
    [String(-MAX_AUDIO_MS), String(MAX_AUDIO_MS), "5"],
  );
  assert.equal(h.value("audioMs"), "0 ms");
  for (const button of h.panel.element.querySelectorAll("button")) {
    assert.equal(button.type, "button");
    assert.ok(
      button.getAttribute("aria-label") ??
        ((button.textContent ?? "").trim().length > 1
          ? button.textContent
          : null),
      `a name for ${button.className}`,
    );
  }
});

test("the texts read as the player would say them", () => {
  assert.equal(speedText(1.5), "1.5x");
  assert.equal(speedText(2), "2x");
  assert.equal(speedText(0.75), "0.75x");
  assert.equal(signedMs(0), "0 ms");
  assert.equal(offsetText(35), "+35 ms: you tap late");
  assert.equal(offsetText(-10), "−10 ms: you tap early");
  assert.equal(offsetText(0), "0 ms");
  assert.equal(visualText(20), "+20 ms: arrows drawn earlier");
  assert.equal(visualText(-15), "−15 ms: arrows drawn later");
  assert.equal(visualText(0), "0 ms");
  assert.equal(
    calibrationText({ offsetMs: 38.4, spreadMs: 9.2, used: 16, ok: true }),
    "You tap 38 ms late (±9 ms)",
  );
  assert.equal(
    calibrationText({ offsetMs: -12.5, spreadMs: 4, used: 16, ok: true }),
    "You tap 12 ms early (±4 ms)",
  );
  assert.equal(
    calibrationText({ offsetMs: 0.2, spreadMs: 3, used: 16, ok: true }),
    "You tap right on the click (±3 ms)",
  );
  assert.match(
    calibrationText({ offsetMs: 5, spreadMs: 61, used: 14, ok: false }),
    /too inconsistent to trust \(±61 ms\)/,
  );
  assert.match(
    calibrationText({ offsetMs: 5, spreadMs: 3, used: 4, ok: false }),
    /Only 4 of 16 taps .* too few to trust/,
  );
});

// ---- keys ----

test("ADD KEY binds the next key pressed and gives the keyboard back", () => {
  const h = harness();
  const before = structuredClone(h.prefs),
    given = h.prefs;
  const add = h.add("left");
  assert.equal(add.textContent, "ADD KEY");
  add.click();
  assert.equal(h.panel.busy, true);
  assert.equal(add.textContent, "PRESS A KEY…");
  assert.equal(add.getAttribute("aria-pressed"), "true");
  assert.equal(h.add("down").textContent, "ADD KEY", "only this row listens");
  assert.equal(h.changes.length, 0);

  const press = h.key("KeyF");
  assert.equal(press.defaultPrevented, true, "the game does not see the key");
  assert.equal(h.changes.length, 1);
  assert.deepEqual(h.changes[0]!.keys.left, [
    "KeyA",
    "KeyJ",
    "ArrowLeft",
    "KeyF",
  ]);
  assert.deepEqual(given, before, "the page's object is not the one changed");
  assert.notEqual(h.changes[0], given);
  assert.deepEqual(h.chips("left"), ["A", "J", "←", "F"]);
  assert.equal(h.panel.busy, false);
  assert.equal(add.textContent, "ADD KEY");
  assert.equal(add.getAttribute("aria-pressed"), "false");

  // The listener is gone: the next key is the page's again.
  const later = h.key("KeyG");
  assert.equal(later.defaultPrevented, false);
  assert.equal(h.changes.length, 1);
});

test("Escape, or pressing the button again, cancels a capture without binding", () => {
  const h = harness();
  h.add("up").click();
  const escape = h.key("Escape");
  assert.equal(escape.defaultPrevented, true, "the dialog stays open");
  assert.equal(h.panel.busy, false);
  assert.equal(h.add("up").textContent, "ADD KEY");
  assert.equal(h.key("KeyF").defaultPrevented, false);
  assert.equal(h.changes.length, 0);

  h.add("up").click();
  assert.equal(h.panel.busy, true);
  h.add("up").click();
  assert.equal(h.panel.busy, false);
  h.key("KeyF");
  assert.equal(h.changes.length, 0);

  // Another row's button takes the capture over.
  h.add("up").click();
  h.add("right").click();
  assert.equal(h.add("up").textContent, "ADD KEY");
  assert.equal(h.add("right").textContent, "PRESS A KEY…");
  h.key("KeyF");
  assert.deepEqual(h.prefs.keys.up, defaultPrefs().keys.up);
  assert.ok(h.prefs.keys.right.includes("KeyF"));
});

test("a key already used elsewhere moves to the new action", () => {
  const h = harness();
  h.add("item").click();
  h.key("KeyS");
  assert.deepEqual(h.prefs.keys.item, ["Space", "KeyS"]);
  assert.deepEqual(h.prefs.keys.down, ["KeyK", "ArrowDown"]);
  assert.deepEqual(h.chips("down"), ["K", "↓"]);
  assert.deepEqual(h.chips("item"), ["SPACE", "S"]);
  const every = Object.values(h.prefs.keys).flat();
  assert.equal(new Set(every).size, every.length, "one action per key");
});

test("an action keeps at most MAX_KEYS keys: the oldest drops", () => {
  const h = harness();
  h.add("left").click();
  h.key("KeyF");
  assert.equal(h.prefs.keys.left.length, MAX_KEYS);
  h.add("left").click();
  assert.match(
    h.one(".fm-settings-keys + .fm-settings-note").textContent ?? "",
    /replaces A/,
  );
  h.key("KeyG");
  assert.deepEqual(h.prefs.keys.left, ["KeyJ", "ArrowLeft", "KeyF", "KeyG"]);
});

test("a capture refuses what cannot be bound and ignores what is not a press", () => {
  const prefs = defaultPrefs();
  prefs.keys.down = ["KeyS"];
  const h = harness({ prefs });
  const note = () =>
    h.one(".fm-settings-keys + .fm-settings-note").textContent ?? "";
  h.add("left").click();
  assert.match(note(), /Press a key for Left\. Esc cancels\./);

  // A held key repeating is not a new press.
  assert.equal(h.key("KeyF", { repeat: true }).defaultPrevented, true);
  assert.equal(h.panel.busy, true);
  // Down's only key cannot be taken: the capture stays open and says why.
  h.key("KeyS");
  assert.equal(h.changes.length, 0);
  assert.equal(h.panel.busy, true);
  assert.match(note(), /S is the only key for Down/);
  // A key the keyboard cannot name.
  h.key("");
  assert.equal(h.changes.length, 0);
  assert.equal(h.panel.busy, true);
  assert.match(note(), /cannot be bound/);
  // A shortcut is the browser's, and so is not swallowed.
  assert.equal(h.key("KeyR", { ctrlKey: true }).defaultPrevented, false);
  assert.equal(h.changes.length, 0);
  assert.equal(h.panel.busy, true);
  // A key already on this action ends the capture with nothing to change.
  h.key("KeyA");
  assert.equal(h.changes.length, 0);
  assert.equal(h.panel.busy, false);

  // Tab stays the browser's: it leaves the capture and is not swallowed.
  h.add("left").click();
  const tab = h.key("Tab");
  assert.equal(tab.defaultPrevented, false);
  assert.equal(h.panel.busy, false);
  assert.match(note(), /TAB cannot be bound/);
  assert.equal(h.changes.length, 0);
});

test("a chip's × removes that key, and an arrow's last key has none", () => {
  const prefs = defaultPrefs();
  prefs.keys.down = ["KeyS"];
  const h = harness({ prefs });
  h.named("Remove J from Left").click();
  assert.deepEqual(h.changes.at(-1)!.keys.left, ["KeyA", "ArrowLeft"]);
  assert.deepEqual(h.chips("left"), ["A", "←"]);
  assert.deepEqual(prefs.keys.left, ["KeyA", "KeyJ", "ArrowLeft"]);

  assert.deepEqual(h.chips("down"), ["S"]);
  assert.equal(
    h.one('[data-action="down"]').querySelectorAll(".fm-settings-remove")
      .length,
    0,
    "the last key of an arrow stays",
  );
  // Down to one key, the × goes from the survivor too.
  h.named("Remove A from Left").click();
  assert.deepEqual(h.chips("left"), ["←"]);
  assert.equal(
    h.one('[data-action="left"]').querySelectorAll(".fm-settings-remove")
      .length,
    0,
  );

  // The power-up is not an arrow: it may have no key at all.
  h.named("Remove SPACE from Power-up").click();
  assert.deepEqual(h.prefs.keys.item, []);
  assert.deepEqual(h.chips("item"), []);
  assert.match(h.one('[data-action="item"]').textContent ?? "", /NO KEY/);
  assert.equal(h.panel.busy, false);
});

test("RESET KEYS restores the default keys and nothing else", () => {
  const prefs = defaultPrefs();
  prefs.keys = {
    left: ["KeyQ"],
    down: ["KeyW"],
    up: ["KeyE"],
    right: ["KeyR"],
    item: [],
  };
  prefs.speed = 2.5;
  prefs.down = true;
  prefs.offsetMs = 30;
  const h = harness({ prefs });
  h.add("left").click();
  h.named("RESET KEYS").click();
  assert.equal(h.panel.busy, false, "a capture ends with the reset");
  assert.equal(h.changes.length, 1);
  assert.deepEqual(h.changes[0], {
    ...defaultPrefs(),
    speed: 2.5,
    down: true,
    offsetMs: 30,
  });
  assert.deepEqual(prefs.keys.left, ["KeyQ"], "the old object is untouched");
  assert.deepEqual(h.chips("item"), ["SPACE"]);
  // Already the defaults: nothing to tell the page.
  h.named("RESET KEYS").click();
  assert.equal(h.changes.length, 1);
});

// ---- scroll and timing ----

test("the speed slider and the direction toggle change the scroll", () => {
  const h = harness();
  const given = h.prefs,
    speed = h.one<HTMLInputElement>("input");
  h.slide(speed, 2.25);
  assert.equal(h.changes.at(-1)!.speed, 2.25);
  assert.equal(given.speed, 1.5, "the page's object is not the one changed");
  assert.equal(h.one(".fm-settings-value").textContent, "2.25x");
  assert.equal(speed.getAttribute("aria-valuetext"), "2.25x");
  // Off the grid or out of range is brought back to it.
  h.slide(speed, 3.1);
  assert.equal(h.prefs.speed, 3);
  h.slide(speed, 99);
  assert.equal(h.prefs.speed, MAX_SPEED);
  h.slide(speed, -4);
  assert.equal(h.prefs.speed, MIN_SPEED);
  const count = h.changes.length;
  h.slide(speed, MIN_SPEED);
  assert.equal(h.changes.length, count, "the same speed is not a change");

  h.named("TARGETS AT BOTTOM").click();
  assert.equal(h.changes.at(-1)!.down, true);
  assert.equal(h.changes.at(-1)!.speed, MIN_SPEED);
  assert.equal(
    h.named("TARGETS AT BOTTOM").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(h.named("TARGETS ON TOP").getAttribute("aria-pressed"), "false");
  h.named("TARGETS AT BOTTOM").click();
  assert.equal(h.changes.length, count + 1, "already at the bottom");
  h.named("TARGETS ON TOP").click();
  assert.equal(h.prefs.down, false);
});

test("the input offset moves by slider and in 5 ms steps, inside its limits", () => {
  const h = harness();
  h.slide(h.range("offsetMs"), 35);
  assert.equal(h.changes.at(-1)!.offsetMs, 35);
  assert.equal(h.value("offsetMs"), "+35 ms: you tap late");
  assert.equal(
    h.range("offsetMs").getAttribute("aria-valuetext"),
    "+35 ms: you tap late",
  );
  h.named("Raise input offset by 5 ms").click();
  assert.equal(h.prefs.offsetMs, 40);
  h.named("Lower input offset by 5 ms").click();
  h.named("Lower input offset by 5 ms").click();
  assert.equal(h.prefs.offsetMs, 30);
  h.slide(h.range("offsetMs"), -10);
  assert.equal(h.value("offsetMs"), "−10 ms: you tap early");
  h.slide(h.range("offsetMs"), 0);
  assert.equal(h.value("offsetMs"), "0 ms");

  // A calibrated offset is off the grid: the buttons go to the next multiple of 5.
  h.prefs = { ...h.prefs, offsetMs: 38 };
  h.panel.refresh();
  assert.equal(h.value("offsetMs"), "+38 ms: you tap late");
  h.named("Raise input offset by 5 ms").click();
  assert.equal(h.prefs.offsetMs, 40);
  h.prefs = { ...h.prefs, offsetMs: 38 };
  h.named("Lower input offset by 5 ms").click();
  assert.equal(h.prefs.offsetMs, 35);
  h.prefs = { ...h.prefs, offsetMs: -38 };
  h.named("Raise input offset by 5 ms").click();
  assert.equal(h.prefs.offsetMs, -35);

  h.slide(h.range("offsetMs"), 9999);
  assert.equal(h.prefs.offsetMs, MAX_OFFSET_MS);
  assert.equal(h.named("Raise input offset by 5 ms").disabled, true);
  assert.equal(h.named("Lower input offset by 5 ms").disabled, false);
  h.slide(h.range("offsetMs"), -9999);
  assert.equal(h.prefs.offsetMs, -MAX_OFFSET_MS);
  assert.equal(h.named("Lower input offset by 5 ms").disabled, true);
  assert.equal(h.prefs.visualMs, 0, "the other offset is left alone");
});

test("the visual offset is its own slider with its own limits", () => {
  const h = harness();
  h.slide(h.range("visualMs"), 20);
  assert.equal(h.changes.at(-1)!.visualMs, 20);
  assert.equal(h.changes.at(-1)!.offsetMs, 0);
  assert.equal(h.value("visualMs"), "+20 ms: arrows drawn earlier");
  h.named("Lower visual offset by 5 ms").click();
  assert.equal(h.prefs.visualMs, 15);
  h.named("Raise visual offset by 5 ms").click();
  assert.equal(h.prefs.visualMs, 20);
  h.slide(h.range("visualMs"), 9999);
  assert.equal(h.prefs.visualMs, MAX_VISUAL_MS);
  h.slide(h.range("visualMs"), -9999);
  assert.equal(h.prefs.visualMs, -MAX_VISUAL_MS);
  assert.equal(h.value("visualMs"), "−200 ms: arrows drawn later");
});

test("refresh re-reads preferences that changed elsewhere", () => {
  const h = harness();
  const next = defaultPrefs();
  next.keys.left = ["KeyQ"];
  next.speed = 3;
  next.down = true;
  next.offsetMs = -20;
  next.visualMs = 10;
  h.prefs = next;
  h.panel.refresh();
  assert.deepEqual(h.chips("left"), ["Q"]);
  assert.equal(h.one(".fm-settings-value").textContent, "3x");
  assert.equal(h.one<HTMLInputElement>("input").value, "3");
  assert.equal(
    h.named("TARGETS AT BOTTOM").getAttribute("aria-pressed"),
    "true",
  );
  assert.equal(h.value("offsetMs"), "−20 ms: you tap early");
  assert.equal(h.range("offsetMs").value, "-20");
  assert.equal(h.value("visualMs"), "+10 ms: arrows drawn earlier");
  assert.equal(h.changes.length, 0, "reading is not changing");
});

// ---- calibration ----

test("a calibration clicks on the audio clock, and taps 40 ms late offer +40", () => {
  const h = harness();
  assert.equal(h.has("CALIBRATE"), true);
  assert.equal(h.shown(h.one(".fm-settings-pad")), false);
  // A little human scatter around 40 ms late.
  const scatter = [0, 5, -4, 2, -6, 3, -1, 6, -3, 1, -5, 4, 0, -2, 2, -1];
  tapAlong(h, (index) => 40 + scatter[index]!);

  // Four count-in clicks, then sixteen to tap, a beat apart, each scheduled ahead of its time.
  assert.equal(h.tones.length, COUNT_IN + CALIBRATION_CLICKS);
  assert.deepEqual(
    h.tones.map((tone) => tone.frequency),
    [
      ...Array.from({ length: COUNT_IN }, () => 880),
      ...Array.from({ length: CALIBRATION_CLICKS }, () => 1320),
    ],
  );
  assert.ok(h.tones.every((tone) => tone.type === "square"));
  h.tones.slice(1).forEach((tone, index) => {
    assert.ok(
      Math.abs(tone.at - h.tones[index]!.at - BEAT_MS / 1000) < 1e-9,
      `click ${index + 1} is a beat after the one before`,
    );
  });
  assert.equal(h.rig.log.resumes, 0, "the context was already running");

  assert.equal(h.live(), 0, "the loop stopped");
  assert.match(h.result(), /^You tap 40 ms late \(±[23] ms\)$/);
  assert.equal(h.shown(h.one(".fm-settings-pad")), false);
  assert.equal(h.has("CALIBRATE"), false);
  assert.equal(h.has("APPLY") && h.has("RETRY") && h.has("CANCEL"), true);
  assert.equal(h.changes.length, 0, "nothing changes until APPLY");

  const given = h.prefs;
  h.named("APPLY").click();
  assert.equal(h.changes.length, 1);
  assert.equal(h.changes[0]!.offsetMs, 40);
  assert.equal(given.offsetMs, 0, "the page's object is not the one changed");
  assert.equal(h.value("offsetMs"), "+40 ms: you tap late");
  assert.equal(h.note(), "Input offset set to +40 ms.");
  assert.equal(h.has("CALIBRATE"), true);
  assert.equal(h.has("APPLY"), false);
});

test("a calibration shows where it is, and takes taps on the pad as well", () => {
  const h = harness();
  h.named("CALIBRATE").click();
  assert.equal(h.panel.busy, true);
  assert.equal(h.shown(h.one(".fm-settings-pad")), true);
  assert.equal(h.has("CANCEL"), true);
  assert.equal(h.has("APPLY") || h.has("RETRY"), false);
  assert.equal(h.count(), "LISTEN…");
  assert.equal(h.tones.length, 0, "the first click is not due yet");
  const seen = new Set<string>();
  for (let step = 0; step < 30; step++) {
    h.pass(CALIBRATION_LOOP_MS);
    seen.add(h.count() ?? "");
  }
  for (const label of ["READY 1 / 4", "READY 4 / 4", "TAP 1 / 16"])
    assert.ok(seen.has(label), `${label} was shown`);
  // A ring for each click that is scheduled or sounding; the spent ones are cleared away.
  const rings = h.panel.element.querySelectorAll(".fm-settings-ring").length;
  assert.ok(rings >= 1 && rings <= 2, `${rings} rings`);
  h.panel.cancel();
  assert.equal(h.panel.element.querySelectorAll(".fm-settings-ring").length, 0);

  // Early by 25 ms, tapped on the pad.
  tapAlong(h, () => -25, { pad: true });
  assert.equal(h.result(), "You tap 25 ms early (±0 ms)");
  h.named("APPLY").click();
  assert.equal(h.changes.at(-1)!.offsetMs, -25);
  // A press on the pad when nothing is running is nothing.
  h.fire(h.one(".fm-settings-pad"), "pointerdown", { timeStamp: h.perf });
  assert.equal(h.panel.busy, false);
});

test("a very late tapper is hearing the sound late: the lag goes to the audio offset", () => {
  const h = harness();
  // Later than 240 ms a tap is nearer the click after, so this is about the largest offset a run can find.
  tapAlong(h, () => 230);
  assert.equal(h.result(), "You tap 230 ms late (±0 ms)");
  h.named("APPLY").click();
  // No keyboard is 230 ms late, and the room would pull presses stamped that far back to its tick.
  assert.equal(h.prefs.audioMs, 230);
  assert.equal(h.prefs.offsetMs, 0);
  assert.equal(h.value("audioMs"), audioText(230));

  // With the audio offset in use the same sound is heard on time: what is left is the player's own.
  tapAlong(h, () => 230 + 14);
  assert.equal(h.result(), "You tap 14 ms late (±0 ms)");
  h.named("APPLY").click();
  assert.equal(h.prefs.audioMs, 230);
  assert.equal(h.prefs.offsetMs, 14);
});

test("an inconsistent tapper is refused, and RETRY runs it again", () => {
  const h = harness();
  const wild = [
    150, -120, 60, -170, 190, -40, 110, -190, 20, 170, -90, 130, -150, 80, -60,
    200,
  ];
  tapAlong(h, (index) => wild[index]!);
  assert.match(h.result(), /too inconsistent to trust/);
  assert.equal(h.has("APPLY"), false, "there is nothing to apply");
  assert.equal(h.has("RETRY") && h.has("CANCEL"), true);
  assert.equal(h.changes.length, 0);

  tapAlong(h, () => 12, { start: "RETRY" });
  assert.equal(h.tones.length, 2 * (COUNT_IN + CALIBRATION_CLICKS));
  assert.equal(h.result(), "You tap 12 ms late (±0 ms)");
  h.named("CANCEL").click();
  assert.equal(h.has("CALIBRATE"), true);
  assert.equal(h.shown(h.one(".fm-settings-result")), false);
  assert.equal(h.changes.length, 0, "cancelling applies nothing");
});

test("too few taps are refused too", () => {
  const h = harness();
  tapAlong(h, (index) => (index < 5 ? 30 : undefined));
  assert.match(h.result(), /Only 5 of 16 taps .* too few to trust/);
  assert.equal(h.has("APPLY"), false);
  assert.equal(h.has("RETRY"), true);
});

test("a tap is timed by its own time stamp when that is on the page's clock", () => {
  const h = harness();
  h.named("CALIBRATE").click();
  const done = new Set<number>();
  // Every tap is exactly on its click, but reaches the page up to 100 ms later, as a busy page delivers it.
  for (let step = 0; step < 400 && h.panel.busy; step++) {
    h.pass(CALIBRATION_LOOP_MS);
    h.tones.forEach((tone, index) => {
      const at = (tone.at + LAG - SKEW) * 1000;
      if (index < COUNT_IN || done.has(index) || at > h.perf) return;
      done.add(index);
      h.key("Space", { timeStamp: at });
    });
  }
  assert.equal(h.result(), "You tap right on the click (±0 ms)");

  // A stamp on another timeline (an epoch, as old browsers gave) is not believed: the tap is timed as it arrives.
  h.named("RETRY").click();
  const from = h.tones.length,
    late = new Set<number>();
  for (let step = 0; step < 400 && h.panel.busy; step++) {
    h.pass(CALIBRATION_LOOP_MS);
    h.tones.slice(from).forEach((tone, index) => {
      const at = (tone.at + LAG - SKEW) * 1000;
      if (index < COUNT_IN || late.has(index) || at > h.perf) return;
      late.add(index);
      h.key("Space", { timeStamp: 1794664116759 });
    });
  }
  const offered = /^You tap (\d+) ms late/.exec(h.result());
  assert.ok(offered, h.result());
  assert.ok(Number(offered[1]) > 0 && Number(offered[1]) <= 100);
});

test("with no sound to tap along with, it says what to do and schedules nothing", async () => {
  // A `?mute` page has no audio clock at all.
  const muted = harness({ forceMute: true });
  muted.named("CALIBRATE").click();
  assert.equal(muted.note(), SOUND_OFF);
  assert.equal(muted.note(), "Turn sound on to calibrate");
  assert.equal(muted.panel.busy, false);
  assert.equal(muted.loops.length, 0);
  assert.equal(muted.tones.length, 0);
  assert.equal(muted.rig.log.opens, 0, "a muted page never opens audio");
  assert.equal(muted.has("CALIBRATE"), true);
  assert.equal(muted.key("KeyF").defaultPrevented, false);

  // The player's own mute, and an effects volume of nothing.
  const quiet = harness();
  quiet.audio.setMuted(true);
  quiet.named("CALIBRATE").click();
  assert.equal(quiet.note(), SOUND_OFF);
  assert.equal(quiet.loops.length, 0);
  quiet.audio.setMuted(false);
  quiet.audio.setVolume("effects", 0);
  quiet.named("CALIBRATE").click();
  assert.equal(quiet.note(), EFFECTS_OFF);
  assert.equal(quiet.loops.length, 0);
  assert.equal(quiet.tones.length, 0);
  assert.equal(quiet.panel.busy, false);

  // A context the browser has not let run yet: CALIBRATE unlocks it, and the next press finds it running.
  const locked = harness({ state: "suspended" });
  let resumes = 0;
  let start = () => {};
  // As a browser does it: the context is running only once the promise settles.
  locked.rig.context.resume = () => {
    resumes++;
    return new Promise<void>((resolve) => {
      start = () => {
        locked.rig.context.state = "running";
        resolve();
      };
    });
  };
  locked.named("CALIBRATE").click();
  assert.equal(locked.note(), SOUND_LOCKED);
  assert.equal(locked.note(), "Press any key to start sound, then try again");
  assert.equal(locked.panel.busy, false);
  assert.equal(locked.loops.length, 0);
  assert.equal(resumes, 1, "CALIBRATE asked for sound");
  start();
  await Promise.resolve();
  locked.named("CALIBRATE").click();
  assert.equal(locked.panel.busy, true);
  assert.equal(locked.note(), "", "the message goes when it starts");
  for (let step = 0; step < 6; step++) locked.pass(CALIBRATION_LOOP_MS);
  assert.ok(locked.tones.length > 0);
});

test("cancel() stops the clicks and removes the key listener", () => {
  const h = harness();
  h.named("CALIBRATE").click();
  for (let step = 0; step < 12; step++) h.pass(CALIBRATION_LOOP_MS);
  const clicks = h.tones.length;
  assert.ok(clicks > 0 && clicks < COUNT_IN + CALIBRATION_CLICKS);
  assert.equal(h.live(), 1);
  assert.equal(h.key("KeyF").defaultPrevented, true, "a tap, not the game's");

  h.panel.cancel();
  assert.equal(h.panel.busy, false);
  assert.equal(h.live(), 0, "the loop is stopped");
  for (let step = 0; step < 20; step++) h.pass(CALIBRATION_LOOP_MS);
  assert.equal(h.tones.length, clicks, "no click after the cancel");
  assert.equal(h.key("KeyF").defaultPrevented, false, "the listener is gone");
  assert.equal(h.has("CALIBRATE"), true);
  assert.equal(h.shown(h.one(".fm-settings-pad")), false);
  assert.equal(h.changes.length, 0);

  // A capture is cancelled the same way, and a result is put away.
  h.add("left").click();
  h.panel.cancel();
  assert.equal(h.panel.busy, false);
  assert.equal(h.key("KeyF").defaultPrevented, false);
  assert.equal(h.changes.length, 0);
  tapAlong(h, () => 15);
  assert.equal(h.has("APPLY"), true);
  h.panel.cancel();
  assert.equal(h.has("APPLY"), false);
  assert.equal(h.has("CALIBRATE"), true);
});

test("Escape and the CANCEL button stop a calibration; the browser's keys are not taps", () => {
  const h = harness();
  h.named("CALIBRATE").click();
  h.pass(CALIBRATION_LOOP_MS);
  // Tab, a shortcut and a held key repeating are not taps, and the first two stay the browser's.
  assert.equal(h.key("Tab").defaultPrevented, false);
  assert.equal(h.key("KeyR", { metaKey: true }).defaultPrevented, false);
  assert.equal(h.key("KeyF", { repeat: true }).defaultPrevented, true);
  assert.equal(h.panel.busy, true);
  const escape = h.key("Escape");
  assert.equal(escape.defaultPrevented, true);
  assert.equal(h.panel.busy, false);
  assert.equal(h.live(), 0);
  assert.equal(h.has("CALIBRATE"), true);

  h.named("CALIBRATE").click();
  h.pass(CALIBRATION_LOOP_MS);
  h.named("CANCEL").click();
  assert.equal(h.panel.busy, false);
  assert.equal(h.live(), 0);
  assert.equal(h.key("KeyF").defaultPrevented, false);
});

test("a calibration whose loop stalls or whose sound stops gives up", () => {
  const stalled = harness();
  stalled.named("CALIBRATE").click();
  for (let step = 0; step < 10; step++) stalled.pass(CALIBRATION_LOOP_MS);
  // A throttled tab: two seconds with no turn, and the beat is broken.
  stalled.pass(2000);
  assert.equal(stalled.panel.busy, false);
  assert.equal(stalled.note(), INTERRUPTED);
  assert.equal(stalled.live(), 0);
  assert.equal(stalled.has("CALIBRATE"), true);

  const hidden = harness();
  hidden.named("CALIBRATE").click();
  hidden.pass(CALIBRATION_LOOP_MS);
  hidden.audio.setHidden(true);
  hidden.pass(CALIBRATION_LOOP_MS);
  assert.equal(hidden.panel.busy, false);
  assert.equal(hidden.note(), SOUND_LOCKED);

  const silenced = harness();
  silenced.named("CALIBRATE").click();
  silenced.pass(CALIBRATION_LOOP_MS);
  silenced.audio.setMuted(true);
  const clicks = silenced.tones.length;
  silenced.pass(CALIBRATION_LOOP_MS);
  assert.equal(silenced.panel.busy, false);
  assert.equal(silenced.note(), SOUND_OFF);
  for (let step = 0; step < 10; step++) silenced.pass(CALIBRATION_LOOP_MS);
  assert.equal(silenced.tones.length, clicks);
});

test("busy is true exactly while a key is captured or a calibration runs", () => {
  const h = harness();
  assert.equal(h.panel.busy, false);
  h.slide(h.one<HTMLInputElement>("input"), 2);
  h.named("TARGETS AT BOTTOM").click();
  h.named("Remove J from Left").click();
  assert.equal(h.panel.busy, false, "plain changes never make it busy");

  h.add("down").click();
  assert.equal(h.panel.busy, true);
  h.key("KeyF");
  assert.equal(h.panel.busy, false);

  // One thing at a time: a calibration ends a capture, and a capture ends a calibration.
  h.add("down").click();
  h.named("CALIBRATE").click();
  assert.equal(h.panel.busy, true);
  assert.equal(h.add("down").textContent, "ADD KEY");
  const before = h.changes.length;
  h.key("KeyG");
  assert.equal(h.changes.length, before, "a tap now, not a binding");
  h.add("up").click();
  assert.equal(h.panel.busy, true);
  assert.equal(h.live(), 0, "the calibration stopped");
  assert.equal(h.shown(h.one(".fm-settings-pad")), false);
  h.key("Escape");
  assert.equal(h.panel.busy, false);

  h.named("CALIBRATE").click();
  assert.equal(h.panel.busy, true);
  let turns = 0;
  while (h.panel.busy && turns++ < 400) h.pass(CALIBRATION_LOOP_MS);
  assert.equal(h.panel.busy, false, "a result on show is not busy");
  assert.equal(h.has("RETRY"), true);
  assert.equal(h.key("KeyF").defaultPrevented, false);
});

test("dispose stops everything and takes the panel off the page", () => {
  const h = harness();
  h.named("CALIBRATE").click();
  h.pass(CALIBRATION_LOOP_MS);
  const calibrate = h.one<HTMLButtonElement>(".fm-settings-calibrate"),
    add = h.add("left");
  h.panel.dispose();
  assert.equal(h.panel.busy, false);
  assert.equal(h.live(), 0);
  assert.equal(h.panel.element.isConnected, false);
  assert.equal(h.key("KeyF").defaultPrevented, false);
  // Its controls are dead: nothing starts and nothing is reported.
  calibrate.click();
  add.click();
  h.panel.refresh();
  h.panel.cancel();
  h.panel.dispose();
  assert.equal(h.panel.busy, false);
  assert.equal(h.loops.length, 1);
  assert.equal(h.changes.length, 0);
});
