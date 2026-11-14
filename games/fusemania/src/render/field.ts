import type { PlayerView } from "../engine/view.js";
import {
  BOO,
  COLUMNS,
  DOUBLE,
  ITEM_KINDS,
  ITEM_MS,
  ITEM_NAMES,
  JUDGMENT_NAMES,
  MARVELOUS,
  MINES,
  MISS,
  NO_ITEM,
  PERFECT,
  ROLL,
  SHIELD,
  STAR,
  TAP,
  isAttack,
  itemNotes,
  turnedMine,
  wasHit,
  type StepNote,
  type Steps,
} from "../engine/view-kit.js";
import { covered, firstEndingAt, has, quantsOf } from "./chart.js";
import { LEAD_BANNER, NO_BANNER, type RiderFeedback } from "./feedback.js";
import {
  blit,
  countText,
  fitText,
  gapText,
  label,
  outlined,
  pressText,
  scoreText,
  type Frame,
  type RiderTexts,
} from "./frame.js";
import { TARGET_INSET, laneOf, type Field } from "./layout.js";
import {
  LAG_MS,
  aheadMs,
  behindMs,
  bends,
  blackoutAt,
  modsAt,
  noMods,
  noPlacement,
  notePlacement,
  targetX,
  type LaneGeometry,
} from "./mods.js";
import {
  CYAN,
  GOLD,
  JUDGMENT_COLORS,
  LINE,
  MUTED,
  PINK,
  QUANT_COLORS,
  RAINBOW,
  RED,
  SHIMMER,
  TEXT,
  WHITE,
  placeName,
  slotColor,
} from "./palette.js";
import type { Pen } from "./pen.js";
import {
  HELD_BURST,
  TURNS,
  itemColor,
  type Sprite,
  type SpriteSet,
} from "./sprites.js";

/**
 * Draws one rider's field: the lanes, the targets, every note in view, the bursts and words for what just happened,
 * and the power-ups in play. The notes are a pure function of the view and the song time; the bursts and pops play
 * from the moments `feedback.ts` stamped.
 */
export interface FieldInfo {
  name: string;
  chart: string;
  /** This device's own field: it gets the item prompt and the lead banner. */
  local: boolean;
  texts: RiderTexts;
  /** The gap in score to the rider next to this one in the standings, or NaN to show none. */
  gap: number;
  banner: number;
  bannerAt: number;
}

/** How long a burst on a target, a mine's blast and its shake, and the judgment word last. */
export const BURST_MS = 240,
  CORE_MS = 90,
  BLAST_MS = 320,
  SHAKE_MS = 260,
  WORD_MS = 520,
  WORD_POP_MS = 80;
/** How far from the targets the warning line is, in columns: under the word and the combo. */
const WARN_AT = 4.05;
/** The combo is shown from here up. */
export const COMBO_FROM = 4;
const WARNINGS = ITEM_NAMES.map((name) => `INCOMING: ${name}`);
// The lanes' colour is opaque (the navy over the background, worked out once): an opaque fill is the cheapest there is.
const LANE = "#08132a",
  GUIDE = "rgba(54,84,119,0.4)",
  EDGE = "rgba(54,84,119,0.9)",
  DOUBLE_TINT = "rgba(255,228,107,0.1)",
  BODY_EDGE = "rgba(3,9,25,0.85)";
/** A hold's body and core, then a roll's: at rest and while it is being kept. */
const HOLD_BODY = "rgba(22,201,235,0.62)",
  HOLD_LIVE = "rgba(140,246,255,0.95)",
  HOLD_CORE = "rgba(235,252,255,0.9)",
  ROLL_BODY = "rgba(255,138,46,0.66)",
  ROLL_LIVE = "rgba(255,196,110,0.96)",
  ROLL_CORE = "rgba(255,244,190,0.95)";

const mods = noMods(),
  at = noPlacement(),
  lane: LaneGeometry = {
    columnWidth: 1,
    targetY: 0,
    length: 1,
    runout: 1,
    windowMs: 1,
    down: false,
  };

const easeOut = (t: number): number => 1 - (1 - t) * (1 - t) * (1 - t);

/** A burst's arrow, turned to its column and scaled about the target. */
function flare(
  g: Pen,
  sprite: Sprite,
  x: number,
  y: number,
  column: number,
  scale: number,
  alpha: number,
): void {
  blit(g, sprite, x, y, alpha, scale, TURNS[column]!);
}

