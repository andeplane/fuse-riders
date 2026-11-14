import type { WorldView } from "../engine/view.js";
import { ITEM_KINDS, ITEM_NAMES, NO_ITEM, SHIELD } from "../engine/view-kit.js";
import {
  HIT_BLOCKED,
  HIT_MINE,
  rowOf,
  type Feedback,
  type RiderFeedback,
} from "./feedback.js";
import { COMBO_FROM } from "./field.js";
import {
  blit,
  countText,
  fitText,
  label,
  scoreText,
  type Frame,
  type RiderTexts,
} from "./frame.js";
import { boxX, boxY, type Panel } from "./layout.js";
import {
  CYAN,
  GOLD,
  GREEN,
  INK,
  JUDGMENT_COLORS,
  MUTED,
  ORANGE,
  PINK,
  RED,
  SLOT_COLORS,
  TEXT,
  WHITE,
  hexA,
  placeName,
  slotColor,
} from "./palette.js";

/**
 * The live leaderboard: a box per rider, the leader's first. A box slides to its new row when the order changes,
 * flashes in the colour of each judgment its rider gets, shakes when an attack lands, and an attack thrown runs as a
 * zap from the thrower's box to the victim's.
 */
export interface BoardInfo {
  names: readonly string[];
  chartNames: readonly string[];
  local: number;
  texts: readonly RiderTexts[];
}

/** How long a box flashes for a judgment, glows after rising, dims after being passed, and wears what hit it. */
export const FLASH_MS = 200,
  RISE_MS = 600,
  PASSED_MS = 500,
  HIT_MS = 800,
  ZAP_MS = 500;
const BOX = "rgba(8,19,39,0.94)",
  VEIL = "rgba(3,9,25,0.8)";
const DIM_SLOTS = SLOT_COLORS.map((color) => hexA(color, 0.5));
const HIT_LABELS = ITEM_NAMES.map((name) => `${name}!`);

