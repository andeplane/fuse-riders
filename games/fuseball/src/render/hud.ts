import type { WorldView } from "../engine/view.js";
import { STEPS_PER_SECOND, VIEW_H, VIEW_W, mapOf } from "../engine/view-kit.js";
import {
  BALL,
  INK,
  PIXEL_FONT,
  TEAM,
  TEAM_DARK,
  TEAM_LIGHT,
  TEAM_NAMES,
  teamColor,
  WHITE,
  hexA,
} from "./palette.js";
import type { Paint } from "./sprites.js";

/**
 * The match's lettering, drawn on the field: a score bar of one segment per point on each side's edge, the 3-2-1
 * and GO, the sudden-death banner and who won. It reads the view and the wall clock and decides nothing.
 */
const BAR_W = 8,
  BAR_TOP = 28,
  SEGMENT_H = 24,
  SEGMENT_GAP = 3,
  BAR_INSET = 2;
const BANNER_Y = 74,
  GO_MS = 700,
  /** "GOAL!" stays up through the freeze and into the zap. */
  GOAL_BANNER_S = 2.2;

/** Where `slot`'s score segments are, bottom one first: slot 0 on the left edge, slot 1 on the right. */
export function scoreSegments(
  slot: 0 | 1,
  target: number,
): { x: number; y: number; w: number; h: number }[] {
  const x = slot === 0 ? BAR_INSET : VIEW_W - BAR_INSET - BAR_W;
  return Array.from({ length: target }, (_, i) => ({
    x,
    y: BAR_TOP + (target - 1 - i) * (SEGMENT_H + SEGMENT_GAP),
    w: BAR_W,
    h: SEGMENT_H,
  }));
}

/** The banner the view calls for, or nothing: what is written across the top of the field right now. */
export function bannerOf(
  view: WorldView,
  names: readonly [string, string] = TEAM_NAMES,
): { text: string; team: -1 | 0 | 1 } | undefined {
  if (view.phase === "over" && view.winner >= 0)
    return {
      text: `${names[view.winner === 1 ? 1 : 0].toUpperCase().slice(0, 12)} WINS`,
      team: view.winner,
    };
  if (view.suddenDeath && view.phase !== "zap" && view.phase !== "over")
    return { text: "SUDDEN DEATH", team: -1 };
  return undefined;
}

export interface Hud {
  draw(
    g: Paint,
    view: WorldView,
    nowMs: number,
    localSlot: 0 | 1 | -1,
    names?: readonly [string, string],
  ): void;
  reset(): void;
}

