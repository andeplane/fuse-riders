import {
  BotController,
  botDisplayName,
  type BotDifficulty,
} from "../../src/engine/bot-controller.js";
import {
  applyTick,
  BOT_NAMES,
  createRoomState,
  freeSlot,
  type RoomState,
} from "../../src/engine/apply-tick.ts";
import {
  ACTION,
  AIM,
  BOT,
  CANCEL,
  JOIN,
  LEAVE,
  PRESENCE,
  PRESS,
  RELEASE,
  STEER,
  SETTINGS,
  quantizeAim,
  type Entry,
} from "../../src/engine/input-log.ts";
import {
  defaultRoomSettings,
  type RoomSettings,
} from "../../src/engine/room-settings.js";
import {
  AIM_SLOW_MAX_TICKS,
  OVERTIME_START_TICK,
  TICK_HZ,
  riderMotionStep,
  type GameState,
  type PlayerState,
} from "../../src/engine/game.js";
import {
  edgesOpen,
  segmentObstacleDistanceSquared,
} from "../../src/engine/arena-map.js";
import { GUN_RADIUS } from "../../src/engine/gun.js";
import { SHELL_SPEED } from "../../src/engine/shell.js";
import type { GameEvent } from "../../src/shared/protocol.js";
import {
  coverageObserver,
  emptyCoverage,
  isObstacleMap,
  unmet,
  type Requirement,
} from "./replay-coverage.js";
import { streamReader, type Recording } from "./replay-log.js";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

/** Three rounds: one to leave in, one played a rider short, one with a bot in the empty seat. */
const ROSTER_MATCH_LENGTH = 3;
const MATCH_LENGTH = 2;
/** How long a scripted human holds a gun for a clean line before it fires the way a bot does. */
const GUN_PATIENCE_TICKS = 160;
/** How long a wrap duel is ridden inside its overtime walls before a rider is given to them. */
const WALLED_TICKS = 40;
/** Longer than the aiming slowdown's whole budget. */
const LONG_HOLD_TICKS = AIM_SLOW_MAX_TICKS + 6;
const GUN_SIGHT = 600;
const SHELL_SIGHT = 320;
/** A round this old has tired thumbs: the wandering grows with the square of its age in these. */
const TIRING_TICKS = 120;

/** What the room is asked for while `wanted` is still to be reached: ordinary settings, and nothing else. */
function settingsFor(wanted: readonly Requirement[]): RoomSettings {
  const focus = wanted[0];
  const stage = focus?.stage ?? "play";
  const weights: RoomSettings["weights"] = {};
  // What drops is whatever is still waited for, in proportion to how much is waiting on it.
  if (stage === "play")
    for (const entry of wanted)
      for (const pickup of entry.pickups)
        weights[pickup] = (weights[pickup] ?? 0) + 1;
  return {
    ...defaultRoomSettings(),
    length:
      stage === "roster"
        ? ROSTER_MATCH_LENGTH
        : stage === "play"
          ? MATCH_LENGTH
          : 1,
    map:
      focus?.map ??
      wanted.find((entry) => entry.map && entry.stage === stage)?.map ??
      "rotate",
    // A duel is two riders and nothing else on the board.
    ...(stage !== "play" && stage !== "roster" ? { weights } : {}),
    ...(Object.keys(weights).length ? { weights } : {}),
  };
}

/**
 * A rival that a projectile leaving along the barrel `delay` ticks from now, at `speed` units a tick, would meet:
 * the rival is led by the time the projectile takes to reach it, as if it rode straight on.
 */
function linedUp(
  game: Readonly<GameState>,
  player: PlayerState,
  speed: number,
  delay: number,
  reach: number,
  tolerance: number,
): boolean {
  const headingX = Math.cos(player.angle),
    headingY = Math.sin(player.angle);
  const pace = (rider: PlayerState): number =>
    riderMotionStep(rider, game.tick, game.roundStartedTick).distance;
  const fromX = player.x + headingX * pace(player) * delay,
    fromY = player.y + headingY * pace(player) * delay;
  return [...game.players.values()].some((rival) => {
    if (rival.id === player.id || !rival.alive) return false;
    const gap = Math.hypot(rival.x - fromX, rival.y - fromY);
    const lead = delay + gap / speed;
    const toX = rival.x + Math.cos(rival.angle) * pace(rival) * lead - fromX,
      toY = rival.y + Math.sin(rival.angle) * pace(rival) * lead - fromY;
    const along = toX * headingX + toY * headingY;
    return (
      along > 30 &&
      along < reach &&
      Math.abs(toX * headingY - toY * headingX) < tolerance
    );
  });
}
/**
 * Scenery standing in the line of the barrel, with more of it behind under a higher id: the shot whose stopping
 * point depends on the order the obstacles are read in.
 */