/** A hold's or roll's body from `from` to `to` milliseconds ahead of the target. */
function body(
  g: Pen,
  ox: number,
  column: number,
  note: StepNote,
  songMs: number,
  head: number,
  from: number,
  to: number,
  live: boolean,
  alpha: number,
): void {
  if (to <= from || alpha <= 0.004) return;
  const col = lane.columnWidth;
  const roll = note.kind === ROLL;
  const stepMs = Math.max(
    1,
    (lane.windowMs * ((0.4 * col) / lane.length)) / (1 + mods.turbo),
  );
  const pieces = bends(mods)
    ? Math.max(1, Math.min(32, Math.ceil((to - from) / stepMs)))
    : 1;
  g.globalAlpha = alpha > 1 ? 1 : alpha;
  g.lineCap = "round";
  g.lineJoin = "round";
  g.beginPath();
  for (let piece = 0; piece <= pieces; piece++) {
    notePlacement(
      mods,
      column,
      from + ((to - from) * piece) / pieces,
      songMs,
      lane,
      at,
    );
    if (piece === 0) g.moveTo(ox + at.x, at.y);
    else g.lineTo(ox + at.x, at.y);
  }
  g.lineWidth = col * 0.66;
  g.strokeStyle = BODY_EDGE;
  g.stroke();
  g.lineWidth = col * 0.54;
  g.strokeStyle = roll
    ? live
      ? ROLL_LIVE
      : ROLL_BODY
    : live
      ? HOLD_LIVE
      : HOLD_BODY;
  g.stroke();
  g.lineWidth = Math.max(1, col * 0.13);
  if (!roll) {
    g.strokeStyle = HOLD_CORE;
    g.stroke();
    return;
  }
  // A roll's core zigzags, each corner fixed to a moment of the roll so it scrolls with the body.
  const start = from - head,
    end = to - head,
    reach = col * 0.13;
  let step = stepMs;
  if ((end - start) / step > 48) step *= Math.ceil((end - start) / step / 48);
  let corner = Math.floor(start / step);
  g.beginPath();
  notePlacement(mods, column, from, songMs, lane, at);
  g.moveTo(ox + at.x + (corner & 1 ? reach : -reach), at.y);
  for (corner++; corner * step < end; corner++) {
    notePlacement(mods, column, head + corner * step, songMs, lane, at);
    g.lineTo(ox + at.x + (corner & 1 ? reach : -reach), at.y);
  }
  notePlacement(mods, column, to, songMs, lane, at);
  g.lineTo(ox + at.x + (corner & 1 ? reach : -reach), at.y);
  g.strokeStyle = ROLL_CORE;
  g.stroke();
}

