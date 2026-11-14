import { WINDOWS } from "../engine/index.js";
import { CLICK_RATES } from "./click-track.js";
import {
  latencyText,
  type LatencyContext,
  type LatencyReport,
} from "./latency.js";
import { MIC_MIN_PRESSES, micUsable, type MicReport } from "./mic.js";
import {
  EYE_MIN_HITS,
  histogram,
  meanOf,
  type PressRecord,
} from "./timing-session.js";

/**
 * The `?debugtiming` panel: everything the page knows about a press on its way to a judgment, live, with the
 * three offsets a player can turn while watching what they do. It draws what it is given and reports clicks; the
 * measuring is the page's (`main.ts`), the arithmetic `latency.ts`, `timing-session.ts` and `mic.ts`.
 */

export interface ClockView {
  /** What the heard position is read from: the browser's clock pair, or the stepped clock and reported latency. */
  source: "paired" | "reported" | "room";
  /** How far behind the audio clock the heard sample is taken to be, ms (the audio offset included). */
  lagMs: number;
  /** The newest clock pair's distance from the value in use, ms. */
  pairedMs: number | undefined;
  sampleRate: number | undefined;
  /** Song restarts since the page loaded: each one is a realignment with the room. */
  restarts: number;
  /** The display's refresh rate as measured, and how far ahead the picture is drawn for it, ms. */
  hz: number;
  leadMs: number;
}
export interface MicView {
  state: "off" | "asking" | "on" | "failed";
  note: string;
  label: string;
  reportedMs: number | undefined;
  /** 0 to 1: the loudest sample lately. */
  level: number;
  report: MicReport | undefined;
  devices: readonly { id: string; label: string }[];
  device: string;
}
export interface TimingView {
  report: LatencyReport;
  context: LatencyContext;
  clock: ClockView;
  offsets: { audioMs: number; inputMs: number; visualMs: number };
  /** Hit errors with the sound on and with it muted, ms. */
  ear: readonly number[];
  eye: readonly number[];
  presses: readonly PressRecord[];
  totalPresses: number;
  bent: number;
  leastSlackMs: number | undefined;
  song: string;
  /** The click track's rate when one is playing. */
  clickBpm: number | undefined;
  mic: MicView;
  log: { lines: number; file: string };
}
export type OffsetKey = "audioMs" | "inputMs" | "visualMs";
export interface TimingActions {
  nudge(key: OffsetKey, by: number): void;
  set(key: OffsetKey, ms: number): void;
  /** Sets the input (or, when it is large, the audio) offset so the by-ear hits centre on zero. */
  centre(): void;
  resetHits(): void;
  click(bpm: number): void;
  mic(on: boolean, device?: string): void;
  /** Applies the microphone's residual. */
  applyMic(): void;
  copy(text: string): void;
  download(): void;
}
export interface TimingPanel {
  element: HTMLElement;
  /** Redraws from `view`; cheap enough for a few times a second. */
  update(view: TimingView): void;
  /** Draws the microphone's scope: the two envelopes around the newest ticks. */
  scope(traces: readonly ScopeTrace[]): void;
}
/** One tick as the microphone heard it, for the scope. Values are per bin, `fromMs` is the first bin's time from the tick's sound. */
export interface ScopeTrace {
  fromMs: number;
  binMs: number;
  click: Float32Array;
  key: Float32Array;
  /** Where the finger was and where the game put it, ms from the tick's sound; undefined when no key was heard. */
  trueMs: number | undefined;
  gameMs: number | undefined;
}

const JUDGMENTS = ["MARV", "PERF", "GREAT", "GOOD", "BOO"];
const BAND_COLOURS = ["#7ff", "#fd5", "#6e6", "#69f", "#f6c"];
const signed = (value: number, digits = 1) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value).toFixed(digits)}`;
const whole = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(Math.round(value))}`;

/** One line about hit errors: mean, spread and count. */
export function errorText(label: string, values: readonly number[]): string {
  if (values.length === 0) return `${label}: no hits yet`;
  const { mean, sd, n } = meanOf(values);
  return `${label}: ${signed(mean)} ms ±${sd.toFixed(1)} (${n} hits)`;
}

