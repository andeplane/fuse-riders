/**
 * The maps a room can play, by id. Dust Basin is the small one; the others come from the generator
 * (`tools/mapgen.ts`), one per team size at about the scale of Z and StarCraft. A map holds a team size when it has a
 * fort for every slot: seats 0 to 2·size − 1. With no map chosen a match plays its size's default; a chosen map too
 * small for the size the match starts at gives way to that default too, so a start never fails over the map.
 */
import { loadMap, type GameMap } from "../engine/index.js";
import dustBasin from "../../maps/dust-basin.json";
import rustCanyon from "../../maps/rust-canyon.json";
import glassLakes from "../../maps/glass-lakes.json";
import ironDelta from "../../maps/iron-delta.json";

export interface MapChoice {
  id: string;
  name: string;
  width: number;
  height: number;
  /** The largest team size it holds. */
  teams: number;
}

const FILES: Readonly<Record<string, unknown>> = {
  "dust-basin": dustBasin,
  "rust-canyon": rustCanyon,
  "glass-lakes": glassLakes,
  "iron-delta": ironDelta,
};
export const MAP_IDS: readonly string[] = Object.keys(FILES);
/** The map a team size plays when none is chosen. */
export const DEFAULT_MAPS: Readonly<Record<number, string>> = {
  1: "rust-canyon",
  2: "glass-lakes",
  3: "iron-delta",
};

const loaded = new Map<string, GameMap>();
/** The loaded map for an id from `MAP_IDS`, loaded once and shared (a map holds no state). */
export function mapById(id: string): GameMap {
  let map = loaded.get(id);
  if (map === undefined) {
    if (!(id in FILES)) throw new Error(`no map ${id}`);
    map = loadMap(FILES[id]);
    loaded.set(id, map);
  }
  return map;
}

const choices = new Map<string, MapChoice>();
export function mapChoice(id: string): MapChoice {
  let choice = choices.get(id);
  if (choice === undefined) {
    const map = mapById(id);
    const seats = new Set(
      map.sites.filter((s) => s.kind === "fort").map((s) => s.seat),
    );
    let teams = 0;
    while (seats.has(2 * teams) && seats.has(2 * teams + 1)) teams++;
    choice = {
      id,
      name: map.name,
      width: map.width,
      height: map.height,
      teams,
    };
    choices.set(id, choice);
  }
  return choice;
}

/** The maps that hold `size` riders a team, in `MAP_IDS` order. */
export const mapsFor = (size: number): MapChoice[] =>
  MAP_IDS.map(mapChoice).filter((choice) => choice.teams >= size);

/** The map a match of `size` plays: `chosen` when it holds that size, else the size's default. */
export function resolveMap(chosen: string | null, size: number): string {
  if (chosen !== null && mapsFor(size).some((c) => c.id === chosen))
    return chosen;
  return DEFAULT_MAPS[size] ?? "dust-basin";
}