export function drawField(
  frame: Frame,
  set: SpriteSet,
  field: Field,
  player: PlayerView,
  steps: Steps | undefined,
  state: RiderFeedback,
  info: FieldInfo,
): void {
  const g = frame.pen,
    col = field.col,
    unit = frame.unit,
    songMs = frame.songMs,
    calm = frame.calm,
    effects = player.effects;
  const width = col * COLUMNS;
  modsAt(effects, songMs, mods);
  laneOf(field, frame.speed, frame.down, lane);
  // A lagged rider's notes are drawn for a moment that has already been heard.
  const drawMs = songMs - LAG_MS * mods.lag;

  // A mine going off shakes this field and no other.
  let ox = field.x,
    oy = 0;
  const mineAge = songMs - state.mineAt;
  if (!calm && mineAge >= 0 && mineAge < SHAKE_MS) {
    const left = 1 - mineAge / SHAKE_MS;
    ox += Math.round(Math.sin(mineAge * 0.11) * col * 0.09 * left);
    oy = Math.round(Math.cos(mineAge * 0.13) * col * 0.06 * left);
  }
  lane.targetY += oy;
  const top = field.laneTop + oy,
    height = field.laneBottom - field.laneTop;
  const doubled = covered(effects, DOUBLE, songMs),
    starred = covered(effects, STAR, songMs),
    // 0 is "no shield", also before the song starts.
    shielded = player.shield !== 0 && player.shield > songMs;
  const thin = Math.max(1, Math.round(unit));

  // ---- the lanes ----
  g.globalAlpha = 1;
  g.fillStyle = LANE;
  g.fillRect(ox, top, width, height);
  g.fillStyle = GUIDE;
  for (let column = 1; column < COLUMNS; column++)
    g.fillRect(ox + column * col, top, thin, height);
  if (doubled) {
    g.fillStyle = DOUBLE_TINT;
    g.fillRect(ox, top, width, height);
    g.globalAlpha = 0.12;
    label(
      g,
      "x2",
      ox + width / 2,
      frame.down ? top + col * 1.3 : top + height - col * 1.3,
      col * 1.3,
      GOLD,
      "center",
      width,
    );
    g.globalAlpha = 1;
  }
  if (mods.blackout > 0) {
    g.globalAlpha = 0.6 * mods.blackout;
    g.fillStyle = "#000000";
    g.fillRect(ox, top, width, height);
    g.globalAlpha = 1;
  }
  // The border: red and flickering for a miss, gold while doubled, every colour while starred.
  const missAge = songMs - state.missAt;
  const missed =
    missAge >= 0 &&
    missAge < 220 &&
    (calm || Math.floor(missAge / 45) % 2 === 0);
  g.fillStyle = missed
    ? RED
    : starred
      ? QUANT_COLORS[RAINBOW[Math.floor(songMs / 120) % RAINBOW.length]!]!
      : doubled
        ? GOLD
        : EDGE;
  const edge = missed || starred || doubled ? thin * 2 : thin;
  g.fillRect(ox - edge, top, edge, height);
  g.fillRect(ox + width, top, edge, height);
  if (shielded) {
    // The shield: a bubble round the whole field.
    const out = Math.round(col * 0.16);
    g.strokeStyle = CYAN;
    g.lineWidth = thin * 2;
    g.globalAlpha = calm ? 0.8 : 0.6 + 0.3 * Math.sin(songMs * 0.006);
    g.strokeRect(ox - out, top - out, width + 2 * out, height + 2 * out);
    g.globalAlpha *= 0.4;
    g.strokeRect(
      ox - out * 2,
      top - out * 2,
      width + 4 * out,
      height + 4 * out,
    );
    g.globalAlpha = 1;
  }

  // ---- the targets ----
  const part = frame.beat - Math.floor(frame.beat);
  const pulse = calm ? 0 : (1 - part) * (1 - part);
  for (let column = 0; column < COLUMNS; column++) {
    const x = ox + targetX(mods.flip, column, lane),
      y = lane.targetY;
    const down = player.down[column] === true;
    if (starred)
      blit(
        g,
        set.arrows[
          RAINBOW[(Math.floor(frame.beat * 2) + column) % RAINBOW.length]!
        ]![column]!,
        x,
        y,
        1,
        down && !calm ? 0.9 : 1,
        0,
      );
    else if (down) blit(g, set.lit[column]!, x, y, 1, calm ? 1 : 0.9, 0);
    else {
      blit(g, set.receptors[column]!, x, y, 1, 1, 0);
      // Brighter on the beat, fading to the next.
      blit(g, set.lit[column]!, x, y, pulse * 0.55, 1 + pulse * 0.05, 0);
    }
  }
  g.globalAlpha = 1;

  // ---- holds, notes and mines, the furthest first so the nearest is on top ----
  if (steps) {
    const notes = steps.notes,
      hits = player.hits;
    const far = aheadMs(mods, lane),
      near = behindMs(mods, lane);
    const dark = 1 - 0.96 * blackoutAt(mods.blackout, frame.beat);
    const quants = quantsOf(steps);
    // In a battle the item notes are capsules while the rider's hand is empty.
    const carriers = frame.battle ? itemNotes(steps) : undefined;
    const items = player.item === NO_ITEM ? carriers : undefined;
    const mined = has(effects, MINES);
    const mineFrame = set.mines[Math.floor(frame.beat * 2) & 1]!;
    for (let column = 0; column < COLUMNS; column++) {
      const ids = steps.lanes[column];
      if (ids) {
        const next = player.next[column] ?? 0,
          running = player.hold[column] ?? -1;
        const first = firstEndingAt(notes, ids, drawMs - near);
        let last = first;
        while (last < ids.length && notes[ids[last]!]!.ms - drawMs <= far)
          last++;
        for (let i = last - 1; i >= first; i--) {
          const id = ids[i]!,
            note = notes[id]!;
          const hit = wasHit(hits, id),
            held = running === id;
          // Hit and done with: gone.
          if (i < next && hit && !held) continue;
          const lost = i < next && !hit;
          const ahead = note.ms - drawMs;
          if (note.kind !== TAP) {
            // A running hold shortens from the target; one let go dims; a missed or dropped one scrolls on.
            const kept =
              held && ((player.let[column] ?? -1) < 0 || note.kind === ROLL);
            body(
              g,
              ox,
              column,
              note,
              songMs,
              ahead,
              held ? 0 : Math.max(ahead, -near),
              Math.min(note.endMs - drawMs, far),
              kept,
              dark *
                (1 - 0.7 * mods.hidden) *
                (lost ? 0.3 : held && !kept ? 0.45 : 1),
            );
            if (held) continue;
          }
          notePlacement(mods, column, ahead, songMs, lane, at);
          const alpha = at.alpha * dark * (lost ? 0.32 : 1);
          if (alpha <= 0.004) continue;
          const sprite =
            mined &&
            note.kind === TAP &&
            covered(effects, MINES, note.ms) &&
            !covered(effects, STAR, note.ms) &&
            turnedMine(effects, frame.seed, id, note, carriers)
              ? mineFrame
              : items?.has(id)
                ? set.capsule
                : set.arrows[quants[id]!]![column]!;
          blit(g, sprite, ox + at.x, at.y, alpha, at.scale, at.rotation);
        }
      }
      const mines = steps.mines[column];
      if (mines)
        for (
          let i = firstEndingAt(notes, mines, drawMs - near);
          i < mines.length;
          i++
        ) {
          const id = mines[i]!,
            ahead = notes[id]!.ms - drawMs;
          if (ahead > far) break;
          if (wasHit(hits, id)) continue;
          notePlacement(mods, column, ahead, songMs, lane, at);
          blit(
            g,
            mineFrame,
            ox + at.x,
            at.y,
            at.alpha * dark,
            at.scale,
            at.rotation,
          );
        }
    }
    g.globalAlpha = 1;
  }

  // ---- bursts on the targets, in added light ----
  g.globalCompositeOperation = "lighter";
  for (let column = 0; column < COLUMNS; column++) {
    const x = ox + targetX(mods.flip, column, lane),
      y = lane.targetY;
    // A hold being kept glows on its target for as long as it is.
    const running = player.hold[column] ?? -1;
    if (
      running >= 0 &&
      steps &&
      ((player.let[column] ?? -1) < 0 || steps.notes[running]?.kind === ROLL)
    )
      blit(
        g,
        set.glows[6]!,
        x,
        y,
        calm ? 0.7 : 0.65 + 0.3 * Math.sin(songMs * 0.035),
        1,
        0,
      );
    const age = songMs - state.burstAt[column]!;
    if (age >= 0 && age < BURST_MS) {
      const judgment = state.burstJudgment[column]!,
        t = age / BURST_MS,
        fade = (1 - t) * (1 - t);
      if (calm) blit(g, set.glows[judgment]!, x, y, fade * 0.6, 1, 0);
      else {
        blit(g, set.glows[judgment]!, x, y, fade * 0.65, 1 + 0.4 * t, 0);
        flare(
          g,
          set.bursts[judgment]!,
          x,
          y,
          column,
          1 + 0.6 * easeOut(t),
          fade,
        );
        if (age < CORE_MS)
          flare(g, set.core, x, y, column, 1 + 0.15 * t, 1 - age / CORE_MS);
        if (judgment === MARVELOUS) {
          // A Marvelous shimmers through the other colours and throws sparks.
          flare(
            g,
            set.bursts[1 + (Math.floor(age / 40) % 4)]!,
            x,
            y,
            column,
            1 + 0.75 * easeOut(t),
            fade * 0.55,
          );
          const reach = col * (0.35 + 0.95 * easeOut(t));
          for (let spark = 0; spark < 6; spark++) {
            const angle = (spark * Math.PI) / 3 + column * 0.5;
            blit(
              g,
              set.spark,
              x + Math.cos(angle) * reach,
              y + Math.sin(angle) * reach,
              1 - t,
              1.1 - 0.5 * t,
              0,
            );
          }
        }
      }
    }
    const heldAge = songMs - state.heldAt[column]!;
    if (heldAge >= 0 && heldAge < BURST_MS) {
      const t = heldAge / BURST_MS,
        fade = (1 - t) * (1 - t);
      blit(g, set.glows[6]!, x, y, fade, calm ? 1 : 1 + 0.5 * t, 0);
      if (!calm)
        flare(
          g,
          set.bursts[HELD_BURST]!,
          x,
          y,
          column,
          1 + 0.6 * easeOut(t),
          fade,
        );
    }
  }
  if (mineAge >= 0 && mineAge < BLAST_MS) {
    const t = mineAge / BLAST_MS;
    const x =
      state.mineColumn >= 0
        ? ox + targetX(mods.flip, state.mineColumn, lane)
        : ox + width / 2;
    blit(
      g,
      set.blast,
      x,
      lane.targetY,
      1 - t,
      calm ? 1 : 0.7 + 1.3 * easeOut(t),
      0,
    );
    blit(
      g,
      set.glows[8]!,
      x,
      lane.targetY,
      (1 - t) * (1 - t),
      calm ? 1 : 1 + t,
      0,
    );
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;

  // ---- the judgment word, the combo under it ----
  const middle = ox + width / 2;
  const wordY = frame.down
    ? lane.targetY - col * 3.15
    : lane.targetY + col * 2.3;
  const judgment = state.popJudgment;
  let wordAge = songMs - state.popAt;
  if (wordAge < 0 && wordAge > -200) wordAge = 0;
  if (judgment >= 0 && wordAge >= 0 && wordAge < WORD_MS) {
    const fade = wordAge < 380 ? 1 : 1 - (wordAge - 380) / (WORD_MS - 380);
    const pop =
      calm || wordAge >= WORD_POP_MS
        ? 1
        : 1.35 - (0.35 * wordAge) / WORD_POP_MS;
    const size = col * 0.4;
    if (!calm) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = fade * 0.6;
      g.drawImage(
        set.glows[judgment]!.canvas,
        middle - col * 2.3,
        wordY - col * 0.8,
        col * 4.6,
        col * 1.6,
      );
      g.globalCompositeOperation = "source-over";
    }
    // A miss flickers; a Marvelous shimmers.
    g.globalAlpha =
      judgment === MISS && !calm && Math.floor(wordAge / 50) % 2 === 1
        ? fade * 0.55
        : fade;
    const color =
      judgment === MARVELOUS && !calm
        ? SHIMMER[Math.floor(songMs / 45) % SHIMMER.length]!
        : JUDGMENT_COLORS[judgment]!;
    if (pop !== 1) g.setTransform(pop, 0, 0, pop, middle, wordY);
    outlined(
      g,
      JUDGMENT_NAMES[judgment]!,
      pop !== 1 ? 0 : middle,
      pop !== 1 ? 0 : wordY,
      size,
      color,
      width * 0.98,
    );
    if (pop !== 1) g.setTransform(1, 0, 0, 1, 0, 0);
    if (judgment >= PERFECT && judgment <= BOO && state.popOff !== 0)
      outlined(
        g,
        state.popOff < 0 ? "EARLY" : "LATE",
        middle,
        wordY - col * 0.44,
        col * 0.17,
        state.popOff < 0 ? "#7fd0ff" : "#ffb26b",
        width,
      );
    g.globalAlpha = 1;
  }
  const comboY = wordY + col * 0.85;
  if (player.combo >= COMBO_FROM) {
    const comboAge = songMs - state.comboAt,
      flashAge = songMs - state.comboFlashAt;
    const bump =
      !calm && comboAge >= 0 && comboAge < 110
        ? 1 + 0.25 * (1 - comboAge / 110)
        : 1;
    const flashing = !calm && flashAge >= 0 && flashAge < 500;
    if (flashing) {
      g.globalCompositeOperation = "lighter";
      g.globalAlpha = 1 - flashAge / 500;
      g.drawImage(
        set.glows[1]!.canvas,
        middle - col * 1.6,
        comboY - col * 0.8,
        col * 3.2,
        col * 1.6,
      );
      g.globalCompositeOperation = "source-over";
      g.globalAlpha = 1;
    }
    outlined(
      g,
      countText(info.texts.combo, "", player.combo),
      middle,
      comboY,
      col * 0.44 * bump * (flashing ? 1.15 : 1),
      flashing && Math.floor(flashAge / 60) % 2 === 0 ? GOLD : WHITE,
      width,
    );
    outlined(g, "COMBO", middle, comboY + col * 0.42, col * 0.14, MUTED, width);
  }
  const brokenAge = songMs - state.brokenAt;
  if (brokenAge >= 0 && brokenAge < 450) {
    // The combo that was just lost falls away.
    g.globalAlpha = 1 - brokenAge / 450;
    outlined(
      g,
      countText(info.texts.broken, "", state.brokenCombo),
      middle,
      comboY + (calm ? 0 : (brokenAge / 450) * col * 0.6),
      col * 0.38,
      RED,
      width,
    );
    g.globalAlpha = 1;
  }

  // ---- warnings and banners, further down the lanes ----
  const warnY = frame.down
    ? lane.targetY - col * WARN_AT
    : lane.targetY + col * WARN_AT;
  const blockedAge = songMs - state.blockedAt;
  if (blockedAge >= 0 && blockedAge < 900) {
    const pop = calm || blockedAge >= 90 ? 1 : 1.3 - (0.3 * blockedAge) / 90;
    g.globalAlpha = blockedAge < 650 ? 1 : 1 - (blockedAge - 650) / 250;
    outlined(g, "BLOCKED!", middle, warnY, col * 0.32 * pop, CYAN, width);
    g.globalAlpha = 1;
  } else {
    // The attack that takes hold soonest: time to brace.
    let incoming = 0,
      soonest = Infinity;
    for (let i = 0; i < effects.length; i++) {
      const effect = effects[i]!;
      if (isAttack(effect[0]) && songMs < effect[1] && effect[1] < soonest) {
        soonest = effect[1];
        incoming = effect[0];
      }
    }
    if (incoming > 0 && incoming < ITEM_KINDS) {
      g.globalAlpha = calm ? 1 : 0.6 + 0.4 * Math.sin(songMs * 0.025);
      outlined(
        g,
        WARNINGS[incoming]!,
        middle,
        warnY,
        Math.min(col * 0.2, (width * 0.98) / WARNINGS[incoming]!.length),
        PINK,
        width * 0.98,
      );
      g.globalAlpha = 1;
    }
  }
  const bannerAge = songMs - info.bannerAt;
  if (
    info.local &&
    info.banner !== NO_BANNER &&
    bannerAge >= 0 &&
    bannerAge < 1300
  ) {
    const pop = calm || bannerAge >= 100 ? 1 : 1.4 - (0.4 * bannerAge) / 100;
    g.globalAlpha = bannerAge < 950 ? 1 : 1 - (bannerAge - 950) / 350;
    outlined(
      g,
      info.banner === LEAD_BANNER ? "YOU LEAD!" : "OVERTAKEN",
      middle,
      warnY + (frame.down ? -col * 0.7 : col * 0.7),
      col * 0.3 * pop,
      info.banner === LEAD_BANNER ? GOLD : PINK,
      width,
    );
    g.globalAlpha = 1;
  }

  header(frame, field, player, info, doubled);
  readout(frame, field, player, info, shielded);
}

