import type { TickContext, TickFact } from "../context.js";
import {
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
import {
  type LaunchBounds,
  bombsPerShot,
  createVolleyFlightPaths,
  volleyAngles,
} from "../../launch-modifiers.js";
import { RIDER_RADIUS, bombFuseTicks } from "../../tuning.js";
import type { Weapon } from "../../shot-log.js";
import { edgesOpen } from "../../arena-map.js";
import { powerBlastRadius, powerReloadTicks } from "../../power-progression.js";
import { wrapCoordinate } from "../../wrap.js";
import {
  WEAPONS,
  armedProjectile,
  pullLabel,
  spendPull,
} from "../../weapons.js";

/**
 * Every living rider's bomb commands for the tick — press, release, cancel — run against the board as it was just
 * committed, in seat order: charging and launching whatever the rider has armed.
 */
export function launchWeapons(ctx: TickContext): void {
  const { inputs, movements } = ctx;
  // Target every launch against the same committed tick, independent of player slot.
  for (const movement of movements.values()) {
    if (movement.player.alive) {
      const input = inputs.get(movement.player.id);
      applyBombActions(ctx, movement.player, input?.bombCommands ?? []);
      // A sight needs a held trigger. A hold whose release never arrives (a connection flap resets the held controls
      // without one) ends here with the Gun kept, rather than leaving the rider locked on a straight line.
      if (movement.player.gunAim !== undefined && !input?.bomb) {
        movement.player.bombChargeStartedTick = undefined;
        movement.player.gunAim = undefined;
      }
    }
  }
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
      player.gunAim = undefined;
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
        const projectile = armedProjectile(player);
        if (projectile && WEAPONS[projectile].projectile!.aims)
          player.gunAim = 0;
      }
      // Every weapon fires on release; a Gun spends the hold sweeping its sight, and a tap fires straight ahead.
      continue;
    }

    const chargeStartedTick = player.bombChargeStartedTick;
    const gunAim = player.gunAim ?? 0;
    player.bombChargeStartedTick = undefined;
    player.gunAim = undefined;
    if (chargeStartedTick === undefined) continue;
    const ownsBomb = sortedBombs(state).some(
      (bomb) => bomb.ownerId === player.id && !bomb.shell,
    );
    if (ownsBomb || player.bombReadyAtTick > state.tick) continue;
    // What this pull fires, and what it is called, come from the weapon table (`weapons.ts`), read before the pull
    // spends anything.
    const projectile = armedProjectile(player);
    const weapon = pullLabel(player);
    if (projectile !== undefined) {
      const rule = WEAPONS[projectile].projectile!;
      // Triple, Five and Extra Bomb fan the projectile out exactly as they fan a lob; the pull spends Triple and Five.
      const angles = volleyAngles(
        player.angle + (rule.aims ? gunAim : 0),
        bombsPerShot(player),
      );
      const shot = state.nextBombId;
      facts.push(shotFired(state, player, shot, weapon, angles.length));
      rule.launch({ ctx: { state, events, facts }, player, angles, shot });
      spendPull(player, projectile);
      player.reloadDurationTicks = powerReloadTicks(player.powerPickups);
      player.bombReadyAtTick = state.tick + player.reloadDurationTicks;
      continue;
    }
    const distance = bombLaunchDistance(
      state.tick - chargeStartedTick,
      state.settings.bombChargeTicks,
      state.settings.aimBounce,
      player.rangeLevel,
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
    const paths =
      bombsPerShot(player) > 1
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
    // One label for the whole trigger pull, read above before anything was spent. Extra Bomb is not a weapon: it is a
    // round-long upgrade that widens every shot, like Power, not something a pull consumes.
    spendPull(player, undefined);
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
        landsAtTick: state.tick + BOMB_FLIGHT_TICKS,
        explodeAtTick: state.tick + bombFuseTicks(player.fuseLevel),
        blastRange: powerBlastRadius(player.powerPickups),
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
      rangeLevel: shooter.rangeLevel,
      grip: shooter.grip,
      kills: [],
    },
  };
}
