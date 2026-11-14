import type { ClockedSong, GameAudio } from "fuse-ui/game-audio";
import { WINDOWS } from "../engine/index.js";
import { blit } from "../render/frame.js";
import { BASE_WINDOW_MS } from "../render/mods.js";
import { CYAN, JUDGMENT_COLORS, hexA } from "../render/palette.js";
import type { CanvasFactory, Pen } from "../render/pen.js";
import { createSprites, type SpriteSet } from "../render/sprites.js";
import {
  CLICK_RATES,
  DEFAULT_CLICK_RATE,
  beatS,
  clickRateOf,
  judgeTap,
  lapWav,
} from "./click-track.js";
import type { TimingView } from "./debug-timing.js";
import { createFrameLead } from "./frame-lead.js";
import { createLatencyProbe } from "./latency.js";
import { COLUMN_ACTIONS, actionOf, type Prefs } from "./prefs.js";
import { createSongClock } from "./song-clock.js";
import { createTickLoop, type TickLoop } from "./tick-loop.js";
import { adviseRun, type TimingAdvice } from "./timing-advice.js";
import { createTimingLab } from "./timing-lab.js";
import { meanOf } from "./timing-session.js";

/**
 * The Timing screen: thirty seconds of a steady click with one lane of arrows on it, then what was measured, what
 * to do about it and one button that does it. It is where a player lines the game up with a device, and it is
 * nothing else: no song, no chart, no score, no room and no rivals.
 *
 * A run is made by ear (the click is heard: it finds the input offset, or the audio offset when the lag is too
 * large to be a keyboard's) or by eye (the click is silent and only the arrows are followed: against the lag by
 * ear, what is left is the visual offset). `timing-advice.ts` turns a run's taps into its advice.
 *
 * Nothing here touches the engine or a room. The click is on the audio clock (`tick-loop.ts`), a tap's place is
 * the heard position at its browser stamp, exactly as a press in a song is placed, and the arrows are drawn with
 * the frame lead and the visual offset a song is drawn with: what is set here is what a song then plays with. The
 * offsets are the player's saved ones and are saved the moment they change.
 */
export interface TimingScreenDeps {
  doc: Document;
  win: Window;
  audio: GameAudio;
  prefs(): Prefs;
  setPrefs(next: Prefs): void;
  /** `performance.now()`. */
  now(): number;
  createCanvas: CanvasFactory;
  /** The click's first rate, ticks a minute. */
  bpm?: number;
  /** Seconds of counted ticks in a run; `RUN_S` when absent. */
  seconds?: number;
  /** Opens the panel's details (`?debugtiming`). */
  details?: boolean;
  /** False reads the heard position from the stepped clock and the reported latency (`?audioclock=reported`). */
  pairing?: boolean;
}
export interface TimingScreen {
  element: HTMLElement;
  /** What the panel shows and the session's log, for the console and for a script driving the page. */
  snapshot(): TimingView;
  logText(): string;
  /**
   * Where the screen is: its phase, the click's rate, the run's kind, the heard position in ms from tick 0
   * (undefined while nothing runs), how many ticks lead in and are counted, and the newest run's advice.
   */
  state(): {
    phase: "idle" | "run" | "result";
    bpm: number;
    kind: "ear" | "eye" | undefined;
    heardMs: number | undefined;
    countIn: number;
    ticks: number;
    advice: TimingAdvice | undefined;
  };
  dispose(): void;
}

/** Seconds of counted ticks in a run. */
export const RUN_S = 30;
/** Ticks before the counted ones: time to find the pulse. Taps on them are shown and not counted. */
export const RUN_COUNT_IN = 4;

