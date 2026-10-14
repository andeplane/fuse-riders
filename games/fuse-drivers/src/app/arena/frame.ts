import type { FuseDriversView } from "../../game/game.js";
import type { RaceState } from "../../game/sim/race.js";
import type { Track } from "../../game/sim/track.js";
import type { TruckPose } from "./interpolate.js";

/** Everything one drawn frame reads. Built once per `render` call and handed to both scenes. */
export interface ArenaFrame {
  view: FuseDriversView;
  race: RaceState;
  /** The race one presentation step back, when there is one to interpolate from. */
  previous: RaceState | undefined;
  /** How far between `previous` and `race` to draw, 0 to 1. */
  alpha: number;
  poses: TruckPose[];
  track: Track;
  /** The truck the personal panels follow: this device's, or the leader when it drives none. */
  focus: number;
  /** True on the first frame that shows a simulation tick the arena has not drawn yet. */
  newTick: boolean;
  /** One display name per truck slot. */
  names: string[];
}

/** Which truck this device drives, or the current leader when it drives none (a shared screen, a watcher). */
export function focusTruck(
  view: FuseDriversView,
  race: RaceState,
  selfId: string | undefined,
): number {
  const own = view.drivers.find((driver) => driver.id === selfId);
  if (own && own.truck >= 0 && own.truck < race.trucks.length) return own.truck;
  return race.placements[0] ?? 0;
}

/** Names in truck order, falling back to the slot when no seat drives it. */
export function truckNames(view: FuseDriversView, count: number): string[] {
  return Array.from({ length: count }, (_, slot) => {
    const driver = view.drivers.find((d) => d.truck === slot);
    return (driver?.name ?? `CPU ${slot + 1}`).slice(0, 8).toUpperCase();
  });
}