/** The band over the lanes: place and name, the chart, the score and how far ahead or behind. */
function header(
  frame: Frame,
  field: Field,
  player: PlayerView,
  info: FieldInfo,
  doubled: boolean,
): void {
  const g = frame.pen,
    unit = frame.unit,
    col = field.col,
    width = col * COLUMNS;
  const size = Math.round(
    Math.max(7 * unit, Math.min(col * 0.19, field.headerHeight * 0.34)),
  );
  const left = field.x + Math.round(col * 0.08),
    right = field.x + width - Math.round(col * 0.08);
  const chars = Math.floor((right - left) / size);
  const first = field.top + field.headerHeight * 0.3,
    second = field.top + field.headerHeight * 0.76;
  const placed = frame.multi ? 4 : 0;
  const chart = info.chart.length + 1 <= chars - placed - 4 ? info.chart : "";
  let x = left;
  if (frame.multi) {
    label(
      g,
      placeName(player.place),
      x,
      first,
      size,
      // The lead in gold, any other place in the rider's own colour.
      player.place === 1 ? GOLD : slotColor(player.slot),
      "left",
      size * 3,
    );
    x += size * 4;
  }
  label(
    g,
    fitText(
      info.texts.name,
      info.name,
      chars - placed - (chart ? chart.length + 1 : 0),
    ),
    x,
    first,
    size,
    slotColor(player.slot),
    "left",
    Math.max(1, right - x),
  );
  if (chart)
    label(
      g,
      fitText(info.texts.chart, chart, chart.length),
      right,
      first,
      size,
      MUTED,
      "right",
      width,
    );
  label(
    g,
    scoreText(info.texts.score, player.rating),
    left,
    second,
    size,
    doubled ? GOLD : TEXT,
    "left",
    right - left,
  );
  if (doubled && chars >= 10)
    label(g, "x2", left + size * 7.5, second, size, GOLD, "left", size * 2);
  if (!Number.isNaN(info.gap) && info.gap !== 0 && chars >= 16)
    label(
      g,
      gapText(info.texts.gap, info.gap),
      right,
      second,
      size,
      info.gap < 0 ? PINK : GOLD,
      "right",
      size * 8,
    );
}

