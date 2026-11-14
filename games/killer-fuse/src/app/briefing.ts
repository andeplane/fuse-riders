import {
  QUEEN_EGGS,
  isQueenSlot,
  type UnitKind,
  type VictoryKind,
} from "../engine/index.js";
import type { ControlSource } from "./controls.js";
import { HOVER_TAPS, type Device } from "./guide.js";
import { seatTitle } from "./presenter.js";

/**
 * The card over the arena while a game counts down: the first game of a set opens on "three
 * ways to win", its three pictures arriving one by one, and the title turns into 3, 2, 1 for the last three seconds.
 * Later games count down only. This seat's controls stay on the card the whole time, so nobody starts a game not
 * knowing the button. A watcher gets no controls.
 */
const TICKS_PER_SECOND = 20;
/** When the title appears and each win picture after it, in log ticks from the countdown's start (0.16, 1.6, 2.3, 3.0 s). */
export const TITLE_AT = 3;
export const WIN_STAGES: readonly {
  kind: VictoryKind;
  at: number;
  caption: string;
}[] = [
  { kind: "military", at: 32, caption: `Kill the Queen ${QUEEN_EGGS}×` },
  { kind: "economy", at: 46, caption: "Fill your hive with berries" },
  { kind: "snail", at: 60, caption: "Ride the snail home" },
];
/** The last ticks of a countdown show 3, 2, 1. */
export const FINAL_TICKS = 3 * TICKS_PER_SECOND;

export interface CountdownState {
  /** The game's number in its set: the first opens with the three ways to win. */
  round: number;
  /** Log ticks since the countdown began, and until the game's first step. */
  elapsed: number;
  left: number;
}
export interface CountdownCard {
  /** "THREE WAYS TO WIN", "GET READY", or the 3, 2, 1. */
  title: string;
  /** Which game on which map, and who this device plays. */
  subtitle: string;
  /** The seat's team, for the card's colour; undefined for a watcher. */
  team: number | undefined;
  /** The game opens a set: a big card over a dimmed arena, not a strip at its foot. */
  first: boolean;
  /** The win pictures shown so far. */
  wins: readonly { kind: VictoryKind; caption: string }[];
  /** The controls, one row per action, this seat's own first. */
  controls: readonly ControlRow[];
  /**
   * Which caps to name: the touch buttons, the gamepad's alone once a pad is what this device plays with, else the
   * keyboard and the gamepad side by side.
   */
  device: Device;
}

/** One action of the controls grid: its keyboard, gamepad and touch caps, a short note, and whether this seat uses it. */
export interface ControlRow {
  action: "MOVE" | "JUMP / FLAP" | "DIVE" | "ATTACK";
  keys: readonly string[];
  pad: readonly string[];
  touch: readonly string[];
  note: string;
  /** The seat's current role does this: shown first and brighter. */
  mine: boolean;
}

/** The big touch button says what it does for the unit this device plays now. */
export const buttonLabel = (kind: UnitKind | undefined): string =>
  kind === "worker" ? "JUMP" : "FLAP";

/**
 * The controls shown as play starts, for every seat (the user requires them all on screen), one row per action: move,
 * jump / flap, the Queen's dive and the Warrior's and Queen's attack. The rows this seat's role uses come first; a
 * Worker's dive and attack follow, dimmed. None for a watcher.
 */
export function controlRows(slot: number): ControlRow[] {
  if (slot < 0) return [];
  const queen = isQueenSlot(slot),
    rows: ControlRow[] = [
      {
        action: "MOVE",
        keys: ["←", "→", "A", "D"],
        pad: ["Stick", "D-pad"],
        touch: ["Left pad"],
        note: "",
        mine: true,
      },
      {
        action: "JUMP / FLAP",
        keys: ["Space"],
        pad: ["A / Cross"],
        touch: [queen ? "FLAP" : "JUMP"],
        note: queen
          ? `tap to fly (~${HOVER_TAPS}/s holds height)`
          : "hold for higher · tap to fly as a Warrior",
        mine: true,
      },
      {
        action: "DIVE",
        keys: ["↓", "S"],
        pad: ["Stick ↓", "D-pad ↓"],
        touch: ["Left pad ↓"],
        note: "Queen, hold",
        mine: queen,
      },
      {
        action: "ATTACK",
        keys: ["X", "Z", "Shift", "J"],
        pad: ["B / Circle", "X / Square", "Bumpers", "Triggers"],
        touch: ["ATTACK"],
        note: "Warrior, Queen",
        mine: queen,
      },
    ];
  return [
    ...rows.filter((row) => row.mine),
    ...rows.filter((row) => !row.mine),
  ];
}

export function countdownCard(
  state: CountdownState,
  slot: number,
  device: Device,
  mapName: string,
): CountdownCard {
  const first = state.round === 1,
    final = state.left <= FINAL_TICKS,
    title = final
      ? String(Math.max(1, Math.ceil(state.left / TICKS_PER_SECOND)))
      : !first
        ? "GET READY"
        : state.elapsed >= TITLE_AT
          ? "THREE WAYS TO WIN"
          : "",
    who = slot < 0 ? "watching" : `you are the ${seatTitle(slot)}`;
  return {
    title,
    subtitle: `GAME ${state.round} · ${mapName.toUpperCase()} · ${who.toUpperCase()}`,
    team: slot < 0 ? undefined : slot % 2,
    first,
    wins: first
      ? WIN_STAGES.filter((stage) => state.elapsed >= stage.at).map(
          ({ kind, caption }) => ({ kind, caption }),
        )
      : [],
    controls: controlRows(slot),
    device,
  };
}

export interface DeviceClues {
  /** The source that last held something, from `Controls.lastUsed`. */
  last: ControlSource | undefined;
  /** A gamepad is connected. */
  pad: boolean;
  /** The main pointer is a finger. */
  coarse: boolean;
  /** This page is a phone controller for a shared screen. */
  controller: boolean;
}
/** Which controls to name: the ones last used, else a connected gamepad, else touch on a phone, else the keyboard. */
export function deviceFor(clues: DeviceClues): Device {
  if (clues.last) return clues.last;
  if (clues.pad) return "pad";
  return clues.coarse || clues.controller ? "touch" : "keys";
}

/** A string that changes exactly when the card's content does, so the page rebuilds it only then. */
export const cardKey = (card: CountdownCard): string =>
  JSON.stringify([
    card.title,
    card.subtitle,
    card.team,
    card.first,
    card.wins.map((win) => win.kind),
    card.controls,
    card.device,
  ]);
