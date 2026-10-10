import {
  BOT_DIFFICULTIES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  type BotDifficulty,
} from "../engine/index.js";
import { playerColor } from "../render/palette.js";
import { deviceLabel, type DeviceId } from "./input/index.js";

/** Player names follow the slot colours (`PLAYER_COLORS`), so "RED WINS" points at the red castle. */
export const PLAYER_NAMES = "RED BLUE GREEN YELLOW PURPLE TEAL".split(" ");

/** One seat of the match: a human on a device, or a bot. */
export interface Seat {
  readonly slot: number;
  readonly name: string;
  readonly color: number;
  /** The human's device, or undefined for a bot. */
  readonly device: DeviceId | undefined;
  readonly difficulty: BotDifficulty;
  /** `Q`, `PAD 1`, `TOUCH 2`, or `BOT`. */
  readonly tag: string;
}

export const MAX_WINS_TO_WIN = 9;

/**
 * The lobby's state, without any DOM: who sits in which slot, how many players, bot difficulties and rounds to
 * win. A device that presses joins the first free slot (growing the player count if needed); pressing again
 * leaves. Slots up to the player count that no human holds are played by bots.
 */
export class Lobby {
  playerCount = 4;
  winsToWin = 3;
  readonly devices = Array<DeviceId | undefined>(MAX_PLAYERS).fill(undefined);
  readonly difficulties = Array<BotDifficulty>(MAX_PLAYERS).fill("easy");

  /** A device pressed its button: join it, or take it out if it already sits. Returns its slot, or undefined. */
  press(device: DeviceId): { slot: number; joined: boolean } | undefined {
    const seated = this.devices.indexOf(device);
    if (seated >= 0) {
      this.devices[seated] = undefined;
      return { slot: seated, joined: false };
    }
    const slot = this.devices.indexOf(undefined);
    if (slot < 0) return undefined;
    this.devices[slot] = device;
    this.playerCount = Math.max(this.playerCount, slot + 1);
    return { slot, joined: true };
  }

  /**
   * Renumber the seated touch zones 0, 1, 2… in their left-to-right order, so a match has no blank zone where a
   * touch player left the lobby. Zone i is the device `touch:i`.
   */
  compactTouchZones(): void {
    const zone = (d: DeviceId | undefined) =>
      d?.startsWith("touch:") ? Number(d.slice(6)) : -1;
    const touch = this.devices
      .map((device, slot) => ({ slot, zone: zone(device) }))
      .filter((s) => s.zone >= 0)
      .sort((a, b) => a.zone - b.zone);
    touch.forEach(({ slot }, i) => {
      this.devices[slot] = `touch:${i}`;
    });
  }

  /** The smallest player count that keeps every seated human in the match. */
  get minPlayers(): number {
    let count = MIN_PLAYERS;
    this.devices.forEach((d, slot) => {
      if (d) count = Math.max(count, slot + 1);
    });
    return count;
  }

  setPlayerCount(count: number): void {
    this.playerCount = Math.min(MAX_PLAYERS, Math.max(this.minPlayers, count));
  }

  setWinsToWin(wins: number): void {
    this.winsToWin = Math.min(MAX_WINS_TO_WIN, Math.max(1, wins));
  }

  /** Next difficulty for one bot slot, or for every slot when `slot` is undefined (all follow the first bot). */
  cycleDifficulty(slot?: number): void {
    const next = (d: BotDifficulty): BotDifficulty =>
      BOT_DIFFICULTIES[(BOT_DIFFICULTIES.indexOf(d) + 1) % 3] ?? "easy";
    if (slot !== undefined) {
      this.difficulties[slot] = next(this.difficulties[slot] ?? "easy");
      return;
    }
    const first = this.seats().find((s) => !s.device)?.difficulty ?? "easy";
    this.difficulties.fill(next(first));
  }

  /** The seats of the match, one per player, in slot (and castle) order. */
  seats(): Seat[] {
    return Array.from({ length: this.playerCount }, (_, slot) => {
      const device = this.devices[slot];
      return {
        slot,
        name: PLAYER_NAMES[slot] ?? `P${slot + 1}`,
        color: playerColor(slot),
        device,
        difficulty: this.difficulties[slot] ?? "easy",
        tag: device ? deviceLabel(device) : "BOT",
      };
    });
  }
}
