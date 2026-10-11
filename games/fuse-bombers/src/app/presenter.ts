import { MIN_PLAYERS, type TickEvent } from "../engine/index.js";
import { CAPACITY, type View } from "../online/game.js";
import { css, playerColor } from "../render/palette.js";
import type { PlayerLook } from "../render/round-scene.js";
import * as screens from "./screens.js";

/**
 * What an online room's page shows, decided from one frame: the lobby's roster and buttons, or the round's overlay
 * (badges, countdown, results, the match winner) and how the scene draws each gunship. Pure, so it is unit-tested;
 * `online.ts` only puts it on the page.
 */
export interface Viewer {
  me: string;
  /** This page runs the room (its creator or stand-in, or a solo match). */
  host: boolean;
  hostPresent: boolean; // the room's creator is here
  touch: boolean; // touch pads rather than keys
  /** This page is the shared TV (`?display=1`): it shows every gunship and never takes a seat. */
  display: boolean;
}
/** A phone that is a controller for the shared TV: who it flies, how that gunship (or its ghost) is, and the round's
 * word (the countdown, GO!, who won). */
export interface Controller {
  name: string;
  tag: string;
  color: string;
  hp: number; // 0–1 of the gunship's
  state: "flying" | "ghost" | "out";
  loaded: boolean; // the launcher, or the ghost's bomb
  reload: number; // 0–1 of the reload done
  wins: string;
  line: string;
  actions: boolean; // REMATCH and BACK TO LOBBY: the host's, once the match is over
}
/** What `present` decides; `online.ts` puts it on the page. */
export type Model = ReturnType<typeof present>;

