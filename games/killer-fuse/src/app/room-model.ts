/**
 * What the shared room layout (`fuse-ui`'s `createRoomLayout`) shows for a Killer Fuse room: the six numbered slots,
 * their team colour and name, and a row for each slot a person holds. Empty slots stay open because Killer Fuse's
 * engine plays every seat nobody took — there is no AI to add, so no slot offers one.
 *
 * These are plain functions of the page model (`presenter.ts`); the page only hands what they return to the layout.
 */
import { CAPACITY, teamOfSlot } from "../online/index.js";
import {
  seatTitle,
  type PageModel,
  type SeatAction,
  type SeatModel,
} from "./presenter.js";

/** Cyan and Pink, as the arena and the stylesheet draw them. */
export const TEAM_COLORS: readonly [string, string] = ["#2ee6f6", "#ff5fa2"];
/** Seats 1 and 2 are the Queens; the layout numbers every slot from one. */
export const slotColor = (slot: number): string =>
  TEAM_COLORS[teamOfSlot(slot) === 0 ? 0 : 1];
export const slotLabel = (slot: number): string =>
  `${slot + 1} · ${seatTitle(slot).toUpperCase()}`;

/** One person in the room, as the layout's roster shows them inside their slot. */
export interface RoomSeatRow {
  id: string;
  slot: number;
  /** The name as it is shown, with "(you)" or "(away)" where that is what the seat is. */
  name: string;
  /** The line under the name: what is pending about the seat, if anything. The slot itself names the role. */
  status: string;
  color: string;
  /** What a tap on this row's button does, and what the button says; "none" and "" when there is none. */
  action: SeatAction;
  label: string;
}

const shownName = (seat: SeatModel): string =>
  seat.kind === "you"
    ? `${seat.name} (you)`
    : seat.kind === "away"
      ? `${seat.name} (away)`
      : seat.name;

/** The seats people hold, in slot order; the bots' empty slots are left to the layout to show as open. */
export function roomSeatRows(model: PageModel): RoomSeatRow[] {
  return model.lobby.teams
    .flatMap((team) => team.seats)
    .filter((seat) => seat.kind !== "bot" && seat.id !== "")
    .sort((a, b) => a.slot - b.slot)
    .map((seat) => ({
      id: seat.id,
      slot: seat.slot,
      name: shownName(seat),
      status: seat.note,
      color: slotColor(seat.slot),
      action: seat.action,
      label: seat.label,
    }));
}

/** The room's capacity; every Killer Fuse match is three against three. */
export const ROOM_CAPACITY = CAPACITY;