/** The newest presses as a table: key, stamp to handler, to frame, song time, judgment. */
export function pressText(presses: readonly PressRecord[]): string {
  const head = "key   >handler  >frame   song ms  judged";
  const names = ["←", "↓", "↑", "→"];
  const rows = presses.map((press) => {
    const key = (
      press.column < 0 ? "ITEM" : (names[press.column] ?? "?")
    ).padEnd(5);
    const handler = press.used
      ? (press.handled - press.stamp).toFixed(1).padStart(7)
      : "  no ts";
    const frame =
      press.frameMs === undefined
        ? "      -"
        : press.frameMs.toFixed(1).padStart(7);
    const song = Math.round(press.songMs).toString().padStart(9);
    const judged =
      press.judgment === undefined
        ? "-"
        : `${JUDGMENTS[press.judgment] ?? "?"} ${whole(press.offMs ?? 0)}`;
    const bent =
      press.slackMs !== undefined && press.slackMs < 0
        ? "  MOVED BY ROOM CLOCK"
        : "";
    return `${key} ${handler} ${frame} ${song}  ${judged}${bent}`;
  });
  return [head, ...rows].join("\n");
}

/** What the clocks section says. */
export function clockText(view: TimingView): string {
  const { clock, context } = view;
  const known = (value: number | undefined) =>
    value === undefined ? "not reported" : `${value.toFixed(1)} ms`;
  const source =
    clock.source === "paired"
      ? "the browser's clock pair (getOutputTimestamp)"
      : clock.source === "reported"
        ? "the stepped audio clock and reported latency"
        : "the room clock (no sound)";
  return [
    `song position from ${source}`,
    `heard ${clock.lagMs.toFixed(1)} ms behind the audio clock` +
      (clock.pairedMs === undefined
        ? ""
        : ` (newest pair ${signed(clock.pairedMs, 2)} ms from it)`),
    `reported: output ${known(context.outputMs)}, base ${known(context.baseMs)}` +
      (clock.sampleRate ? `, ${clock.sampleRate} Hz` : ""),
    `song ${signed(context.driftMs)} ms from the room clock, ${clock.restarts} restart${clock.restarts === 1 ? "" : "s"}`,
    `display ${clock.hz ? clock.hz.toFixed(0) : "?"} Hz, picture drawn ${clock.leadMs.toFixed(1)} ms ahead for it`,
    view.totalPresses === 0
      ? "room clock: no presses yet"
      : view.bent === 0
        ? `room clock: moved 0 of ${view.totalPresses} presses (least room ${Math.round(view.leastSlackMs ?? 0)} ms)`
        : `room clock: MOVED ${view.bent} of ${view.totalPresses} presses`,
  ].join("\n");
}

/** What the microphone section says. */
export function micText(mic: MicView, offsets: TimingView["offsets"]): string {
  if (mic.state !== "on") return mic.note;
  const report = mic.report;
  const lines = [
    `${mic.label || "microphone"}${mic.reportedMs === undefined ? "" : ` (reports ${mic.reportedMs.toFixed(0)} ms)`}`,
  ];
  if (mic.note) lines.push(mic.note);
  if (!report) return lines.join("\n");
  lines.push(
    report.roundTrip.n
      ? `tick heard ${report.roundTrip.median.toFixed(1)} ms after it was scheduled ±${report.roundTrip.spread.toFixed(1)} (${report.clicksHeard} of ${report.clicks} ticks)`
      : `no tick heard yet (${report.clicks} looked for): turn the volume up, use the speaker`,
  );
  if (report.presses > 0)
    lines.push(
      `keys heard: ${report.pressesHeard} of ${report.presses}` +
        (report.pressesHeard < report.presses / 2
          ? " · tap firmer, or turn the volume down"
          : ""),
    );
  if (report.residualMs.n > 0) {
    lines.push(
      `finger vs tick (microphone):  ${signed(report.trueMs.median)} ms ±${report.trueMs.spread.toFixed(1)}`,
      `press vs tick (game):         ${signed(report.gameMs.median)} ms ±${report.gameMs.spread.toFixed(1)}`,
      `game − microphone:            ${signed(report.residualMs.median)} ms ±${report.residualMs.spread.toFixed(1)}  (n=${report.residualMs.n})`,
      `input path jitter (stamp vs key sound): ±${report.stampMs.spread.toFixed(1)} ms`,
    );
    lines.push(
      micUsable(report)
        ? Math.abs(report.residualMs.median) < 3
          ? `offsets are right for this device (input ${whole(offsets.inputMs)}, audio ${whole(offsets.audioMs)})`
          : `the game places presses ${Math.abs(report.residualMs.median).toFixed(0)} ms ${report.residualMs.median > 0 ? "later" : "earlier"} than you made them`
        : report.residualMs.n < MIC_MIN_PRESSES
          ? `${MIC_MIN_PRESSES - report.residualMs.n} more presses to trust it`
          : "too scattered to act on",
    );
  }
  return lines.join("\n");
}

