import type { RosterMember } from "fuse-ui";
import { CAPACITY, type FuseDriversView } from "../game/index.js";
import { config } from "../game/sim/config.js";

/**
 * What the screen shows, as a pure function of the view and who this device is.
 *
 * The screen renders from the view, never from events: a rollback can correct an outcome after it was
 * shown, and events are deduplicated by position, so only the view carries the correction.
 */
export interface Viewer {
  /** This device's member id ("solo" alone, "" before the room service admitted it). */
  me: string;
  /** This device created the room: it starts races and adds or removes bots. */
  host: boolean;
  solo: boolean;
  /** The shared screen (`?display=1`): it shows the race and never drives. */
  display: boolean;
  /** The room's settings make it one shared screen with phones as controllers. */
  shared: boolean;
}

export interface DriverRow {
  id: string;
  name: string;
  /** The name as the card shows it, marked when it is this device's seat. */
  label: string;
  /** Which truck this seat drives, or -1 before the grid forms. */
  truck: number;
  place: number;
  lap: number;
  laps: number;
  kills: number;
  armor: number;
  /** Wrecked and waiting to respawn. */
  wrecked: boolean;
  finished: boolean;
  you: boolean;
  bot: boolean;
  away: boolean;
}

export interface RaceModel {
  /** Laps the leader is on, for the HUD. */
  lap: number;
  laps: number;
  /** This device's own place, or 0 when it is only watching. */
  place: number;
  drivers: DriverRow[];
  countdown: number;
  finished: boolean;
}

export interface ResultModel {
  title: string;
  rows: string[];
  /** This device may start the next race or return to the lobby. */
  host: boolean;
  waiting: string;
}

export interface LobbyModel {
  members: RosterMember[];
  canStart: boolean;
  showStart: boolean;
  note: string;
  track: string;
}

export interface TableModel {
  screen: "lobby" | "race" | "results";
  askName: boolean;
  lobby: LobbyModel;
  race?: RaceModel;
  results?: ResultModel;
}

const marked = (name: string, you: boolean): string =>
  you ? `${name} (you)` : name;

export function presentTable(
  view: FuseDriversView,
  viewer: Viewer,
): TableModel {
  const seated = view.drivers.some((driver) => driver.id === viewer.me);
  const racing = view.phase === "running";
  const over = view.phase === "over";

  const members: RosterMember[] = view.drivers.map((driver) => ({
    id: driver.id,
    name: marked(driver.name, driver.id === viewer.me),
    status: driver.bot ? "CPU" : driver.connected ? "READY" : "AWAY",
    avatar: driver.avatarId,
    host: false,
  }));

  const lobby: LobbyModel = {
    members,
    canStart: view.drivers.length >= 2,
    showStart: viewer.host && !racing && !over,
    note:
      view.drivers.length >= 2
        ? ""
        : `Waiting for drivers: 2 to ${String(CAPACITY)} race.`,
    track: view.track,
  };

  const model: TableModel = {
    screen: racing ? "race" : over ? "results" : "lobby",
    askName: !seated && !viewer.display && !viewer.solo,
    lobby,
  };

  const race = view.race;
  if (race && (racing || over)) {
    const rows: DriverRow[] = view.drivers.map((driver) => {
      const car = driver.truck >= 0 ? race.trucks[driver.truck] : undefined;
      const place =
        driver.truck >= 0 ? race.placements.indexOf(driver.truck) + 1 : 0;
      return {
        id: driver.id,
        name: driver.name,
        label: marked(driver.name, driver.id === viewer.me),
        truck: driver.truck,
        place,
        lap: Math.min((car?.laps ?? 0) + 1, config.laps),
        laps: config.laps,
        kills: car?.kills ?? 0,
        armor: car?.armor ?? 0,
        wrecked: (car?.respawnAtTick ?? 0) > 0,
        finished: (car?.finishedTick ?? 0) > 0,
        you: driver.id === viewer.me,
        bot: driver.bot,
        away: !driver.connected && !driver.bot,
      };
    });
    rows.sort((a, b) => (a.place || 99) - (b.place || 99));
    const mine = rows.find((row) => row.you);
    model.race = {
      lap: rows[0]?.lap ?? 1,
      laps: config.laps,
      place: mine?.place ?? 0,
      drivers: rows,
      countdown: Math.max(0, race.countdownEndTick - race.tick),
      finished: over,
    };
    if (over)
      model.results = {
        title:
          rows[0]?.you === true ? "YOU WIN" : `${rows[0]?.name ?? ""} WINS`,
        rows: rows.map(
          (row, index) =>
            `${String(index + 1)}. ${row.label}  ${String(row.kills)} kills`,
        ),
        host: viewer.host,
        waiting: viewer.host ? "" : "Waiting for the host",
      };
  }

  return model;
}
