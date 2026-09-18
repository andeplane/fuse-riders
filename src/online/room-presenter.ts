/**
 * What the room page writes for a frame: header, standings, lobby riders, status line and action buttons (#255).
 *
 * This is the part of the room UI's frame callback that is arithmetic over the frame and the device's own state. It
 * holds no DOM and no state; `ui.ts` diffs the result into the page. Wording and rules are unchanged from when the
 * callback computed them inline, and the browser smokes wait on several of these strings.
 */
import { BOT_ID_PREFIX } from "../engine/bot-controller.js";
import { isAimingGun } from "../engine/gun.js";
import type { WorldView } from "../engine/view.js";
import type { AvatarId } from "../shared/avatars.js";
import { powerLabel } from "../render/power-indicator.js";
import {
  matchWinnerName,
  roundClock,
  roundWinnerName,
  showsRoundResult,
} from "../client/arena-announcer.js";
import { plainStatus, type StatusTone } from "./status-copy.js";

/** Match score units per point. */
const UNITS = 60;
/** Ticks per second, for the recharge and countdown seconds the buttons show. */
const TICKS_PER_SECOND = 20;
/** A room holds at most this many riders, AI included. */
export const MAX_RIDERS = 5;

type RoomPhase = WorldView["phase"];

/** The final-round pause keeps the arena visible until `phaseEndsAtTick`; the match report is ready once it has run out. */
export function recapReady(
  state: Pick<WorldView, "phase" | "tick" | "phaseEndsAtTick">,
): boolean {
  return (
    state.phase === "matchOver" && state.tick >= (state.phaseEndsAtTick ?? 0)
  );
}

export interface RoomPresenterInput {
  state: WorldView;
  /** This device's rider id, `""` before the room confirms it. */
  playerId: string;
  host: boolean;
  /** Another tab took hosting over: this one's host actions are gone. */
  replacedHost: boolean;
  solo: boolean;
  displayOnly: boolean;
  /** From the room screen: the lobby card is up. */
  lobbyCard: boolean;
  /** From the room screen: an invited device without a seat. */
  joining: boolean;
  /** From the room screen: the phone lobby. */
  phoneLobby: boolean;
  /** From the room screen: a phone playing as the thirds controller. */
  mobileActive: boolean;
  /** The fire control is held down right now. */
  bombHeld: boolean;
}

export interface LobbyRiderView {
  id: string;
  name: string;
  color: string;
  avatarId: AvatarId;
  status: "READY" | "OFFLINE";
}

export interface StandingView {
  id: string;
  /** The rider's name with its state (`· next round`, `· offline`). */
  name: string;
  points: string;
  /** Tooltip and accessible name. */
  title: string;
  color: string;
  avatarId: AvatarId;
  /** Eliminated this round. */
  out: boolean;
  /** 1-based, by match score, this round's points breaking ties. */
  rank: number;
  /** Holds the top match score, once anybody has scored. */
  leader: boolean;
  /** Match score as a fraction of the leader's, for the lead bar. */
  lead: string;
  remove: {
    hidden: boolean;
    disabled: boolean;
    title: string;
    label: string;
  };
}

export interface FireView {
  /** The Gun is armed and a tap fires it. */
  gunReady: boolean;
  title: string;
  /** The fire button's label; undefined without a rider, when the button keeps what it said. */
  label: string | undefined;
}

export interface RoomView {
  joined: boolean;
  recapReady: boolean;
  resultsHidden: boolean;
  avatarHidden: boolean;
  joinPanelHidden: boolean;
  controlsHidden: boolean;
  roundClock: string;
  roundChipHidden: boolean;
  /** The in-arena announcer may show: not behind the lobby card or the join card. */
  announcerVisible: boolean;
  notice: string;
  lobby: { count: string; empty: boolean; riders: LobbyRiderView[] };
  standings: StandingView[];
  actions: {
    hidden: boolean;
    start: { label: "START RACE" | "REMATCH"; disabled: boolean };
    reset: { disabled: boolean; hidden: boolean };
    shareHidden: boolean;
    addAIDisabled: boolean;
  };
  fire: FireView;
  power: { hidden: boolean; text: string };
  /** Where a target bomb aims from, as a fraction of the arena; undefined when none is armed. */
  targetAim: { x: number; y: number } | undefined;
  /** This device's rider colour, when it has a rider. */
  playerColor: string | undefined;
  /** The phone HUD shows only on a phone playing as the controller. */
  hudHidden: boolean;
  /** The phone HUD's text, whenever this device has a rider. */
  hud: { fire: string; wins: string; clock: string } | undefined;
}

