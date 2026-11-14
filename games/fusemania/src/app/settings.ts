import { button as makeButton, elementsFor } from "fuse-ui";
import type { AudioClock, GameAudio } from "fuse-ui/game-audio";
import {
  CALIBRATION_MIN_TAPS,
  CALIBRATION_REACH,
  calibrate,
  placeLag,
  type Calibration,
} from "./calibration.js";
import {
  ACTIONS,
  COLUMN_ACTIONS,
  MAX_KEYS,
  MAX_AUDIO_MS,
  MAX_OFFSET_MS,
  MAX_SPEED,
  MAX_VISUAL_MS,
  MIN_SPEED,
  RESERVED_CODES,
  actionOf,
  bindKey,
  defaultPrefs,
  keyLabel,
  unbindKey,
  type Action,
  type Prefs,
} from "./prefs.js";
import { createSongClock, type SongClock } from "./song-clock.js";

/**
 * The settings panel: the keys, the scroll, the three timing offsets and the tap calibration that measures the audio
 * and input ones. It owns no preferences: it reads them from the page and hands every change back as a new object.
 */
export interface SettingsOptions {
  document: Document;
  /** The current preferences; read on every render. */
  prefs(): Prefs;
  /** The new preferences after any change; the page saves and applies them. */
  onChange(prefs: Prefs): void;
  audio: GameAudio;
  /** `performance.now()`. */
  now(): number;
  /** Runs `run` every `ms` until the returned function is called (the browser adapter is setInterval/clearInterval). */
  every(run: () => void, ms: number): () => void;
}
export interface SettingsPanel {
  element: HTMLElement;
  /** Re-reads `prefs()` (they changed elsewhere). */
  refresh(): void;
  /** True while a key is being captured for a binding or a calibration is running: the page must not treat key presses as anything else. */
  readonly busy: boolean;
  /** Cancels a key capture and stops a calibration (the dialog closed, the page hid). */
  cancel(): void;
  dispose(): void;
}

/** A calibration click every this many ms. */
export const BEAT_MS = 600;
/** Clicks heard before the ones that count. */
export const COUNT_IN = 4;
/** Clicks the player taps along with. */
export const CALIBRATION_CLICKS = 16;
/** The scheduling loop's period. */
export const CALIBRATION_LOOP_MS = 100;
export const SPEED_STEP = 0.25;
export const OFFSET_STEP_MS = 5;

export const SOUND_OFF = "Turn sound on to calibrate";
export const SOUND_LOCKED = "Press any key to start sound, then try again";
export const EFFECTS_OFF = "Turn the effects volume up to calibrate";
export const INTERRUPTED = "Calibration was interrupted. Try again.";

const BEAT_S = BEAT_MS / 1000;
const TOTAL_CLICKS = COUNT_IN + CALIBRATION_CLICKS;
/** The first click is this far ahead of the start, so the clock mapping has a few samples before anything sounds. */
const LEAD_S = 0.5;
/** A click is handed to the audio clock once it is this near: two loop periods of slack for a late timer. */
const AHEAD_S = 0.3;
/** How long a click's ring shows; matches the animation in settings.css. */
const PULSE_MS = 450;
/** Taps kept from one run: a held-down mash cannot grow the list. */
const MAX_TAPS = 256;
/** A key press's own time stamp is used when it is on `now()`'s timeline and no older than this. */
const STALE_PRESS_MS = 1000;

const NAMES: Record<Action, string> = {
  left: "Left",
  down: "Down",
  up: "Up",
  right: "Right",
  item: "Power-up",
};
const GLYPHS: Record<Action, string> = {
  left: "←",
  down: "↓",
  up: "↑",
  right: "→",
  item: "★",
};
const MODIFIER = /^(?:Control|Alt|Meta|Shift)(?:Left|Right)$/;
/** The keys `keyLabel` shows as an arrow, which the pixel font cannot draw. */
const ARROW_KEY = /^Arrow(?:Left|Down|Up|Right)$/;

const clamp = (value: number, min: number, max: number) =>
  Math.max(min, Math.min(max, value));
