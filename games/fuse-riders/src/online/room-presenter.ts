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
import type { AvatarId } from "../engine/avatar-id.js";
import { powerLabel } from "../render/power-indicator.js";
import {
  matchWinnerName,
  roundClock,
  roundWinnerName,
  showsRoundResult,
} from "../client/arena-announcer.js";
import { plainStatus, type StatusTone } from "./status-copy.js";
import { fuseGame, type SpectatorView } from "./fuse-game.js";

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
  /** Whether this device may run the room right now: the creator, or the delegate holding it while the creator is away. */
  manages: boolean;
  /** Who runs the room, from the frame. Its row wears the HOST badge on every screen, including the host's own. */
  managerId: string;
  /** Another tab took hosting over: this one's host actions are gone. */
  replacedHost: boolean;
  /** This device opened the room. */
  creator: boolean;
  /**
   * The page that opened the room is here — this one, or a member the service still lists. A manager that is not the
   * creator cannot write its own side switch (the fold would drop the second of the pair), so it hands that one job
   * back to the creator's page; with none here there is nobody left who could write it.
   */
  hostPresent: boolean;
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
  /** The room's watching list, from the frame. Watchers hold no seat, so nothing else here reads them. */
  spectators: readonly SpectatorView[];
  readyPlayers?: readonly string[];
}

export interface LobbyRiderView {
  id: string;
  name: string;
  color: string;
  avatarId: AvatarId;
  status: "READY" | "NOT READY" | "OFFLINE";
  /** This rider runs the room: the row wears the HOST badge. The crown is the round leader's, over in the standings. */
  host: boolean;
  /** On this device's own row: give the seat up and watch instead. */
  switchSide: SwitchView;
}

export interface WatcherView {
  id: string;
  name: string;
  /** `WATCHING` or `OFFLINE`, and on this device's own row what it is here as. */
  status: string;
  /** This watcher runs the room: a host that gave up its seat keeps the badge. */
  host: boolean;
  /** The manager's button for sending this watcher home. */
  remove: RemoveView;
  /** On this device's own row: take one of the room's free seats and ride. */
  switchSide: SwitchView;
}

/**
 * This device's own button for changing sides without leaving the room: WATCH on its rider row, TAKE A SEAT on its
 * watcher row. It is the ordinary join and spectate commands sent again by a member the room already lists, so the
 * reasons it is disabled are the runtime's own refusals, said before the tap rather than after it.
 */
export interface SwitchView {
  hidden: boolean;
  disabled: boolean;
  label: "WATCH" | "TAKE A SEAT";
  /** Tooltip and accessible name: what the button does, or why it cannot right now. */
  title: string;
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
  remove: RemoveView;
}

/** The manager's remove button on a member's row: the same control for an AI rider, a friend and a watcher. */
export interface RemoveView {
  hidden: boolean;
  disabled: boolean;
  title: string;
  label: string;
  /** A human needs asking twice; removing an AI is one tap, as it has always been. */
  confirms: boolean;
}

export interface FireView {
  /** The next shot, in the engine’s Gun → Shell → Five → Triple priority. */
  weapon: "bomb" | "gun" | "shell" | "five" | "triple";
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
  lobby: {
    count: string;
    empty: boolean;
    riders: LobbyRiderView[];
    watchers: WatcherView[];
    /** Nobody is watching, so the WATCHING block is not there at all. */
    watchersHidden: boolean;
  };
  standings: StandingView[];
  actions: {
    hidden: boolean;
    start: { label: "START RACE" | "REMATCH"; disabled: boolean };
    ready: { hidden: boolean; pressed: boolean; label: string };
    reset: { disabled: boolean; hidden: boolean };
    shareHidden: boolean;
    addAIDisabled: boolean;
  };
  fire: FireView;
  power: { hidden: boolean; text: string };
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
  manages: boolean,
  ready: boolean,
  watching: boolean,
): string {
  const player = state.players.find((p) => p.id === playerId);
  if (state.phase === "lobby")
    return watching
      ? "Watching · waiting for the race to start"
      : joined && !manages
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
        : player.shellArmed
          ? "FIRE SHELL"
          : bombHeld
            ? "RELEASE!"
            : "HOLD TO FIRE";
  }
  return {
    weapon: player?.gunArmed
      ? "gun"
      : player?.shellArmed
        ? "shell"
        : player?.fiveShotArmed
          ? "five"
          : player?.tripleShotArmed
            ? "triple"
            : "bomb",
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
  const { state, manages } = input;
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
      // The manager may remove an AI rider or a friend, never itself. Both wait for a pause: outside one a removed
      // rider is only marked absent, and the manager's own presence duties would log it back a moment later.
      remove: removeView({
        hidden: !manages || p.id === input.playerId,
        removable,
        bot: p.id.startsWith(BOT_ID_PREFIX),
        name: p.name,
      }),
    };
  });
}

function removeView(input: {
  hidden: boolean;
  removable: boolean;
  bot: boolean;
  name: string;
}): RemoveView {
  return {
    hidden: input.hidden,
    disabled: !input.removable,
    title: input.removable
      ? input.bot
        ? "Remove AI rider"
        : `Remove ${input.name} from the room`
      : input.bot
        ? "Remove AI between rounds or return to menu"
        : "Remove riders between rounds or return to menu",
    label: input.bot
      ? `Remove ${input.name}`
      : `Remove ${input.name} from the room`,
    confirms: !input.bot,
  };
}

/**
 * The change-sides button on this device's own lobby row. The refusal lines are the runtime's own, so a disabled
 * button and a refused tap say the same thing; the button is simply the one that says it first.
 */