const scoreText = (units: number) => `${units / UNITS}`;

function notice(
  state: WorldView,
  playerId: string,
  joined: boolean,
  host: boolean,
  ready: boolean,
): string {
  const player = state.players.find((p) => p.id === playerId);
  if (state.phase === "lobby")
    return joined && !host
      ? "Waiting for the host to start"
      : "Join your friends, then start the race";
  if (state.phase === "countdown")
    return `READY · ${Math.max(0, Math.ceil(((state.phaseEndsAtTick ?? state.tick) - state.tick) / TICKS_PER_SECOND))}`;
  if (showsRoundResult(state))
    return state.roundWinnerId === playerId
      ? "You win this round"
      : `${roundWinnerName(state) ?? "Nobody"} wins this round`;
  if (state.phase === "matchOver") {
    const winner = matchWinnerName(state);
    // The notice is narrow on a phone: the result alone while its beat lasts, then the short form the smokes wait for.
    if (ready) return `${winner ?? "Shared victory"} · MATCH COMPLETE`;
    if (winner === undefined) return "Shared victory";
    return state.matchWinnerId === playerId
      ? "You win the match"
      : `${winner} wins the match`;
  }
  if (player?.waitingForNextRound) return "You’re in — joining next round";
  if (!player?.alive && joined) return "Eliminated — next round soon";
  return "";
}

function fire(
  state: WorldView,
  player: WorldView["players"][number] | undefined,
  bombHeld: boolean,
): FireView {
  const gunReady =
    !!player?.alive && !!player.gunArmed && state.phase === "playing";
  let label: string | undefined;
  if (player) {
    const remaining = Math.max(0, player.bombReadyAtTick - state.tick);
    label = remaining
      ? `${Math.ceil(remaining / TICKS_PER_SECOND)}s RECHARGE`
      : player.gunArmed
        ? isAimingGun(player)
          ? "STEER TO AIM · RELEASE!"
          : "HOLD TO AIM GUN"
        : player.targetBombArmed
          ? "SLIDE TO AIM"
          : player.shellArmed
            ? "FIRE SHELL"
            : bombHeld
              ? "RELEASE!"
              : "HOLD TO FIRE";
  }
  return {
    gunReady,
    title: gunReady
      ? "Tap to fire Gun, or hold and steer to aim (Space)"
      : "Hold to charge, release to fire (Space)",
    label,
  };
}

const BETWEEN_ROUNDS: readonly RoomPhase[] = [
  "lobby",
  "roundOver",
  "matchOver",
];
const LIVE: readonly RoomPhase[] = ["playing", "countdown"];
const BEFORE_PLAY: readonly RoomPhase[] = ["lobby", "countdown"];

function standings(input: RoomPresenterInput): StandingView[] {
  const { state, host } = input;
  // Cards are ordered by match score (this round's points break ties); the leader is marked once somebody has scored.
  const ranked = [...state.players].sort(
    (a, b) =>
      b.matchScoreUnits - a.matchScoreUnits ||
      b.roundScoreUnits - a.roundScoreUnits,
  );
  const topScore = ranked[0]?.matchScoreUnits ?? 0;
  const removable = BETWEEN_ROUNDS.includes(state.phase);
  return state.players.map((p) => {
    const points = `${scoreText(p.matchScoreUnits)} PTS · +${scoreText(p.roundScoreUnits)}`;
    return {
      id: p.id,
      name: `${p.name}${p.waitingForNextRound ? " · next round" : p.connected ? "" : " · offline"}`,
      points,
      title: `${p.name} · ${points} this round`,
      color: p.color,
      avatarId: p.avatarId,
      out: !p.alive && !BEFORE_PLAY.includes(state.phase),
      rank: ranked.indexOf(p) + 1,
      leader: topScore > 0 && p.matchScoreUnits === topScore,
      lead: topScore > 0 ? String(p.matchScoreUnits / topScore) : "0",
      remove: {
        hidden: !host || !p.id.startsWith(BOT_ID_PREFIX),
        disabled: !removable,
        title: removable
          ? "Remove AI rider"
          : "Remove AI between rounds or return to menu",
        label: `Remove ${p.name}`,
      },
    };
  });
}