/** A copy that shares nothing with `prefs`, so the page's object is never the one that changes. */
const copy = (prefs: Prefs): Prefs => ({
  ...prefs,
  keys: {
    left: [...prefs.keys.left],
    down: [...prefs.keys.down],
    up: [...prefs.keys.up],
    right: [...prefs.keys.right],
    item: [...prefs.keys.item],
  },
});
const sameKeys = (a: Prefs, b: Prefs) =>
  ACTIONS.every(
    (action) =>
      a.keys[action].length === b.keys[action].length &&
      a.keys[action].every((key, index) => key === b.keys[action][index]),
  );

/** `+35 ms`, `−10 ms`, `0 ms`. */
export const signedMs = (ms: number): string =>
  ms === 0 ? "0 ms" : `${ms > 0 ? "+" : "−"}${Math.abs(ms)} ms`;
export const speedText = (speed: number): string =>
  `${Math.round(speed * 100) / 100}x`;
export const offsetText = (ms: number): string =>
  ms === 0 ? "0 ms" : `${signedMs(ms)}: you tap ${ms > 0 ? "late" : "early"}`;
export const audioText = (ms: number): string =>
  ms === 0
    ? "0 ms"
    : `${signedMs(ms)} · sound ${ms > 0 ? "arrives late" : "arrives early"}`;
export const visualText = (ms: number): string =>
  ms === 0
    ? "0 ms"
    : `${signedMs(ms)}: arrows drawn ${ms > 0 ? "earlier" : "later"}`;
/** What a finished calibration says. */
export function calibrationText(result: Calibration): string {
  const spread = Math.round(result.spreadMs);
  if (!result.ok)
    return result.used < CALIBRATION_MIN_TAPS
      ? `Only ${result.used} of ${CALIBRATION_CLICKS} taps landed near a click: too few to trust. Tap on every click and try again.`
      : `Your taps were too inconsistent to trust (±${spread} ms). Try again, tapping by ear on every click.`;
  const ms = Math.round(result.offsetMs);
  const where =
    ms === 0
      ? "right on the click"
      : `${Math.abs(ms)} ms ${ms > 0 ? "late" : "early"}`;
  return `You tap ${where} (±${spread} ms)`;
}

/** One calibration in progress. */
interface Run {
  clock: AudioClock;
  songClock: SongClock;
  /** The audio-clock time of the first count-in click. */
  base: number;
  /** The audio-clock time each click was scheduled at, in order. */
  clicks: number[];
  /** The audio-clock time of what was being heard at each tap. */
  taps: number[];
  rings: { element: HTMLElement; until: number }[];
  stop(): void;
}
type CalibrationState =
  | { stage: "idle"; note: string }
  | { stage: "running"; run: Run }
  | { stage: "result"; result: Calibration };

/** Ids for the labels of one panel; a second panel in the same document gets its own. */
let panels = 0;

