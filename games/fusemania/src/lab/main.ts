/**
 * Fusemania's chart lab: a developer page (not in the game's menus) for reviewing generated step charts against the
 * music. Time runs down the page; the charts sit beside a constant-Q spectrogram (or the mel bands ChartNet reads),
 * with playback, an assist tick, tap editing and review notes on time spans and frequency bands.
 *
 * Served at `<base>fusemania/chart-lab.html`; `?song=<id>` picks the song.
 */
import "./lab.css";
import { SONGS_DATA } from "../engine/songs-data.js";
import {
  parseSimfile,
  writeSsc,
  type SimChart,
  type Simfile,
} from "../engine/simfile.js";
import {
  chartStats,
  placeChart,
  quantName,
  snapBeat,
  toggleTap,
  type LabChart,
  type PlacedNote,
  type Quant,
} from "./charts.js";
import {
  describeNote,
  mergeNotes,
  NOTE_TAGS,
  parseNotes,
  writeNotes,
  type LabNote,
  type NoteTag,
  type NotesFile,
} from "./notes.js";
import {
  bandFlux,
  detailBinAt,
  detailHz,
  FRAMES_PER_SECOND,
  LAB_RATE,
  MEL_BANDS,
  melBandAt,
  melBandHz,
  quantile,
  type Spectra,
} from "./spectrum.js";
import type { SpectrumReply, SpectrumRequest } from "./spectrum-worker.js";
import {
  parseResume,
  resumeHash,
  revealTop,
  seekDelta,
  typingIn,
} from "./playback.js";
import { hiddenAtStart, parseShown } from "./shown.js";
import { NOTES_UPLOAD_PATH, writeNotesUpload } from "./notes-upload.js";
import {
  addTap,
  parseTaps,
  removeSpan,
  removeTap,
  tapColumn,
  writeTaps,
  type Tap,
  type TapsFile,
} from "./taps.js";
import {
  bandMix,
  coversAll,
  dragSpan,
  grabAt,
  type Grab,
  type Span,
} from "./band.js";
import { quantOf as gameQuantOf } from "../render/palette.js";
import type { SpriteCanvas } from "../render/pen.js";
import {
  createSprites,
  type Sprite,
  type SpriteSet,
} from "../render/sprites.js";

const BASE = import.meta.env.BASE_URL;
const NOTES_KEY = "fusemania-lab:notes";
const SHOWN_KEY = "fusemania-lab:shown";
const EDITS_KEY = (song: string) => `fusemania-lab:edits:${song}`;
const MARKER_KEY = (song: string) => `fusemania-lab:marker:${song}`;
const TAPS_KEY = (song: string) => `fusemania-lab:taps:${song}`;
const RECORD_FROM_KEY = (song: string) => `fusemania-lab:record-from:${song}`;
/** The key of the column that shows the tapped rhythm. */
const TAPPED = "taps";
const HEADER = 30;
const RULER = 58;
const LANE = 30;
const CHART_GAP = 10;
const CURVES = 76;
const OVERVIEW = 22;

// ---------------------------------------------------------------------------------------------------------------------
// Storage: per-viewer conveniences, every access guarded.

const load = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const save = (key: string, value: string | null): void => {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* private window or full storage: the linked file and downloads still work */
  }
};

// ---------------------------------------------------------------------------------------------------------------------
// DOM

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  Object.assign(node, props);
  node.append(...children);
  return node;
};
const button = (
  label: string,
  onClick: () => void,
  title = "",
): HTMLButtonElement =>
  el("button", { type: "button", textContent: label, title, onclick: onClick });

const app = document.getElementById("app")!;
const songSelect = el("select", { title: "Song" });
for (const song of SONGS_DATA)
  songSelect.append(el("option", { value: song.id, textContent: song.id }));
const playButton = button(
  "▶ Play",
  () => togglePlay(),
  "Play or pause (space)",
);
const key = (text: string) => el("kbd", { textContent: text });
const keyLegend = el(
  "div",
  { className: "lab-keys", title: "Keyboard: playback and seeking" },
  key("space"),
  " play / pause",
  el("span", { className: "lab-keys-gap" }),
  key("←"),
  key("→"),
  " 0.5 s",
  el("span", { className: "lab-keys-gap" }),
  key("⇧"),
  key("←"),
  key("→"),
  " 3 s",
  el("span", { className: "lab-keys-gap" }),
  key("⌥"),
  key("←"),
  key("→"),
  " 10 s",
  el("span", { className: "lab-keys-gap" }),
  key("r"),
  " record, then tap ",
  key("WASD"),
  key("IJKL"),
  el("span", { className: "lab-keys-gap" }),
  key("⇧R"),
  " record from here",
  el("span", { className: "lab-keys-gap" }),
  key("⌘Z"),
  " undo tap",
  el("span", { className: "lab-keys-gap" }),
  key("⌫"),
  " delete taps in a selection dragged over Custom",
  el("span", { className: "lab-keys-gap" }),
  key("x"),
  " set marker",
  el("span", { className: "lab-keys-gap" }),
  key("enter"),
  " back to marker",
  el("span", { className: "lab-keys-gap" }),
  key("↑"),
  key("↓"),
  " scroll",
  el("span", { className: "lab-keys-gap" }),
  key("+"),
  key("−"),
  " zoom",
);
const speedSelect = el("select", {
  title: "Playback speed (the pitch drops with it)",
});
for (const rate of [1, 0.75, 0.5, 0.25])
  speedSelect.append(
    el("option", { value: String(rate), textContent: `${rate}×` }),
  );
const tickSelect = el("select", {
  title: "Assist tick: a click on every step of a chart, or on every beat",
});
const viewSelect = el("select", { title: "Spectrogram" });
viewSelect.append(
  el("option", { value: "detail", textContent: "Constant-Q (detail)" }),
  el("option", { value: "model", textContent: "Mel 64 (what ChartNet reads)" }),
);
const floorInput = el("input", {
  type: "range",
  min: "0",
  max: "0.9",
  step: "0.01",
  value: "0.45",
  title: "Spectrogram floor: raise it to keep only the loudest parts",
});
const gridInput = el("input", {
  type: "checkbox",
  checked: true,
  title: "Draw 16th lines over the spectrogram",
});
const editInput = el("input", {
  type: "checkbox",
  title: "Click a lane to add or remove a tap",
});
const recordInput = el("input", {
  type: "checkbox",
  title:
    "Record mode (r): while the song plays, tap the rhythm on WASD or IJKL; each tap lands as an arrow in a Custom chart",
});
const snapSelect = el("select", { title: "Edit snap" });
for (const per of [4, 3, 2, 6, 8, 1])
  snapSelect.append(
    el("option", { value: String(per), textContent: quantName(per as Quant) }),
  );
const sscInput = el("input", {
  type: "file",
  accept: ".ssc,.sm",
  multiple: true,
  hidden: true,
});
const notesInput = el("input", {
  type: "file",
  accept: ".json,application/json",
  hidden: true,
});
const chips = el("div", { className: "lab-chips" });
const status = el("span", { className: "lab-status" });

const canvas = el("canvas", { className: "lab-canvas" });
const overview = el("canvas", { className: "lab-overview" });
const stage = el("div", { className: "lab-stage" }, canvas, overview);

const selectionBox = el("section", { className: "lab-card" });
const notesBox = el("section", { className: "lab-card" });
const helpBox = el(
  "section",
  { className: "lab-card lab-help" },
  el("h2", { textContent: "How to use" }),
  el("p", {
    textContent:
      "Record mode (r, or the record box): while the song plays, tap the rhythm you hear on WASD or IJKL (left, down, up, right). Each tap lands in a Custom chart beside the song's own and is saved with your notes. Shift + R puts a red line at the playhead where recording starts: play from before it and tap along, and only the taps after the line are kept (shift + R on the line removes it). Press x to drop a marker at the playhead (the yellow line) and enter to jump back to it, as often as you like. Scroll to move through the song, ctrl/⌘ + scroll (or + and −) to zoom. Space plays and pauses at the playhead (the white line); ← and → move it back and forward by 0.5 s, 3 s with shift and 10 s with option (as in VLC), playing or paused. Click the ruler or the spectrogram to put it somewhere else.",
  }),
  el("p", {
    textContent:
      "Drag on the spectrogram to select a time span and frequency band, or drag over a chart for a span on that chart. Write what you hear and save it as a note. The pink curve is the onset strength of the band you selected; the cyan one is the onset strength ChartNet sees.",
  }),
  el("p", {
    textContent:
      "The green box on the frequency axis above the spectrogram is what you hear at full level; it starts out covering everything. Drag an edge in to narrow it and drag the middle to move it: everything outside the box drops to a tenth of its level. Double-click it to hear everything again.",
  }),
  el("p", {
    textContent:
      "The arrows are the game's own, in its colours: red 4th, blue 8th, purple 12th, yellow 16th, green 24th and 32nd, grey anything finer.",
  }),
);
const side = el(
  "aside",
  { className: "lab-side" },
  selectionBox,
  notesBox,
  helpBox,
);

