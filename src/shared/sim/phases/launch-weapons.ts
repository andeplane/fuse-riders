import type { TickContext, TickFact } from "../context.js";
import {
  type AimPoint,
  type BombActionCommand,
  type BombState,
  type FlightPoint,
  type GameState,
  type PlayerState,
  sortedBombs,
} from "../../state.js";
import {
  BOMB_FLIGHT_TICKS,
  bombLandingPoint,
  bombLaunchDistance,
} from "../../bomb-launch.js";
import { GUN_TRACER_TICKS } from "../../gun.js";
import {
  type LaunchBounds,
  bombsPerShot,
  createVolleyFlightPaths,
  volleyAngles,
} from "../../launch-modifiers.js";
import { RIDER_RADIUS, bombFuseTicks } from "../../tuning.js";
import { SHELL_SPEED } from "../../shell.js";
import type { Weapon } from "../../shot-log.js";
import { cos, sin } from "../../deterministic-math.js";
import { edgesOpen } from "../../arena-map.js";
import { powerBlastRadius, powerReloadTicks } from "../../power-progression.js";
import { wrapCoordinate } from "../../wrap.js";

/**
 * Every living rider's bomb commands for the tick — press, release, cancel — run against the board as it was just
 * committed, in seat order: charging, aiming a Target Bomb, and launching whatever the rider has armed.
 */
export function launchWeapons(ctx: TickContext): void {
  const { state, inputs, movements } = ctx;
  // Target every launch against the same committed tick, independent of player slot.
  for (const movement of movements.values()) {
    if (movement.player.alive) {
      const input = inputs.get(movement.player.id);
      applyBombActions(ctx, movement.player, input?.bombCommands ?? []);
      if (
        movement.player.targetBombArmed &&
        !movement.player.shellArmed &&
        !movement.player.gunArmed &&
        movement.player.bombChargeStartedTick !== undefined
      )
        movement.player.bombTarget = targetPoint(
          state,
          movement.player,
          input?.aim,
          movement.player.bombTarget,
        );
    }
  }
}

function targetPoint(
  state: GameState,
  player: PlayerState,
  aim?: AimPoint,
  previous?: AimPoint,
): AimPoint {
  const x = aim
    ? aim.x * state.width
    : (previous?.x ?? player.x + cos(player.angle) * 100);
  const y = aim
    ? aim.y * state.height
    : (previous?.y ?? player.y + sin(player.angle) * 100);
  return {
    x: Math.max(
      state.boundaryInset + RIDER_RADIUS,
      Math.min(state.width - state.boundaryInset - RIDER_RADIUS, x),
    ),
    y: Math.max(
      state.boundaryInset + RIDER_RADIUS,
      Math.min(state.height - state.boundaryInset - RIDER_RADIUS, y),
    ),
  };
}