const JUDGMENT_WORDS = ["MARVELOUS", "PERFECT", "GREAT", "GOOD", "BOO"];
const signed = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}`;
/** How long a tap lights the target, and how long its burst lasts, ms. */
const LIT_MS = 90,
  BURST_MS = 260;
/** The column whose arrow the lane shows: up. */
const ARROW = 2;

interface Run {
  kind: "ear" | "eye";
  bpm: number;
  /** Counted ticks. */
  ticks: number;
  /** The click, once its lap has been decoded; a silent page has none. */
  loop: TickLoop | undefined;
  song: ClockedSong | undefined;
  /** With no audio clock at all (`?mute`), the page time of tick 0. */
  silentFrom: number;
  /** Counted taps as they were heard, ms from the first counted tick, and what the judge made of them. */
  taps: number[];
  errors: number[];
  /** Ticks already tapped: a second tap on one is not another measurement. */
  hit: Set<number>;
  last: { offMs: number; judgment: number; at: number } | undefined;
  /** A run by ear had its sound off while ticks were counted: its taps were not by ear. */
  deaf: boolean;
}

export function createTimingScreen(deps: TimingScreenDeps): TimingScreen {
  const { doc, win, audio } = deps;
  const el = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    text = "",
    className = "",
  ): HTMLElementTagNameMap[K] => {
    const node = doc.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const button = (text: string, className: string, run: () => void) => {
    const node = el("button", text, `fui-button ${className}`);
    node.type = "button";
    // A game key must never press it again: it does not keep the focus.
    node.tabIndex = -1;
    node.addEventListener("click", () => {
      node.blur();
      run();
    });
    return node;
  };
  const setText = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };

  const probe = createLatencyProbe(),
    frameLead = createFrameLead(),
    songClock = createSongClock({
      now: deps.now,
      audio: () => audio.clock(),
      extraLatencyMs: () => deps.prefs().audioMs,
      pairing: () => deps.pairing !== false,
    });
  const seconds = deps.seconds && deps.seconds > 0 ? deps.seconds : RUN_S;

  // ---- the run ----
  let bpm = clickRateOf(deps.bpm ?? DEFAULT_CLICK_RATE) ?? DEFAULT_CLICK_RATE,
    run: Run | undefined,
    /** Counts the runs, so the lab can tell one run's ticks from the next and a lap that arrives late is dropped. */
    generation = 0,
    advice: TimingAdvice | undefined,
    /** What the newest finished run was, for RUN AGAIN, and what was said after an APPLY. */
    lastKind: "ear" | "eye" = "ear",
    /** The newest finished run's judged errors: what the details go on showing after it. */
    lastErrors: readonly number[] = [],
    note = "",
    /** The lag the newest by-ear run found, with the offsets it was found under. */
    earLag: { ms: number; audioMs: number } | undefined,
    litUntil = 0,
    disposed = false;
  const laps = new Map<number, string>();
  const lapUrl = (rate: number) => {
    let url = laps.get(rate);
    if (!url) {
      url = URL.createObjectURL(
        new Blob([lapWav(rate)], { type: "audio/wav" }),
      );
      laps.set(rate, url);
    }
    return url;
  };
  /** Whether a click would be heard: sound on, and not turned all the way down. */
  const soundOn = () => audio.audible && audio.prefs.music > 0;
  const stop = () => {
    run?.loop?.stop();
    run = undefined;
  };
  const start = (kind: "ear" | "eye") => {
    stop();
    audio.unlock();
    const turn = ++generation,
      rate = bpm,
      next: Run = {
        kind,
        bpm: rate,
        ticks: Math.max(1, Math.round(seconds / beatS(rate))),
        loop: undefined,
        song: undefined,
        silentFrom: deps.now() + 500,
        taps: [],
        errors: [],
        hit: new Set(),
        last: undefined,
        deaf: false,
      };
    run = next;
    advice = undefined;
    note = "";
    lab.record("run", {
      run: turn,
      by: kind,
      bpm: rate,
      ticks: next.ticks,
      countIn: RUN_COUNT_IN,
      offsets: offsets(),
    });
    // By eye the ticks still run on the audio clock where there is one, with the click turned all the way down:
    // the arrows are then exactly where a song's arrows would be.
    if (audio.clock())
      void audio.loadSong(lapUrl(rate)).then((song) => {
        // A run that was stopped while its click was loading is not this one any more.
        if (disposed || run !== next) return;
        if (!song) return abort("The click could not be loaded. Try again.");
        next.song = song;
        next.loop = createTickLoop({
          clock: () => audio.clock(),
          song,
          bpm: rate,
          count: RUN_COUNT_IN + next.ticks,
        });
      });
  };
  /** Ends the run with no result, and says why. */
  const abort = (why: string) => {
    stop();
    advice = undefined;
    lastErrors = [];
    note = why;
    readout();
  };
  /** The heard position at page time `at`, in ms from tick 0 of the run. */
  const position = (at: number): number | undefined => {
    if (!run) return undefined;
    if (!audio.clock()) return at - run.silentFrom;
    const origin = run.loop?.origin,
      heard = songClock.audioTime(at);
    return origin === undefined || heard === undefined
      ? undefined
      : (heard - origin) * 1000;
  };
  const offsets = () => {
    const prefs = deps.prefs();
    return {
      audioMs: prefs.audioMs,
      inputMs: prefs.offsetMs,
      visualMs: prefs.visualMs,
    };
  };
  const finish = (done: Run) => {
    const now = offsets();
    advice = adviseRun(
      {
        kind: done.kind,
        taps: done.taps,
        beatMs: beatS(done.bpm) * 1000,
        ticks: done.ticks,
      },
      now,
      // A lag found under another audio offset is not this picture's.
      earLag?.audioMs === now.audioMs ? earLag.ms : undefined,
    );
    if (done.kind === "ear" && advice.verdict !== "few")
      earLag =
        advice.verdict === "scattered"
          ? undefined
          : { ms: advice.lagMs, audioMs: now.audioMs };
    lastKind = done.kind;
    lastErrors = done.errors;
    // Everything the advice was made from, for whoever reads the session afterwards.
    lab.record("result", {
      run: generation,
      by: done.kind,
      bpm: done.bpm,
      ticks: done.ticks,
      offsets: now,
      ...advice,
      taps: done.taps.map((tap) => Math.round(tap * 10) / 10),
    });
    stop();
  };
  const setRate = (rate: number) => {
    const next = clickRateOf(rate);
    if (next === undefined || next === bpm) return;
    bpm = next;
    if (run) start(run.kind);
  };

  // ---- the page ----
  const element = el("main", "", "fm-ts"),
    field = el("section", "", "fm-ts-field"),
    canvas = el("canvas", "", "fm-ts-lane"),
    info = el("div", "", "fm-ts-info"),
    status = el("p", "", "fm-ts-status"),
    running = el("div", "", "fm-ts-running"),
    lastValue = el("output", "", "fm-ts-last"),
    lastWord = el("p", "", "fm-ts-word"),
    progress = el("progress", "", "fm-ts-progress"),
    mean = el("p", "", "fm-ts-mean"),
    result = el("div", "", "fm-ts-result"),
    measured = el("p", "", "fm-ts-measured"),
    todo = el("p", "", "fm-ts-advice"),
    actions = el("div", "", "fm-ts-actions"),
    rates = el("div", "", "fm-ts-rates"),
    setup = el("div", "", "fm-ts-setup");
  canvas.setAttribute(
    "aria-label",
    "The lane: tap here, or any arrow key, on every tick",
  );
  status.setAttribute("role", "status");
  result.setAttribute("role", "status");
  progress.max = 1;
  const apply = button("APPLY", "fui-button-primary fm-ts-apply", () => {
      const set = advice?.apply;
      if (!set) return;
      const before = offsets();
      lab.apply(set);
      const after = offsets();
      note = [
        after.audioMs !== before.audioMs
          ? `Audio offset set to ${signed(after.audioMs)} ms.`
          : "",
        after.inputMs !== before.inputMs
          ? `Input offset set to ${signed(after.inputMs)} ms.`
          : "",
        after.visualMs !== before.visualMs
          ? `Visual offset set to ${signed(after.visualMs)} ms.`
          : "",
        lastKind === "ear"
          ? "Run it again to check, then check the picture."
          : "Run it again to check.",
      ]
        .filter(Boolean)
        .join(" ");
      // The lag by ear is the offset that was just set: a by-eye run is compared with that.
      if (lastKind === "ear") earLag = undefined;
      advice = undefined;
      readout();
    }),
    byEar = button("", "fm-ts-ear", () => start("ear")),
    byEye = button("", "fm-ts-eye", () => start("eye")),
    cancel = button("STOP", "fm-ts-stop", () => {
      stop();
      readout();
    });
  const rateButtons = CLICK_RATES.map((rate) => {
    const node = button(`${rate / 60} / s`, "fm-ts-rate", () => {
      setRate(rate);
      readout();
    });
    rates.append(node);
    return { rate, node };
  });
  running.append(lastValue, lastWord, progress, mean, cancel);
  actions.append(apply, byEar, byEye);
  result.append(measured, todo);
  setup.append(el("h2", "TICKS A SECOND", "fm-ts-label"), rates);
  info.append(status, running, result, actions, setup);
  field.append(canvas, info);

  const lab = createTimingLab({
    mode: "screen",
    doc,
    win,
    audio,
    songClock,
    probe,
    frameLead,
    prefs: deps.prefs,
    setPrefs: deps.setPrefs,
    latencyContext() {
      const detail = audio.clock()?.latencies?.(),
        errors = meanOf(run?.errors ?? lastErrors);
      return {
        baseMs: detail?.base === undefined ? undefined : detail.base * 1000,
        outputMs:
          detail?.output === undefined ? undefined : detail.output * 1000,
        driftMs: 0,
        audible: (run?.kind ?? lastKind) === "ear" && soundOn(),
        offsetMs: deps.prefs().offsetMs,
        hits: { biasMs: errors.mean, spreadMs: errors.sd, used: errors.n },
      };
    },
    ticks() {
      const loop = run?.loop;
      return (
        loop && {
          bpm: loop.bpm,
          run: generation,
          heardMs: () => position(deps.now()),
          scheduledAt: loop.scheduledAt,
          last: loop.last,
        }
      );
    },
    rate: () => bpm,
    setRate(rate) {
      setRate(rate);
      readout();
    },
    details: deps.details,
    now: deps.now,
  });
  element.append(field, lab.element);

  // ---- taps ----
  const tap = (source: "key" | "touch", column: number, stamp: number) => {
    const now = deps.now(),
      // A browser's stamp is used when it is one: not zero, and within half a second of now.
      used = stamp > 0 && Math.abs(stamp - now) < 500,
      heard = position(used ? stamp : now);
    probe.press(source, stamp, now, used);
    litUntil = now + LIT_MS;
    if (!run || heard === undefined) return;
    const ms = heard - deps.prefs().offsetMs,
      judged = judgeTap(run.bpm, ms),
      // The lead-in is for finding the pulse, and nothing after the last counted tick is a tick.
      counted =
        judged.index >= RUN_COUNT_IN && judged.index < RUN_COUNT_IN + run.ticks,
      fresh = judged.judgment >= 0 && !run.hit.has(judged.index);
    lab.press(
      { source, column, stamp, handled: now, used, songMs: ms },
      fresh && counted ? judged : undefined,
    );
    if (!fresh) return;
    run.hit.add(judged.index);
    run.last = { offMs: judged.offMs, judgment: judged.judgment, at: now };
    if (!counted) return;
    run.taps.push(heard - RUN_COUNT_IN * beatS(run.bpm) * 1000);
    run.errors.push(judged.offMs);
    lab.judged({
      at: ms,
      judgment: judged.judgment,
      offMs: judged.offMs,
      by: run.kind === "ear" && soundOn() ? "ear" : "eye",
    });
  };
  const onKey = (event: KeyboardEvent) => {
    const target = event.target;
    if (
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      doc.querySelector("dialog[open]") ||
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement
    )
      return;
    // Enter on a link or a button is that control's.
    const control =
      target instanceof Element && target.closest("a, button, summary");
    if (event.code === "Enter" && !run && !control) {
      event.preventDefault();
      start(advice || note ? lastKind : audio.clock() ? "ear" : "eye");
      return readout();
    }
    if (event.code === "Escape" && run) {
      // This Escape is the run's: it is not also the page's Back.
      event.preventDefault();
      stop();
      return readout();
    }
    const action = actionOf(deps.prefs(), event.code),
      column = action ? COLUMN_ACTIONS.indexOf(action) : -1;
    if (!action || (control && column < 0)) return;
    // An arrow key would scroll the page, and so would the power-up's key (Space): that one is not a tap.
    event.preventDefault();
    if (column >= 0) tap("key", column, event.timeStamp);
  };
  const onPointer = (event: PointerEvent) => {
    // Any finger or the main mouse button; a right click is not a tap.
    if (event.button > 0) return;
    event.preventDefault();
    tap("touch", ARROW, event.timeStamp);
  };
  doc.addEventListener("keydown", onKey);
  canvas.addEventListener("pointerdown", onPointer);

  // ---- drawing ----
  let sprites: SpriteSet | undefined;
  const draw = (heard: number | undefined, now: number) => {
    const pen: Pen | null = canvas.getContext("2d");
    if (!pen) return;
    const ratio = win.devicePixelRatio || 1,
      width = Math.round(canvas.clientWidth * ratio),
      height = Math.round(canvas.clientHeight * ratio);
    if (width < 2 || height < 2) return;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    const cell = Math.round(Math.min(width * 0.62, height * 0.2, 132 * ratio));
    if (sprites?.cell !== Math.max(2, cell))
      sprites = createSprites(deps.createCanvas, cell);
    const prefs = deps.prefs(),
      x = width / 2,
      edge = cell * 0.85,
      target = prefs.down ? height - edge : edge,
      perMs = (height - edge) / (BASE_WINDOW_MS / prefs.speed);
    pen.setTransform(1, 0, 0, 1, 0, 0);
    pen.globalAlpha = 1;
    pen.clearRect(0, 0, width, height);
    pen.fillStyle = hexA(CYAN, 0.07);
    pen.fillRect(x - cell * 0.62, 0, cell * 1.24, height);
    blit(
      pen,
      (now < litUntil ? sprites.lit : sprites.receptors)[ARROW]!,
      x,
      target,
      1,
      1,
      0,
    );
    if (run && heard !== undefined) {
      // The frame is seen a refresh after it starts: the arrows are drawn where the sound will be then.
      const drawn = heard + frameLead.ms + prefs.visualMs,
        beat = beatS(run.bpm) * 1000,
        reach = WINDOWS[WINDOWS.length - 1]!;
      const first = Math.max(0, Math.ceil((drawn - reach) / beat)),
        to = Math.min(
          RUN_COUNT_IN + run.ticks - 1,
          Math.floor((drawn + BASE_WINDOW_MS / prefs.speed + 200) / beat),
        );
      for (let index = first; index <= to; index++) {
        if (run.hit.has(index)) continue;
        const ahead = index * beat - drawn,
          y = target + (prefs.down ? -ahead : ahead) * perMs,
          // A tick nobody tapped goes on past the target and fades out with the last window.
          fade = ahead < 0 ? 1 + ahead / reach : 1;
        // The lead-in's arrows are another colour and fainter: they are not counted.
        blit(
          pen,
          sprites.arrows[index < RUN_COUNT_IN ? 3 : 0]![ARROW]!,
          x,
          y,
          index < RUN_COUNT_IN ? fade * 0.55 : fade,
          1,
          0,
        );
      }
    }
    const last = run?.last;
    if (last && now - last.at < BURST_MS) {
      const t = (now - last.at) / BURST_MS;
      pen.globalCompositeOperation = "lighter";
      blit(pen, sprites.glows[last.judgment]!, x, target, (1 - t) * 0.65, 1, 0);
      blit(
        pen,
        sprites.bursts[last.judgment]!,
        x,
        target,
        1 - t,
        1 + 0.5 * t,
        0,
      );
      pen.globalCompositeOperation = "source-over";
    }
    pen.globalAlpha = 1;
  };

  function readout(): void {
    const clock = audio.clock(),
      heard = run ? position(deps.now()) : undefined;
    element.dataset.phase = run ? "run" : advice ? "result" : "idle";
    running.hidden = !run;
    result.hidden = !!run;
    actions.hidden = !!run;
    setup.hidden = !!run;
    if (run) {
      const beat = beatS(run.bpm) * 1000,
        tick = heard === undefined ? -1 : Math.round(heard / beat),
        left = Math.max(
          0,
          Math.ceil(
            ((RUN_COUNT_IN + run.ticks - 1) * beat - (heard ?? 0)) / 1000,
          ),
        );
      setText(
        status,
        heard === undefined
          ? clock && !clock.running
            ? "Press a key or tap the lane to let the sound out."
            : "Starting…"
          : run.kind === "ear" && !soundOn()
            ? "The sound is off: press M to hear the click, or stop and run it by eye."
            : tick < RUN_COUNT_IN
              ? `Listen: ${Math.max(1, RUN_COUNT_IN - Math.max(0, tick))}…`
              : run.kind === "ear"
                ? `Tap on every tick, by ear. ${left} s left.`
                : `No sound: tap as each arrow fills the target. ${left} s left.`,
      );
      const last = run.last,
        stats = meanOf(run.errors);
      setText(lastValue, last ? `${signed(last.offMs)} ms` : "— ms");
      lastValue.style.color = last ? JUDGMENT_COLORS[last.judgment]! : "";
      setText(
        lastWord,
        last
          ? `${JUDGMENT_WORDS[last.judgment] ?? ""} · ${Math.abs(last.offMs) < 0.5 ? "ON IT" : last.offMs > 0 ? "LATE" : "EARLY"}`
          : "TAP ON THE TICK",
      );
      progress.value =
        heard === undefined
          ? 0
          : Math.max(
              0,
              Math.min(1, heard / ((RUN_COUNT_IN + run.ticks - 1) * beat)),
            );
      setText(
        mean,
        stats.n
          ? `average ${signed(stats.mean)} ms ±${stats.sd.toFixed(0)} over ${stats.n} taps`
          : "no taps yet",
      );
      return;
    }
    setText(
      status,
      advice
        ? lastKind === "ear"
          ? "RESULT, BY EAR"
          : "RESULT, BY EYE"
        : note
          ? "DONE"
          : `A ${Math.round(seconds)} second test. Tap any arrow key, or the lane, on every tick: then you get one number and one button.`,
    );
    setText(measured, advice?.measured ?? note);
    setText(todo, advice?.advice ?? "");
    measured.hidden = !advice && !note;
    todo.hidden = !advice;
    apply.hidden = !advice?.apply;
    const again = advice || note ? lastKind : undefined,
      length = `${Math.round(seconds)} S`;
    setText(
      byEar,
      again === "ear"
        ? `RUN AGAIN BY EAR (${length})`
        : `START BY EAR (${length})`,
    );
    setText(
      byEye,
      again === "eye"
        ? `RUN AGAIN BY EYE (${length})`
        : `CHECK THE PICTURE BY EYE (${length}, NO SOUND)`,
    );
    // Without a sound there is nothing to go by ear on.
    byEar.hidden = !clock;
    // The button to press next is the bright one: APPLY when there is one, else the run that comes next.
    const next = advice?.apply
      ? apply
      : !clock ||
          (again === "ear" && advice?.verdict === "good") ||
          again === "eye"
        ? byEye
        : byEar;
    for (const each of [byEar, byEye])
      each.classList.toggle("fui-button-primary", each === next);
    for (const each of rateButtons)
      each.node.classList.toggle("fm-ts-on", each.rate === bpm);
  }

  let shown = 0,
    raf = 0;
  const frame = (timestamp: number) => {
    if (disposed) return;
    // Asked first, so one bad frame cannot stop the drawing for good.
    raf = win.requestAnimationFrame(frame);
    const began = deps.now();
    probe.frameStart(timestamp, began);
    frameLead.frame(timestamp);
    songClock.sample();
    const mapping = songClock.mapping();
    if (mapping) probe.clock(mapping.reading, mapping.smoothed);
    if (mapping?.pairedMs !== undefined) probe.pair(mapping.pairedMs);
    const live = run;
    if (live) {
      const loop = live.loop;
      loop?.frame();
      if (loop && loop.run > 0 && !audio.clock()?.running && loop.over) {
        // The sound stopped after the last tick had left: the run is whole, bar the taps still to come.
        finish(live);
        shown = 0;
        return readout();
      }
      // The audio clock stopped under the run (the page was hidden): its ticks are gone, or started over.
      if (
        loop &&
        (loop.run > 1 || (loop.run === 1 && loop.origin === undefined))
      )
        return abort("The sound stopped during the run. Run it again.");
      // By eye the click is there and cannot be heard.
      live.song?.shape(live.kind === "eye" ? 0 : 1, 0);
    }
    const heard = position(timestamp);
    draw(heard, began);
    const done = deps.now();
    probe.frameEnd(done);
    lab.frame(began, done, {
      mine: undefined,
      running: heard !== undefined,
      audible:
        live?.kind === "ear" &&
        soundOn() &&
        live.loop?.origin !== undefined &&
        mapping !== undefined,
      epoch: generation,
      song: `ticks-${bpm}`,
      title: `STEADY CLICK ${bpm / 60} / s`,
    });
    // The run is over a moment after its last counted tick, before another one sounds.
    if (live && heard !== undefined) {
      const beat = beatS(live.bpm) * 1000;
      if (live.kind === "ear" && heard > RUN_COUNT_IN * beat && !soundOn())
        live.deaf = true;
      if (
        heard >
        (RUN_COUNT_IN + live.ticks - 1) * beat + Math.min(200, beat * 0.45)
      ) {
        if (live.deaf)
          abort(
            "The sound was off during the run, so nothing was measured by ear. Turn it on and run again, or check the picture by eye.",
          );
        else finish(live);
        shown = 0;
      }
    }
    if (done - shown > 100) {
      shown = done;
      readout();
    }
  };
  readout();
  raf = win.requestAnimationFrame(frame);

  return {
    element,
    snapshot: lab.snapshot,
    logText: lab.logText,
    state: () => ({
      phase: run ? "run" : advice ? "result" : "idle",
      bpm,
      kind: run?.kind,
      heardMs: run ? position(deps.now()) : undefined,
      countIn: RUN_COUNT_IN,
      ticks: run?.ticks ?? Math.max(1, Math.round(seconds / beatS(bpm))),
      advice,
    }),
    dispose() {
      disposed = true;
      win.cancelAnimationFrame(raf);
      stop();
      doc.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", onPointer);
      for (const url of laps.values()) URL.revokeObjectURL(url);
      lab.dispose();
    },
  };
}