function box(
  frame: Frame,
  panel: Panel,
  view: WorldView,
  slot: number,
  rider: RiderFeedback,
  info: BoardInfo,
): void {
  const player = view.players[slot];
  if (!player) return;
  const g = frame.pen,
    unit = frame.unit,
    songMs = frame.songMs,
    calm = frame.calm,
    texts = info.texts[slot]!;
  const width = panel.boxWidth,
    height = panel.boxHeight;
  const row = rowOf(rider, songMs);
  let x = boxX(panel, row),
    y = boxY(panel, row);
  const hitAge = songMs - rider.hitAt,
    missAge = songMs - rider.missAt,
    riseAge = songMs - rider.roseAt,
    passedAge = songMs - rider.passedAt,
    flashAge = songMs - rider.popAt;
  const struck = hitAge >= 0 && hitAge < HIT_MS;
  if (!calm) {
    // A hit shakes the box; a miss nudges it.
    if (hitAge >= 0 && hitAge < 420) {
      const left = (1 - hitAge / 420) * unit;
      x += Math.sin(hitAge * 0.12) * 5 * left;
      y += Math.cos(hitAge * 0.15) * 3 * left;
    } else if (missAge >= 0 && missAge < 160)
      x += Math.sin((missAge / 160) * Math.PI * 2) * 3 * unit;
  }
  x = Math.round(x);
  y = Math.round(y);
  const local = slot === info.local;
  const color = slotColor(slot);
  const thin = Math.max(1, Math.round(unit));

  // The one just passed dims for a moment.
  const dim =
    passedAge >= 0 && passedAge < PASSED_MS
      ? 0.55 + 0.45 * (passedAge / PASSED_MS)
      : 1;
  g.globalAlpha = dim;
  g.fillStyle = BOX;
  g.fillRect(x, y, width, height);
  g.fillStyle = color;
  g.fillRect(x, y, thin * 3, height);
  // Every judgment flashes the box in its colour.
  if (rider.popJudgment >= 0 && flashAge >= 0 && flashAge < FLASH_MS) {
    g.globalAlpha = calm ? 0.2 : 0.55 * (1 - flashAge / FLASH_MS);
    g.fillStyle = JUDGMENT_COLORS[rider.popJudgment]!;
    g.fillRect(x, y, width, height);
    g.globalAlpha = dim;
  }
  const rising = riseAge >= 0 && riseAge < RISE_MS;
  g.lineWidth = local || rising ? thin * 2 : thin;
  g.strokeStyle = rising
    ? WHITE
    : local
      ? color
      : DIM_SLOTS[slot % DIM_SLOTS.length]!;
  g.strokeRect(x, y, width, height);
  if (rising && !calm) {
    g.globalCompositeOperation = "lighter";
    g.globalAlpha = 1 - riseAge / RISE_MS;
    g.lineWidth = thin * 4;
    g.strokeStyle = GOLD;
    g.strokeRect(x, y, width, height);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = dim;
  }

  const pad = Math.round(9 * unit);
  const left = x + pad,
    right = x + width - Math.round(6 * unit);
  if (panel.strip) {
    // Compact: place and name, then the score.
    const size = Math.round(
      Math.max(5 * unit, Math.min(8 * unit, (width - pad * 1.6) / 8)),
    );
    const chars = Math.floor((right - left) / size);
    label(
      g,
      placeName(player.place),
      left,
      y + height * 0.3,
      size,
      player.place === 1 ? GOLD : MUTED,
      "left",
      size * 3,
    );
    label(
      g,
      fitText(texts.boxName, info.names[slot] ?? "", chars - 4),
      left + size * 4,
      y + height * 0.3,
      size,
      local ? WHITE : color,
      "left",
      Math.max(1, right - left - size * 4),
    );
    label(
      g,
      scoreText(texts.boxScore, Math.round(rider.score)),
      left,
      y + height * 0.72,
      size,
      TEXT,
      "left",
      right - left,
    );
    if (player.combo >= COMBO_FROM && chars >= 12)
      label(
        g,
        countText(texts.boxCombo, "x", player.combo),
        right,
        y + height * 0.72,
        size,
        GOLD,
        "right",
        size * 4,
      );
  } else {
    const size = Math.round(
      Math.max(6 * unit, Math.min(10 * unit, height / 7.2)),
    );
    const chars = Math.floor((right - left) / size);
    const first = y + height * 0.22,
      second = y + height * 0.52,
      third = y + height * 0.82;
    label(
      g,
      placeName(player.place),
      left,
      first,
      size,
      player.place === 1 ? GOLD : MUTED,
      "left",
      size * 3,
    );
    label(
      g,
      fitText(
        texts.boxName,
        info.names[slot] ?? "",
        chars - 4 - (local ? 4 : 0),
      ),
      left + size * 4,
      first,
      size,
      color,
      "left",
      Math.max(1, right - left - size * 4),
    );
    if (local) {
      // The rider's own box wears a tag.
      g.fillStyle = color;
      g.fillRect(
        right - size * 3.4,
        first - size * 0.8,
        size * 3.4,
        size * 1.6,
      );
      label(g, "YOU", right - size * 1.7, first, size, INK, "center", size * 3);
    }
    if (rising) {
      // Going up.
      const tip = right - size * (local ? 4.6 : 0.6);
      g.fillStyle = GREEN;
      g.beginPath();
      g.moveTo(tip, first - size * 0.6);
      g.lineTo(tip + size * 0.6, first + size * 0.5);
      g.lineTo(tip - size * 0.6, first + size * 0.5);
      g.closePath();
      g.fill();
    }
    label(
      g,
      scoreText(texts.boxScore, Math.round(rider.score)),
      left,
      second,
      Math.round(size * 1.25),
      TEXT,
      "left",
      right - left,
    );
    // The power-up in hand, at the right.
    const side = Math.round(Math.min(height * 0.36, 28 * unit));
    if (player.item > NO_ITEM && player.item < ITEM_KINDS) {
      const icon = frame.icons.get(player.item, side);
      if (icon) blit(g, icon, right - side / 2, second, dim, 1, 0);
      g.globalAlpha = dim;
    }
    label(
      g,
      countText(texts.boxCombo, "x", player.combo),
      left,
      third,
      size,
      player.combo >= COMBO_FROM ? GOLD : MUTED,
      "left",
      size * 5,
    );
    if (chars >= 13)
      label(
        g,
        countText(texts.boxBest, "MAX ", player.best),
        left + size * 5.5,
        third,
        size,
        MUTED,
        "left",
        size * 8,
      );
    const brokenAge = songMs - rider.brokenAt;
    if (brokenAge >= 0 && brokenAge < 500) {
      // The combo that was just lost drops away.
      g.globalAlpha = dim * (1 - brokenAge / 500);
      label(
        g,
        countText(texts.boxBroken, "x", rider.brokenCombo),
        left,
        third + (calm ? 0 : (brokenAge / 500) * size * 1.2),
        size,
        RED,
        "left",
        size * 5,
      );
      g.globalAlpha = dim;
    }
    // What the rider is under, as small icons; with none, the chart it plays.
    const small = Math.round(size * 1.7);
    let at = right - small / 2,
      shown = 0;
    for (let i = -1; i < player.effects.length && shown < 4; i++) {
      let kind = SHIELD;
      if (i < 0) {
        if (!(player.shield > songMs)) continue;
      } else {
        const effect = player.effects[i]!;
        kind = effect[0];
        if (!(effect[1] <= songMs && songMs < effect[2])) continue;
      }
      const icon = frame.icons.get(kind, small);
      if (!icon) continue;
      blit(g, icon, at, third, dim, 1, 0);
      at -= small + thin;
      shown++;
    }
    g.globalAlpha = dim;
    const room = chars - 14;
    if (shown === 0 && room >= 3)
      label(
        g,
        fitText(texts.boxChart, info.chartNames[slot] ?? "", room),
        right,
        third,
        size,
        MUTED,
        "right",
        size * room,
      );
  }

  if (struck) {
    // What just hit: its name over the box.
    g.globalAlpha = hitAge < HIT_MS - 200 ? 1 : (HIT_MS - hitAge) / 200;
    g.fillStyle = VEIL;
    g.fillRect(x + thin * 3, y + thin, width - thin * 4, height - thin * 2);
    const kind = rider.hitKind;
    const size = Math.round(
      Math.max(6 * unit, Math.min(11 * unit, height / 4, (width - pad) / 11)),
    );
    label(
      g,
      kind === HIT_MINE
        ? "MINE!"
        : kind === HIT_BLOCKED
          ? "BLOCKED!"
          : (HIT_LABELS[kind] ?? "HIT!"),
      x + width / 2,
      y + height / 2,
      size,
      kind === HIT_MINE ? ORANGE : kind === HIT_BLOCKED ? CYAN : PINK,
      "center",
      width - pad,
    );
  }
  g.globalAlpha = 1;
}