export function createHud(): Hud {
  let phase: WorldView["phase"] | undefined,
    wentAt = -Infinity,
    scoredAt = -Infinity;

  const write = (
    g: Paint,
    text: string,
    x: number,
    y: number,
    size: number,
    color: string,
    alpha = 1,
  ) => {
    g.font = `${Math.round(size * 10) / 10}px ${PIXEL_FONT}`;
    g.textAlign = "center";
    g.textBaseline = "middle";
    const drop = Math.max(1, Math.round(size / 8));
    g.fillStyle = hexA(INK, 0.85 * alpha);
    g.fillText(text, x + drop, y + drop);
    g.fillStyle = hexA(color, 0.28 * alpha);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ] as const)
      g.fillText(text, x + dx, y + dy);
    g.fillStyle = hexA(color, alpha);
    g.fillText(text, x, y);
  };

  const bars = (
    g: Paint,
    view: WorldView,
    nowMs: number,
    localSlot: number,
  ) => {
    for (const slot of [0, 1] as const) {
      const segments = scoreSegments(slot, view.target),
        won = view.score[slot],
        fresh =
          view.phase === "zap" &&
          view.lastScorer === slot &&
          Math.floor(nowMs / 110) % 2 === 0;
      segments.forEach((s, i) => {
        const lit = i < won;
        g.fillStyle = hexA(INK, 0.8);
        g.fillRect(s.x - 1, s.y - 1, s.w + 2, s.h + 2);
        if (lit) {
          g.fillStyle = hexA(TEAM[slot], 0.22);
          g.fillRect(s.x - 3, s.y - 2, s.w + 6, s.h + 4);
          g.fillStyle = fresh && i === won - 1 ? WHITE : TEAM[slot];
          g.fillRect(s.x, s.y, s.w, s.h);
          g.fillStyle = TEAM_LIGHT[slot];
          g.fillRect(s.x, s.y, s.w, 2);
          g.fillRect(s.x, s.y, 1, s.h);
        } else {
          // The point that would win the match beckons in sudden death.
          const beckon =
            view.suddenDeath &&
            i === won &&
            view.winner < 0 &&
            Math.floor(nowMs / 260) % 2 === 0;
          g.fillStyle = beckon ? hexA(BALL, 0.5) : TEAM_DARK[slot];
          g.fillRect(s.x, s.y, s.w, s.h);
          g.fillStyle = hexA(TEAM[slot], 0.55);
          g.fillRect(s.x, s.y, s.w, 1);
          g.fillRect(s.x, s.y + s.h - 1, s.w, 1);
          g.fillRect(s.x, s.y, 1, s.h);
          g.fillRect(s.x + s.w - 1, s.y, 1, s.h);
        }
      });
      if (slot !== localSlot) continue;
      // A tick under this device's own bar.
      const last = segments[0]!,
        mid = last.x + last.w / 2,
        y = last.y + last.h + 5;
      g.fillStyle = TEAM_LIGHT[slot];
      g.fillRect(mid - 3, y + 2, 6, 1);
      g.fillRect(mid - 2, y + 1, 4, 1);
      g.fillRect(mid - 1, y, 2, 1);
    }
  };

  return {
    draw(g, view, nowMs, localSlot, names = TEAM_NAMES) {
      if (phase === "countdown" && view.phase === "play") wentAt = nowMs;
      if (phase !== "zap" && view.phase === "zap") scoredAt = nowMs;
      phase = view.phase;
      bars(g, view, nowMs, localSlot);
      const banner = bannerOf(view, names),
        mid = VIEW_W / 2;

      if (view.phase === "countdown") {
        // Each number lands big and settles over its second.
        const into =
            1 - ((view.remaining - 1) % STEPS_PER_SECOND) / STEPS_PER_SECOND,
          pop = Math.max(0, 1 - into * 3);
        write(
          g,
          String(Math.max(1, view.count)),
          mid,
          BANNER_Y,
          38 + 22 * pop * pop,
          view.suddenDeath ? BALL : WHITE,
          Math.min(1, 1.25 - into * 0.5),
        );
        if (banner)
          write(
            g,
            banner.text,
            mid,
            BANNER_Y - 38,
            13,
            BALL,
            0.65 + 0.35 * Math.sin(nowMs / 90),
          );
        else
          write(
            g,
            mapOf(view.mapId).name.toUpperCase(),
            mid,
            BANNER_Y - 36,
            8,
            TEAM_LIGHT[0],
            0.8,
          );
        return;
      }
      if (view.phase === "play") {
        const since = nowMs - wentAt;
        if (since >= 0 && since < GO_MS) {
          const t = since / GO_MS;
          write(g, "GO!", mid, BANNER_Y, 30 + 26 * t, BALL, 1 - t * t);
        }
        if (banner)
          write(
            g,
            banner.text,
            mid,
            26,
            7,
            BALL,
            0.55 + 0.3 * Math.sin(nowMs / 160),
          );
        return;
      }
      if (view.phase === "zap" && view.lastScorer >= 0) {
        // Seconds since this page first saw the goal: through the freeze and into the zap.
        const into = Math.max(0, nowMs - scoredAt) / 1000;
        if (into < GOAL_BANNER_S) {
          const pop = Math.max(0, 1 - into * 5);
          write(
            g,
            "GOAL!",
            mid,
            BANNER_Y,
            26 + 18 * pop,
            teamColor(view.lastScorer),
            Math.min(1, (GOAL_BANNER_S - into) * 3),
          );
        }
        return;
      }
      if (!banner || banner.team < 0) return;
      // The result, on a band across the field.
      const top = VIEW_H / 2 - 52,
        tall = localSlot >= 0 ? 104 : 86;
      g.fillStyle = hexA(INK, 0.8);
      g.fillRect(0, top, VIEW_W, tall);
      g.fillStyle = teamColor(banner.team);
      g.fillRect(0, top, VIEW_W, 2);
      g.fillRect(0, top + tall - 2, VIEW_W, 2);
      const size = Math.min(22, 400 / banner.text.length);
      write(g, banner.text, mid, top + 30, size, teamColor(banner.team));
      write(g, String(view.score[0]), mid - 30, top + 60, 14, TEAM[0]);
      write(g, "-", mid, top + 60, 14, WHITE, 0.8);
      write(g, String(view.score[1]), mid + 30, top + 60, 14, TEAM[1]);
      if (localSlot >= 0)
        write(
          g,
          localSlot === banner.team ? "YOU WIN" : "YOU LOSE",
          mid,
          top + 86,
          8,
          WHITE,
          0.6 + 0.3 * Math.sin(nowMs / 200),
        );
    },
    reset() {
      phase = undefined;
      wentAt = -Infinity;
      scoredAt = -Infinity;
    },
  };
}