/** Log ticks (of 50 ms) a second, and how long GO! stays up once the round flies. */
const LOG_HZ = 20;
const GO_TICKS = 14;
/** Names are what players typed, and screens.ts builds markup: as HTML text. */
export const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export function present(view: View, viewer: Viewer) {
  const players = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const members = players.map((seat) => ({
    id: seat.id,
    name: seat.name,
    color: css(playerColor(seat.slot)),
    status:
      seat.id === viewer.me
        ? "YOU"
        : seat.bot
          ? "BOT"
          : seat.connected
            ? `P${seat.slot + 1}`
            : "OFFLINE",
    removable: viewer.host && seat.bot,
  }));
  const index = view.ships.indexOf(viewer.me);
  const follow = index < 0 ? undefined : index;
  // The round's gunships, by castle id, coloured by their room seat.
  const looks = view.ships.map((id, ship): PlayerLook => {
    const seat = view.seats.find((each) => each.id === id);
    return {
      name: seat?.name ?? "GONE",
      color: playerColor(seat?.slot ?? ship),
      tag: ship === follow ? "YOU" : seat?.bot ? "BOT" : "",
      ...(ship === follow
        ? { prompt: viewer.touch ? "TAP FIRE" : "PRESS SPACE" }
        : {}),
    };
  });
  const world = view.world;
  const running = view.stage === "running" && world !== null;
  // On a shared TV every seated phone is a controller from the first countdown on.
  const shared = view.settings.display || view.play.display;
  const pad = shared && !viewer.display && !!mine && !mine.watcher;
  const name = (ship: number | null | undefined) =>
    looks[ship ?? -1]?.name.toUpperCase();
  let line = "";
  // A fallen gunship flies on as a ghost.
  const flying = running && follow !== undefined && !world.result;

  let screen: "lobby" | "countdown" | "playing" | "controller" | View["stage"] =
      "lobby",
    overlay = "";
  if (view.stage !== "lobby" && world) {
    const info: screens.MatchInfo = {
      seats: looks.map((look, slot) => ({
        ...look,
        name: escapeHtml(look.name),
        tag: look.tag ?? "",
        slot,
        device: undefined,
        difficulty: view.play.difficulty,
      })),
      view: world,
      match: {
        config: { seed: 0, playerCount: looks.length },
        winsToWin: view.play.wins,
        wins: view.ships.map((id) => view.wins[id] ?? 0),
        history: [],
        winner: null,
      },
    };
    const ship = (id = "") => (id ? view.ships.indexOf(id) : null);
    const left = view.startAt - view.logTick,
      next = Math.max(1, Math.ceil((view.resumeAt - view.logTick) / LOG_HZ));
    overlay = screens.hudHtml(info);
    if (view.stage === "running") {
      screen = left > 0 ? "countdown" : "playing";
      const count = left > 0 ? String(Math.ceil(left / LOG_HZ)) : "GO!";
      if (left > -GO_TICKS) overlay += screens.countdownHtml((line = count));
      const won = world.result?.winner;
      if (world.result) line = won == null ? "DRAW!" : `${name(won)} WINS`;
    } else if ((screen = view.stage) === "between") {
      const winner = ship(view.results.at(-1)?.winner);
      const text = `FIRST TO ${view.play.wins} WINS · NEXT ROUND IN ${next}`;
      overlay += screens.roomResultsHtml(info, winner, text);
      line = `${winner == null ? "DRAW!" : `${name(winner)} WINS THE ROUND`} · NEXT IN ${next}`;
    } else {
      const winner = ship(view.winner);
      const text = `MATCH OVER AFTER ${view.results.length} ROUNDS`;
      overlay += screens.roomResultsHtml(info, winner, text, viewer);
      line = `${winner == null ? "NO WINNER" : `${name(winner)} WINS THE MATCH`}${viewer.host ? "" : " · WAITING FOR THE HOST"}`;
    }
    if (pad) screen = "controller";
  }

  const few = players.length < MIN_PLAYERS,
    tv = viewer.display,
    lobby = screen === "lobby";
  const notes: [boolean, string][] = [
    [!viewer.hostPresent, "The host left: the room plays on without them"],
    [tv && lobby, "Scan the code with your phone to join"],
    [!mine && !tv, "Pick a name to take a seat"],
    [running && !!mine?.watcher, "Watching"],
    [running && follow === undefined && !tv, "You fly from the next round"],
    [lobby && !viewer.host, "Waiting for the host to start"],
    [lobby && few, "Two gunships start: invite a friend or add a bot"],
    [
      lobby && shared,
      "Shared TV: open the TV screen, then everyone joins on their phone",
    ],
  ];
  let controller: Controller | null = null;
  if (screen === "controller" && world && mine) {
    const castle = world.castles[follow ?? -1];
    const ghost = world.ghosts.find((g) => g.owner === follow);
    const unit = castle?.alive ? castle : ghost;
    const state = castle?.alive ? "flying" : ghost ? "ghost" : "out";
    controller = {
      name: mine.name,
      tag: `P${mine.slot + 1}`,
      color: css(playerColor(mine.slot)),
      hp: castle ? Math.max(0, Math.min(1, castle.hp / castle.maxHp)) : 0,
      state,
      loaded:
        !!unit &&
        unit.reloadTicks === 0 &&
        !(unit === castle && castle.volleyLeft),
      reload: unit
        ? 1 - unit.reloadTicks / Math.max(1, unit.reloadTotalTicks)
        : 0,
      wins: `${view.wins[mine.id] ?? 0} / ${view.play.wins}`,
      line:
        line ||
        (state === "ghost"
          ? "GHOST: DROP BOMBS"
          : state === "out"
            ? "YOU FLY FROM THE NEXT ROUND"
            : ""),
      actions: view.stage === "over" && viewer.host,
    };
  }
  const note = notes.find(([when]) => when)?.[1] ?? "";
  return {
    screen,
    askName: !mine && !tv,
    members,
    host: viewer.host,
    canAddBot: viewer.host && players.length < CAPACITY,
    canStart: viewer.host && !few,
    openTv: shared && viewer.host && !tv, // OPEN TV SCREEN in the lobby
    note,
    controller,
    overlay, // over the round (screens.ts)
    looks, // how the scene draws each gunship, by castle id; `follow` is this device's
    follow,
    flying, // this device flies its gunship (or ghost) in the running round
  };
}

/** What a room status line means for this page: a dead end shown as a card, a link being retried, a shared room
 * still without its TV, or nothing. */
export type Trouble = "full" | "desync" | "fatal" | "retry" | "display" | "";
const RETRY = /retrying|interrupted|recovering|waiting for the game|could not/i;
const FATAL = /reload this page|replaced|start a new room|room ended/i;
export function trouble(text: string): Trouble {
  if (/^room full\b/i.test(text)) return "full"; // the service closed a full room to us
  if (/out of sync/i.test(text)) return "desync";
  if (/waiting for a display/i.test(text)) return "display";
  return RETRY.test(text) ? "retry" : FATAL.test(text) ? "fatal" : "";
}

/** How long a controller vibrates (ms) for `event`, when it hurt `ship` (this phone's gunship): 0 for anything else. */
export function buzz(event: TickEvent, ship: number | undefined): number {
  if (ship === undefined) return 0;
  if (event.type === "castle-destroyed" && event.castleId === ship) return 300;
  if (event.type === "hit" && event.castleId === ship)
    return event.shielded ? 20 : 60;
  return 0;
}
