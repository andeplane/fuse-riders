import { VIEW_H, VIEW_W } from "../engine/view-kit.js";
import type { HeroKind } from "../engine/index.js";
import { picksApply, type View } from "../online/game.js";

/**
 * What the page shows, decided from one frame: the lobby (roster, hero picker, start) or the running game, and the
 * line of help under it. Pure, so the decisions are unit-tested; `main.ts` only puts them on the page. A seat's hero
 * always comes from the room (`SeatView.hero`): a pick is logged, not promised, and the room can drop it.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page only watches the room (`?display=1`): it never takes a seat. */
  display: boolean;
}

/** How the page introduces each hero. */
export const HEROES: Readonly<
  Record<HeroKind, { name: string; blurb: string; color: string }>
> = {
  brakka: {
    name: "BRAKKA",
    blurb: "Barbarian · broadsword · Storm",
    color: "#4da6ff",
  },
  rhea: { name: "RHEA", blurb: "Amazon · longsword · Fire", color: "#ff6a3d" },
  gorm: { name: "GORM", blurb: "Dwarf · battle axe · Earth", color: "#ffc23d" },
};
/** Each seat's colour on the page, P1 to P5. */
export const SEAT_COLORS = [
  "#2de2ff",
  "#ff4fa3",
  "#b6ff4d",
  "#ffc23d",
  "#a77bff",
] as const;
export const tag = (slot: number): string => `P${slot + 1}`;

export interface Member {
  id: string;
  name: string;
  tag: string;
  color: string;
  hero: HeroKind | null;
  status: string;
  you: boolean;
}
export interface Model {
  screen: "lobby" | "play";
  askName: boolean;
  seated: boolean;
  /** This device steers a hero in the running world, so the game's keys are its own. */
  playing: boolean;
  /** The hero this device's seat plays (or plays next), from the room. */
  hero: HeroKind | null;
  /** The hero picker takes a pick: a present seat, in the lobby or once a run is over. */
  canPick: boolean;
  members: Member[];
  watchers: number;
  showStart: boolean;
  canStart: boolean;
  /** The host may take the room back to the lobby (and the hero picker) from a run. */
  canReturn: boolean;
  note: string;
}

export function present(view: View, viewer: Viewer): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher && !viewer.display;
  const inWorld =
    seated && !!view.world?.heroes.some((hero) => hero.seat === mine.slot);
  const screen = view.stage === "lobby" ? "lobby" : "play";
  let note = "";
  if (screen === "lobby")
    note = !seats.length
      ? "Pick a name to take a seat"
      : viewer.display
        ? "This screen watches; everyone plays on their own device"
        : viewer.host
          ? "Pick your hero, then START"
          : "Pick your hero; the host starts the run";
  else if (!viewer.display)
    note = !seated
      ? mine
        ? "Watching"
        : "Pick a name to play from the next run"
      : !inWorld
        ? "You join the next run"
        : view.stage === "over"
          ? "The run is over"
          : "";
  return {
    screen,
    askName: !mine && !viewer.display && !viewer.solo,
    seated,
    playing: inWorld && view.stage === "running",
    hero: seated ? mine.hero : null,
    canPick: seated && mine.connected && !mine.away && picksApply(view.stage),
    members: seats.map((seat) => ({
      id: seat.id,
      name: seat.id === viewer.me ? `${seat.name} (you)` : seat.name,
      tag: tag(seat.slot),
      color: SEAT_COLORS[seat.slot % SEAT_COLORS.length]!,
      hero: seat.hero,
      status: seat.away
        ? "AWAY"
        : !seat.connected && !seat.bot
          ? "OFFLINE"
          : `${tag(seat.slot)} · ${seat.hero ? HEROES[seat.hero].name : ""}`,
      you: seat.id === viewer.me,
    })),
    watchers: view.seats.length - seats.length,
    showStart: viewer.host && !viewer.display && screen === "lobby",
    canStart: seats.length > 0,
    canReturn: viewer.host && !viewer.display && screen === "play",
    note,
  };
}

/** The largest whole-number scale at which the native screen fits `width` × `height` device pixels; at least 1. */
export function pixelScale(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / VIEW_W, height / VIEW_H)));
}