export function createSettingsPanel(options: SettingsOptions): SettingsPanel {
  const doc = options.document,
    audio = options.audio,
    el = elementsFor(doc),
    // Every button carries the shared class: its rules outrank the page's `.fui-app button` wherever the panel sits.
    button = (text: string, className: string) =>
      makeButton(text, `fm-settings-button ${className}`, doc),
    uid = `fm-settings-${++panels}`;

  /** The action waiting for its next key. */
  let capturing: Action | undefined;
  let keysNote = "";
  let calibration: CalibrationState = { stage: "idle", note: "" };
  let listening = false;
  let disposed = false;

  const element = el("div", "", "fm-settings");
  const section = (title: string) => {
    const result = el("section", "", "fm-settings-section");
    result.setAttribute("aria-label", title);
    result.append(el("h3", title.toUpperCase(), "fm-settings-heading"));
    return result;
  };

  // ---- keys ----

  const keys = section("Keys");
  const rows = ACTIONS.map((action) => {
    const row = el("div", "", "fm-settings-key-row"),
      name = el("span", "", "fm-settings-action"),
      glyph = el("span", GLYPHS[action], "fm-settings-glyph"),
      chips = el("span", "", "fm-settings-chips"),
      add = button("ADD KEY", "fm-settings-add");
    row.dataset.action = action;
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", `${NAMES[action]} keys`);
    glyph.setAttribute("aria-hidden", "true");
    name.append(glyph, NAMES[action].toUpperCase());
    add.setAttribute("aria-label", `Add a key for ${NAMES[action]}`);
    add.addEventListener("click", () => {
      if (disposed) return;
      if (capturing === action) stopCapture();
      else startCapture(action);
      render();
    });
    row.append(name, chips, add);
    return { action, row, chips, add };
  });
  const keysStatus = el("p", "", "fm-settings-note");
  keysStatus.setAttribute("role", "status");
  const reset = button("RESET KEYS", "fm-settings-reset");
  reset.addEventListener("click", () => {
    if (disposed) return;
    stopCapture();
    const prefs = options.prefs(),
      next = { ...copy(prefs), keys: defaultPrefs().keys };
    if (sameKeys(prefs, next)) render();
    else change(next);
  });
  const keyRows = el("div", "", "fm-settings-keys");
  keyRows.append(...rows.map((entry) => entry.row));
  keys.append(
    keyRows,
    keysStatus,
    el(
      "p",
      "Both hands work: WASD and IJKL are the same four arrows.",
      "fm-settings-hint",
    ),
    reset,
  );

  function startCapture(action: Action): void {
    stopCalibration("");
    capturing = action;
    const bound = options.prefs().keys[action];
    keysNote =
      bound.length >= MAX_KEYS
        ? `Press a key for ${NAMES[action]}: it replaces ${keyLabel(bound[0]!)}. Esc cancels.`
        : `Press a key for ${NAMES[action]}. Esc cancels.`;
  }
  function stopCapture(note = ""): void {
    capturing = undefined;
    keysNote = note;
  }
  function capture(action: Action, key: string): void {
    const prefs = options.prefs();
    if (prefs.keys[action].includes(key)) {
      stopCapture();
      render();
      return;
    }
    const next = bindKey(prefs, action, key);
    if (next === prefs) {
      // Refused: the capture stays open for another key.
      const owner = actionOf(prefs, key);
      keysNote = owner
        ? `${keyLabel(key)} is the only key for ${NAMES[owner]}: give ${NAMES[owner]} another key first.`
        : "That key cannot be bound. Press another, or Esc to cancel.";
      render();
      return;
    }
    stopCapture();
    change(next);
  }
  function renderKeys(prefs: Prefs): void {
    for (const row of rows) {
      const bound = prefs.keys[row.action];
      const keeps =
        COLUMN_ACTIONS.includes(row.action) && bound.length <= 1
          ? bound[0]
          : undefined;
      row.chips.replaceChildren(
        ...bound.map((key) => {
          const chip = el("span", "", "fm-settings-chip");
          chip.dataset.key = key;
          chip.append(
            el(
              "span",
              keyLabel(key),
              ARROW_KEY.test(key)
                ? "fm-settings-chip-label fm-settings-chip-arrow"
                : "fm-settings-chip-label",
            ),
          );
          if (key === keeps) return chip;
          const remove = button("×", "fm-settings-remove");
          remove.setAttribute(
            "aria-label",
            `Remove ${keyLabel(key)} from ${NAMES[row.action]}`,
          );
          remove.addEventListener("click", () => {
            if (disposed) return;
            stopCapture();
            const now = options.prefs(),
              next = unbindKey(now, row.action, key);
            if (next === now) render();
            else change(next);
            // The chip is gone, and the focus with it.
            row.add.focus();
          });
          chip.append(remove);
          return chip;
        }),
      );
      if (bound.length === 0)
        row.chips.append(el("span", "NO KEY", "fm-settings-empty"));
      const active = capturing === row.action;
      row.add.textContent = active ? "PRESS A KEY…" : "ADD KEY";
      row.add.setAttribute("aria-pressed", String(active));
    }
    keysStatus.textContent = keysNote;
    keysStatus.hidden = keysNote === "";
  }

  // ---- scroll ----

  const scroll = section("Scroll");
  const speedField = el("div", "", "fm-settings-field"),
    speedHead = el("div", "", "fm-settings-field-head"),
    speedLabel = el("label", "SPEED", "fm-settings-label"),
    speedValue = el("span", "", "fm-settings-value"),
    speed = el("input", "", "fm-settings-range");
  speed.type = "range";
  speed.id = `${uid}-speed`;
  speed.setAttribute("min", String(MIN_SPEED));
  speed.setAttribute("max", String(MAX_SPEED));
  speed.setAttribute("step", String(SPEED_STEP));
  speedLabel.setAttribute("for", speed.id);
  speed.addEventListener("input", () => {
    if (disposed) return;
    const raw = Number(speed.value);
    if (!Number.isFinite(raw)) return render();
    const value = clamp(
      Math.round(raw / SPEED_STEP) * SPEED_STEP,
      MIN_SPEED,
      MAX_SPEED,
    );
    const prefs = options.prefs();
    if (value === prefs.speed) render();
    else change({ ...copy(prefs), speed: value });
  });
  speedHead.append(speedLabel, speedValue);
  speedField.append(speedHead, speed);

  const directionField = el("div", "", "fm-settings-field"),
    directionLabel = el("span", "DIRECTION", "fm-settings-label"),
    direction = el("div", "", "fm-settings-toggle"),
    onTop = button("TARGETS ON TOP", "fm-settings-choice"),
    atBottom = button("TARGETS AT BOTTOM", "fm-settings-choice");
  directionLabel.id = `${uid}-direction`;
  direction.setAttribute("role", "group");
  direction.setAttribute("aria-labelledby", directionLabel.id);
  const setDown = (down: boolean) => {
    if (disposed) return;
    const prefs = options.prefs();
    if (prefs.down === down) render();
    else change({ ...copy(prefs), down });
  };
  onTop.addEventListener("click", () => setDown(false));
  atBottom.addEventListener("click", () => setDown(true));
  direction.append(onTop, atBottom);
  directionField.append(directionLabel, direction);
  scroll.append(speedField, directionField);

  function renderScroll(prefs: Prefs): void {
    const text = speedText(prefs.speed);
    speed.value = String(prefs.speed);
    speed.setAttribute("aria-valuetext", text);
    speedValue.textContent = text;
    onTop.setAttribute("aria-pressed", String(!prefs.down));
    atBottom.setAttribute("aria-pressed", String(prefs.down));
  }

  // ---- timing ----

  const timing = section("Timing");
  /** A slider between a − and a + button, for one of the offsets. */
  const offsetField = (spec: {
    key: "offsetMs" | "visualMs" | "audioMs";
    title: string;
    max: number;
    text(ms: number): string;
    hint: string;
  }) => {
    const field = el("div", "", "fm-settings-field"),
      head = el("div", "", "fm-settings-field-head"),
      label = el("label", spec.title, "fm-settings-label"),
      value = el("span", "", "fm-settings-value"),
      stepper = el("div", "", "fm-settings-stepper"),
      less = button("−", "fm-settings-step"),
      more = button("+", "fm-settings-step"),
      range = el("input", "", "fm-settings-range");
    field.dataset.offset = spec.key;
    range.type = "range";
    range.id = `${uid}-${spec.key}`;
    range.setAttribute("min", String(-spec.max));
    range.setAttribute("max", String(spec.max));
    range.setAttribute("step", String(OFFSET_STEP_MS));
    label.setAttribute("for", range.id);
    const name = spec.title.toLowerCase();
    less.setAttribute("aria-label", `Lower ${name} by ${OFFSET_STEP_MS} ms`);
    more.setAttribute("aria-label", `Raise ${name} by ${OFFSET_STEP_MS} ms`);
    const set = (raw: number) => {
      if (disposed) return;
      const prefs = options.prefs();
      if (!Number.isFinite(raw)) return render();
      const ms = clamp(Math.round(raw), -spec.max, spec.max);
      if (ms === prefs[spec.key]) render();
      else change({ ...copy(prefs), [spec.key]: ms });
    };
    range.addEventListener("input", () => set(Number(range.value)));
    // A calibrated offset is rarely on the grid: the buttons step to the next multiple, not past it.
    less.addEventListener("click", () =>
      set(
        (Math.ceil(options.prefs()[spec.key] / OFFSET_STEP_MS) - 1) *
          OFFSET_STEP_MS,
      ),
    );
    more.addEventListener("click", () =>
      set(
        (Math.floor(options.prefs()[spec.key] / OFFSET_STEP_MS) + 1) *
          OFFSET_STEP_MS,
      ),
    );
    head.append(label, value);
    stepper.append(less, range, more);
    field.append(head, stepper);
    if (spec.hint) field.append(el("p", spec.hint, "fm-settings-hint"));
    return {
      field,
      render(prefs: Prefs) {
        const ms = prefs[spec.key],
          text = spec.text(ms);
        range.value = String(ms);
        range.setAttribute("aria-valuetext", text);
        value.textContent = text;
        less.disabled = ms <= -spec.max;
        more.disabled = ms >= spec.max;
      },
    };
  };
  const inputOffset = offsetField({
    key: "offsetMs",
    title: "INPUT OFFSET",
    max: MAX_OFFSET_MS,
    text: offsetText,
    hint: "",
  });
  const visualOffset = offsetField({
    key: "visualMs",
    title: "VISUAL OFFSET",
    max: MAX_VISUAL_MS,
    text: visualText,
    hint: "Raise it if arrows reach the targets after the beat",
  });
  const audioOffset = offsetField({
    key: "audioMs",
    title: "AUDIO OFFSET",
    max: MAX_AUDIO_MS,
    text: audioText,
    hint: "For sound that arrives late: Bluetooth, a TV, a soundbar. Moves arrows and judging together",
  });

  // ---- calibration ----

  const calibrationBox = el("div", "", "fm-settings-calibration"),
    calibrateButton = button("CALIBRATE", "fm-settings-calibrate"),
    calibrationHint = el(
      "p",
      `Hear ${COUNT_IN} clicks, then tap along with the next ${CALIBRATION_CLICKS} to measure your input offset.`,
      "fm-settings-hint",
    ),
    calibrationStatus = el("p", "", "fm-settings-note"),
    stage = el("div", "", "fm-settings-stage"),
    count = el("p", "", "fm-settings-count"),
    pad = button("", "fm-settings-pad"),
    stageHint = el(
      "p",
      "Tap any key, or the pad, on every click. Go by ear, not by eye. Esc cancels.",
      "fm-settings-hint",
    ),
    outcome = el("p", "", "fm-settings-result"),
    actions = el("div", "", "fm-settings-actions"),
    apply = button("APPLY", "fm-settings-apply"),
    retry = button("RETRY", "fm-settings-retry"),
    cancelButton = button("CANCEL", "fm-settings-cancel");
  calibrationStatus.setAttribute("role", "status");
  outcome.setAttribute("role", "status");
  outcome.setAttribute("tabindex", "-1");
  pad.setAttribute("aria-label", "Tap pad: tap here on every click");
  pad.append(el("span", "TAP", "fm-settings-pad-label"));
  stage.append(count, pad, stageHint);
  actions.append(apply, retry, cancelButton);
  calibrationBox.append(
    calibrateButton,
    calibrationHint,
    calibrationStatus,
    stage,
    outcome,
    actions,
  );
  timing.append(
    inputOffset.field,
    audioOffset.field,
    visualOffset.field,
    calibrationBox,
  );

  const running = (): Run | undefined =>
    calibration.stage === "running" ? calibration.run : undefined;
  /** Ends the run in progress, if any, and leaves the calibration idle with `note`. */
  function stopCalibration(note: string): void {
    const run = running();
    if (run) {
      run.stop();
      for (const ring of run.rings) ring.element.remove();
      run.rings.length = 0;
    }
    calibration = { stage: "idle", note };
  }
  function startCalibration(): void {
    stopCapture();
    stopCalibration("");
    audio.unlock();
    const clock = audio.clock();
    // Why it cannot start, when it cannot: there would be nothing to tap along with.
    const blocked =
      !clock || audio.prefs.muted
        ? SOUND_OFF
        : !clock.running
          ? SOUND_LOCKED
          : !audio.audible
            ? SOUND_OFF
            : audio.prefs.effects <= 0
              ? EFFECTS_OFF
              : "";
    if (!clock || blocked) calibration = { stage: "idle", note: blocked };
    else {
      const run: Run = {
        clock,
        songClock: createSongClock({
          now: () => options.now(),
          audio: () => audio.clock(),
          extraLatencyMs: () => options.prefs().audioMs,
        }),
        base: clock.now() + LEAD_S,
        clicks: [],
        taps: [],
        rings: [],
        stop: () => undefined,
      };
      calibration = { stage: "running", run };
      pad.removeAttribute("data-tap");
      run.stop = options.every(() => tick(run), CALIBRATION_LOOP_MS);
      tick(run);
    }
    render();
  }
  /** The loop: keeps the clock mapping fed and hands each click to the audio clock a little ahead of time. */
  function tick(run: Run): void {
    if (running() !== run) return;
    if (!run.clock.running) return fail(SOUND_LOCKED);
    if (!audio.audible) return fail(SOUND_OFF);
    run.songClock.sample();
    const at = run.clock.now();
    while (run.clicks.length < TOTAL_CLICKS) {
      const index = run.clicks.length,
        delay = run.base + index * BEAT_S - at;
      if (delay > AHEAD_S) break;
      // The loop stalled past a click (a throttled tab): the clicks would no longer be a steady beat.
      if (delay < 0) return fail(INTERRUPTED);
      audio.tone({
        frequency: index < COUNT_IN ? 880 : 1320,
        duration: 0.05,
        type: "square",
        volume: 0.2,
        delay,
      });
      run.clicks.push(at + delay);
      pulse(run, at + delay, index < COUNT_IN);
    }
    const now = options.now();
    run.rings = run.rings.filter((ring) => {
      if (ring.until > now) return true;
      ring.element.remove();
      return false;
    });
    const heard = run.songClock.audioTime(),
      last = run.clicks[TOTAL_CLICKS - 1];
    if (
      last !== undefined &&
      heard !== undefined &&
      heard > last + CALIBRATION_REACH * BEAT_S
    )
      return finish(run);
    count.textContent = countText(run);
  }
  function fail(note: string): void {
    stopCalibration(note);
    render();
  }
  /** A ring on the pad that opens when the click scheduled at `click` is heard. */
  function pulse(run: Run, click: number, countIn: boolean): void {
    const heard = run.songClock.audioTime();
    if (heard === undefined) return;
    const wait = Math.max(0, (click - heard) * 1000);
    const ring = el(
      "span",
      "",
      countIn ? "fm-settings-ring fm-settings-ring-ready" : "fm-settings-ring",
    );
    ring.setAttribute("aria-hidden", "true");
    ring.style.animationDelay = `${Math.round(wait)}ms`;
    pad.append(ring);
    run.rings.push({ element: ring, until: options.now() + wait + PULSE_MS });
  }
  /** Which click is nearest to what is being heard now. */
  function countText(run: Run): string {
    const heard = run.songClock.audioTime();
    if (heard === undefined) return "LISTEN…";
    const beat = Math.round((heard - run.base) / BEAT_S) - COUNT_IN;
    if (beat < -COUNT_IN) return "LISTEN…";
    if (beat < 0) return `READY ${beat + COUNT_IN + 1} / ${COUNT_IN}`;
    return `TAP ${Math.min(beat + 1, CALIBRATION_CLICKS)} / ${CALIBRATION_CLICKS}`;
  }
  /** A press as a time on `now()`'s timeline: its own stamp when that is one, the present otherwise. */
  function pressTime(stamp: number): number {
    const now = options.now();
    return Number.isFinite(stamp) &&
      stamp > 0 &&
      stamp <= now + 5 &&
      now - stamp < STALE_PRESS_MS
      ? stamp
      : now;
  }
  function tap(run: Run, stamp: number): void {
    if (run.taps.length >= MAX_TAPS) return;
    run.songClock.sample();
    const heard = run.songClock.audioTime(pressTime(stamp));
    if (heard === undefined) return;
    run.taps.push(heard);
    // Two names for one animation, so every tap restarts it.
    pad.dataset.tap = pad.dataset.tap === "a" ? "b" : "a";
    count.textContent = countText(run);
  }
  function finish(run: Run): void {
    // `audioTime` is already the heard time (the output latency is taken off), so a tap's distance from a click is
    // its heard time minus the time the click was scheduled at.
    const first = run.clicks[COUNT_IN]!;
    const result = calibrate(
      run.taps.map((heard) => (heard - first) * 1000),
      BEAT_MS,
    );
    stopCalibration("");
    calibration = { stage: "result", result };
    render();
  }

  calibrateButton.addEventListener("click", () => {
    if (!disposed) startCalibration();
  });
  retry.addEventListener("click", () => {
    if (!disposed) startCalibration();
  });
  cancelButton.addEventListener("click", () => {
    if (disposed) return;
    stopCalibration("");
    render();
  });
  apply.addEventListener("click", () => {
    if (disposed || calibration.stage !== "result" || !calibration.result.ok)
      return;
    const prefs = options.prefs();
    // Taps were heard with the audio offset in use, so what they show is what is left for the input offset; a lag
    // too large to be a keyboard's is the sound's, and goes to the audio offset.
    const placed = placeLag(calibration.result.offsetMs, prefs.audioMs, {
      input: MAX_OFFSET_MS,
      audio: MAX_AUDIO_MS,
    });
    calibration = {
      stage: "idle",
      note:
        placed.moved === "audio"
          ? `Sound arrives late here: audio offset set to ${signedMs(placed.audioMs)}, input offset to ${signedMs(placed.offsetMs)}.`
          : `Input offset set to ${signedMs(placed.offsetMs)}.`,
    };
    if (prefs.offsetMs === placed.offsetMs && prefs.audioMs === placed.audioMs)
      render();
    else
      change({
        ...copy(prefs),
        offsetMs: placed.offsetMs,
        audioMs: placed.audioMs,
      });
  });
  pad.addEventListener("pointerdown", (event) => {
    const run = running();
    // Any finger or the main mouse button; a right click is not a tap.
    if (!run || event.button > 0) return;
    tap(run, event.timeStamp);
  });

  function renderCalibration(): void {
    const idle = calibration.stage === "idle",
      result = calibration.stage === "result" ? calibration.result : undefined,
      note = calibration.stage === "idle" ? calibration.note : "";
    calibrateButton.hidden = !idle;
    calibrationHint.hidden = !idle;
    calibrationStatus.textContent = note;
    calibrationStatus.hidden = note === "";
    stage.hidden = calibration.stage !== "running";
    if (calibration.stage === "running")
      count.textContent = countText(calibration.run);
    outcome.hidden = !result;
    outcome.textContent = result ? calibrationText(result) : "";
    outcome.classList.toggle("fm-settings-result-bad", result?.ok === false);
    actions.hidden = idle;
    apply.hidden = !result?.ok;
    retry.hidden = !result;
  }

  // ---- the panel ----

  /** While the panel is busy every key is its own: a binding, a tap, or Escape to stop. */
  const onKey = (event: KeyboardEvent) => {
    const run = running();
    if (!capturing && !run) return;
    event.stopPropagation();
    const key = event.code;
    if (key === "Escape") {
      event.preventDefault();
      stopCapture();
      stopCalibration("");
      render();
      return;
    }
    // The browser's own keys stay the browser's: Tab, reload, the developer tools, a shortcut with a modifier.
    const shortcut =
      (event.ctrlKey || event.metaKey || event.altKey) && !MODIFIER.test(key);
    if (RESERVED_CODES.includes(key)) {
      if (capturing) {
        stopCapture(`${keyLabel(key)} cannot be bound.`);
        render();
      }
      return;
    }
    if (shortcut) return;
    event.preventDefault();
    if (event.repeat) return;
    if (capturing) capture(capturing, key);
    else if (run) tap(run, event.timeStamp);
  };

  function change(next: Prefs): void {
    options.onChange(next);
    render();
  }
  function render(): void {
    if (disposed) return;
    // A control that is about to be hidden takes the keyboard focus with it: note it, and hand the focus on.
    const focused = doc.activeElement;
    const prefs = options.prefs();
    renderKeys(prefs);
    renderScroll(prefs);
    inputOffset.render(prefs);
    audioOffset.render(prefs);
    visualOffset.render(prefs);
    renderCalibration();
    const busy = capturing !== undefined || running() !== undefined;
    if (busy !== listening) {
      listening = busy;
      if (busy) doc.addEventListener("keydown", onKey, true);
      else doc.removeEventListener("keydown", onKey, true);
    }
    if (
      focused &&
      calibrationBox.contains(focused) &&
      focused.closest("[hidden]")
    )
      (calibration.stage === "running"
        ? pad
        : calibration.stage === "result"
          ? outcome
          : calibrateButton
      ).focus();
  }

  element.append(keys, scroll, timing);
  render();

  return {
    element,
    refresh: render,
    get busy() {
      return capturing !== undefined || running() !== undefined;
    },
    cancel() {
      if (disposed) return;
      stopCapture();
      stopCalibration("");
      render();
    },
    dispose() {
      if (disposed) return;
      stopCapture();
      stopCalibration("");
      render();
      disposed = true;
      element.remove();
    },
  };
}
