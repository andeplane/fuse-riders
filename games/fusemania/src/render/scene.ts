import type { WorldView } from "../engine/view.js";
import { BATTLE_MODE, COLUMNS, type Steps } from "../engine/view-kit.js";
import { drawBoard, type BoardInfo } from "./board.js";
import { createFeedback } from "./feedback.js";
import { drawField, type FieldInfo } from "./field.js";
import {
  fitText,
  fittedText,
  label,
  outlined,
  riderTexts,
  type Frame,
} from "./frame.js";
import { layoutFor, type Field, type Layout } from "./layout.js";
import { BACKGROUND, CYAN, GOLD, MUTED, TEXT, WHITE } from "./palette.js";
import type { CanvasFactory, SceneCanvas, SpriteCanvas } from "./pen.js";
import { PLAIN, scrambleFor } from "./scramble.js";
import { createIcons, createSprites, type SpriteSet } from "./sprites.js";

export { BASE_WINDOW_MS, modsAt, notePlacement, type Mods } from "./mods.js";
export type { CanvasFactory, Pen, SceneCanvas, SpriteCanvas } from "./pen.js";

/**
 * Draws one frame of a Fusemania match on a 2D canvas. A rider's device shows its own field, lit and framed, with the
 * other riders' beside it: their attacks, judgments and combos as they are, their arrows shuffled between the columns
 * (`scramble.ts`) so there is nothing to read off them. A shared screen shows every rider's field as it is, in a row.
 * The live leaderboard is beside the fields.
 *
 * It keeps no loop, timer or clock of its own. The app calls `draw` once per animation frame with the view to show
 * and the song time that is heard right now, and where every note is drawn is worked out from that song time alone,
 * never carried from the frame before: a dropped frame or a slow device changes how often the picture is drawn, not
 * what it shows. What it does remember (`feedback.ts`) is when things were first seen, so a burst or a sliding box
 * can play out; that too advances only with the song time it is given. Nothing here feeds back into the match.
 */
export interface SceneOptions {
  /** No beat pulses, bounces, flashes or shakes of the chrome. The attacks stay: they are the game. */
  reducedMotion?: boolean;
  /**
   * Makes an offscreen canvas for a pre-rendered sprite; in a browser,
   * `(w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; return c; }`.
   */
  createCanvas(width: number, height: number): SpriteCanvas;
  /** Device pixels per CSS pixel; the window's unless given. */
  pixelRatio?: () => number;
}
export interface DrawOptions {
  /** The song time to draw, in ms: what is heard right now (already includes the player's visual offset). */
  songMs: number;
  /** The beat at `songMs` (fractional), for beat pulses; and the tempo there. */
  beat: number;
  bpm: number;
  /** The chart each rider plays, by rider slot (`view.players[slot]`). */
  steps: readonly Steps[];
  /** Display names by rider slot. */
  names: readonly string[];
  /** The slot this device plays, or -1 for a watcher or the shared TV. */
  local: number;
  /** Scroll speed: a field's length shows `BASE_WINDOW_MS / speed` milliseconds of song. */
  speed: number;
  /** Arrows fall to targets at the bottom (true) or rise to targets at the top (false, StepMania's classic). */
  down: boolean;
  /** Song title and chart names by slot, for the header line. */
  title: string;
  chartNames: readonly string[];
  /** Each player's session total before this song, by slot: the leaderboard adds the song's score. Leave out for none. */
  totals?: readonly number[];
  /** The key that throws the held power-up, as text ("SPACE"), for the prompt. */
  itemKey: string;
  /** CSS pixels at the bottom of the canvas covered by touch buttons (0 when none): the field stays above it. */
  inset?: number;
}
const NO_TOTALS: readonly number[] = [];
export interface Scene {
  draw(view: WorldView, options: DrawOptions): void;
  /** Call after the canvas's CSS size (or the screen's pixel ratio) changes. */
  resize(): void;
  destroy(): void;
}

const MAX_RATIO = 3;
const COUNTS = ["", "1", "2", "3"];