/** The whole panel as text, for a bug report. */
export function timingReport(view: TimingView): string {
  return [
    `Fusemania timing · ${view.song}`,
    `offsets: audio ${whole(view.offsets.audioMs)} ms, input ${whole(view.offsets.inputMs)} ms, visual ${whole(view.offsets.visualMs)} ms`,
    errorText("by ear", view.ear),
    errorText("by eye (sound off)", view.eye),
    "",
    latencyText(view.report, view.context),
    "",
    clockText(view),
    "",
    pressText(view.presses.slice(-12)),
    "",
    `microphone: ${micText(view.mic, view.offsets)}`,
  ].join("\n");
}

interface Bars {
  canvas: HTMLCanvasElement;
  draw(
    values: readonly number[],
    spec: {
      min: number;
      max: number;
      bins: number;
      zero?: boolean;
      windows?: boolean;
    },
    more?: { values: readonly number[]; colour: string },
  ): void;
}
function bars(doc: Document, width: number, height: number): Bars {
  const canvas = doc.createElement("canvas");
  canvas.width = width * 2;
  canvas.height = height * 2;
  canvas.className = "fm-dt-canvas";
  return {
    canvas,
    draw(values, spec, more) {
      const pen = canvas.getContext("2d");
      if (!pen) return;
      const w = canvas.width,
        h = canvas.height,
        x = (value: number) => ((value - spec.min) / (spec.max - spec.min)) * w;
      pen.clearRect(0, 0, w, h);
      if (spec.windows)
        for (let index = WINDOWS.length - 1; index >= 0; index--) {
          const half = WINDOWS[index]!;
          pen.fillStyle = `${BAND_COLOURS[index]}22`;
          pen.fillRect(x(-half), 0, x(half) - x(-half), h);
        }
      const draw = (list: readonly number[], colour: string, alpha: number) => {
        const counts = histogram(list, spec.min, spec.max, spec.bins),
          top = Math.max(1, ...counts),
          step = w / spec.bins;
        pen.globalAlpha = alpha;
        pen.fillStyle = colour;
        for (const [index, count] of counts.entries()) {
          const tall = (count / top) * (h - 4);
          if (count) pen.fillRect(index * step + 1, h - tall, step - 2, tall);
        }
        pen.globalAlpha = 1;
      };
      draw(values, "#9ff", 0.9);
      if (more && more.values.length) draw(more.values, more.colour, 0.6);
      if (spec.zero) {
        pen.fillStyle = "#fff";
        pen.fillRect(x(0) - 1, 0, 2, h);
      }
      if (values.length) {
        pen.fillStyle = "#f55";
        pen.fillRect(x(meanOf(values).mean) - 1, 0, 2, h);
      }
    },
  };
}