/** The power-ups: what is in hand, and what the rider is under with how long each has left. */
function readout(
  frame: Frame,
  field: Field,
  player: PlayerView,
  info: FieldInfo,
  shielded: boolean,
): void {
  const g = frame.pen,
    unit = frame.unit,
    col = field.col,
    songMs = frame.songMs;
  const size = Math.round(Math.max(6 * unit, Math.min(10 * unit, col * 0.16)));
  const row = size + Math.round(9 * unit);
  const inside = field.hudAlign > 0;
  const align: CanvasTextAlign = inside ? "left" : "right";
  const x = field.hudX,
    way = inside ? 1 : -1;
  const span = size * 9,
    pitch = span + size;
  const height = field.laneBottom - field.laneTop;
  // Beside the field the labels are a column that starts level with the targets, where the eyes are. Over the lanes
  // they sit side by side at the far end, where the notes are still faint, and stay clear of the warning line.
  const across = inside
    ? Math.max(1, Math.floor((field.x + col * COLUMNS - x) / pitch))
    : 1;
  const rows = Math.floor(
    (inside ? height - col * (TARGET_INSET + WARN_AT + 0.35) : height / 2) /
      row,
  );
  if (rows < 1) return;
  const fromTop = inside ? frame.down : !frame.down;
  const step = fromTop ? row : -row;
  let y = fromTop
    ? field.laneTop + Math.round(row * 0.8)
    : field.laneBottom - Math.round(row * 0.8);
  let used = 0;

  if (player.item > NO_ITEM && player.item < ITEM_KINDS) {
    // Two rows when there is room: the icon, its name, and the key that throws it. Otherwise one line.
    const tall = rows >= 2;
    const side = (tall ? row * 2 : row) - Math.round(4 * unit);
    const icon = frame.icons.get(player.item, side);
    const centre = tall ? y + step / 2 : y;
    if (icon) blit(g, icon, x + (way * side) / 2, centre, 1, 1, 0);
    g.globalAlpha = 1;
    const text = x + way * (side + Math.round(5 * unit));
    if (tall || !info.local)
      label(
        g,
        ITEM_NAMES[player.item]!,
        text,
        tall && info.local ? centre - row * 0.42 : centre,
        size,
        itemColor(player.item),
        align,
        span,
      );
    if (info.local) {
      g.globalAlpha = frame.calm ? 1 : 0.65 + 0.35 * Math.sin(songMs * 0.012);
      label(
        g,
        pressText(info.texts.press, frame.itemKey),
        text,
        tall ? centre + row * 0.42 : centre,
        size,
        WHITE,
        align,
        span + size * 6,
      );
      g.globalAlpha = 1;
    }
    used = tall ? 2 : 1;
    y += step * used;
  }
  const bar = Math.max(2, Math.round(3 * unit));
  let place = 0;
  for (let i = -1; i < player.effects.length && used < rows; i++) {
    // The shield first, then each effect in force.
    let kind = SHIELD,
      left = 0;
    if (i < 0) {
      if (!shielded) continue;
      left = (player.shield - songMs) / (ITEM_MS[SHIELD] ?? 1);
    } else {
      const effect = player.effects[i]!;
      kind = effect[0];
      if (!(kind > NO_ITEM && kind < ITEM_KINDS)) continue;
      if (!(effect[1] <= songMs && songMs < effect[2])) continue;
      left = (effect[2] - songMs) / Math.max(1, effect[2] - effect[1]);
    }
    const color = itemColor(kind);
    const at = x + place * pitch;
    label(g, ITEM_NAMES[kind]!, at, y - bar, size, color, align, span);
    const from = way < 0 ? at - span : at,
      top = y + Math.round(size / 2);
    g.fillStyle = LINE;
    g.fillRect(from, top, span, bar);
    g.fillStyle = color;
    g.fillRect(
      from,
      top,
      Math.round(span * Math.max(0, Math.min(1, left))),
      bar,
    );
    if (++place >= across) {
      place = 0;
      y += step;
      used++;
    }
  }
}