/** The room page's frame, as data. */
export function presentRoom(input: RoomPresenterInput): RoomView {
  const { state, playerId, host, solo, displayOnly } = input;
  const player = state.players.find((p) => p.id === playerId);
  const joined = Boolean(player);
  const ready = recapReady(state);
  const clock = roundClock(state);
  const connected = state.players.filter((p) => p.connected).length;
  const fireView = fire(state, player, input.bombHeld);
  return {
    joined,
    recapReady: ready,
    resultsHidden: !ready,
    // Avatars are a lobby choice: before a seat the join form carries it, and the button leaves with the lobby.
    avatarHidden: !joined || state.phase !== "lobby",
    joinPanelHidden: joined || displayOnly,
    controlsHidden: !joined || displayOnly,
    roundClock: clock,
    roundChipHidden: !clock || input.lobbyCard,
    announcerVisible: !input.lobbyCard && !input.joining,
    notice: notice(state, playerId, joined, host, ready),
    lobby: {
      count:
        connected < 2
          ? `${connected === 1 ? "1 rider ready · " : ""}Waiting for at least 2 riders`
          : `${connected} riders ready`,
      empty: state.players.length === 0,
      riders: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        avatarId: p.avatarId,
        status: p.connected ? "READY" : "OFFLINE",
      })),
    },
    standings: standings(input),
    actions: {
      hidden: !host || input.replacedHost,
      start: {
        label: state.phase === "matchOver" ? "REMATCH" : "START RACE",
        // A rematch during the final pause would skip the match result, the recap and the match report that opens with it.
        disabled:
          connected < 2 ||
          !(state.phase === "lobby" || state.phase === "matchOver") ||
          (state.phase === "matchOver" && !ready),
      },
      // BACK TO LOBBY means nothing in the lobby, and the phone lobby has no room for dead buttons.
      reset: { disabled: state.phase === "lobby", hidden: input.phoneLobby },
      // A phone is never the TV; solo has no room to show.
      shareHidden: solo || input.phoneLobby,
      addAIDisabled: state.players.length >= MAX_RIDERS,
    },
    fire: fireView,
    power: {
      hidden: !player || displayOnly || !LIVE.includes(state.phase),
      text: player
        ? powerLabel(
            player.powerPickups,
            player.extraBombs,
            player.grip,
            player.rangeLevel,
          )
        : "",
    },
    targetAim:
      player?.targetBombArmed && !player.gunArmed && !player.shellArmed
        ? { x: player.x / state.width, y: player.y / state.height }
        : undefined,
    playerColor: player?.color,
    // Phone HUD: who you are, what the fire button would do, match points and the clock.
    hudHidden: !player || !input.mobileActive,
    hud: player
      ? {
          fire:
            state.phase === "playing" && player.alive
              ? (fireView.label ?? "")
              : player.alive || state.phase !== "playing"
                ? ""
                : "WIPED OUT",
          wins: `${scoreText(player.matchScoreUnits)} PTS · +${scoreText(player.roundScoreUnits)}`,
          clock,
        }
      : undefined,
  };
}

export interface StatusView {
  /** What the header shows. */
  text: string;
  /** The runtime's full wording, for the tooltip and diagnostics. */
  raw: string;
  tone: StatusTone;
  /** The button beside the status: RETRY, TAKE OVER HOSTING, or none. */
  action: "RETRY" | "TAKE OVER HOSTING" | undefined;
  /** Another tab took hosting over. */
  replaced: boolean;
}

/** The header's link status. Players read three states; the runtime's wording stays in the tooltip. */
export function presentStatus(raw: string): StatusView {
  const plain = plainStatus(raw);
  // A replaced host tab cannot act on the room any more: one button reclaims hosting (a reload re-authenticates).
  const replaced = /replaced/i.test(raw);
  return {
    text: plain.text,
    raw,
    tone: plain.tone,
    action: replaced ? "TAKE OVER HOSTING" : plain.retry ? "RETRY" : undefined,
    replaced,
  };
}
