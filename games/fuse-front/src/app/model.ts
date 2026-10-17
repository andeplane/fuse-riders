import {
  DIFFICULTIES,
  DRAW,
  MAX_SEATS,
  NO_WINNER,
  teamOf,
  type Difficulty,
} from "../engine/index.js";
import type { Settings, View } from "../online/game.js";

export const TEAMS = ["RED", "BLUE"] as const;
export const SIZES = [1, 2, 3] as const;

/** One slot of the lobby or match: a rider's, or a bot's at its difficulty. */
export interface SlotView {
  slot: number;
  team: number;
  name: string;
  bot: boolean;
  difficulty: Difficulty;
  /** This device rides it. */
  self: boolean;
}

/**
 * The slots a start would play (or the match plays): `2·size` of them, grown to fit the highest seated rider as the
 * fold grows it. A slot no rider holds is the bot fill at that slot's difficulty.
 */
export function slotsOf(view: View, self: string): SlotView[] {
  const settings = view.stage === "lobby" ? view.settings : view.play;
  const riders = view.seats.filter((s) => !s.watcher && s.slot >= 0);
  const highest = Math.max(-1, ...riders.map((s) => s.slot));
  const count = Math.min(
    MAX_SEATS,
    Math.max(2 * settings.size, highest + 1 + ((highest + 1) % 2)),
  );
  const out: SlotView[] = [];
  for (let slot = 0; slot < count; slot++) {
    const seat = riders.find((s) => s.slot === slot);
    const bot = view.world
      ? view.bots.some((b) => b.slot === slot)
      : !seat || seat.bot;
    const difficulty = settings.bots[slot] ?? "normal";
    out.push({
      slot,
      team: teamOf(slot),
      name: seat && !bot ? seat.name : `AI · ${difficulty}`,
      bot,
      difficulty,
      self: seat?.id === self && !bot,
    });
  }
  return out;
}

/** The settings with `slot`'s bot one difficulty harder, wrapping from hard to easy. */
export function cycleDifficulty(settings: Settings, slot: number): Settings {
  const bots = [...settings.bots];
  const at = DIFFICULTIES.indexOf(bots[slot] ?? "normal");
  bots[slot] = DIFFICULTIES[(at + 1) % DIFFICULTIES.length]!;
  return { ...settings, bots };
}

/** The map tile under a pointer on a canvas drawn `width × height` tiles across its whole box, or undefined. */
export function tileAt(
  x: number,
  y: number,
  box: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): { x: number; y: number } | undefined {
  if (box.width <= 0 || box.height <= 0) return;
  const tx = Math.floor(((x - box.left) / box.width) * width),
    ty = Math.floor(((y - box.top) / box.height) * height);
  return tx >= 0 && ty >= 0 && tx < width && ty < height
    ? { x: tx, y: ty }
    : undefined;
}

/** The banner over a decided match, from the seat's side when this device rode one (`slot` ≥ 0). */
export function banner(winner: number, slot: number): string {
  if (winner === NO_WINNER) return "";
  if (winner === DRAW) return "DRAW";
  if (slot >= 0) return teamOf(slot) === winner ? "VICTORY" : "DEFEAT";
  return `${TEAMS[winner]} WINS`;
}
