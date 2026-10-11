import { MIN_PLAYERS } from "../engine/index.js";
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
  /** The room's creator is here. */
  hostPresent: boolean;
  /** Touch pads rather than keys. */
  touch: boolean;
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
  // A fallen gunship flies on as a ghost.
  const flying = running && follow !== undefined && !world.result;

  let screen: "lobby" | "countdown" | "playing" | View["stage"] = "lobby",
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
      if (left > -GO_TICKS) overlay += screens.countdownHtml(count);
    } else if ((screen = view.stage) === "between") {
      const line = `FIRST TO ${view.play.wins} WINS · NEXT ROUND IN ${next}`;
      overlay += screens.roomResultsHtml(
        info,
        ship(view.results.at(-1)?.winner),
        line,
      );
    } else {
      const line = `MATCH OVER AFTER ${view.results.length} ROUNDS`;
      overlay += screens.roomResultsHtml(info, ship(view.winner), line, viewer);
    }
  }

  const notes: [boolean, string][] = [
    [!viewer.hostPresent, "The host left: the room plays on without them"],
    [!mine, "Pick a name to take a seat"],
    [running && !!mine?.watcher, "Watching"],
    [running && follow === undefined, "You fly from the next round"],
    [screen === "lobby" && !viewer.host, "Waiting for the host to start"],
    [
      screen === "lobby" && players.length < MIN_PLAYERS,
      "Two gunships start a match: invite a friend or add a bot",
    ],
  ];
  const note = notes.find(([when]) => when)?.[1] ?? "";
  return {
    screen,
    askName: !mine,
    members,
    host: viewer.host,
    canAddBot: viewer.host && players.length < CAPACITY,
    canStart: viewer.host && players.length >= MIN_PLAYERS,
    note,
    /** The HTML over the round (screens.ts). */
    overlay,
    /** How the scene draws each gunship, by castle id; `follow` is this device's. */
    looks,
    follow,
    /** This device flies its gunship or ghost in the running round. */
    flying,
  };
}

/** What a room status line means for this page: a dead end shown as a card, a link being retried, or nothing. */
export type Trouble = "full" | "desync" | "fatal" | "retry" | "";
const RETRY = /retrying|interrupted|recovering|waiting for the game|could not/i;
const FATAL = /reload this page|replaced|start a new room|room ended/i;
export function trouble(text: string): Trouble {
  if (/^room (is )?full$/i.test(text)) return "full";
  if (/out of sync/i.test(text)) return "desync";
  return RETRY.test(text) ? "retry" : FATAL.test(text) ? "fatal" : "";
}
