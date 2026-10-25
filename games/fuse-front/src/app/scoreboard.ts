/**
 * The scoreboard (v3 M6), held open with ` or toggled by the HUD's SCORE button: each hero's kills, deaths and
 * assists (`feed.ts`), level, items and gold, and each team's razed enemy towers and held jungle sectors. `scoreOf` is
 * pure; the panel rebuilds its rows only when what they show changed.
 */
import { el } from "fuse-ui";
import {
  ITEMS,
  STEPS_PER_SECOND,
  type HeroKind,
  type WorldView,
} from "../engine/index.js";
import type { Tally } from "./feed.js";
import type { SlotView } from "./model.js";
import { itemMark } from "./shop-state.js";

export interface ScoreRow extends Tally {
  seat: number;
  team: number;
  name: string;
  kind: HeroKind;
  level: number;
  gold: number;
  /** Item marks by slot, "" empty. */
  items: string[];
  self: boolean;
  /** Seconds to respawn, 0 alive. */
  respawn: number;
}
export interface Score {
  rows: ScoreRow[];
  /** By team: enemy towers and gates razed, and jungle sectors held. */
  towers: [number, number];
  jungle: [number, number];
}

/** The scoreboard from `world`, the match's `slots` and the feed's tallies. */
export function scoreOf(
  world: WorldView,
  slots: readonly SlotView[],
  tally: (seat: number) => Tally,
): Score {
  const towers: [number, number] = [0, 0],
    jungle: [number, number] = [0, 0];
  for (const b of world.buildings)
    if (b.tier >= 0 && b.hp <= 0 && b.team >= 0) towers[1 - b.team]!++;
  // A jungle sector is one without a fort (`GameMap.sectorKinds`).
  const homes = new Set(
    world.buildings.filter((b) => b.kind === "fort").map((b) => b.sector),
  );
  for (const f of world.flags)
    if (f.team >= 0 && !homes.has(f.sector)) jungle[f.team]!++;
  const rows = world.heroes.map((hero): ScoreRow => {
    const slot = slots.find((s) => s.slot === hero.seat);
    const name = slot?.self ? "You" : (slot?.name ?? `Seat ${hero.seat + 1}`);
    return {
      seat: hero.seat,
      team: hero.team,
      name: slot?.bot ? `AI ${slot.difficulty}` : name,
      kind: hero.kind,
      level: hero.level,
      gold: hero.gold,
      items: hero.items.map((id) => {
        const item = ITEMS[id];
        return item ? itemMark(item) : "";
      }),
      self: !!slot?.self,
      respawn: hero.hp > 0 ? 0 : Math.ceil(hero.respawn / STEPS_PER_SECOND),
      ...tally(hero.seat),
    };
  });
  return { rows, towers, jungle };
}

const TEAM_NAMES = ["RED", "BLUE"];

export class Scoreboard {
  readonly element = el("div", "", "ff-score-board ff-frame");
  private readonly body = el("div", "", "ff-score-teams");
  private shown = "";

  constructor() {
    this.element.hidden = true;
    this.element.setAttribute("role", "dialog");
    this.element.setAttribute("aria-label", "Scoreboard");
    const head = el("div", "", "ff-shop-head");
    head.append(el("h3", "SCOREBOARD"), el("small", "hold `", "ff-note"));
    this.element.append(head, this.body);
  }

  get open(): boolean {
    return !this.element.hidden;
  }
  set open(on: boolean) {
    this.element.hidden = !on;
  }

  /** Rebuilds the rows when `score` differs from what they show. */
  update(score: Score): void {
    const key = JSON.stringify(score);
    if (key === this.shown) return;
    this.shown = key;
    this.body.replaceChildren(
      ...[0, 1].map((team) => {
        const column = el("section", "", `ff-score-team ff-t${team}`);
        const head = el("div", "", "ff-score-head");
        head.append(
          el("b", TEAM_NAMES[team]!),
          el("span", `towers ${score.towers[team]}`, "ff-note"),
          el("span", `jungle ${score.jungle[team]}`, "ff-note"),
        );
        column.append(head);
        for (const r of score.rows.filter((row) => row.team === team)) {
          const row = el("div", "", `ff-score-row${r.self ? " ff-own" : ""}`);
          const items = el("span", "", "ff-score-items");
          items.append(...r.items.map((mark) => el("i", mark)));
          row.append(
            el("b", `${r.name} · ${r.kind.toUpperCase()}`),
            el("span", r.respawn ? `${r.respawn}s` : `LV ${r.level}`),
            el("span", `${r.kills}/${r.deaths}/${r.assists}`, "ff-kda"),
            el("span", `◆ ${r.gold.toLocaleString("en")}`, "ff-purse"),
            items,
          );
          column.append(row);
        }
        return column;
      }),
    );
  }
}
