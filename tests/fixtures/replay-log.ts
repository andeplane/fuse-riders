import { BotController } from "../../src/shared/bot-controller.js";
import {
  applyTick,
  BOT_NAMES,
  createRoomState,
  freeSlot,
  hashRoomState,
  type StreamEntries,
  type RoomState,
} from "../../src/shared/apply-tick.ts";
import {
  ACTION,
  AIM,
  BOT,
  CANCEL,
  JOIN,
  PRESS,
  RELEASE,
  STEER,
  SETTINGS,
  type Entry,
} from "../../src/shared/input-log.ts";
import { defaultRoomSettings } from "../../src/shared/room-settings.js";
import {
  PICKUP_TYPES,
  SHIELD_GRACE_TICKS,
  type PickupType,
} from "../../src/shared/game.js";
import {
  PORTAL_COOLDOWN_TICKS,
  PORTAL_GRACE_TICKS,
} from "../../src/shared/portal.js";
import type { GameEvent } from "../../src/shared/protocol.js";

export interface ReplayCoverage {
  collected: PickupType[];
  portalTransits: number;
  shieldAbsorbs: number;
}

export function coverageObserver(coverage: ReplayCoverage) {
  return (state: Readonly<RoomState>) => {
    const pickups = new Map(
      state.game.pickups.map((pickup) => [pickup.id, pickup.type]),
    );
    const players = new Map(
      [...state.game.players].map(([id, player]) => [
        id,
        {
          shielded: player.shielded,
          cooldown: player.portalCooldownUntilTick,
          x: player.x,
          matchId: state.game.matchId,
        },
      ]),
    );
    return (events: readonly GameEvent[]) => {
      for (const event of events) {
        if (event.type !== "pickupCollected") continue;
        const type = pickups.get(event.pickupId);
        if (type && !coverage.collected.includes(type))
          coverage.collected.push(type);
      }
      for (const [id, player] of state.game.players) {
        const before = players.get(id);
        if (!before || before.matchId !== state.game.matchId) continue;
        if (
          before.shielded &&
          !player.shielded &&
          player.alive &&
          player.shieldGraceUntilTick === state.game.tick + SHIELD_GRACE_TICKS
        )
          coverage.shieldAbsorbs++;
        if (
          player.portalCooldownUntilTick > before.cooldown &&
          player.portalCooldownUntilTick ===
            state.game.tick + PORTAL_COOLDOWN_TICKS &&
          player.portalGraceUntilTick ===
            state.game.tick + PORTAL_GRACE_TICKS &&
          Math.abs(player.x - before.x) > 100
        )
          coverage.portalTransits++;
      }
    };
  };
}

/** Seeded five-rider recording: two scripted humans plus three AI riders, rematching whenever a match ends. */
export interface Recording {
  matchId: string;
  creator: string;
  ticks: number;
  entries: Record<string, Entry[]>;
}

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