export function createTimingPanel(
  doc: Document,
  actions: TimingActions,
): TimingPanel {
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
  const button = (text: string, run: () => void, className = "") => {
    const node = el("button", text, `fm-dt-button ${className}`.trim());
    node.type = "button";
    // A game key must never press a panel button: nothing here keeps the focus.
    node.tabIndex = -1;
    node.addEventListener("click", () => {
      node.blur();
      run();
    });
    return node;
  };
  const section = (title: string, ...nodes: Node[]) => {
    const box = el("section", "", "fm-dt-section");
    box.append(el("h3", title), ...nodes);
    return box;
  };
  const pre = () => el("pre", "", "fm-dt-pre");
  const setText = (node: HTMLElement, text: string) => {
    if (node.textContent !== text) node.textContent = text;
  };
  let last: TimingView | undefined;

  const root = el("aside", "", "fm-dt");
  root.setAttribute("aria-label", "Timing debug");
  const body = el("div", "", "fm-dt-body");
  const hide = button("HIDE", () => {
    body.hidden = !body.hidden;
    hide.textContent = body.hidden ? "TIMING" : "HIDE";
    root.classList.toggle("fm-dt-closed", body.hidden);
  });
  const head = el("header", "", "fm-dt-head");
  head.append(
    el("b", "TIMING DEBUG"),
    button("COPY", () => last && actions.copy(timingReport(last))),
    button("SAVE LOG", () => actions.download()),
    hide,
  );

  // ---- offsets ----
  const rows = (
    [
      [
        "audioMs",
        "AUDIO",
        "sound arrives later than the browser says: moves arrows and judging",
      ],
      [
        "inputMs",
        "INPUT",
        "your presses register late: moves only the judging",
      ],
      [
        "visualMs",
        "VISUAL",
        "draws the arrows earlier: moves only the picture",
      ],
    ] as const
  ).map(([key, title, hint]) => {
    const row = el("div", "", "fm-dt-offset"),
      value = el("output", "0", "fm-dt-value");
    row.title = hint;
    row.append(
      el("span", title, "fm-dt-name"),
      button("−5", () => actions.nudge(key, -5)),
      button("−1", () => actions.nudge(key, -1)),
      value,
      button("+1", () => actions.nudge(key, 1)),
      button("+5", () => actions.nudge(key, 5)),
      button("0", () => actions.set(key, 0)),
      el("small", hint),
    );
    return { key, value, row };
  });

  // ---- hit error ----
  const errors = bars(doc, 340, 84),
    errorLines = pre(),
    centre = button("CENTRE BY EAR", () => actions.centre()),
    eyeNote = el("p", "", "fm-dt-note"),
    setVisual = button("SET VISUAL", () => {
      if (pendingVisual !== undefined) actions.set("visualMs", pendingVisual);
    });
  let pendingVisual: number | undefined;
  const errorActions = el("div", "", "fm-dt-actions");
  errorActions.append(
    centre,
    setVisual,
    button("RESET", () => actions.resetHits()),
  );

  // ---- press chain ----
  const chain = pre(),
    toFrame = bars(doc, 340, 44),
    recent = pre();

  // ---- clocks ----
  const clocks = pre();

  // ---- microphone ----
  const micToggle = button("LISTEN WITH THE MICROPHONE", () =>
      actions.mic(last?.mic.state !== "on", devices.value || undefined),
    ),
    devices = el("select", "", "fm-dt-select"),
    meter = el("meter", "", "fm-dt-meter"),
    micLines = pre(),
    applyMic = button("APPLY", () => actions.applyMic()),
    scope = doc.createElement("canvas");
  devices.tabIndex = -1;
  devices.addEventListener("change", () => {
    devices.blur();
    if (last?.mic.state === "on") actions.mic(true, devices.value || undefined);
  });
  meter.min = 0;
  meter.max = 1;
  scope.width = 680;
  scope.height = 200;
  scope.className = "fm-dt-canvas fm-dt-scope";
  const micRow = el("div", "", "fm-dt-actions");
  micRow.append(micToggle, devices, meter, applyMic);
  const micHint = el(
    "p",
    "Play a click track through the speaker and tap along. The microphone hears each tick and each key; nothing is recorded or sent. White line: the tick. Green: your finger. Red: where the game put the press.",
    "fm-dt-note",
  );

  // ---- click track ----
  const clickRow = el("div", "", "fm-dt-actions");
  for (const bpm of CLICK_RATES)
    clickRow.append(
      button(`${bpm / 60} / s`, () => actions.click(bpm), "fm-dt-click"),
    );
  const songLine = el("p", "", "fm-dt-note"),
    logLine = el("p", "", "fm-dt-note");

  body.append(
    section("OFFSETS", ...rows.map((row) => row.row)),
    section("STEADY CLICK TRACK", clickRow, songLine),
    section(
      "HIT ERROR (early ← 0 → late)",
      errors.canvas,
      errorLines,
      eyeNote,
      errorActions,
    ),
    section("MICROPHONE", micRow, micLines, scope, micHint),
    section("PRESS TO JUDGMENT", chain, toFrame.canvas, recent),
    section("CLOCKS", clocks),
    logLine,
  );
  root.append(head, body);

  return {
    element: root,
    update(view) {
      last = view;
      if (body.hidden) return;
      for (const row of rows)
        setText(row.value, `${whole(view.offsets[row.key])} ms`);
      errors.draw(
        view.ear,
        { min: -180, max: 180, bins: 60, zero: true, windows: true },
        { values: view.eye, colour: "#fd5" },
      );
      setText(
        errorLines,
        `${errorText("by ear", view.ear)}\n${errorText("by eye (press M: sound off)", view.eye)}`,
      );
      centre.disabled = view.ear.length < EYE_MIN_HITS;
      const eye =
        view.ear.length >= EYE_MIN_HITS && view.eye.length >= EYE_MIN_HITS
          ? Math.round(meanOf(view.eye).mean - meanOf(view.ear).mean)
          : undefined;
      pendingVisual =
        eye === undefined ? undefined : view.offsets.visualMs + eye;
      setVisual.disabled = eye === undefined || eye === 0;
      setText(
        eyeNote,
        eye === undefined
          ? `Mute (M) and play ${EYE_MIN_HITS} notes by eye to measure the picture against the sound.`
          : eye === 0
            ? "By eye and by ear agree: the picture is on the sound."
            : `By eye you hit ${Math.abs(eye)} ms ${eye > 0 ? "later" : "earlier"} than by ear: the picture is ${eye > 0 ? "late" : "early"}. SET VISUAL makes it ${whole(view.offsets.visualMs + eye)} ms.`,
      );
      setText(chain, latencyText(view.report, view.context));
      toFrame.draw(
        view.presses
          .map((press) => press.frameMs)
          .filter((value): value is number => value !== undefined),
        { min: 0, max: 34, bins: 34 },
      );
      setText(recent, pressText(view.presses.slice(-8)));
      setText(clocks, clockText(view));
      setText(
        micToggle,
        view.mic.state === "on"
          ? "STOP THE MICROPHONE"
          : view.mic.state === "asking"
            ? "ASKING…"
            : "LISTEN WITH THE MICROPHONE",
      );
      micToggle.disabled = view.mic.state === "asking";
      const wanted = `${view.mic.device}\u0001${view.mic.devices
        .map((device) => `${device.id}\u0000${device.label}`)
        .join("\u0001")}`;
      if (devices.dataset.list !== wanted) {
        devices.dataset.list = wanted;
        devices.replaceChildren(
          ...view.mic.devices.map((device, index) => {
            const option = el(
              "option",
              device.label || `Microphone ${index + 1}`,
            );
            option.value = device.id;
            option.selected = device.id === view.mic.device;
            return option;
          }),
        );
      }
      devices.hidden = view.mic.devices.length < 2;
      meter.hidden = view.mic.state !== "on";
      meter.value = Math.min(1, view.mic.level);
      setText(micLines, micText(view.mic, view.offsets));
      const report = view.mic.report;
      applyMic.hidden = !(
        report &&
        micUsable(report) &&
        Math.abs(report.residualMs.median) >= 3
      );
      scope.hidden = view.mic.state !== "on";
      setText(
        songLine,
        view.clickBpm
          ? `Playing: ${view.clickBpm / 60} ticks a second. A note sits on every tick.`
          : `Playing: ${view.song}. A click track has nothing but the beat, so what is left is the device and you.`,
      );
      setText(
        logLine,
        `Session log: ${view.log.lines} lines${view.log.file ? `, written to ${view.log.file}` : " (SAVE LOG downloads it)"}`,
      );
    },
    scope(traces) {
      const pen = scope.getContext("2d");
      if (!pen || scope.hidden) return;
      const w = scope.width,
        h = scope.height,
        from = -120,
        to = 120,
        x = (ms: number) => ((ms - from) / (to - from)) * w;
      pen.clearRect(0, 0, w, h);
      pen.fillStyle = "#fff";
      pen.fillRect(x(0), 0, 1, h);
      const half = h / 2;
      for (const [index, trace] of traces.entries()) {
        const newest = index === traces.length - 1,
          alpha = newest ? 1 : 0.25;
        const line = (values: Float32Array, colour: string, base: number) => {
          let top = 0;
          for (const value of values) if (value > top) top = value;
          if (top <= 0) return;
          pen.globalAlpha = alpha;
          pen.strokeStyle = colour;
          pen.lineWidth = newest ? 2 : 1;
          pen.beginPath();
          for (let bin = 0; bin < values.length; bin++) {
            const px = x(trace.fromMs + bin * trace.binMs),
              py = base - (values[bin]! / top) * (half - 6);
            if (bin === 0) pen.moveTo(px, py);
            else pen.lineTo(px, py);
          }
          pen.stroke();
        };
        line(trace.click, "#9ff", half - 2);
        line(trace.key, "#fd5", h - 2);
        pen.globalAlpha = newest ? 1 : 0.35;
        if (trace.trueMs !== undefined) {
          pen.fillStyle = "#5f8";
          pen.fillRect(x(trace.trueMs) - 1, half, 2, half);
        }
        if (trace.gameMs !== undefined) {
          pen.fillStyle = "#f55";
          pen.fillRect(x(trace.gameMs) - 1, half, 2, half);
        }
      }
      pen.globalAlpha = 1;
    },
  };
}