export function createScene(canvas: SceneCanvas, options: SceneOptions): Scene {
  const g = canvas.getContext("2d");
  const factory: CanvasFactory = (width, height) =>
    options.createCanvas(width, height);
  const ratio =
    options.pixelRatio ??
    (() => (typeof devicePixelRatio === "number" ? devicePixelRatio : 1));
  const feedback = createFeedback();
  const icons = createIcons(factory);
  const sets = new Map<number, SpriteSet>();
  const texts = Array.from({ length: 5 }, riderTexts);
  const title = fittedText(),
    chart = fittedText();
  let destroyed = false,
    unit = 1,
    layout: Layout | undefined,
    laidRiders = -1,
    laidLocal = -2,
    laidInset = -1;

  const frame: Frame | undefined = g
    ? {
        pen: g,
        unit: 1,
        songMs: 0,
        beat: 0,
        speed: 1,
        down: false,
        calm: options.reducedMotion === true,
        battle: false,
        seed: 0,
        itemKey: "",
        multi: false,
        icons,
      }
    : undefined;
  const fieldInfo: FieldInfo = {
    name: "",
    chart: "",
    local: false,
    marked: false,
    columns: PLAIN,
    texts: texts[0]!,
    gap: Number.NaN,
    banner: 0,
    bannerAt: 0,
  };
  const boardInfo: BoardInfo = {
    names: [],
    chartNames: [],
    totals: [],
    local: -1,
    texts,
  };

  function resize(): void {
    if (destroyed) return;
    const now = ratio();
    unit = Math.max(0.5, Math.min(MAX_RATIO, now > 0 ? now : 1));
    const width = Math.max(0, Math.round(canvas.clientWidth * unit)),
      height = Math.max(0, Math.round(canvas.clientHeight * unit));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    layout = undefined;
  }

  /** The layout for this many riders, and the sprites its fields are drawn with: remade only when something changed. */
  function laid(riders: number, local: number, inset: number): Layout {
    if (
      layout &&
      laidRiders === riders &&
      laidLocal === local &&
      laidInset === inset
    )
      return layout;
    layout = layoutFor(canvas.width, canvas.height, riders, local, inset, unit);
    laidRiders = riders;
    laidLocal = local;
    laidInset = inset;
    for (const size of [...sets.keys()])
      if (!layout.fields.some((field) => field.col === size)) sets.delete(size);
    for (const field of layout.fields)
      if (!sets.has(field.col))
        sets.set(field.col, createSprites(factory, field.col));
    return layout;
  }

  resize();

  return {
    resize,
    draw(view, shot) {
      if (destroyed) return;
      const songMs = shot.songMs;
      feedback.observe(view, shot.steps, songMs, shot.local);
      if (!g || !frame || canvas.width <= 0 || canvas.height <= 0) return;
      const riders = view.players.length;
      const local = shot.local >= 0 && shot.local < riders ? shot.local : -1;
      const plan = laid(riders, local, Math.max(0, shot.inset ?? 0));
      const width = plan.width,
        height = plan.height;

      frame.unit = unit;
      frame.songMs = songMs;
      frame.beat = Number.isFinite(shot.beat) ? shot.beat : 0;
      frame.speed = shot.speed;
      frame.down = shot.down;
      frame.battle = view.mode === BATTLE_MODE;
      frame.seed = view.seed;
      frame.itemKey = shot.itemKey;
      frame.multi = riders > 1;

      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 1;
      g.globalCompositeOperation = "source-over";
      g.shadowBlur = 0;
      g.textBaseline = "middle";
      g.fillStyle = BACKGROUND;
      g.fillRect(0, 0, width, height);

      if (plan.panel) {
        boardInfo.names = shot.names;
        boardInfo.chartNames = shot.chartNames;
        boardInfo.totals = shot.totals ?? NO_TOTALS;
        boardInfo.local = local;
        drawBoard(frame, plan.panel, view, feedback, boardInfo);
      }

      for (let i = 0; i < plan.fields.length; i++) {
        const field = plan.fields[i]!,
          slot = field.slot;
        const player = view.players[slot],
          rider = feedback.riders[slot],
          set = sets.get(field.col);
        if (!player || !rider || !set) continue;
        fieldInfo.name = shot.names[slot] ?? "";
        fieldInfo.chart = shot.chartNames[slot] ?? "";
        fieldInfo.local = slot === local;
        // On a rider's device its own field is marked out and the others' arrows are shuffled.
        fieldInfo.marked = slot === local && plan.fields.length > 1;
        fieldInfo.columns =
          local < 0 || slot === local ? PLAIN : scrambleFor(view.seed);
        fieldInfo.texts = texts[slot] ?? texts[0]!;
        fieldInfo.banner = feedback.banner;
        fieldInfo.bannerAt = feedback.bannerAt;
        fieldInfo.gap = Number.NaN;
        if (slot === local && riders > 1) {
          // How far ahead of second place, or behind the leader: from the scores as shown, so it rolls with them.
          // The rolling scores can cross a moment after the places have: the sign is the place's.
          const leads = player.place === 1,
            rival = leads ? 2 : 1;
          for (let other = 0; other < riders; other++)
            if (other !== slot && view.players[other]!.place === rival) {
              const gap =
                Math.round(rider.score) -
                Math.round(feedback.riders[other]!.score);
              fieldInfo.gap = leads ? Math.max(0, gap) : Math.min(0, gap);
            }
        }
        drawField(
          frame,
          set,
          field,
          player,
          shot.steps[slot],
          rider,
          fieldInfo,
        );
      }

      // The title bar, with the song's progress along its bottom edge.
      const pad = Math.round(8 * unit),
        size = Math.round(8 * unit),
        bar = plan.barHeight;
      const named = local >= 0 ? (shot.chartNames[local] ?? "") : "";
      g.globalAlpha = 1;
      label(
        g,
        fitText(title, shot.title, 64),
        pad,
        bar * 0.42,
        size,
        TEXT,
        "left",
        width * (named ? 0.62 : 1) - pad * 2,
      );
      if (named)
        label(
          g,
          fitText(chart, named, 24),
          width - pad,
          bar * 0.42,
          size,
          MUTED,
          "right",
          width * 0.34,
        );
      const thick = Math.max(2, Math.round(3 * unit));
      const progress =
        view.phase === "over"
          ? 1
          : view.endMs > 0
            ? Math.max(0, Math.min(1, songMs / view.endMs))
            : 0;
      g.fillStyle = "rgba(54,84,119,0.5)";
      g.fillRect(0, bar - thick, width, thick);
      g.fillStyle = CYAN;
      g.fillRect(0, bar - thick, Math.round(width * progress), thick);

      // Before the song: get ready, then three, two, one.
      // Over the rider's own field, or across all of them on a shared screen.
      let first: Field | undefined = plan.fields[0],
        last = plan.fields[plan.fields.length - 1];
      if (local >= 0 && songMs < 0)
        for (let i = 0; i < plan.fields.length; i++)
          if (plan.fields[i]!.slot === local) first = last = plan.fields[i];
      if (songMs < 0 && view.phase !== "over" && first && last) {
        const left = first.x,
          right = last.x + last.col * COLUMNS;
        const x = (left + right) / 2,
          y = (first.laneTop + first.laneBottom) / 2;
        const col = first.col;
        outlined(
          g,
          "GET READY",
          x,
          y - col * 1.1,
          Math.min(col * 0.38, (right - left) / 9.5),
          WHITE,
          right - left,
        );
        const seconds = Math.ceil(-songMs / 1000);
        if (seconds >= 1 && seconds <= 3) {
          const into = seconds + songMs / 1000;
          const pop = frame.calm
            ? 1
            : 1 + 0.5 * (1 - into) * (1 - into) * (1 - into);
          g.globalAlpha = frame.calm ? 1 : Math.min(1, 1.6 - into);
          outlined(
            g,
            COUNTS[seconds]!,
            x,
            y + col * 0.3,
            col * 1.1 * pop,
            GOLD,
            right - left,
          );
          g.globalAlpha = 1;
        }
      }
    },
    destroy() {
      destroyed = true;
      layout = undefined;
      sets.clear();
      icons.clear();
    },
  };
}