app.append(
  el(
    "header",
    { className: "lab-top" },
    el("strong", {
      className: "lab-brand",
      textContent: "Fusemania chart lab",
    }),
    songSelect,
    playButton,
    speedSelect,
    el("label", {}, "tick ", tickSelect),
    viewSelect,
    el("label", {}, "floor ", floorInput),
    el("label", {}, gridInput, " 16ths"),
    el("label", {}, editInput, " edit"),
    el("label", { className: "lab-record" }, recordInput, " record"),
    button(
      "Clear taps",
      () => clearTaps(),
      "Throw away the rhythm you tapped for this song",
    ),
    snapSelect,
    button(
      "Load .ssc…",
      () => sscInput.click(),
      "Add charts from a StepMania file, e.g. a ChartNet candidate",
    ),
    button(
      "Export .ssc",
      () => exportSsc(),
      "Download this song's charts, with your edits",
    ),
    button(
      "Reset edits",
      () => resetEdits(),
      "Throw away your tap edits for this song",
    ),
    status,
    sscInput,
    notesInput,
  ),
  el(
    "div",
    { className: "lab-chips-row" },
    el("span", { className: "lab-chips-label", textContent: "Charts shown:" }),
    chips,
  ),
  keyLegend,
  el("main", { className: "lab-main" }, stage, side),
);

// ---------------------------------------------------------------------------------------------------------------------
// State

interface Selection {
  start: number;
  end: number;
  lowHz?: number;
  highHz?: number;
  chart?: string;
}

let songId = "";
let sim: Simfile | undefined;
let charts: LabChart[] = [];
const extraSims: { name: string; sim: Simfile }[] = [];
const hidden = new Set<string>();
let duration = 1;
let spectra: Spectra | undefined;
let tiles: { canvas: HTMLCanvasElement; from: number; frames: number }[] = [];
let flux: Float32Array | undefined;
let fluxScale = 1;
let onsetScale = 1;
let topTime = -0.5;
let pxPerSec = 180;
let playhead = 0;
let selection: Selection | undefined;
let notes: NotesFile = readStoredNotes();
let linkedFile: FileSystemFileHandle | undefined;
let loadToken = 0;

let audioContext: AudioContext | undefined;
let playBuffer: AudioBuffer | undefined;
let source: AudioBufferSourceNode | undefined;
let startCtx = 0;
let startSong = 0;
let rate = 1;
let scheduledUntil = 0;
let tickBuffer: AudioBuffer | undefined;
/** Ticks scheduled on the audio clock and not yet heard; a stop or a seek silences them. */
const pendingTicks = new Set<AudioBufferSourceNode>();
let follow = true;
/** A place in the song to come back to: `x` sets it at the playhead, enter returns to it. Kept per song. */
let marker: number | undefined;
/** The rhythm tapped in record mode for this song, in time order. */
let taps: Tap[] = [];
let tapsTimer: ReturnType<typeof setTimeout> | undefined;
/** Where recording starts (shift + R): taps before it are not kept, so the hands can find the rhythm first. */
let recordFrom: number | undefined;
/** The taps of this visit in the order they were pressed: ⌘Z takes back the latest. */
let tapHistory: Tap[] = [];
/** In local development the URL remembers the playhead (`#t=…`), so a reload carries on from there. */
let resumeAt = import.meta.env.DEV ? parseResume(location.hash) : undefined;
if (import.meta.env.DEV)
  setInterval(() => {
    const hash = resumeHash(playhead);
    if (resumeAt === undefined && location.hash !== hash)
      history.replaceState(null, "", hash);
  }, 1000);
/** The listening band: outside these frequencies the song is turned down to a tenth. Undefined: all of them. */
let band: { lowHz: number; highHz: number } | undefined;
/** The playback graph: every song source goes in at `mixIn`; the band's filters are `bandFilters` (2 high-pass, 2 low-pass). */
let mixIn: GainNode | undefined;
let dryGain: GainNode | undefined;
let bandGain: GainNode | undefined;
let bandFilters: BiquadFilterNode[] = [];
/** The current animation loop; a stop or a new start retires the one before it. */
let frameLoop = 0;

function readStoredNotes(): NotesFile {
  const text = load(NOTES_KEY);
  if (!text) return { version: 1, notes: [] };
  try {
    return parseNotes(text);
  } catch {
    return { version: 1, notes: [] };
  }
}

const say = (text: string) => {
  status.textContent = text;
};

// ---------------------------------------------------------------------------------------------------------------------
// Loading a song