function applyBombActions(
  { state, events, facts }: TickContext,
  player: PlayerState,
  actions: readonly BombActionCommand[],
): void {
  for (const command of actions) {
    const { action } = command;
    if (action === "cancel") {
      player.bombChargeStartedTick = undefined;
      player.bombTarget = undefined;
      continue;
    }
    if (action === "press") {
      const ownsBomb = sortedBombs(state).some(
        (bomb) => bomb.ownerId === player.id && !bomb.shell,
      );
      if (
        player.bombChargeStartedTick === undefined &&
        !ownsBomb &&
        player.bombReadyAtTick <= state.tick
      ) {
        player.bombChargeStartedTick = state.tick;
        if (player.targetBombArmed && !player.shellArmed && !player.gunArmed)
          player.bombTarget = targetPoint(state, player, command.aim);
      }
      // Guns consume the press immediately. Release/cancel cannot fire a second shot.
      if (!player.gunArmed) continue;
    }

    const target = player.targetBombArmed
      ? targetPoint(state, player, command.aim, player.bombTarget)
      : undefined;
    const chargeStartedTick = player.bombChargeStartedTick;
    player.bombChargeStartedTick = undefined;
    player.bombTarget = undefined;
    if (chargeStartedTick === undefined) continue;
    const ownsBomb = sortedBombs(state).some(
      (bomb) => bomb.ownerId === player.id && !bomb.shell,
    );
    if (ownsBomb || player.bombReadyAtTick > state.tick) continue;
    if (player.shellArmed || player.gunArmed) {
      const gun = player.gunArmed === true;
      const weapon: Weapon = gun ? "gun" : "shell";
      const deadline = gun
        ? state.tick + GUN_TRACER_TICKS
        : Number.MAX_SAFE_INTEGER;
      const speed = gun ? 1 : SHELL_SPEED;
      // Triple, Five and Extra Bomb fan the projectile out exactly as they fan a lob; the pull spends Triple and Five.
      const angles = volleyAngles(player.angle, bombsPerShot(player));
      const shot = state.nextBombId;
      facts.push(shotFired(state, player, shot, weapon, angles.length));
      for (const angle of angles) {
        const id = state.nextBombId++;
        state.bombs.set(id, {
          id,
          ownerId: player.id,
          launchX: player.x,
          launchY: player.y,
          x: player.x,
          y: player.y,
          launchedTick: state.tick,
          placedTick: state.tick,
          landsAtTick: deadline,
          explodeAtTick: deadline,
          blastRange: 0,
          flightPath: [],
          shot,
          shell: {
            vx: cos(angle) * speed,
            vy: sin(angle) * speed,
            ...(gun ? { gun: true } : {}),
          },
        });
        facts.push({ kind: "bombPlaced", playerId: player.id });
        events.push({
          type: "bombPlaced",
          bombId: id,
          playerId: player.id,
          ...(gun ? { gun: true } : {}),
        });
      }
      if (gun) player.gunArmed = false;
      else player.shellArmed = false;
      player.tripleShotArmed = false;
      player.fiveShotArmed = false;
      player.reloadDurationTicks = powerReloadTicks(player.powerPickups);
      player.bombReadyAtTick = state.tick + player.reloadDurationTicks;
      continue;
    }
    const distance = bombLaunchDistance(
      state.tick - chargeStartedTick,
      state.settings?.bombChargeTicks,
      state.settings?.aimBounce ?? false,
    );
    // Over open edges a lob is never cut short: it flies on past the edge and comes down on the far side.
    const open = edgesOpen(state);
    const bounds: LaunchBounds = open
      ? {
          minX: -state.width,
          maxX: 2 * state.width,
          minY: -state.height,
          maxY: 2 * state.height,
        }
      : {
          minX: state.boundaryInset + RIDER_RADIUS,
          maxX: state.width - state.boundaryInset - RIDER_RADIUS,
          minY: state.boundaryInset + RIDER_RADIUS,
          maxY: state.height - state.boundaryInset - RIDER_RADIUS,
        };
    // Read before the release below disarms them, so the launch can still say which weapon it spent. Extra Bomb is
    // not one of them: it is a round-long upgrade that widens every shot, like Power, not a weapon a pull consumes.
    const volley: Weapon | undefined = player.fiveShotArmed
      ? "five"
      : player.tripleShotArmed
        ? "triple"
        : undefined;
    const paths = target
      ? [[{ ...target, angle: player.angle }]]
      : bombsPerShot(player) > 1
        ? createVolleyFlightPaths(
            player,
            player.angle,
            distance,
            bounds,
            bombsPerShot(player),
          )
        : [
            createStraightFlightPath(
              player.x,
              player.y,
              player.angle,
              distance,
              bounds,
            ),
          ];
    if (target) player.targetBombArmed = false;
    else {
      player.tripleShotArmed = false;
      player.fiveShotArmed = false;
    }
    /**
     * One label for the whole trigger pull. Gun and Shell never reach here — they launch in the branch above, which
     * is why they outrank everything (a Triple or Five they fan out is spent under their label), and why a rider
     * holding Target as well keeps it armed for the next pull.
     * Among the launches that do reach here, Target comes first, because it is the only one the others cannot combine with.
     */
    const weapon: Weapon = target ? "target" : (volley ?? "bomb");
    // Every bomb of the pull names the same shot: the id its first bomb is about to take.
    const shot = state.nextBombId;
    facts.push(shotFired(state, player, shot, weapon, paths.length));
    for (const flightPath of paths) {
      const landing = flightPath[flightPath.length - 1]!;
      const bomb: BombState = {
        id: state.nextBombId++,
        ownerId: player.id,
        launchX: player.x,
        launchY: player.y,
        // The flight path stays unwrapped, so it is still one straight throw to whoever draws it.
        x: open ? wrapCoordinate(landing.x, state.width) : landing.x,
        y: open ? wrapCoordinate(landing.y, state.height) : landing.y,
        placedTick: state.tick,
        launchedTick: state.tick,
        landsAtTick: target ? state.tick : state.tick + BOMB_FLIGHT_TICKS,
        explodeAtTick: target
          ? state.tick
          : state.tick + bombFuseTicks(player.fuseLevel),
        blastRange: powerBlastRadius(player.powerPickups) * (target ? 0.7 : 1),
        flightPath,
        shot,
      };
      state.bombs.set(bomb.id, bomb);
      facts.push({ kind: "bombPlaced", playerId: player.id });
      events.push({ type: "bombPlaced", bombId: bomb.id, playerId: player.id });
    }
    player.reloadDurationTicks = powerReloadTicks(player.powerPickups);
    player.bombReadyAtTick = state.tick + player.reloadDurationTicks;
  }
}

function createStraightFlightPath(
  x: number,
  y: number,
  angle: number,
  distance: number,
  bounds: LaunchBounds,
): FlightPoint[] {
  const landing = bombLandingPoint(x, y, angle, distance, {
    left: bounds.minX,
    right: bounds.maxX,
    top: bounds.minY,
    bottom: bounds.maxY,
  });
  return Array.from({ length: BOMB_FLIGHT_TICKS + 1 }, (_, step) => ({
    x: x + ((landing.x - x) * step) / BOMB_FLIGHT_TICKS,
    y: y + ((landing.y - y) * step) / BOMB_FLIGHT_TICKS,
    angle,
  }));
}

/** The pull as the shot log will hold it: the shooter's round-long upgrades are read now, at the moment of the pull. */
function shotFired(
  state: GameState,
  shooter: PlayerState,
  shot: number,
  weapon: Weapon,
  bombs: number,
): TickFact {
  return {
    kind: "shotFired",
    shot: {
      shot,
      shooterId: shooter.id,
      weapon,
      elapsed: state.tick - (state.roundStartedTick ?? state.tick),
      bombs,
      power: shooter.powerPickups,
      extraBombs: shooter.extraBombs,
      fuseLevel: shooter.fuseLevel,
      grip: shooter.grip,
      kills: [],
    },
  };
}