export function makeRecording(
  seed: number,
  ticks: number,
  coverMechanics = false,
): Recording {
  const random = mulberry32(seed),
    creator = "creator",
    players = [creator, "rider"];
  const entries: Record<string, Entry[]> = { creator: [], rider: [] };
  const seqs: Record<string, number> = { creator: 0, rider: 0 };
  const log = (member: string, tick: number, ...body: unknown[]) => {
    entries[member]!.push([++seqs[member]!, tick, ...body] as Entry);
  };
  const state = createRoomState("replay", defaultRoomSettings()),
    bots = new BotController();
  const gestures: Record<string, { active: number; latest: number }> = {
    creator: { active: 0, latest: 0 },
    rider: { active: 0, latest: 0 },
  };
  const coverage: ReplayCoverage = {
    collected: [],
    portalTransits: 0,
    shieldAbsorbs: 0,
  };
  const observe = coverageObserver(coverage);
  let focus: PickupType | undefined;
  let attempt = 0;
  let attemptStart = 0;
  for (let tick = 1; tick <= ticks; tick++) {
    if (tick === 1) {
      log(creator, tick, JOIN, creator, "Creator", 0, "robot", 1);
      log(creator, tick, JOIN, "rider", "Rider", 1, "fox", 1);
    }
    if (tick === 2)
      for (let index = 0; index < 3; index++) {
        const slot = freeSlot(state.game) + index;
        log(
          creator,
          tick,
          BOT,
          "add",
          `bot:${index + 1}`,
          `AI ${BOT_NAMES[slot]}`,
          slot,
        );
      }
    if (tick === 3) log(creator, tick, ACTION, "start", `match-${tick}`);
    if (coverMechanics && tick >= 3) {
      const wanted =
        PICKUP_TYPES.find((type) => !coverage.collected.includes(type)) ??
        (coverage.shieldAbsorbs === 0
          ? "orbitShield"
          : coverage.portalTransits === 0
            ? "portal"
            : undefined);
      if (!wanted)
        return { matchId: "replay", creator, ticks: tick - 1, entries };
      if (
        wanted !== focus ||
        tick - attemptStart >= 1000 ||
        state.game.phase === "matchOver"
      ) {
        focus = wanted;
        attemptStart = tick;
        log(creator, tick, ACTION, "lobby", `coverage-${seed}-${++attempt}`);
        log(creator, tick, SETTINGS, {
          ...defaultRoomSettings(),
          length: 1,
          weights: { [wanted]: 1 },
        });
        log(creator, tick, ACTION, "start", `coverage-${seed}-${attempt}`);
        for (const gesture of Object.values(gestures)) gesture.active = 0;
      }
    }
    if (
      state.game.phase === "matchOver" &&
      state.game.tick >= (state.game.phaseEndsAtTick ?? 0)
    )
      log(creator, tick, ACTION, "rematch", `match-${tick}`);
    for (const member of players) {
      const gesture = gestures[member]!;
      if (random() < 0.12) log(member, tick, STEER, Math.floor(random() * 4));
      if (random() < 0.05)
        log(
          member,
          tick,
          AIM,
          Math.floor(random() * 65536),
          Math.floor(random() * 65536),
        );
      if (!gesture.active && random() < 0.04) {
        gesture.active = ++gesture.latest;
        log(member, tick, PRESS, gesture.active);
      } else if (gesture.active && random() < 0.08) {
        const aimed = random() < 0.5;
        log(
          member,
          tick,
          RELEASE,
          gesture.active,
          ...(aimed
            ? [Math.floor(random() * 65536), Math.floor(random() * 65536)]
            : []),
        );
        gesture.active = 0;
      } else if (gesture.active && random() < 0.01) {
        log(member, tick, CANCEL, gesture.active);
        gesture.active = 0;
      }
    }
    const after = observe(state);
    after(applyTick(state, creator, streamsAt(entries, tick), bots));
  }
  if (coverMechanics)
    throw new Error(
      `Coverage incomplete at ${ticks} ticks: ${JSON.stringify(coverage)}`,
    );
  return { matchId: "replay", creator, ticks, entries };
}

function streamsAt(
  entries: Record<string, readonly Entry[]>,
  tick: number,
): Map<string, StreamEntries> {
  return new Map(
    Object.entries(entries).map(([member, list]) => [
      member,
      { generation: 1, entries: list.filter((entry) => entry[1] === tick) },
    ]),
  );
}

/** One hash per tick. Any engine that disagrees with another on any tick has diverged. */
export function replayHashes(
  recording: Recording,
  observe?: (
    state: Readonly<RoomState>,
  ) => (events: readonly GameEvent[]) => void,
): string[] {
  const state = createRoomState(recording.matchId, defaultRoomSettings()),
    bots = new BotController(),
    hashes: string[] = [];
  for (let tick = 1; tick <= recording.ticks; tick++) {
    const after = observe?.(state);
    const events = applyTick(
      state,
      recording.creator,
      streamsAt(recording.entries, tick),
      bots,
    );
    after?.(events);
    hashes.push(hashRoomState(state));
  }
  return hashes;
}