function switchView(input: {
  own: boolean;
  /** Towards a seat (a watcher's TAKE A SEAT) rather than towards the watching list (a rider's WATCH). */
  toSeat: boolean;
  solo: boolean;
  displayOnly: boolean;
  phase: RoomPhase;
  /** This device runs the room, did not open it, and has no creator's page to hand the pair to (`switchWriter`). */
  standIn: boolean;
  /** The side being moved to has no room left. */
  full: boolean;
}): SwitchView {
  const text = fuseGame.text;
  const reason = !BETWEEN_ROUNDS.includes(input.phase)
    ? input.toSeat
      ? text.takeSeatInRound
      : text.watchInRound
    : input.standIn
      ? text.switchAsStandIn
      : input.full
        ? input.toSeat
          ? text.full
          : text.watchersFull
        : undefined;
  return {
    // Solo is one device and four AI, and a display is not a member: neither has a side to change.
    hidden: !input.own || input.solo || input.displayOnly,
    disabled: reason !== undefined,
    label: input.toSeat ? "TAKE A SEAT" : "WATCH",
    title:
      reason ??
      (input.toSeat
        ? "Take a seat and ride the next round"
        : "Give your seat up and watch instead"),
  };
}

/** The room page's frame, as data. */
export function presentRoom(input: RoomPresenterInput): RoomView {
  const { state, playerId, managerId, solo, displayOnly } = input;
  // A tab another one replaced as host cannot act on the room any more, whatever the fold still says it manages.
  const manages = input.manages && !input.replacedHost;
  const player = state.players.find((p) => p.id === playerId);
  const joined = Boolean(player);
  const watching = input.spectators.some((seat) => seat.id === playerId);
  const ready = recapReady(state);
  const clock = roundClock(state);
  const connected = state.players.filter((p) => p.connected).length;
  const watchingCount = input.spectators.filter(
    (seat) => seat.connected,
  ).length;
  const fireView = fire(state, player, input.bombHeld);
  // What each side has room for, read the way the runtime reads it: a seat can be reclaimed from a rider the room
  // lists absent (`claimSlot`), and the watching list counts everyone on it, here or not (`spectate`).
  const seatsFull =
    state.players.length >= MAX_RIDERS &&
    state.players.every((p) => p.connected);
  const watchingFull = input.spectators.length >= fuseGame.seating.maxWatchers;
  // A shared screen's first rider manages the room for as long as it lasts, and switches sides perfectly well: the
  // creator's own page writes the pair for it. Only a room whose creator's page has gone has nobody who can.
  const standIn = manages && !input.creator && !input.hostPresent;
  const side = { solo, displayOnly, phase: state.phase, standIn };
  return {
    joined,
    recapReady: ready,
    resultsHidden: !ready,
    // A lobby choice, and one this rider has not finished making: the head and colour buttons leave with the lobby,
    // and they leave the moment this rider says READY. READY is what settles an identity for the round — after it the
    // room is only waiting on everyone else, and a rider still recolouring is a rider not yet ready. Un-readying
    // brings both back, so this is a gate rather than a one-way door.
    avatarHidden:
      !joined ||
      state.phase !== "lobby" ||
      (input.readyPlayers?.includes(input.playerId) ?? false),
    joinPanelHidden: joined || watching || displayOnly,
    controlsHidden: !joined || displayOnly,
    roundClock: clock,
    roundChipHidden: !clock || input.lobbyCard,
    announcerVisible: !input.lobbyCard && !input.joining,
    notice:
      !solo && joined && state.phase === "lobby"
        ? "Ready up — the race starts when everyone is ready"
        : notice(state, playerId, joined, manages, ready, watching),
    lobby: {
      // The watchers go beside the riders, before the call for more: "1 rider · 1 watching · Waiting for at least 2 riders".
      count: [
        ...(connected >= 2
          ? [`${connected} riders`]
          : connected === 1
            ? ["1 rider"]
            : []),
        ...(watchingCount ? [`${watchingCount} watching`] : []),
        ...(connected < 2 ? ["Waiting for at least 2 riders"] : []),
      ].join(" · "),
      empty: state.players.length === 0,
      riders: state.players.map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        avatarId: p.avatarId,
        status: !p.connected
          ? "OFFLINE"
          : solo ||
              p.id.startsWith(BOT_ID_PREFIX) ||
              input.readyPlayers?.includes(p.id)
            ? "READY"
            : "NOT READY",
        host: p.id === managerId,
        // An AI rider has no device to watch from: only this device's own row carries the button.
        switchSide: switchView({
          ...side,
          own: p.id === playerId,
          toSeat: false,
          full: watchingFull,
        }),
      })),
      watchers: input.spectators.map((seat) => ({
        id: seat.id,
        name: seat.name,
        // The badge says who runs the room; the status still says whose row this is and whether it is still here.
        status: `${seat.id === playerId ? "YOU · " : ""}${seat.connected ? "WATCHING" : "OFFLINE"}`,
        host: seat.id === managerId,
        // A watcher holds no seat and no simulation state, so it can be sent home in any phase.
        remove: removeView({
          hidden: !manages || seat.id === playerId,
          removable: true,
          bot: false,
          name: seat.name,
        }),
        switchSide: switchView({
          ...side,
          own: seat.id === playerId,
          toSeat: true,
          full: seatsFull,
        }),
      })),
      watchersHidden: input.spectators.length === 0,
    },
    standings: standings({ ...input, manages }),
    actions: {
      hidden: (!manages && (!joined || solo)) || input.replacedHost,
      ready: {
        hidden:
          solo || !joined || displayOnly || !(state.phase === "lobby" || ready),
        pressed: input.readyPlayers?.includes(playerId) ?? false,
        label: input.readyPlayers?.includes(playerId)
          ? "NOT READY"
          : state.phase === "matchOver"
            ? "READY FOR REMATCH"
            : "READY",
      },
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