async function loadSong(id: string): Promise<void> {
  const data = SONGS_DATA.find((song) => song.id === id) ?? SONGS_DATA[0]!;
  const token = ++loadToken;
  stop();
  songId = data.id;
  songSelect.value = data.id;
  const url = new URL(location.href);
  url.searchParams.set("song", data.id);
  history.replaceState(null, "", url);
  extraSims.length = 0;
  hidden.clear();
  selection = undefined;
  flux = undefined;
  spectra = undefined;
  tiles = [];
  playhead = 0;
  topTime = -0.5;
  taps = [];
  tapHistory = [];
  const tapped = load(TAPS_KEY(data.id));
  if (tapped) {
    try {
      taps = parseTaps(tapped).taps;
    } catch {
      save(TAPS_KEY(data.id), null);
    }
  }
  const from = Number(load(RECORD_FROM_KEY(data.id)) ?? NaN);
  recordFrom = Number.isFinite(from) && from >= 0 ? from : undefined;
  const marked = Number(load(MARKER_KEY(data.id)) ?? NaN);
  marker = Number.isFinite(marked) && marked >= 0 ? marked : undefined;
  playBuffer = undefined;
  sim = parseSimfile(data.ssc);
  const edited = load(EDITS_KEY(data.id));
  if (edited) {
    try {
      sim = { ...sim, charts: parseSimfile(edited).charts };
    } catch {
      save(EDITS_KEY(data.id), null);
    }
  }
  rebuildCharts();
  // One chart to start with (the ones ticked last time, else Hard); the chips above the charts pick the rest.
  for (const key of hiddenAtStart(charts, parseShown(load(SHOWN_KEY))))
    hidden.add(key);
  hidden.delete(TAPPED);
  renderChips();
  renderNotes();
  renderSelection();
  say("loading audio…");
  const audioUrl = /^(blob:|https?:)/.test(data.audio)
    ? data.audio
    : `${BASE}${data.audio}`;
  try {
    const bytes = await (await fetch(audioUrl)).arrayBuffer();
    if (token !== loadToken) return;
    const context = ensureContext();
    const decoded = await context.decodeAudioData(bytes.slice(0));
    if (token !== loadToken) return;
    playBuffer = decoded;
    duration = decoded.duration;
    if (resumeAt !== undefined) {
      // Back where the page was before it was reloaded.
      playhead = Math.min(resumeAt, duration);
      topTime = playhead - viewSeconds() * 0.3;
      clampView();
      resumeAt = undefined;
    }
    const offline = new OfflineAudioContext(1, 1, LAB_RATE);
    const low = await offline.decodeAudioData(bytes);
    if (token !== loadToken) return;
    const mono = new Float32Array(low.length);
    for (let channel = 0; channel < low.numberOfChannels; channel++) {
      const data = low.getChannelData(channel);
      for (let i = 0; i < mono.length; i++)
        mono[i]! += data[i]! / low.numberOfChannels;
    }
    say("analysing audio…");
    draw();
    const result = await analyse(mono, (share) => {
      if (token === loadToken)
        say(`analysing audio… ${Math.round(share * 100)}%`);
    });
    if (token !== loadToken) return;
    spectra = result;
    onsetScale = Math.max(1e-6, quantile(result.onset, 0.995));
    buildTiles();
    updateFlux();
    say(`${data.id}: ${duration.toFixed(1)} s, ${result.frames} frames`);
  } catch (error) {
    if (token !== loadToken) return;
    say(
      `could not load the audio: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  draw();
}

function analyse(
  samples: Float32Array,
  progress: (share: number) => void,
): Promise<Spectra> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL("./spectrum-worker.ts", import.meta.url),
      { type: "module" },
    );
    worker.onmessage = (event: MessageEvent<SpectrumReply>) => {
      const reply = event.data;
      if (reply.kind === "progress") progress(reply.share);
      else {
        worker.terminate();
        resolve(reply);
      }
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(new Error(event.message || "the analysis worker failed"));
    };
    worker.postMessage({ samples, rate: LAB_RATE } satisfies SpectrumRequest, [
      samples.buffer,
    ]);
  });
}

function rebuildCharts(): void {
  if (!sim) return;
  const placed: LabChart[] = sim.charts
    .filter((chart) => chart.stepsType === "dance-single")
    .map((chart, index) => placeChart(sim!, chart, `song:${index}`, "song"));
  for (const [fileIndex, extra] of extraSims.entries())
    extra.sim.charts
      .filter((chart) => chart.stepsType === "dance-single")
      .forEach((chart, index) =>
        placed.push(
          placeChart(
            extra.sim,
            chart,
            `extra:${fileIndex}:${index}`,
            extra.name,
          ),
        ),
      );
  if (taps.length) {
    // The tapped rhythm, as a column of its own: where each tap fell, unsnapped.
    const tapped = placeChart(
      sim,
      {
        stepsType: "dance-single",
        difficulty: "Custom",
        meter: 1,
        description: "",
        credit: "tapped in the chart lab",
        notes: taps.map((tap) => ({
          beat: tap.beat,
          column: tap.column,
          kind: "tap" as const,
        })),
      },
      TAPPED,
      "recorded",
    );
    placed.push({ ...tapped, label: "Custom" });
  }
  charts = placed;
  const current = tickSelect.value;
  tickSelect.replaceChildren(
    el("option", { value: "", textContent: "off" }),
    el("option", { value: "beats", textContent: "beats" }),
    ...charts.map((chart) =>
      el("option", { value: chart.key, textContent: chart.label }),
    ),
  );
  tickSelect.value = [...tickSelect.options].some(
    (option) => option.value === current,
  )
    ? current
    : "";
  renderChips();
}

function renderChips(): void {
  chips.replaceChildren(
    ...charts.map((chart) => {
      const stats = chartStats(chart.notes);
      const sixteenths = (stats.quants[4] ?? 0) * 100;
      const chip = el("label", {
        className: "lab-chip",
        title: `${stats.steps} steps, ${stats.perSecond.toFixed(2)} a second, ${sixteenths.toFixed(0)}% on 16ths (${chart.chart.credit || "no credit"})`,
      });
      const box = el("input", {
        type: "checkbox",
        checked: !hidden.has(chart.key),
      });
      box.onchange = () => {
        if (box.checked) hidden.delete(chart.key);
        else hidden.add(chart.key);
        save(
          SHOWN_KEY,
          JSON.stringify(
            charts
              .filter((c) => c.key.startsWith("song:") && !hidden.has(c.key))
              .map((c) => c.label),
          ),
        );
        draw();
      };
      chip.append(
        box,
        ` ${chart.label} `,
        el("small", {
          textContent: `${stats.perSecond.toFixed(1)}/s · ${sixteenths.toFixed(0)}% 16ths`,
        }),
      );
      return chip;
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Spectrogram pictures

/** A neon magma: black, violet, magenta, orange, pale yellow. */
const COLOUR_STOPS: [number, number, number, number][] = [
  [0, 4, 6, 18],
  [0.25, 48, 10, 92],
  [0.5, 170, 30, 150],
  [0.75, 255, 120, 60],
  [1, 255, 245, 190],
];
const LUT = (() => {
  const lut = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i++) {
    const v = i / 255;
    const upper = COLOUR_STOPS.findIndex(([at]) => at >= v);
    const b = COLOUR_STOPS[Math.max(1, upper)]!;
    const a = COLOUR_STOPS[Math.max(0, upper - 1)]!;
    const f = b[0] === a[0] ? 0 : (v - a[0]) / (b[0] - a[0]);
    for (let c = 0; c < 3; c++)
      lut[i * 3 + c] = a[c + 1]! + (b[c + 1]! - a[c + 1]!) * f;
  }
  return lut;
})();

const isModel = () => viewSelect.value === "model";

function buildTiles(): void {
  if (!spectra) return;
  const values = isModel() ? spectra.model : spectra.detail;
  const bins = isModel() ? MEL_BANDS : spectra.detailBins;
  const high = quantile(values, 0.997);
  const low = quantile(values, Number(floorInput.value));
  const span = Math.max(1e-6, high - low);
  tiles = [];
  for (let from = 0; from < spectra.frames; from += 4096) {
    const frames = Math.min(4096, spectra.frames - from);
    const tile = el("canvas", { width: bins, height: frames });
    const context = tile.getContext("2d")!;
    const image = context.createImageData(bins, frames);
    for (let f = 0; f < frames; f++)
      for (let b = 0; b < bins; b++) {
        const v = (values[(from + f) * bins + b]! - low) / span;
        const i = Math.max(0, Math.min(255, Math.round(v * 255)));
        const o = (f * bins + b) * 4;
        image.data[o] = LUT[i * 3]!;
        image.data[o + 1] = LUT[i * 3 + 1]!;
        image.data[o + 2] = LUT[i * 3 + 2]!;
        image.data[o + 3] = 255;
      }
    context.putImageData(image, 0, 0);
    tiles.push({ canvas: tile, from, frames });
  }
}

function updateFlux(): void {
  if (
    !spectra ||
    selection?.lowHz === undefined ||
    selection.highHz === undefined
  ) {
    flux = undefined;
    return;
  }
  flux = bandFlux(spectra, selection.lowHz, selection.highHz);
  fluxScale = Math.max(1e-6, quantile(flux, 0.995));
}

// ---------------------------------------------------------------------------------------------------------------------
// Layout and coordinates

interface Layout {
  width: number;
  height: number;
  columns: { chart: LabChart; x: number }[];
  curvesX: number;
  specX: number;
  specW: number;
}

let layout: Layout = {
  width: 0,
  height: 0,
  columns: [],
  curvesX: 0,
  specX: 0,
  specW: 0,
};

function computeLayout(): Layout {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  let x = RULER + 6;
  const columns: Layout["columns"] = [];
  for (const chart of charts) {
    if (hidden.has(chart.key)) continue;
    columns.push({ chart, x });
    x += LANE * 4 + CHART_GAP;
  }
  const curvesX = x;
  const specX = curvesX + CURVES + 6;
  return {
    width,
    height,
    columns,
    curvesX,
    specX,
    specW: Math.max(40, width - specX - 4),
  };
}

const yOf = (time: number) => HEADER + (time - topTime) * pxPerSec;
const timeOf = (y: number) => topTime + (y - HEADER) / pxPerSec;
const viewSeconds = () => (layout.height - HEADER) / pxPerSec;

function xOfHz(hz: number): number {
  const { specX, specW } = layout;
  if (isModel()) return specX + ((melBandAt(hz) + 0.5) / MEL_BANDS) * specW;
  const bins = spectra?.detailBins ?? 1;
  return specX + ((detailBinAt(hz) + 0.5) / bins) * specW;
}
function hzOfX(x: number): number {
  const { specX, specW } = layout;
  const share = (x - specX) / specW;
  if (isModel()) return melBandHz(share * MEL_BANDS - 0.5);
  const bins = spectra?.detailBins ?? 1;
  return detailHz(share * bins - 0.5);
}

// ---------------------------------------------------------------------------------------------------------------------
// Drawing

function draw(): void {
  const ratio = window.devicePixelRatio || 1;
  layout = computeLayout();
  const { width, height } = layout;
  if (
    canvas.width !== Math.round(width * ratio) ||
    canvas.height !== Math.round(height * ratio)
  ) {
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
  }
  const g = canvas.getContext("2d")!;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = "#04091a";
  g.fillRect(0, 0, width, height);
  const t0 = timeOf(HEADER);
  const t1 = timeOf(height);

  // Spectrogram.
  const { specX, specW } = layout;
  g.save();
  g.beginPath();
  g.rect(specX, HEADER, specW, height - HEADER);
  g.clip();
  g.imageSmoothingEnabled = true;
  for (const tile of tiles) {
    const top = tile.from / FRAMES_PER_SECOND - 0.5 / FRAMES_PER_SECOND;
    const bottom = top + tile.frames / FRAMES_PER_SECOND;
    if (bottom < t0 || top > t1) continue;
    g.drawImage(tile.canvas, specX, yOf(top), specW, (bottom - top) * pxPerSec);
  }
  g.restore();

  // Beat grid across everything.
  if (sim) {
    const timing = charts[0]?.timing;
    if (timing) {
      const firstBeat = Math.floor(timing.beatAt(Math.max(t0, -2)) * 4) / 4;
      const lastBeat = timing.beatAt(t1);
      const dense = gridInput.checked && pxPerSec >= 120;
      for (let beat = firstBeat; beat <= lastBeat; beat += 0.25) {
        const y = yOf(timing.timeAt(beat));
        const measure = Math.abs(beat / 4 - Math.round(beat / 4)) < 1e-6;
        const whole = Math.abs(beat - Math.round(beat)) < 1e-6;
        if (!whole && !dense) continue;
        g.strokeStyle = measure
          ? "rgba(140,200,255,0.55)"
          : whole
            ? "rgba(140,200,255,0.22)"
            : "rgba(255,226,59,0.13)";
        g.lineWidth = measure ? 1.2 : 1;
        g.beginPath();
        g.moveTo(whole ? RULER - 14 : RULER - 6, y);
        g.lineTo(width, y);
        g.stroke();
        if (measure) {
          g.fillStyle = "#8cc8ff";
          g.font = "10px ui-monospace, monospace";
          g.fillText(`m${Math.round(beat / 4) + 1}`, 4, y - 2);
        }
      }
    }
  }
  // Seconds on the ruler.
  g.fillStyle = "#6b7590";
  g.font = "10px ui-monospace, monospace";
  for (let s = Math.ceil(Math.max(0, t0)); s <= t1; s++) {
    const y = yOf(s);
    g.fillRect(RULER - 8, y, 8, 1);
    if (pxPerSec >= 40 || s % 5 === 0)
      g.fillText(
        `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`,
        22,
        y + 10,
      );
  }

  // Notes and the selection, under the arrows.
  for (const note of notes.notes.filter((n) => n.song === songId))
    drawSavedNote(g, note);
  if (selection)
    drawSpan(g, selection, "rgba(255,107,213,0.14)", "#ff6bd5", true);

  // Charts.
  for (const { chart, x } of layout.columns) {
    g.fillStyle = "rgba(255,255,255,0.03)";
    g.fillRect(x, HEADER, LANE * 4, height - HEADER);
    for (let lane = 1; lane < 4; lane++) {
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(x + lane * LANE, HEADER, 1, height - HEADER);
    }
    for (const note of visibleNotes(chart.notes, t0 - 2, t1))
      drawNote(g, note, x, chart.key === TAPPED);
  }

  // Curves: ChartNet's onset strength (cyan) and the selected band's flux (pink).
  const { curvesX } = layout;
  g.fillStyle = "rgba(255,255,255,0.025)";
  g.fillRect(curvesX, HEADER, CURVES, height - HEADER);
  if (spectra) drawCurve(g, spectra.onset, onsetScale, "#3bffd0", t0, t1);
  if (flux) drawCurve(g, flux, fluxScale, "#ff6bd5", t0, t1);

  // The listening band: what is turned down is dimmed.
  const listening = bandSpan();
  if (band) {
    const { specX, specW } = layout;
    g.fillStyle = "rgba(4,9,26,0.62)";
    g.fillRect(specX, HEADER, listening.from - specX, height - HEADER);
    g.fillRect(
      listening.to,
      HEADER,
      specX + specW - listening.to,
      height - HEADER,
    );
    g.fillStyle = "rgba(59,255,208,0.7)";
    g.fillRect(listening.from - 1, HEADER, 1, height - HEADER);
    g.fillRect(listening.to, HEADER, 1, height - HEADER);
  }

  // Where recording starts.
  if (recordFrom !== undefined) {
    const ry = yOf(recordFrom);
    g.fillStyle = "#ff2e6e";
    g.fillRect(RULER - 10, ry - 1, width, 2);
    g.font = "bold 10px ui-monospace, monospace";
    g.fillText(`rec from ${recordFrom.toFixed(2)}s`, 2, ry - 4);
  }

  // The marker to come back to.
  if (marker !== undefined) {
    const my = yOf(marker);
    g.fillStyle = "#ffe46b";
    g.fillRect(RULER - 10, my - 1, width, 2);
    g.font = "bold 10px ui-monospace, monospace";
    g.fillText(`x ${marker.toFixed(2)}s`, 2, my + 11);
  }

  // Playhead.
  const py = yOf(playhead);
  g.fillStyle = "#ffffff";
  g.fillRect(RULER - 10, py - 1, width, 2);
  g.fillStyle = "rgba(255,255,255,0.9)";
  g.font = "10px ui-monospace, monospace";
  const beatHere = charts[0]?.timing.beatAt(playhead);
  g.fillText(
    `${playhead.toFixed(2)}s${beatHere !== undefined ? ` b${beatHere.toFixed(2)}` : ""}`,
    2,
    py - 4,
  );

  // Header: column labels and the frequency axis.
  g.fillStyle = "#0b1230";
  g.fillRect(0, 0, width, HEADER);
  g.font = "10px ui-monospace, monospace";
  for (const { chart, x } of layout.columns) {
    g.fillStyle = "#cfd8ff";
    g.fillText(chart.label.slice(0, 11), x, 12);
    g.fillStyle = "#6b7590";
    for (const [lane, arrow] of ["←", "↓", "↑", "→"].entries())
      g.fillText(arrow, x + lane * LANE + LANE / 2 - 3, 25);
  }
  g.fillStyle = "#3bffd0";
  g.fillText("onset", curvesX, 12);
  g.fillStyle = "#ff6bd5";
  g.fillText(flux ? "band" : "", curvesX + 40, 12);
  g.fillStyle = "#cfd8ff";
  let lastLabel = -Infinity;
  for (const hz of [50, 100, 200, 500, 1000, 2000, 4000, 8000]) {
    const x = xOfHz(hz);
    if (x < specX || x > specX + specW - 20 || x - lastLabel < 30) continue;
    lastLabel = x;
    g.fillRect(x, HEADER - 6, 1, 6);
    g.fillText(hz >= 1000 ? `${hz / 1000}k` : String(hz), x + 2, 22);
  }
  g.fillText(isModel() ? "mel bands (Hz) →" : "frequency (Hz) →", specX, 10);
  // The listening box, always there, with a handle on each edge.
  g.fillStyle = band ? "rgba(59,255,208,0.22)" : "rgba(59,255,208,0.08)";
  g.fillRect(listening.from, 1, listening.to - listening.from, HEADER - 2);
  g.fillStyle = "#3bffd0";
  g.fillRect(listening.from, 1, 3, HEADER - 2);
  g.fillRect(listening.to - 3, 1, 3, HEADER - 2);
  if (band)
    g.fillText(
      `${Math.round(band.lowHz)}–${Math.round(band.highHz)} Hz, rest −90%`,
      Math.min(listening.from + 6, specX + layout.specW - 150),
      HEADER + 12,
    );
  if (!spectra) {
    g.fillStyle = "#cfd8ff";
    g.fillText(status.textContent ?? "", specX + 10, HEADER + 30);
  }
  drawOverview();
}

function drawSpan(
  g: CanvasRenderingContext2D,
  span: Selection | LabNote,
  fill: string,
  stroke: string,
  dashed: boolean,
): void {
  const y0 = yOf(span.start);
  const y1 = Math.max(y0 + 2, yOf(span.end));
  let x0 = RULER - 10;
  let x1 = layout.width;
  if (span.lowHz !== undefined && span.highHz !== undefined) {
    x0 = xOfHz(span.lowHz);
    x1 = xOfHz(span.highHz);
  } else if (span.chart) {
    const column = layout.columns.find((c) => c.chart.label === span.chart);
    if (column) {
      x0 = column.x - 3;
      x1 = column.x + LANE * 4 + 3;
    }
  }
  g.fillStyle = fill;
  g.fillRect(x0, y0, x1 - x0, y1 - y0);
  g.strokeStyle = stroke;
  g.setLineDash(dashed ? [4, 3] : []);
  g.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0 - 1, y1 - y0 - 1);
  g.setLineDash([]);
}

/** A saved note on the canvas: its rectangle, and what was written about it on a label at its top. */
function drawSavedNote(g: CanvasRenderingContext2D, note: LabNote): void {
  if (yOf(note.end) < HEADER || yOf(note.start) > layout.height) return;
  if (note.lowHz !== undefined) {
    // A note on a frequency band also marks its time span across the charts, the Custom one included.
    const y0 = yOf(note.start);
    const y1 = Math.max(y0 + 2, yOf(note.end));
    g.fillStyle = "rgba(59,255,208,0.1)";
    g.fillRect(RULER - 10, y0, layout.curvesX - RULER + 10, y1 - y0);
    g.fillStyle = "rgba(59,255,208,0.6)";
    g.fillRect(RULER - 10, y0, layout.curvesX - RULER + 10, 1);
    g.fillRect(RULER - 10, y1 - 1, layout.curvesX - RULER + 10, 1);
  }
  g.lineWidth = 2;
  drawSpan(g, note, "rgba(59,255,208,0.16)", "#3bffd0", false);
  g.lineWidth = 1;
  const words = [note.text, ...note.tags].filter(Boolean).join(" · ");
  if (!words) return;
  const banded = note.lowHz !== undefined && note.highHz !== undefined;
  const x = banded ? xOfHz(note.lowHz!) : layout.curvesX;
  g.font = "11px ui-sans-serif, system-ui, sans-serif";
  const room = layout.width - x - 12;
  let label = words;
  while (label.length > 4 && g.measureText(label).width > room)
    label = `${label.slice(0, -4)}…`;
  const y = Math.max(HEADER + 2, yOf(note.start) + 2);
  g.fillStyle = "rgba(4,9,26,0.85)";
  g.fillRect(x + 2, y, g.measureText(label).width + 10, 16);
  g.fillStyle = "#3bffd0";
  g.fillText(label, x + 7, y + 12);
}

function visibleNotes(
  list: readonly PlacedNote[],
  from: number,
  to: number,
): PlacedNote[] {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.time < from) lo = mid + 1;
    else hi = mid;
  }
  const out: PlacedNote[] = [];
  for (let i = lo; i < list.length && list[i]!.time <= to; i++)
    out.push(list[i]!);
  // Holds that started before the window.
  for (const note of list)
    if (note.endTime !== undefined && note.time < from && note.endTime >= from)
      out.push(note);
  return out;
}

function drawNote(
  g: CanvasRenderingContext2D,
  note: PlacedNote,
  x: number,
  tapped = false,
): void {
  const cx = x + note.column * LANE + LANE / 2;
  const y = yOf(note.time);
  const set = gameSprites();
  if (note.kind === "mine") {
    blit(g, set.mines[0]!, cx, y);
    return;
  }
  if (note.endTime !== undefined) {
    g.fillStyle =
      note.kind === "roll" ? "rgba(255,155,59,0.55)" : "rgba(59,255,120,0.45)";
    g.fillRect(cx - LANE * 0.22, y, LANE * 0.44, yOf(note.endTime) - y);
  }
  // The game's own arrow for this beat and lane.
  // A tapped note is never exactly on the grid: it takes the colour of the 16th it is nearest.
  const sprite =
    set.arrows[gameQuantOf(tapped ? snapBeat(note.beat, 4) : note.beat)]?.[
      note.column
    ];
  if (sprite) blit(g, sprite, cx, y);
}

/** The game's note sprites at the lab's lane width, redrawn when the screen's pixel ratio changes. */
const spriteElements = new WeakMap<SpriteCanvas, HTMLCanvasElement>();
let spriteSet: SpriteSet | undefined;
let spriteRatio = 0;
function gameSprites(): SpriteSet {
  const ratio = window.devicePixelRatio || 1;
  if (!spriteSet || spriteRatio !== ratio) {
    spriteRatio = ratio;
    spriteSet = createSprites((width, height) => {
      const element = el("canvas", { width, height });
      spriteElements.set(element, element);
      return element;
    }, LANE * ratio);
  }
  return spriteSet;
}
/** Draws a sprite (device pixels) centred on a point in the lab's CSS pixels. */
function blit(
  g: CanvasRenderingContext2D,
  sprite: Sprite,
  cx: number,
  cy: number,
): void {
  const image = spriteElements.get(sprite.canvas);
  if (!image) return;
  const size = sprite.size / spriteRatio;
  g.drawImage(image, cx - size / 2, cy - size / 2, size, size);
}

function drawCurve(
  g: CanvasRenderingContext2D,
  values: Float32Array,
  scale: number,
  colour: string,
  t0: number,
  t1: number,
): void {
  const { curvesX } = layout;
  const from = Math.max(0, Math.floor(t0 * FRAMES_PER_SECOND));
  const to = Math.min(values.length - 1, Math.ceil(t1 * FRAMES_PER_SECOND));
  g.strokeStyle = colour;
  g.globalAlpha = 0.85;
  g.beginPath();
  for (let f = from; f <= to; f++) {
    const x = curvesX + 2 + Math.min(1.2, values[f]! / scale) * (CURVES - 6);
    const y = yOf(f / FRAMES_PER_SECOND);
    if (f === from) g.moveTo(x, y);
    else g.lineTo(x, y);
  }
  g.stroke();
  g.globalAlpha = 1;
}

function drawOverview(): void {
  const ratio = window.devicePixelRatio || 1;
  const width = overview.clientWidth;
  const height = overview.clientHeight;
  overview.width = Math.round(width * ratio);
  overview.height = Math.round(height * ratio);
  const g = overview.getContext("2d")!;
  g.setTransform(ratio, 0, 0, ratio, 0, 0);
  g.fillStyle = "#070d24";
  g.fillRect(0, 0, width, height);
  const yAt = (time: number) => (time / duration) * height;
  if (spectra) {
    const step = Math.max(1, Math.floor(spectra.frames / height));
    g.fillStyle = "rgba(59,255,208,0.5)";
    for (let y = 0; y < height; y++) {
      const f = Math.floor((y / height) * spectra.frames);
      let peak = 0;
      for (let i = f; i < Math.min(spectra.frames, f + step); i++)
        peak = Math.max(peak, spectra.onset[i]!);
      g.fillRect(0, y, Math.min(1, peak / onsetScale) * width, 1);
    }
  }
  g.fillStyle = "rgba(59,255,208,0.9)";
  for (const note of notes.notes.filter((n) => n.song === songId))
    g.fillRect(
      width - 5,
      yAt(note.start),
      5,
      Math.max(2, yAt(note.end) - yAt(note.start)),
    );
  g.strokeStyle = "#ffffff";
  g.strokeRect(
    0.5,
    yAt(topTime) + 0.5,
    width - 1,
    Math.max(4, yAt(viewSeconds())),
  );
  g.fillStyle = "#ff6bd5";
  g.fillRect(0, yAt(playhead), width, 2);
}

// ---------------------------------------------------------------------------------------------------------------------
// Playback

function ensureContext(): AudioContext {
  if (!audioContext) {
    audioContext = new AudioContext();
    const length = Math.round(audioContext.sampleRate * 0.03);
    tickBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const data = tickBuffer.getChannelData(0);
    for (let i = 0; i < length; i++)
      data[i] =
        Math.sin((2 * Math.PI * 2200 * i) / audioContext.sampleRate) *
        Math.exp(-i / (length / 5)) *
        0.6;
    // The song, as it is (dry) and through a 4th-order band-pass (band); `applyBand` sets the mix.
    const context = audioContext;
    mixIn = context.createGain();
    dryGain = context.createGain();
    bandGain = context.createGain();
    bandFilters = [0.541, 1.307, 0.541, 1.307].map((q, index) => {
      const filter = context.createBiquadFilter();
      filter.type = index < 2 ? "highpass" : "lowpass";
      // For these filter types Web Audio takes Q in decibels; the two stages make a Butterworth response.
      filter.Q.value = 20 * Math.log10(q);
      return filter;
    });
    mixIn.connect(dryGain).connect(context.destination);
    let node: AudioNode = mixIn;
    for (const filter of bandFilters) node = node.connect(filter);
    node.connect(bandGain).connect(context.destination);
    applyBand();
  }
  return audioContext;
}

/** Points the filters at the band and sets the mix; a short ramp, so dragging the box does not click. */
function applyBand(): void {
  if (!audioContext || !dryGain || !bandGain) return;
  const now = audioContext.currentTime;
  const mix = bandMix(Boolean(band));
  dryGain.gain.setTargetAtTime(mix.dry, now, 0.015);
  bandGain.gain.setTargetAtTime(mix.band, now, 0.015);
  if (!band) return;
  const top = audioContext.sampleRate * 0.45;
  for (const [index, filter] of bandFilters.entries())
    filter.frequency.setTargetAtTime(
      Math.max(10, Math.min(top, index < 2 ? band.lowHz : band.highHz)),
      now,
      0.015,
    );
}

/** Seconds into the song the listener hears now. */
function heardTime(): number {
  if (!audioContext || !source) return playhead;
  const latency = (audioContext.outputLatency || 0) + audioContext.baseLatency;
  // Never before where this run started: just after a start or a seek the first sample has not been heard yet.
  return Math.max(
    startSong,
    startSong + (audioContext.currentTime - latency - startCtx) * rate,
  );
}

function togglePlay(): void {
  if (source) stop();
  else play();
}

/** Starts playback from the playhead. Synchronous, so a second call while one is starting finds `source` set. */
function play(): void {
  if (!playBuffer || source) return;
  const context = ensureContext();
  void context.resume();
  rate = Number(speedSelect.value) || 1;
  source = context.createBufferSource();
  source.buffer = playBuffer;
  source.playbackRate.value = rate;
  source.connect(mixIn ?? context.destination);
  startSong = Math.max(0, Math.min(playhead, duration - 0.05));
  startCtx = context.currentTime + 0.05;
  scheduledUntil = startSong;
  source.start(startCtx, startSong);
  const mine = source;
  source.onended = () => {
    if (source === mine) stop();
  };
  follow = true;
  playButton.textContent = "❚❚ Pause";
  const loop = ++frameLoop;
  requestAnimationFrame(() => frame(loop));
}

function stop(): void {
  frameLoop++;
  if (source) {
    playhead = Math.max(0, heardTime());
    const old = source;
    source = undefined;
    old.onended = null;
    try {
      old.stop();
    } catch {
      /* already ended */
    }
    for (const tick of pendingTicks) {
      tick.onended = null;
      try {
        tick.stop();
      } catch {
        /* already ended */
      }
    }
    pendingTicks.clear();
  }
  playButton.textContent = "▶ Play";
  draw();
}

function scheduleTicks(): void {
  if (!audioContext || !source || !tickBuffer) return;
  const choice = tickSelect.value;
  // Look ahead on the audio clock, not the heard time: output latency must not eat the lookahead.
  const horizon =
    startSong + (audioContext.currentTime + 0.3 - startCtx) * rate;
  if (horizon <= scheduledUntil || !choice) {
    scheduledUntil = Math.max(scheduledUntil, horizon);
    return;
  }
  const times: number[] = [];
  if (choice === "beats") {
    const timing = charts[0]?.timing;
    if (timing)
      for (
        let beat = Math.ceil(timing.beatAt(scheduledUntil));
        timing.timeAt(beat) < horizon;
        beat++
      )
        times.push(timing.timeAt(beat));
  } else {
    const chart = charts.find((c) => c.key === choice);
    let last = -1;
    for (const note of chart?.notes ?? [])
      if (
        note.kind !== "mine" &&
        note.time >= scheduledUntil &&
        note.time < horizon &&
        note.time !== last
      ) {
        times.push(note.time);
        last = note.time;
      }
  }
  for (const time of times) {
    const when = startCtx + (time - startSong) / rate;
    if (when < audioContext.currentTime) continue;
    const tick = audioContext.createBufferSource();
    tick.buffer = tickBuffer;
    tick.connect(audioContext.destination);
    tick.onended = () => pendingTicks.delete(tick);
    pendingTicks.add(tick);
    tick.start(when);
  }
  scheduledUntil = horizon;
}

function frame(loop: number): void {
  if (!source || loop !== frameLoop) return;
  playhead = heardTime();
  scheduleTicks();
  if (follow) {
    const seconds = viewSeconds();
    const wanted = playhead - seconds * 0.3;
    if (Math.abs(wanted - topTime) > 0.001) topTime = wanted;
  }
  draw();
  requestAnimationFrame(() => frame(loop));
}

function seek(time: number): void {
  const playing = Boolean(source);
  if (playing) stop();
  playhead = Math.max(0, Math.min(duration, time));
  if (playing) play();
  else draw();
}

/** Record mode: a tap at the moment it is heard, drawn at once and saved shortly after. */
function recordTap(column: number): void {
  const timing = charts[0]?.timing;
  if (!source || !timing) return;
  const time = Math.max(0, heardTime());
  if (recordFrom !== undefined && time < recordFrom) return;
  const tap: Tap = {
    time: Number(time.toFixed(3)),
    beat: Number(timing.beatAt(time).toFixed(3)),
    column,
  };
  tapHistory.push(tap);
  taps = addTap(taps, tap);
  hidden.delete(TAPPED);
  rebuildCharts();
  saveTaps();
}

function saveTaps(): void {
  const file: TapsFile = { version: 1, song: songId, taps };
  save(TAPS_KEY(songId), taps.length ? writeTaps(file) : null);
  // To the folder on this machine once the tapping pauses, not on every tap.
  clearTimeout(tapsTimer);
  tapsTimer = setTimeout(() => void writeToDevServer(undefined, file), 600);
}

/** Takes back the tap pressed last (then the one before it, and so on). */
function undoTap(): void {
  // Nothing pressed since the page opened: the tap nearest the playhead, within a second, goes instead.
  const here = heardTime();
  const tap =
    tapHistory.pop() ??
    taps
      .filter((other) => Math.abs(other.time - here) <= 1)
      .sort((a, b) => Math.abs(a.time - here) - Math.abs(b.time - here))[0];
  if (!tap) {
    say("no tap to undo: put the playhead on one and press ⌘Z");
    return;
  }
  taps = removeTap(taps, tap);
  rebuildCharts();
  saveTaps();
  draw();
  say(`removed the tap at ${tap.time.toFixed(2)} s`);
}

/** Deletes the Custom chart's taps inside the selection, when the selection was dragged over that chart. */
function deleteSelectedTaps(): boolean {
  if (!selection || selection.chart !== "Custom") return false;
  const left = removeSpan(taps, selection.start, selection.end);
  const gone = taps.length - left.length;
  taps = left;
  tapHistory = tapHistory.filter((tap) => left.includes(tap));
  selection = undefined;
  flux = undefined;
  rebuildCharts();
  saveTaps();
  renderSelection();
  draw();
  say(`deleted ${gone} tap${gone === 1 ? "" : "s"}`);
  return true;
}

function clearTaps(): void {
  if (!taps.length) return;
  taps = [];
  tapHistory = [];
  rebuildCharts();
  saveTaps();
  draw();
}

/** A seek from the keyboard: moves the playhead from where it is heard, and brings the view back to it. */
function seekBy(seconds: number): void {
  seek(heardTime() + seconds);
  follow = true;
  topTime = revealTop(playhead, topTime, viewSeconds());
  clampView();
  draw();
}

// ---------------------------------------------------------------------------------------------------------------------
// Pointer: select, seek, edit

interface Drag {
  x: number;
  y: number;
  zone: "spectrum" | "chart" | "ruler";
  chart?: LabChart;
}
let drag: Drag | undefined;
/** A drag on the frequency axis: where it started, the box as it was, and what it took hold of. */
let bandDrag: { x: number; start: Span; grab: Grab } | undefined;

/** The listening band on the frequency axis as it is drawn now, in canvas pixels. */
function bandSpan(): Span {
  const { specX, specW } = layout;
  if (!band) return { from: specX, to: specX + specW };
  const clamp = (x: number) => Math.max(specX, Math.min(specX + specW, x));
  return { from: clamp(xOfHz(band.lowHz)), to: clamp(xOfHz(band.highHz)) };
}

function zoneAt(x: number): Drag["zone"] {
  if (x < RULER) return "ruler";
  if (x >= layout.curvesX) return "spectrum";
  return "chart";
}

canvas.addEventListener("pointerdown", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (y < HEADER) {
    if (x < layout.specX) return;
    const span = bandSpan();
    bandDrag = { x, start: span, grab: grabAt(span, x) };
    canvas.setPointerCapture(event.pointerId);
    return;
  }
  const zone = zoneAt(x);
  const column = layout.columns.find((c) => x >= c.x && x < c.x + LANE * 4);
  if (zone === "chart" && editInput.checked && column) {
    editTap(column.chart, Math.floor((x - column.x) / LANE), timeOf(y));
    return;
  }
  drag = { x, y, zone, ...(column ? { chart: column.chart } : {}) };
  canvas.setPointerCapture(event.pointerId);
});

canvas.addEventListener("pointermove", (event) => {
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (bandDrag) {
    const { specX, specW } = layout;
    const span = dragSpan(
      bandDrag.start,
      bandDrag.grab,
      bandDrag.x,
      x,
      specX,
      specX + specW,
    );
    band = coversAll(span, specX, specX + specW)
      ? undefined
      : { lowHz: hzOfX(span.from), highHz: hzOfX(span.to) };
    applyBand();
    draw();
    return;
  }
  if (!drag) {
    // Over the frequency axis the cursor says what a press would do to the listening band.
    const grab =
      y < HEADER && x >= layout.specX ? grabAt(bandSpan(), x) : undefined;
    canvas.style.cursor =
      grab === "move"
        ? "grab"
        : grab === "low" || grab === "high"
          ? "ew-resize"
          : "";
    return;
  }
  if (Math.abs(y - drag.y) < 4 && Math.abs(x - drag.x) < 4) return;
  selection = selectionFrom(drag, x, y);
  draw();
});

canvas.addEventListener("dblclick", (event) => {
  const rect = canvas.getBoundingClientRect();
  if (event.clientY - rect.top >= HEADER || !band) return;
  band = undefined;
  applyBand();
  draw();
});

canvas.addEventListener("pointercancel", () => {
  bandDrag = undefined;
  drag = undefined;
});

canvas.addEventListener("pointerup", (event) => {
  if (bandDrag) {
    bandDrag = undefined;
    return;
  }
  if (!drag) return;
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const start = drag;
  drag = undefined;
  if (Math.abs(y - start.y) < 4 && Math.abs(x - start.x) < 4) {
    seek(timeOf(y));
    return;
  }
  selection = selectionFrom(start, x, y);
  updateFlux();
  renderSelection();
  draw();
});

function selectionFrom(start: Drag, x: number, y: number): Selection {
  const a = Math.max(0, timeOf(start.y));
  const b = Math.max(0, timeOf(y));
  const span: Selection = { start: Math.min(a, b), end: Math.max(a, b) };
  if (start.zone === "spectrum" && start.x >= layout.specX) {
    const hzA = hzOfX(Math.max(layout.specX, start.x));
    const hzB = hzOfX(Math.max(layout.specX, x));
    span.lowHz = Math.round(Math.min(hzA, hzB));
    span.highHz = Math.round(Math.max(hzA, hzB));
  } else if (start.zone === "chart" && start.chart)
    span.chart = start.chart.label;
  return span;
}

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    if (event.ctrlKey || event.metaKey) {
      const rect = canvas.getBoundingClientRect();
      zoom(Math.exp(-event.deltaY * 0.002), event.clientY - rect.top);
    } else {
      follow = false;
      topTime +=
        (event.deltaY + (event.shiftKey ? event.deltaX : 0)) / pxPerSec;
      clampView();
      draw();
    }
  },
  { passive: false },
);

function zoom(factor: number, anchorY = layout.height / 2): void {
  const anchor = timeOf(anchorY);
  pxPerSec = Math.max(20, Math.min(1200, pxPerSec * factor));
  topTime = anchor - (anchorY - HEADER) / pxPerSec;
  clampView();
  draw();
}

function clampView(): void {
  topTime = Math.max(-2, Math.min(duration - viewSeconds() * 0.2, topTime));
}

const overviewJump = (event: PointerEvent) => {
  const rect = overview.getBoundingClientRect();
  follow = false;
  topTime =
    ((event.clientY - rect.top) / rect.height) * duration - viewSeconds() / 2;
  clampView();
  draw();
};
overview.addEventListener("pointerdown", (event) => {
  overview.setPointerCapture(event.pointerId);
  overviewJump(event);
});
overview.addEventListener("pointermove", (event) => {
  if (event.buttons) overviewJump(event);
});

// ---------------------------------------------------------------------------------------------------------------------
// Editing

function editTap(chart: LabChart, column: number, time: number): void {
  if (!sim || chart.source !== "song") {
    say(
      "only the song's own charts can be edited; export a loaded file's charts by loading them as the song",
    );
    return;
  }
  const index = Number(chart.key.split(":")[1]);
  const songCharts = sim.charts.filter((c) => c.stepsType === "dance-single");
  const target = songCharts[index];
  if (!target) return;
  const beat = snapBeat(
    chart.timing.beatAt(time),
    Number(snapSelect.value) || 4,
  );
  const last = chart.timing.beatAt(duration);
  if (beat < 0 || beat > last) {
    say("taps go between the song's first beat and its end");
    return;
  }
  const replaced: SimChart = toggleTap(target, beat, column);
  sim = {
    ...sim,
    charts: sim.charts.map((c) => (c === target ? replaced : c)),
  };
  save(EDITS_KEY(songId), writeSsc(sim));
  rebuildCharts();
  draw();
}

function resetEdits(): void {
  save(EDITS_KEY(songId), null);
  void loadSong(songId);
}

function download(name: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = el("a", { href: url, download: name });
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportSsc(): void {
  if (sim) download(`${songId}.ssc`, writeSsc(sim), "text/plain");
}

sscInput.addEventListener("change", () => void addSscFiles());
async function addSscFiles(): Promise<void> {
  for (const file of sscInput.files ?? []) {
    try {
      extraSims.push({ name: file.name, sim: parseSimfile(await file.text()) });
    } catch (error) {
      say(
        `${file.name}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  sscInput.value = "";
  rebuildCharts();
  draw();
}

// ---------------------------------------------------------------------------------------------------------------------
// Selection panel and notes

function inSpan(chart: LabChart, span: Selection): PlacedNote[] {
  return chart.notes.filter(
    (note) =>
      note.kind !== "mine" && note.time >= span.start && note.time <= span.end,
  );
}

function renderSelection(): void {
  if (!selection) {
    selectionBox.replaceChildren(
      el("h2", { textContent: "Selection" }),
      el("p", {
        className: "lab-dim",
        textContent: "Drag on the spectrogram or a chart to select.",
      }),
    );
    return;
  }
  const span = selection;
  const timing = charts[0]?.timing;
  const beats = timing
    ? `beats ${timing.beatAt(span.start).toFixed(2)}–${timing.beatAt(span.end).toFixed(2)}`
    : "";
  const rows = charts
    .filter((chart) => !hidden.has(chart.key))
    .map((chart) => {
      const list = inSpan(chart, span);
      const times = new Set(list.map((n) => n.beat));
      const stats = chartStats(list);
      const parts = Object.entries(stats.quants)
        .sort(
          (a, b) =>
            Number(a[0] === "0" ? 99 : a[0]) - Number(b[0] === "0" ? 99 : b[0]),
        )
        .map(
          ([q, share]) =>
            `${quantName(Number(q) as Quant)} ${Math.round(share * 100)}%`,
        )
        .join(", ");
      return el("li", {
        textContent: `${chart.label}: ${times.size} steps${parts ? ` (${parts})` : ""}`,
      });
    });
  const text = el("textarea", {
    rows: 4,
    placeholder: "What do you hear? What should the chart do here?",
  });
  const picked = new Set<NoteTag>();
  const tags = el(
    "div",
    { className: "lab-tags" },
    ...NOTE_TAGS.map((tag) => {
      const chip = button(tag, () => {
        if (picked.has(tag)) picked.delete(tag);
        else picked.add(tag);
        chip.classList.toggle("on", picked.has(tag));
      });
      return chip;
    }),
  );
  const saveNote = () => {
    const note: LabNote = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      created: new Date().toISOString(),
      song: songId,
      start: round(span.start, 3),
      end: round(span.end, 3),
      startBeat: round(timing?.beatAt(span.start) ?? 0, 3),
      endBeat: round(timing?.beatAt(span.end) ?? 0, 3),
      tags: [...picked],
      text: text.value.trim(),
    };
    if (span.lowHz !== undefined && span.highHz !== undefined) {
      note.lowHz = span.lowHz;
      note.highHz = span.highHz;
    }
    if (span.chart) note.chart = span.chart;
    // A picture of the lab as it is now, the selection still marked, to go with the note.
    let png: string | undefined;
    try {
      png = canvas.toDataURL("image/png");
    } catch {
      png = undefined;
    }
    setNotes(
      mergeNotes(notes, { version: 1, notes: [note] }),
      png ? { id: note.id, png } : undefined,
    );
    selection = undefined;
    flux = undefined;
    renderSelection();
    draw();
  };
  text.addEventListener("keydown", (event) => {
    // Enter saves; shift + enter is a new line.
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      saveNote();
    }
    // Escape leaves the text box (what was typed stays), so space and the arrows drive playback again.
    if (event.key === "Escape") text.blur();
    // With nothing typed, delete removes the Custom taps in the selection instead of editing text.
    if (
      (event.key === "Backspace" || event.key === "Delete") &&
      !text.value &&
      deleteSelectedTaps()
    )
      event.preventDefault();
    event.stopPropagation();
  });
  selectionBox.replaceChildren(
    el("h2", { textContent: "Selection" }),
    el(
      "p",
      {},
      `${span.start.toFixed(2)}–${span.end.toFixed(2)} s (${(span.end - span.start).toFixed(2)} s) ${beats}`,
      span.lowHz !== undefined ? el("br") : "",
      span.lowHz !== undefined
        ? `band ${span.lowHz}–${span.highHz} Hz (pink curve)`
        : "",
      span.chart ? el("br") : "",
      span.chart ? `chart ${span.chart}` : "",
    ),
    el("ul", { className: "lab-stats" }, ...rows),
    tags,
    text,
    el(
      "div",
      { className: "lab-row" },
      button("Save note", saveNote, "Enter (shift + Enter for a new line)"),
      button("Play span", () => {
        seek(span.start);
        if (!source) play();
      }),
      button("Clear", () => {
        selection = undefined;
        flux = undefined;
        renderSelection();
        draw();
      }),
    ),
  );
  text.focus();
}