/** An attack on its way: a line from the thrower's box to the victim's, with a spark running along it. */
function zap(
  frame: Frame,
  panel: Panel,
  feedback: Feedback,
  victim: RiderFeedback,
  slot: number,
): void {
  const age = frame.songMs - victim.zapAt;
  const thrower = feedback.riders[victim.zapBy];
  if (!(age >= 0 && age < ZAP_MS) || !thrower || victim.zapBy === slot) return;
  const g = frame.pen,
    unit = frame.unit;
  const from = rowOf(thrower, frame.songMs),
    to = rowOf(victim, frame.songMs);
  const out = Math.round(9 * unit);
  // Three legs: out of the thrower's box, along the gutter, into the victim's.
  let x0: number, y0: number, x1: number, y1: number, x2: number, y2: number;
  let x3: number, y3: number;
  if (panel.strip) {
    x0 = x1 = boxX(panel, from) + panel.boxWidth / 2;
    x2 = x3 = boxX(panel, to) + panel.boxWidth / 2;
    y0 = y3 = panel.y + panel.boxHeight;
    y1 = y2 = y0 + out * 0.6;
  } else {
    y0 = y1 = boxY(panel, from) + panel.boxHeight / 2;
    y2 = y3 = boxY(panel, to) + panel.boxHeight / 2;
    x0 = x3 = panel.x;
    x1 = x2 = x0 - out;
  }
  const t = age / ZAP_MS;
  g.globalCompositeOperation = "lighter";
  g.globalAlpha = 1 - t * t;
  g.strokeStyle = PINK;
  g.lineWidth = Math.max(2, Math.round(2 * unit));
  g.lineJoin = "round";
  g.lineCap = "round";
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.lineTo(x2, y2);
  g.lineTo(x3, y3);
  g.stroke();
  if (!frame.calm) {
    const first = Math.abs(x1 - x0) + Math.abs(y1 - y0),
      second = Math.abs(x2 - x1) + Math.abs(y2 - y1),
      third = Math.abs(x3 - x2) + Math.abs(y3 - y2);
    let run = Math.min(1, t * 1.7) * (first + second + third);
    let x = x3,
      y = y3;
    if (run <= first) {
      const part = first > 0 ? run / first : 0;
      x = x0 + (x1 - x0) * part;
      y = y0 + (y1 - y0) * part;
    } else if ((run -= first) <= second) {
      const part = second > 0 ? run / second : 0;
      x = x1 + (x2 - x1) * part;
      y = y1 + (y2 - y1) * part;
    } else if ((run -= second) <= third) {
      const part = third > 0 ? run / third : 0;
      x = x2 + (x3 - x2) * part;
      y = y2 + (y3 - y2) * part;
    }
    const dot = Math.round(6 * unit);
    g.fillStyle = WHITE;
    g.fillRect(Math.round(x - dot / 2), Math.round(y - dot / 2), dot, dot);
  }
  g.globalCompositeOperation = "source-over";
  g.globalAlpha = 1;
}

export function drawBoard(
  frame: Frame,
  panel: Panel,
  view: WorldView,
  feedback: Feedback,
  info: BoardInfo,
): void {
  const riders = feedback.riders,
    songMs = frame.songMs;
  // The riser is drawn last, on top of the box it is passing.
  for (let pass = 0; pass < 2; pass++)
    for (let slot = 0; slot < riders.length; slot++) {
      const rider = riders[slot]!;
      const rising =
        songMs - rider.roseAt >= 0 && songMs - rider.roseAt < RISE_MS;
      if (rising === (pass === 1)) box(frame, panel, view, slot, rider, info);
    }
  for (let slot = 0; slot < riders.length; slot++)
    zap(frame, panel, feedback, riders[slot]!, slot);
}