function gunFacesScenery(
  game: Readonly<GameState>,
  player: PlayerState,
): boolean {
  const headingX = Math.cos(player.angle),
    headingY = Math.sin(player.angle);
  const reach = game.width + game.height;
  const inLine = game.obstacles
    .filter(
      (obstacle) =>
        segmentObstacleDistanceSquared(
          obstacle,
          player.x,
          player.y,
          player.x + headingX * reach,
          player.y + headingY * reach,
        ) <=
        GUN_RADIUS * GUN_RADIUS,
    )
    .sort(
      (a, b) => (a.x - b.x) * headingX + (a.y - b.y) * headingY || a.id - b.id,
    );
  const nearest = inLine[0];
  return (
    nearest !== undefined &&
    Math.hypot(nearest.x - player.x, nearest.y - player.y) < GUN_SIGHT &&
    inLine.some((obstacle) => obstacle.id > nearest.id)
  );
}

interface Hand {
  gesture: number;
  latest: number;
  flags: number;
  wanderUntil: number;
  wander: number;
  restlessness: number;
  steadyUntil: number;
  joustAfter: number;
  armedSince?: number;
}
const hand = (restlessness: number): Hand => ({
  gesture: 0,
  latest: 0,
  flags: 0,
  wanderUntil: 0,
  wander: 0,
  restlessness,
  steadyUntil: 0,
  joustAfter: 0,
});

/**
 * Seeded recording: two scripted humans and three AI riders of three strengths.
 *
 * The humans are flown by the bots' own planner, read from the state a player would be looking at, and everything
 * they do reaches the room as the log entries a device would send: steering flags, aim, press, release and cancel.
 * On top of that come the things only a human stream does — a wandering thumb, a cancelled charge, a second press
 * over a held one — and the things only a human decides: holding a gun for a clean line, putting a bullet into a
 * rock, sitting out a duel until the walls come in, riding across the other rider's bows.
 *
 * With `coverMechanics` the creator also directs the room, through ordinary settings, start, rematch, lobby, bot and
 * roster entries, until every requirement in `REQUIREMENTS` has been seen in play: five riders first, then a match the
 * second human walks out of, then duels with the bots sent home, where a round can afford to run into overtime.
 * Nothing here writes simulation state.
 */