const round = (value: number, digits: number) => Number(value.toFixed(digits));

function setNotes(next: NotesFile, shot?: { id: string; png: string }): void {
  notes = next;
  save(NOTES_KEY, writeNotes(notes));
  void writeLinked();
  void writeToDevServer(shot);
  renderNotes();
}

/**
 * In local development the notes also go to the dev server, which writes them (and a new note's picture) to a
 * folder on this machine. The deployed page has no such server and skips this.
 */
async function writeToDevServer(
  shot?: { id: string; png: string },
  tapped?: TapsFile,
): Promise<void> {
  if (!import.meta.env.DEV) return;
  try {
    const response = await fetch(`${BASE}${NOTES_UPLOAD_PATH}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: writeNotesUpload({
        notes,
        ...(shot ? { shot } : {}),
        ...(tapped ? { taps: tapped } : {}),
      }),
    });
    const reply = (await response.json()) as { dir?: string; error?: string };
    diskState.textContent = response.ok
      ? `Also saved on this Mac: ${reply.dir ?? ""}`
      : `Could not save to this Mac: ${reply.error ?? response.status}`;
  } catch (error) {
    diskState.textContent = `Could not save to this Mac: ${error instanceof Error ? error.message : String(error)}`;
  }
}
const diskState = el("p", { className: "lab-dim" });

async function writeLinked(): Promise<void> {
  if (!linkedFile) return;
  try {
    const writable = await linkedFile.createWritable();
    await writable.write(writeNotes(notes));
    await writable.close();
    fileState.textContent = `saving to ${linkedFile.name}`;
  } catch (error) {
    fileState.textContent = `could not write ${linkedFile.name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const fileState = el("p", {
  className: "lab-dim",
  textContent:
    "Notes are kept in this browser. Link a file to keep them on disk.",
});

interface FilePickers {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>;
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>;
}
const pickers = window as unknown as FilePickers;
const JSON_TYPES = [
  { description: "Chart lab notes", accept: { "application/json": [".json"] } },
];

async function linkNewFile(): Promise<void> {
  if (!pickers.showSaveFilePicker) return;
  try {
    linkedFile = await pickers.showSaveFilePicker({
      suggestedName: "chart-lab-notes.json",
      types: JSON_TYPES,
    });
    await writeLinked();
  } catch {
    /* cancelled */
  }
}

async function openLinkedFile(): Promise<void> {
  if (!pickers.showOpenFilePicker) return;
  try {
    const [handle] = await pickers.showOpenFilePicker({ types: JSON_TYPES });
    if (!handle) return;
    const text = await (await handle.getFile()).text();
    const incoming = text.trim()
      ? parseNotes(text)
      : { version: 1 as const, notes: [] };
    linkedFile = handle;
    setNotes(mergeNotes(notes, incoming));
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError")
      fileState.textContent = error.message;
  }
}

notesInput.addEventListener("change", () => void importNotes());
async function importNotes(): Promise<void> {
  const file = notesInput.files?.[0];
  notesInput.value = "";
  if (!file) return;
  try {
    setNotes(mergeNotes(notes, parseNotes(await file.text())));
  } catch (error) {
    fileState.textContent = `${file.name}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function renderNotes(): void {
  const mine = notes.notes.filter((note) => note.song === songId);
  const list = el(
    "ol",
    { className: "lab-notes" },
    ...mine.map((note) => {
      const item = el(
        "li",
        {},
        el("span", {
          textContent: describeNote(note).replace(`${songId} `, ""),
        }),
      );
      item.title = "Click to jump there";
      item.onclick = () => {
        follow = false;
        topTime = note.start - viewSeconds() * 0.25;
        clampView();
        selection = {
          start: note.start,
          end: note.end,
          ...(note.lowHz !== undefined && note.highHz !== undefined
            ? { lowHz: note.lowHz, highHz: note.highHz }
            : {}),
          ...(note.chart ? { chart: note.chart } : {}),
        };
        updateFlux();
        seek(note.start);
      };
      const remove = button(
        "✕",
        () =>
          setNotes({
            version: 1,
            notes: notes.notes.filter((n) => n.id !== note.id),
          }),
        "Delete this note",
      );
      remove.onclick = (event) => {
        event.stopPropagation();
        setNotes({
          version: 1,
          notes: notes.notes.filter((n) => n.id !== note.id),
        });
      };
      item.append(remove);
      return item;
    }),
  );
  const copy = button(
    "Copy as text",
    () => {
      const text = mine.map(describeNote).join("\n");
      void navigator.clipboard.writeText(text).then(
        () => (fileState.textContent = `copied ${mine.length} notes`),
        () => download(`${songId}-notes.txt`, text, "text/plain"),
      );
    },
    "Copy this song's notes to paste into a chat",
  );
  const tools = el(
    "div",
    { className: "lab-row" },
    copy,
    button(
      "Download",
      () =>
        download("chart-lab-notes.json", writeNotes(notes), "application/json"),
      "All songs' notes as JSON",
    ),
    button("Import…", () => notesInput.click(), "Merge notes from a JSON file"),
  );
  const linking = el("div", { className: "lab-row" });
  if (pickers.showSaveFilePicker && pickers.showOpenFilePicker)
    linking.append(
      button(
        "Save to new file…",
        () => void linkNewFile(),
        "Keep the notes in a file that updates on every change",
      ),
      button(
        "Open notes file…",
        () => void openLinkedFile(),
        "Merge and keep saving to an existing notes file",
      ),
    );
  notesBox.replaceChildren(
    el("h2", {
      textContent: `Notes (${mine.length} on this song, ${notes.notes.length} in all)`,
    }),
    list,
    tools,
    linking,
    fileState,
    diskState,
  );
}

// ---------------------------------------------------------------------------------------------------------------------
// Controls

songSelect.onchange = () => void loadSong(songSelect.value);
viewSelect.onchange = () => {
  buildTiles();
  draw();
};
floorInput.oninput = () => {
  buildTiles();
  draw();
};
gridInput.onchange = () => draw();
recordInput.onchange = () => {
  document.body.classList.toggle("lab-recording", recordInput.checked);
  recordInput.blur();
  say(
    recordInput.checked
      ? "recording: play the song and tap WASD or IJKL"
      : "recording off",
  );
};
speedSelect.onchange = () => {
  if (source) {
    stop();
    play();
  }
};
tickSelect.onchange = () => {
  scheduledUntil = heardTime();
};

window.addEventListener("keydown", (event) => {
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (typingIn(target)) return;
  const delta = seekDelta(event);
  // A focused button, menu or slider would take space and the arrows for itself: playback owns them here.
  if ((event.key === " " || delta !== undefined) && target !== document.body)
    target?.blur();
  if (event.key === " ") {
    event.preventDefault();
    if (!event.repeat) togglePlay();
  } else if (delta !== undefined) {
    event.preventDefault();
    seekBy(delta);
  } else if (
    (event.key === "Backspace" || event.key === "Delete") &&
    deleteSelectedTaps()
  ) {
    event.preventDefault();
  } else if (
    event.key.toLowerCase() === "z" &&
    (event.metaKey || event.ctrlKey) &&
    !event.shiftKey &&
    !event.altKey
  ) {
    event.preventDefault();
    undoTap();
  } else if (
    event.key.toLowerCase() === "r" &&
    event.shiftKey &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    // Recording starts here: taps before this line are not kept. Pressed again on the line, it goes away.
    const here = Math.max(0, heardTime());
    if (recordFrom !== undefined && Math.abs(recordFrom - here) < 0.3) {
      recordFrom = undefined;
      save(RECORD_FROM_KEY(songId), null);
      say("recording start line removed");
    } else {
      recordFrom = here;
      save(RECORD_FROM_KEY(songId), here.toFixed(3));
      if (!recordInput.checked) {
        recordInput.checked = true;
        recordInput.onchange?.(new Event("change"));
      }
      say(
        `recording starts at ${here.toFixed(2)} s: taps before it are not kept`,
      );
    }
    draw();
  } else if (
    event.key.toLowerCase() === "r" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    recordInput.checked = !recordInput.checked;
    recordInput.onchange?.(new Event("change"));
  } else if (
    recordInput.checked &&
    tapColumn(event.key) !== undefined &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    if (!event.repeat) recordTap(tapColumn(event.key)!);
  } else if (
    event.key.toLowerCase() === "x" &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    // Mark this moment, to come back to with enter.
    marker = Math.max(0, heardTime());
    save(MARKER_KEY(songId), marker.toFixed(3));
    draw();
  } else if (event.key === "Enter" && marker !== undefined) {
    // Back to the marker (in the note's text box enter saves the note instead; it never reaches here).
    event.preventDefault();
    if (target !== document.body) target?.blur();
    seekBy(marker - heardTime());
  } else if (event.key === "+" || event.key === "=") zoom(1.25);
  else if (event.key === "-") zoom(0.8);
  else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    follow = false;
    topTime += (event.key === "ArrowDown" ? 1 : -1) * viewSeconds() * 0.15;
    clampView();
    draw();
  } else if (event.key === "Escape") {
    selection = undefined;
    flux = undefined;
    renderSelection();
    draw();
  }
});

new ResizeObserver(() => draw()).observe(stage);

/** For the console and automated checks. */
(window as unknown as { chartLab: unknown }).chartLab = {
  state: () => ({
    song: songId,
    duration,
    frames: spectra?.frames ?? 0,
    charts: charts.map((c) => ({
      key: c.key,
      label: c.label,
      notes: c.notes.length,
    })),
    notes: notes.notes.length,
    playhead,
    topTime,
    pxPerSec,
    selection,
  }),
  select: (span: Selection) => {
    selection = span;
    updateFlux();
    renderSelection();
    draw();
  },
  view: (top: number, scale: number) => {
    topTime = top;
    pxPerSec = scale;
    follow = false;
    draw();
  },
};

// In local development the folder on this machine and this browser share their notes: whatever was written before,
// in any browser, shows up here, and notes only this browser has reach the folder.
void (async () => {
  if (!import.meta.env.DEV) return;
  try {
    const response = await fetch(`${BASE}${NOTES_UPLOAD_PATH}`);
    if (response.ok) {
      const merged = mergeNotes(parseNotes(await response.text()), notes);
      if (merged.notes.length !== notes.notes.length) {
        setNotes(merged);
        draw();
        return;
      }
    }
  } catch {
    /* no folder yet, or an unreadable file: this browser's notes stand */
  }
  if (notes.notes.length) void writeToDevServer();
})();

void loadSong(
  new URLSearchParams(location.search).get("song") ?? "final-chase",
);
