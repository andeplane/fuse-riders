// HTML for the overlay screens (lobby, HUD badges, countdown, results, winner, pause). Pure string builders: the
// flow decides which one shows and wires clicks through `data-action` attributes. All text is our own constants.

import type { MatchState, RoundView } from "../engine/index.js";
import { castleSvg } from "../render/art.js";
import { css } from "../render/palette.js";
import { KEY_BINDINGS, deviceLabel } from "./input/index.js";
import type { Lobby, Seat } from "./lobby.js";

/** What the in-match screens show. */
export interface MatchInfo {
  readonly seats: readonly Seat[];
  readonly match: MatchState;
  readonly view: RoundView;
}

const KEYS = KEY_BINDINGS.map((b) => deviceLabel(b.device)).join(" ");

const pips = ({ match }: MatchInfo, slot: number): string =>
  `<span class="pips">${Array.from(
    { length: match.winsToWin },
    (_, i) => `<i class="${i < (match.wins[slot] ?? 0) ? "on" : ""}"></i>`,
  ).join("")}</span>`;

const button = (action: string, label: string, hint = "", cls = ""): string =>
  `<button class="${cls}" data-action="${action}">${label}${hint ? ` <kbd>${hint}</kbd>` : ""}</button>`;

const stepper = (label: string, action: string, value: number, key: string) =>
  `<div class="stepper">${label} <kbd>${key}</kbd>` +
  `${button(`${action}:-`, "−")}<b>${value}</b>${button(`${action}:+`, "+")}</div>`;

function slotCard(lobby: Lobby, slot: number, seat: Seat | undefined): string {
  if (!seat)
    return `<div class="slot off" data-action="players:${slot + 1}"><div class="castle"></div><b>OPEN</b><small>CLICK TO ADD A BOT</small></div>`;
  const head = `<div class="castle">${castleSvg(seat.color)}</div><b>${seat.name}</b>`;
  const style = `style="--c:${css(seat.color)}"`;
  if (seat.device)
    return `<div class="slot human" ${style}>${head}<span class="key">${seat.tag}</span><small>PRESS AGAIN TO LEAVE</small></div>`;
  const next = lobby.devices.indexOf(undefined) === slot;
  const level = button(
    `bot:${slot}`,
    `BOT · ${seat.difficulty.toUpperCase()}`,
    "",
    "level",
  );
  return `<div class="slot bot${next ? " next" : ""}" ${style}>${head}${level}<small>${next ? "NEXT TO JOIN" : "CLICK TO CHANGE"}</small></div>`;
}

export function lobbyHtml(lobby: Lobby, touch: boolean): string {
  const seats = lobby.seats();
  const cards = Array.from({ length: 6 }, (_, slot) =>
    slotCard(lobby, slot, seats[slot]),
  ).join("");
  const join = touch
    ? "TAP JOIN BELOW, PRESS A KEY OR A GAMEPAD BUTTON TO JOIN"
    : `PRESS YOUR BUTTON TO JOIN: ${KEYS} OR ANY GAMEPAD BUTTON`;
  const start = seats.some((s) => s.device) ? "START" : "WATCH BOTS";
  return `<div class="panel lobby">
  <h1>FUSE BOMBERS</h1>
  <p class="join">${join}</p>
  <div class="slots">${cards}</div>
  <div class="settings">
    ${stepper("PLAYERS", "players", lobby.playerCount, "2-6")}
    ${stepper("ROUNDS TO WIN", "wins", lobby.winsToWin, "R")}
    ${button("bots", "ALL BOTS", "B")}
  </div>
  ${button("start", start, "ENTER", "start")}
  <p>ONE BUTTON EACH: PRESS TO FIRE AS THE LAUNCHER SWEEPS · ESC${touch ? ", II" : ""} OR PAD START PAUSES</p>
  <p>GAMEPADS: START BEGINS, OR HOLD YOUR BUTTON FOR A SECOND</p>
</div>`;
}

/**
 * Small badges along the bottom: name, button and round wins in the player's colour; knocked-out castles dim.
 * `pause` adds a pause button in the corner (for touch players, who have no Esc or Start button). A sim `speed`
 * above 1 (the bots finishing a round on their own) shows a fast-forward sign.
 */
export function hudHtml(info: MatchInfo, pause = false, speed = 1): string {
  const badges = info.seats.map((s) => {
    const out = info.view.castles[s.slot]?.alive === false ? " out" : "";
    return `<div class="badge${out}" style="--c:${css(s.color)}">${s.name} <small>${s.tag}</small>${pips(info, s.slot)}</div>`;
  });
  const corner = pause
    ? `<button class="pause" data-action="pause" aria-label="Pause">II</button>`
    : "";
  if (speed > 1.05)
    badges.push(
      `<div class="badge fast-forward">⏩ BOTS ONLY ×${speed.toFixed(1)}</div>`,
    );
  return `<div class="hud">${badges.join("")}</div>${corner}`;
}

export const countdownHtml = (text: string): string =>
  `<div class="countdown">${text}</div>`;

function scoreboard(info: MatchInfo): string {
  const { seats, match, view } = info;
  const wins = (s: Seat) => match.wins[s.slot] ?? 0;
  const rows = [...seats]
    .sort((a, b) => wins(b) - wins(a) || a.slot - b.slot)
    .map((s) => {
      const stats = view.castles[s.slot]?.stats;
      return (
        `<tr style="--c:${css(s.color)}"><td class="castle">${castleSvg(s.color)}</td>` +
        `<td class="name">${s.name}</td><td><small>${s.tag}</small></td><td>${pips(info, s.slot)}</td>` +
        `<td>${Math.round(stats?.damageDealt ?? 0)}</td><td>${stats?.kills ?? 0}</td></tr>`
      );
    });
  return `<table class="scores"><tr><th></th><th></th><th></th><th>WINS</th><th>DAMAGE</th><th>KOS</th></tr>${rows.join("")}</table>`;
}

const named = (seat: Seat | undefined): string =>
  seat ? `<span style="color:${css(seat.color)}">${seat.name}</span>` : "";

/** Between rounds (`secondsLeft` until the next one) or, once the match has a winner, the match winner screen. */
export function resultsHtml(info: MatchInfo, secondsLeft: number): string {
  const { seats, match, view } = info;
  const rounds = match.history.length;
  if (match.winner !== null)
    return `<div class="panel">
  <h1>${named(seats[match.winner])} WINS!</h1>
  <p>MATCH OVER AFTER ${rounds} ROUNDS</p>
  ${scoreboard(info)}
  <div class="row">${button("again", "PLAY AGAIN", "ENTER", "start")}${button("lobby", "BACK TO LOBBY", "ESC")}</div>
</div>`;
  const winner = view.result?.winner;
  const next = `NEXT ROUND IN ${Math.max(1, Math.ceil(secondsLeft))}`;
  return `<div class="panel">
  <h2>${winner == null ? "DRAW!" : `${named(seats[winner])} WINS ROUND ${rounds}`}</h2>
  <p>FIRST TO ${match.winsToWin} WINS THE MATCH</p>
  ${scoreboard(info)}
  ${button("next", next, "ENTER", "start")}
</div>`;
}

export const pauseHtml = (): string => `<div class="panel">
  <h2>PAUSED</h2>
  <div class="row">${button("resume", "RESUME", "ESC", "start")}${button("quit", "QUIT TO LOBBY", "BKSP")}</div>
</div>`;