export function makeRecording(
  seed: number,
  ticks: number,
  coverMechanics = false,
  /** For whoever is tuning the recorder: every tick's outcome, and the requirements it met. */
  report?: (
    state: Readonly<RoomState>,
    events: readonly GameEvent[],
    met: readonly string[],
  ) => void,
): Recording {
  const random = mulberry32(seed),
    creator = "creator",
    rider = "rider";
  const entries: Record<string, Entry[]> = { creator: [], rider: [] };
  const seqs: Record<string, number> = { creator: 0, rider: 0 };
  let tick = 0;
  const log = (member: string, ...body: unknown[]) => {
    entries[member]!.push([++seqs[member]!, tick, ...body] as Entry);
  };
  const state = createRoomState("replay", defaultRoomSettings()),
    bots = new BotController(),
    planner = new BotController();
  const hands: Record<string, Hand> = {
    creator: hand(0.004),
    rider: hand(0.012),
  };
  const coverage = emptyCoverage();
  const observe = coverageObserver(coverage);
  const streams = streamReader(entries);
  let logged = "";
  let matches = 0;
  /** The roster script: the rider leaves, a bot takes the seat, the rider takes it back. */
  let roster: "idle" | "leaving" | "left" | "filled" | "done" = "idle";
  let blinkUntil = 0;
  const fillIn = "bot:4";
  /**
   * Three strengths of AI. The full-strength rider plans 32 ticks ahead, which is most of what a replayed tick costs,
   * so it rides the opening match only and a second medium rider has its seat after that.
   */
  let strongest: BotDifficulty | undefined;
  const seatBot = (id: string, slot: number, tier?: BotDifficulty): void =>
    log(creator, BOT, "add", id, botDisplayName(BOT_NAMES[slot]!, tier), slot);
  const seatBots = (): void => {
    const slot = freeSlot(state.game);
    ([strongest, "medium", "easy"] as const).forEach((tier, index) =>
      seatBot(`bot:${index + 1}`, slot + index, tier),
    );
  };

  const fly = (member: string, stage: Requirement["stage"]): void => {
    const game = state.game,
      held = hands[member]!,
      player = game.players.get(member);
    if (game.phase !== "playing") {
      // Every round boundary and room action drops held gestures in the fold, so the hand lets go as well.
      held.gesture = 0;
      held.armedSince = undefined;
      return;
    }
    if (!player?.alive || !player.connected || !state.folds.has(member)) return;
    // Sitting a duel out means riding for room, not for the other rider: the planner is shown a board whose only
    // living rider is this one, and still sees every trail on it.
    const intent = planner.input(
      stage === "duel"
        ? {
            ...game,
            players: new Map(
              [...game.players].map(([id, seated]) => [
                id,
                id === member ? seated : { ...seated, alive: false },
              ]),
            ),
          }
        : game,
      member,
    );
    const elapsed = game.tick - (game.roundStartedTick ?? game.tick);
    let flags = (intent.left ? 1 : 0) | (intent.right ? 2 : 0);
    const rival = game.players.get(member === creator ? rider : creator);
    // A head that meets the trail behind another head dies by `trail`, which outranks `rider`, so riding straight at
    // each other mostly ends on the trail. The joust is ridden as a broadside instead: the creator holds a straight
    // line and the second rider steers for where the creator's head is going to be, which brings it in across the
    // bows with both trails behind the meeting. Each one sets off at a moment of its own, so a miss is not repeated.
    if (elapsed === 0) held.joustAfter = Math.floor(random() * 30);
    if (stage === "joust" && rival?.alive && elapsed >= held.joustAfter) {
      if (member === creator) flags = 0;
      else {
        const pace = riderMotionStep(
          rival,
          game.tick,
          game.roundStartedTick,
        ).distance;
        const lead =
          Math.hypot(rival.x - player.x, rival.y - player.y) / (2 * pace);
        const bearing = Math.atan2(
          rival.y + Math.sin(rival.angle) * pace * lead - player.y,
          rival.x + Math.cos(rival.angle) * pace * lead - player.x,
        );
        const off = Math.atan2(
          Math.sin(bearing - player.angle),
          Math.cos(bearing - player.angle),
        );
        flags = off > 0.02 ? 2 : off < -0.02 ? 1 : 0;
      }
    } else if (tick < held.wanderUntil) flags = held.wander;
    else if (
      // A duel is sat out with a steady hand; any other round tires the thumbs as it ages.
      stage !== "duel" &&
      random() < held.restlessness * (1 + (elapsed / TIRING_TICKS) ** 2)
    ) {
      held.wanderUntil = tick + 2 + Math.floor(random() * 6);
      held.wander = Math.floor(random() * 4);
      flags = held.wander;
    }
    // Two planners on an empty board mirror each other move for move, down to dying on the same tick. The second
    // rider opens every duel with a turn of its own length, and the symmetry never forms.
    if (stage === "duel" && member === rider && elapsed < held.joustAfter)
      flags = 2;
    held.armedSince =
      player.gunArmed || player.shellArmed
        ? (held.armedSince ?? tick)
        : undefined;
    let press = intent.bombCommands?.some(({ action }) => action === "press");
    const release = intent.bombCommands?.some(
      ({ action }) => action === "release",
    );
    if (
      (player.gunArmed || player.shellArmed) &&
      game.tick >= player.bombReadyAtTick &&
      !held.gesture
    ) {
      // Both leave on the release, a tick after the press: a bullet along its held sight, a shell along the heading.
      const lined = player.gunArmed
        ? linedUp(game, player, Infinity, 1, GUN_SIGHT, 8) ||
          (isObstacleMap(game.map) &&
            coverage.gunScreenedStops === 0 &&
            gunFacesScenery(game, player))
        : linedUp(game, player, SHELL_SPEED / TICK_HZ, 2, SHELL_SIGHT, 14);
      press = lined || (press && tick - held.armedSince! > GUN_PATIENCE_TICKS);
      // Either leaves along the heading the tick ends on, so the shot is taken with the wheel straight.
      if (lined) held.steadyUntil = tick + (player.gunArmed ? 1 : 3);
    }
    if (tick < held.steadyUntil) flags = 0;
    // A Star is for riding at the wall with: straight on until it turns the rider back.
    if (
      coverage.immuneBounces === 0 &&
      !edgesOpen(game) &&
      player.invulnerableUntilTick - game.tick > 10
    )
      flags = 0;
    // A duel is sat out, all the way into overtime, and a joust needs no bombs.
    if (stage === "joust" || stage === "duel") press = false;
    // Once a wrap duel has walls, the second rider stops dodging them: that is the death the walls are there for.
    if (
      stage === "duel" &&
      member === rider &&
      game.map === "wrap" &&
      elapsed > OVERTIME_START_TICK + WALLED_TICKS
    )
      flags = 0;
    if (flags !== held.flags) {
      held.flags = flags;
      log(member, STEER, flags);
    }
    if (random() < 0.02)
      log(
        member,
        AIM,
        Math.floor(random() * 65536),
        Math.floor(random() * 65536),
      );
    const ownsBomb = [...game.bombs.values()].some(
      (bomb) => bomb.ownerId === member && !bomb.shell,
    );
    if (held.gesture && player.bombChargeStartedTick === undefined) {
      // The press found no bomb to charge, or the gun took it outright: the thumb comes off.
      log(member, CANCEL, held.gesture);
      held.gesture = 0;
    } else if (
      held.gesture &&
      release &&
      member === rider &&
      coverage.aimSpentTicks === 0 &&
      game.tick - (player.bombChargeStartedTick ?? game.tick) < LONG_HOLD_TICKS
    ) {
      // The bots never hold a charge past its reach. Until the aiming slowdown has run out of budget once, the second
      // rider keeps its thumb down well past that, and lets the aim walk back and forth.
    } else if (held.gesture && release) {
      log(
        member,
        RELEASE,
        held.gesture,
        ...(intent.aim ? quantizeAim(intent.aim) : []),
      );
      held.gesture = 0;
    } else if (held.gesture && random() < 0.02) {
      log(member, CANCEL, held.gesture);
      held.gesture = 0;
    } else if (held.gesture && random() < 0.02) {
      // A second press over a held one: the fold cancels the charge and starts another.
      held.gesture = ++held.latest;
      log(member, PRESS, held.gesture);
    } else if (!held.gesture && press && !ownsBomb) {
      if (intent.aim) log(member, AIM, ...quantizeAim(intent.aim));
      held.gesture = ++held.latest;
      log(member, PRESS, held.gesture);
    }
  };

  const settle = (wanted: readonly Requirement[]): void => {
    const settings = JSON.stringify(settingsFor(wanted));
    if (settings === logged) return;
    logged = settings;
    log(creator, SETTINGS, JSON.parse(settings));
  };

  const direct = (wanted: readonly Requirement[]): "stop" | undefined => {
    const game = state.game;
    const over =
      game.phase === "matchOver" && game.tick >= (game.phaseEndsAtTick ?? 0);
    if (!wanted.length) {
      // Whatever is in play is played out, so the recording ends on a decided match rather than mid-air.
      return game.phase === "matchOver" || game.phase === "lobby"
        ? "stop"
        : undefined;
    }
    const elapsed = game.tick - (game.roundStartedTick ?? game.tick);
    if (game.phase === "playing" && wanted[0]!.stage === "play") {
      // A connection that drops and comes back within the round: absent, then present, under the same stream.
      if (
        coverage.reconnections === 0 &&
        !blinkUntil &&
        matches > 0 &&
        elapsed === 50 &&
        game.players.get(rider)?.alive
      ) {
        log(creator, PRESENCE, rider, false, 1);
        blinkUntil = tick + 25;
      }
      // Walking out of a round in play, bombs in the air and all.
      if (coverage.abandonedRounds === 0 && matches > 1 && elapsed === 150) {
        log(creator, ACTION, "lobby", `abandon-${seed}-${++matches}`);
        settle(wanted);
        log(creator, ACTION, "start", `coverage-${seed}-${matches}`);
        return;
      }
    }
    if (blinkUntil && tick === blinkUntil) {
      log(creator, PRESENCE, rider, true, 1);
      hands[rider]!.flags = 0;
      hands[rider]!.gesture = 0;
    }
    if (
      roster === "leaving" &&
      game.phase === "playing" &&
      game.round === 1 &&
      elapsed === 40
    ) {
      log(creator, LEAVE, rider);
      roster = "left";
    }
    if (
      roster === "left" &&
      !game.players.has(rider) &&
      game.players.size === 4
    ) {
      seatBot(fillIn, freeSlot(game), "easy");
      roster = "filled";
    }
    // Settings asked for mid-match reach the next round; a finished match waits for its recap to run out.
    if (game.phase !== "matchOver") settle(wanted);
    if (!over) return;
    if (roster === "filled") {
      log(creator, BOT, "remove", fillIn);
      log(creator, JOIN, rider, "Rider", 1, "fox", 1);
      hands[rider]!.flags = 0;
      hands[rider]!.gesture = 0;
      roster = "done";
      // The seat is taken back on this very tick, so what is asked for next no longer includes it.
      wanted = wanted.filter((entry) => entry.stage !== "roster");
      if (!wanted.length) return;
    }
    const stage = wanted[0]!.stage;
    if (stage === "roster" && roster === "idle") roster = "leaving";
    const dueling = stage !== "play" && stage !== "roster";
    matches++;
    const swap = !dueling && !strongest && state.bots.size > 0;
    if (dueling === (state.bots.size === 0) && matches % 2 && !swap) {
      settle(wanted);
      log(creator, ACTION, "rematch", `coverage-${seed}-${matches}`);
      return;
    }
    // The other way out of a finished match is by way of the lobby, which is also where bots come and go.
    log(creator, ACTION, "lobby", `lobby-${seed}-${matches}`);
    if (dueling)
      for (const id of [...state.bots].sort()) log(creator, BOT, "remove", id);
    else if (swap) {
      const seat = game.players.get("bot:1")!.slot;
      strongest = "medium";
      log(creator, BOT, "remove", "bot:1");
      seatBot("bot:1", seat, strongest);
    } else if (state.bots.size === 0) seatBots();
    settle(wanted);
    log(creator, ACTION, "start", `coverage-${seed}-${matches}`);
  };

  for (tick = 1; tick <= ticks; tick++) {
    const wanted = coverMechanics ? unmet(coverage) : [];
    if (tick === 1) {
      log(creator, JOIN, creator, "Creator", 0, "robot", 1);
      log(creator, JOIN, rider, "Rider", 1, "fox", 1);
    }
    if (tick === 2) seatBots();
    if (tick === 3) {
      if (coverMechanics) settle(wanted);
      log(creator, ACTION, "start", `match-${tick}`);
    }
    if (coverMechanics && tick > 3) {
      if (direct(wanted) === "stop")
        return { matchId: "replay", creator, ticks: tick - 1, entries };
    } else if (
      state.game.phase === "matchOver" &&
      state.game.tick >= (state.game.phaseEndsAtTick ?? 0)
    )
      log(creator, ACTION, "rematch", `match-${tick}`);
    const stage = wanted[0]?.stage ?? "play";
    fly(creator, stage);
    fly(rider, stage);
    const after = observe(state);
    const events = applyTick(state, creator, streams(tick), bots);
    after(events);
    if (report) {
      const left = unmet(coverage).map((entry) => entry.key);
      report(
        state,
        events,
        wanted.map((entry) => entry.key).filter((key) => !left.includes(key)),
      );
    }
  }
  if (coverMechanics)
    throw Object.assign(
      new Error(
        `Coverage incomplete at ${ticks} ticks: ${unmet(coverage)
          .map((entry) => entry.key)
          .join(", ")}`,
      ),
      { recording: { matchId: "replay", creator, ticks, entries } },
    );
  return { matchId: "replay", creator, ticks, entries };
}
