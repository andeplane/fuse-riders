import type { ControlHint } from "fuse-ui";
import { QUEEN_EGGS, isQueenSlot, type UnitKind } from "../engine/index.js";
import type { ControlSource } from "./controls.js";
import { DEVICE_KEYS, WIN_LINE, type Device } from "./guide.js";
import { seatTitle } from "./presenter.js";

/**
 * The card over the arena while a game counts down (and during the pause before the next one): this seat's role, the
 * keys that play it on this device, and the three ways to win, in at most four short lines. A device with no unit (a
 * watcher, the shared screen) gets only the objective.
 */
export interface Briefing {
  title: string;
  /** The seat's team, for the card's colour; undefined for a watcher. */
  team: number | undefined;
  /** One line: keys and what they do. */
  controls: readonly ControlHint[];
  /** What this role is for, a line each. */
  tips: readonly string[];
  win: string;
}

/** The big touch button says what it does for the unit this device plays now. */
export const buttonLabel = (kind: UnitKind | undefined): string =>
  kind === "worker" ? "JUMP" : "FLAP";

export function briefing(slot: number, device: Device): Briefing {
  if (slot < 0)
    return {
      title: "WATCHING",
      team: undefined,
      controls: [],
      tips: [],
      win: `Kill the enemy Queen ${QUEEN_EGGS} times, fill the hive, or ride the snail home`,
    };
  const keys = DEVICE_KEYS[device],
    title = `YOU ARE THE ${seatTitle(slot).toUpperCase()}`,
    team = slot % 2,
    // On touch the right button is labelled with what it does; name it so.
    queenButton = device === "touch" ? "FLAP" : keys.button,
    workerButton = device === "touch" ? "JUMP" : keys.button;
  if (isQueenSlot(slot))
    return {
      title,
      team,
      controls: [
        { keys: keys.move, action: "move" },
        { keys: queenButton, action: "tap to flap" },
        { keys: keys.down, action: "hold to dive, release to stop" },
      ],
      tips: [
        `Touch enemies from above or behind to kill · Touch gates to claim them · You have ${QUEEN_EGGS} lives`,
      ],
      win: WIN_LINE,
    };
  return {
    title,
    team,
    controls: [
      { keys: keys.move, action: "move" },
      { keys: workerButton, action: "jump (hold for higher)" },
    ],
    tips: [
      "Carry berries to your hive · Stand in a gate with a berry to become a Warrior or get speed",
      "Walk into the snail to ride it to your goal · the button hops off",
    ],
    win: WIN_LINE,
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

/** A string that changes exactly when the card's text does, so the page rebuilds it only then. */
export const briefingKey = (card: Briefing): string =>
  JSON.stringify([card.title, card.team, card.controls, card.tips, card.win]);
