import {
  DIFFICULTIES,
  DRAW,
  MAX_SEATS,
  NO_WINNER,
  pickHeroes,
  teamOf,
  type Difficulty,
  type HeroKind,
} from "../engine/index.js";
import type { Settings, View } from "../online/game.js";
import { mapsFor, resolveMap } from "../online/maps.js";

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
  /** The hero it plays (in the lobby, the one a start would give it) and whether it was picked rather than given. */
  hero: HeroKind;
  picked: boolean;
}

/**
 * The slots a start would play (or the match plays): `2·size` of them, grown to fit the highest seated rider as the
 * fold grows it. A slot no rider holds is the bot fill at that slot's difficulty.
 */
export function slotsOf(view: View, self: string): SlotView[] {
  const settings = view.stage === "lobby" ? view.settings : view.play;
  const riders = view.seats.filter((s) => !s.watcher && s.slot >= 0);
  const highest = Math.max(-1, ...riders.map((s) => s.slot));
  const count =
    view.world?.players.length ??
    Math.min(
      MAX_SEATS,
      Math.max(2 * settings.size, highest + 1 + ((highest + 1) % 2)),
    );
  const out: SlotView[] = [];
  const all = Array.from({ length: count }, (_, slot) => slot);
  const given = pickHeroes(
    all,
    Object.fromEntries(all.map((s) => [s, settings.heroes[s] ?? null])),
  );
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
      hero:
        view.world?.heroes.find((h) => h.seat === slot)?.kind ?? given[slot]!,
      picked: settings.heroes[slot] != null,
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

/** The banner over a decided match, from the seat's side when this device rode one (`slot` ≥ 0). */
export function banner(winner: number, slot: number): string {
  if (winner === NO_WINNER) return "";
  if (winner === DRAW) return "DRAW";
  if (slot >= 0) return teamOf(slot) === winner ? "VICTORY" : "DEFEAT";
  return `${TEAMS[winner]} WINS`;
}

/** The settings with `kind` picked for `slot`; a teammate who had picked it goes back to a free one. */
export function pickHero(
  settings: Settings,
  slot: number,
  kind: HeroKind,
): Settings {
  const heroes = settings.heroes.map((h, s) =>
    s % 2 === slot % 2 && h === kind ? null : h,
  );
  heroes[slot] = kind;
  return { ...settings, heroes };
}

/** The maps the lobby offers at the settings' size, the one a start would play lit (the size's default if none). */
export function mapOptions(
  settings: Settings,
): { id: string; label: string; on: boolean }[] {
  const playing = resolveMap(settings.map, settings.size);
  return mapsFor(settings.size).map((choice) => ({
    id: choice.id,
    label: `${choice.name} ${choice.width}×${choice.height}`,
    on: choice.id === playing,
  }));
}
