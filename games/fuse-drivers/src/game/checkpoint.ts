import { uint32, type SeatRecord, type Stage } from "fuse-netcode";
import {
  CAPACITY,
  CONTROL_BITS,
  MAX_ROUNDS,
  MAX_WATCHERS,
  isAvatar,
  packControls,
  parseSettings,
  playerKey,
  players,
  trackFor,
  trackNames,
  unpackControls,
  validMatchId,
  validName,
  type FuseDriversRoom,
} from "./rules.js";
import type { BotMemory } from "./sim/bot.js";
import { config, type TruckStats } from "./sim/config.js";
import type { TruckInput } from "./sim/input.js";
import type { Drone, Mine, Missile, OilSlick } from "./sim/items.js";
import type { Phase, RaceState } from "./sim/race.js";
import type { ItemKind, Truck } from "./sim/truck.js";

/**
 * The room as snapshot fields, and back. `decode` checks every field and how the fields fit together, and builds a
 * fresh room only once all of them pass: a corrupt or hostile snapshot yields `undefined`, never part of a room.
 *
 * The race is the bulk of it, and every peer hashes it: a number that is not finite, or is `-0`, would fold on to a
 * different race elsewhere, so it is refused here rather than carried into the simulation.
 */
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
const PHASES: readonly Phase[] = ["countdown", "racing", "finished"];
const ITEM_KINDS: readonly ItemKind[] = [
  "mine",
  "oil",
  "nitro",
  "shield",
  "missile",
  "drone",
  "emp",
];
/** The world is about 1024x516 units; anything this far out is corruption rather than a race. */
const MAX_COORD = 100_000;
/** Speeds are a few hundred units a second, headings a handful of radians. */
const MAX_SPEED = 100_000,
  MAX_ANGLE = 1_000;
/** Every projectile is culled by its own lifetime, far below this; the cap only bounds the work. */
const MAX_PROJECTILES = 1_024;
/** The furthest ahead any timer is armed (the 45 s end-of-race grace is the longest by far). */
const MAX_TIMER_AHEAD = 10_000;
/** A bot queues at most `DELAY` steering decisions, which is six on easy. */
const MAX_QUEUE = 64;
/** Laps, kills and contact ticks: far past anything a race reaches, and still bounded. */
const MAX_COUNTER = 1_000_000;
/** A truck's fields, grouped as `[core..., timers, tally]`. */
const TIMER_COUNT = 14,
  TALLY_COUNT = 10,
  TRUCK_FIELDS = 17,
  STAT_COUNT = 7,
  RACE_FIELDS = 15;

const encodeTruck = (truck: Truck): unknown[] => [
  truck.slot,
  truck.x,
  truck.y,
  truck.heading,
  truck.speed,
  [
    truck.stats.topSpeed,
    truck.stats.accelTime,
    truck.stats.turnRateHigh,
    truck.stats.landingMul,
    truck.stats.maxArmor,
    truck.stats.nitros,
    truck.stats.mass,
  ],
  truck.armor,
  truck.nitros,
  truck.item,
  truck.turnDir,
  truck.turnHeldTicks,
  truck.driftDir,
  truck.driftTicks,
  truck.prevNitro,
  truck.onBridge,
  [
    truck.boostUntilTick,
    truck.nitroUntilTick,
    truck.padUntilTick,
    truck.airborneUntilTick,
    truck.spinUntilTick,
    truck.stunUntilTick,
    truck.oilUntilTick,
    truck.shieldUntilTick,
    truck.invulnerableUntilTick,
    truck.lockedUntilTick,
    truck.respawnAtTick,
    truck.respawnedTick,
    truck.toxicNextTick,
    truck.landAtTick,
  ],
  [
    truck.wallTicks,
    truck.laps,
    truck.checkpoint,
    truck.progress,
    truck.wrongWayTicks,
    truck.finishedTick,
    truck.kills,
    truck.deaths,
    truck.lapsLed,
    truck.nitrosUsed,
  ],
];

const encodeRace = (race: RaceState): unknown[] => [
  race.tick,
  race.phase,
  race.rngState,
  race.trackName,
  race.countdownEndTick,
  race.raceEndTick,
  race.nextId,
  race.trucks.map(encodeTruck),
  [...race.placements],
  [...race.itemHeld],
  [...race.boxCooldowns],
  race.missiles.map((m) => [
    m.id,
    m.owner,
    m.x,
    m.y,
    m.heading,
    m.launchedTick,
    m.target,
    m.onBridge,
  ]),
  race.mines.map((m) => [m.id, m.owner, m.x, m.y, m.droppedTick, m.onBridge]),
  race.oils.map((o) => [o.id, o.owner, o.x, o.y, o.droppedTick]),
  race.drones.map((d) => [
    d.id,
    d.owner,
    d.launchedTick,
    d.zaps,
    [...d.lastZapTick],
  ]),
];

export function encodeRoom(room: FuseDriversRoom): unknown[] {
  return [
    [room.matchId, room.round, room.stage],
    players(room)
      .concat([...room.seats.values()].filter((seat) => seat.watcher))
      .map((seat) => [
        seat.id,
        seat.name,
        seat.slot,
        seat.avatarId,
        seat.connected,
        seat.watcher === true ? "watcher" : seat.bot,
        seat.generation ?? null,
      ]),
    { ...room.settings },
    [...room.grid],
    Object.entries(room.controls),
    Object.entries(room.bots).map(([id, memory]) => [
      id,
      memory.queue.map(packControls),
      memory.lateral,
      memory.anchorX,
      memory.anchorY,
      memory.anchorTick,
      memory.reverseUntilTick,
    ]),
    room.race ? encodeRace(room.race) : null,
  ];
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
/** A number every peer hashes the same way: finite, never `-0`, and inside a sane range. */
const real = (value: unknown, limit = MAX_COORD): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  !Object.is(value, -0) &&
  Math.abs(value) <= limit;
/** An absolute tick: already past, or armed no further ahead than any timer reaches. */
const timer = (value: unknown, tick: number): value is number =>
  uint32(value) && value <= tick + MAX_TIMER_AHEAD;
const count = (value: unknown, most = MAX_COUNTER): value is number =>
  uint32(value) && value <= most;
const turn = (value: unknown): value is -1 | 0 | 1 =>
  value === -1 || value === 1 || (value === 0 && !Object.is(value, -0));
/** Control bits as a seat logs them: a bitmask with no unknown bit set. */
const controlBits = (value: unknown): value is number =>
  uint32(value) && (value & ~CONTROL_BITS) === 0;

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!Array.isArray(raw) || raw.length !== 7) return;
  const [id, name, slot, avatarId, connected, role, generation] = raw;
  const watcher = role === "watcher";
  if (
    !playerKey(id) ||
    !validName(name) ||
    !(watcher ? slot === -1 : uint32(slot) && slot < CAPACITY) ||
    !(watcher ? avatarId === "" : isAvatar(avatarId)) ||
    typeof connected !== "boolean" ||
    (!watcher && typeof role !== "boolean") ||
    // A bot follows no stream; every human seat and watcher follows one.
    (role === true ? generation !== null : !uint32(generation))
  )
    return;
  return {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot: role === true,
    ...(watcher ? { watcher } : {}),
    ...(generation === null ? {} : { generation }),
  };
}

function decodeStats(raw: unknown): TruckStats | undefined {
  if (!Array.isArray(raw) || raw.length !== STAT_COUNT) return;
  const [
    topSpeed,
    accelTime,
    turnRateHigh,
    landingMul,
    maxArmor,
    nitros,
    mass,
  ] = raw;
  if (
    !real(topSpeed, MAX_SPEED) ||
    topSpeed <= 0 ||
    !real(accelTime, MAX_COUNTER) ||
    accelTime <= 0 ||
    !real(turnRateHigh, MAX_ANGLE) ||
    turnRateHigh <= 0 ||
    !real(landingMul, MAX_COUNTER) ||
    landingMul <= 0 ||
    !count(maxArmor) ||
    maxArmor === 0 ||
    !count(nitros, config.truck.nitroMax) ||
    !real(mass, MAX_COUNTER) ||
    mass <= 0
  )
    return;
  return {
    topSpeed,
    accelTime,
    turnRateHigh,
    landingMul,
    maxArmor,
    nitros,
    mass,
  };
}

/** One truck, at the slot its place in the list gives it: a truck may not claim another slot's number. */
function decodeTruck(
  raw: unknown,
  slot: number,
  tick: number,
): Truck | undefined {
  if (!Array.isArray(raw) || raw.length !== TRUCK_FIELDS) return;
  const [
    itsSlot,
    x,
    y,
    heading,
    speed,
    rawStats,
    armor,
    nitros,
    item,
    turnDir,
    turnHeldTicks,
    driftDir,
    driftTicks,
    prevNitro,
    onBridge,
    rawTimers,
    rawTally,
  ] = raw;
  const stats = decodeStats(rawStats);
  if (
    itsSlot !== slot ||
    !real(x) ||
    !real(y) ||
    !real(heading, MAX_ANGLE) ||
    !real(speed, MAX_SPEED) ||
    !stats ||
    !count(armor, stats.maxArmor) ||
    !count(nitros, config.truck.nitroMax) ||
    !(item === null || (ITEM_KINDS as readonly unknown[]).includes(item)) ||
    !turn(turnDir) ||
    !turn(driftDir) ||
    !count(turnHeldTicks) ||
    !count(driftTicks) ||
    typeof prevNitro !== "boolean" ||
    typeof onBridge !== "boolean" ||
    !Array.isArray(rawTimers) ||
    rawTimers.length !== TIMER_COUNT ||
    !Array.isArray(rawTally) ||
    rawTally.length !== TALLY_COUNT
  )
    return;
  const [
    boostUntilTick,
    nitroUntilTick,
    padUntilTick,
    airborneUntilTick,
    spinUntilTick,
    stunUntilTick,
    oilUntilTick,
    shieldUntilTick,
    invulnerableUntilTick,
    lockedUntilTick,
    respawnAtTick,
    respawnedTick,
    toxicNextTick,
    landAtTick,
  ] = rawTimers;
  const [
    wallTicks,
    laps,
    checkpoint,
    progress,
    wrongWayTicks,
    finishedTick,
    kills,
    deaths,
    lapsLed,
    nitrosUsed,
  ] = rawTally;
  if (
    !timer(boostUntilTick, tick) ||
    !timer(nitroUntilTick, tick) ||
    !timer(padUntilTick, tick) ||
    !timer(airborneUntilTick, tick) ||
    !timer(spinUntilTick, tick) ||
    !timer(stunUntilTick, tick) ||
    !timer(oilUntilTick, tick) ||
    !timer(shieldUntilTick, tick) ||
    !timer(invulnerableUntilTick, tick) ||
    !timer(lockedUntilTick, tick) ||
    !timer(respawnAtTick, tick) ||
    // What already happened cannot be in the race's future.
    !count(respawnedTick, tick) ||
    !timer(toxicNextTick, tick) ||
    !timer(landAtTick, tick) ||
    !count(wallTicks) ||
    !count(laps) ||
    !count(checkpoint) ||
    !real(progress) ||
    !count(wrongWayTicks) ||
    !count(finishedTick, tick) ||
    !count(kills) ||
    !count(deaths) ||
    !count(lapsLed) ||
    !count(nitrosUsed)
  )
    return;
  return {
    slot,
    x,
    y,
    heading,
    speed,
    stats,
    armor,
    nitros,
    item: item === null ? null : (item as ItemKind),
    turnDir,
    turnHeldTicks,
    driftDir,
    driftTicks,
    boostUntilTick,
    nitroUntilTick,
    padUntilTick,
    airborneUntilTick,
    spinUntilTick,
    stunUntilTick,
    oilUntilTick,
    shieldUntilTick,
    invulnerableUntilTick,
    lockedUntilTick,
    respawnAtTick,
    respawnedTick,
    toxicNextTick,
    landAtTick,
    wallTicks,
    prevNitro,
    onBridge,
    laps,
    checkpoint,
    progress,
    wrongWayTicks,
    finishedTick,
    kills,
    deaths,
    lapsLed,
    nitrosUsed,
  };
}

/** The whole race, or `undefined`. `slots` is the grid's length: a race carries exactly one truck per grid place. */
function decodeRace(
  raw: unknown,
  slots: number,
  roomTick: number,
): RaceState | undefined {
  if (!Array.isArray(raw) || raw.length !== RACE_FIELDS) return;
  const [
    tick,
    phase,
    rngState,
    trackName,
    countdownEndTick,
    raceEndTick,
    nextId,
    rawTrucks,
    rawPlacements,
    rawItemHeld,
    rawBoxCooldowns,
    rawMissiles,
    rawMines,
    rawOils,
    rawDrones,
  ] = raw;
  if (
    // The log runs at 20 Hz and the race at 30 Hz, so a race never advances more than twice per log tick.
    !count(tick, roomTick * 2) ||
    !PHASES.includes(phase as Phase) ||
    !uint32(rngState) ||
    typeof trackName !== "string" ||
    !trackNames().includes(trackName) ||
    !timer(countdownEndTick, tick) ||
    // The grace is armed once the leader finishes, which is after the lights go out.
    !(raceEndTick === 0 || timer(raceEndTick, tick)) ||
    (raceEndTick !== 0 && raceEndTick <= countdownEndTick) ||
    // `countdown` lasts exactly until the countdown tick, on every peer.
    (phase === "countdown") !== tick < countdownEndTick ||
    !count(nextId) ||
    nextId < 1 ||
    !Array.isArray(rawTrucks) ||
    rawTrucks.length !== slots ||
    !Array.isArray(rawPlacements) ||
    rawPlacements.length !== slots ||
    !Array.isArray(rawItemHeld) ||
    rawItemHeld.length !== slots ||
    !Array.isArray(rawBoxCooldowns) ||
    !Array.isArray(rawMissiles) ||
    rawMissiles.length > MAX_PROJECTILES ||
    !Array.isArray(rawMines) ||
    rawMines.length > MAX_PROJECTILES ||
    !Array.isArray(rawOils) ||
    rawOils.length > MAX_PROJECTILES ||
    !Array.isArray(rawDrones) ||
    rawDrones.length > MAX_PROJECTILES
  )
    return;
  // Every peer parses the same committed map, so the box grid's size is known rather than trusted.
  const track = trackFor(trackName);
  if (rawBoxCooldowns.length !== track.items.length * slots) return;

  const trucks: Truck[] = [];
  for (const [slot, rawTruck] of rawTrucks.entries()) {
    const truck = decodeTruck(rawTruck, slot, tick);
    if (!truck) return;
    trucks.push(truck);
  }
  // Placements rank every slot exactly once, best first.
  const placements: number[] = [];
  for (const place of rawPlacements) {
    if (!count(place, slots - 1) || placements.includes(place)) return;
    placements.push(place);
  }
  const itemHeld: boolean[] = [];
  for (const held of rawItemHeld) {
    if (typeof held !== "boolean") return;
    itemHeld.push(held);
  }
  const boxCooldowns: number[] = [];
  for (const until of rawBoxCooldowns) {
    if (!timer(until, tick)) return;
    boxCooldowns.push(until);
  }

  // One id per projectile ever spawned, all of them drawn from the counter below `nextId`.
  const ids = new Set<number>();
  const fresh = (id: unknown): id is number =>
    count(id, nextId - 1) && id >= 1 && !ids.has(id);
  const missiles: Missile[] = [];
  for (const rawMissile of rawMissiles) {
    if (!Array.isArray(rawMissile) || rawMissile.length !== 8) return;
    const [id, owner, x, y, heading, launchedTick, target, onBridge] =
      rawMissile;
    if (
      !fresh(id) ||
      !count(owner, slots - 1) ||
      !real(x) ||
      !real(y) ||
      !real(heading, MAX_ANGLE) ||
      !count(launchedTick, tick) ||
      !(target === null || count(target, slots - 1)) ||
      typeof onBridge !== "boolean"
    )
      return;
    ids.add(id);
    missiles.push({
      id,
      owner,
      x,
      y,
      heading,
      launchedTick,
      target: target === null ? null : target,
      onBridge,
    });
  }
  const mines: Mine[] = [];
  for (const rawMine of rawMines) {
    if (!Array.isArray(rawMine) || rawMine.length !== 6) return;
    const [id, owner, x, y, droppedTick, onBridge] = rawMine;
    if (
      !fresh(id) ||
      !count(owner, slots - 1) ||
      !real(x) ||
      !real(y) ||
      !count(droppedTick, tick) ||
      typeof onBridge !== "boolean"
    )
      return;
    ids.add(id);
    mines.push({ id, owner, x, y, droppedTick, onBridge });
  }
  const oils: OilSlick[] = [];
  for (const rawOil of rawOils) {
    if (!Array.isArray(rawOil) || rawOil.length !== 5) return;
    const [id, owner, x, y, droppedTick] = rawOil;
    if (
      !fresh(id) ||
      !count(owner, slots - 1) ||
      !real(x) ||
      !real(y) ||
      !count(droppedTick, tick)
    )
      return;
    ids.add(id);
    oils.push({ id, owner, x, y, droppedTick });
  }
  const drones: Drone[] = [];
  for (const rawDrone of rawDrones) {
    if (!Array.isArray(rawDrone) || rawDrone.length !== 5) return;
    const [id, owner, launchedTick, zaps, rawZapTicks] = rawDrone;
    if (
      !fresh(id) ||
      !count(owner, slots - 1) ||
      !count(launchedTick, tick) ||
      !count(zaps, config.items.drone.maxZaps) ||
      !Array.isArray(rawZapTicks) ||
      // A drone remembers when it last zapped each truck on the grid.
      rawZapTicks.length !== slots
    )
      return;
    const lastZapTick: number[] = [];
    for (const at of rawZapTicks) {
      if (!count(at, tick)) return;
      lastZapTick.push(at);
    }
    ids.add(id);
    drones.push({ id, owner, launchedTick, zaps, lastZapTick });
  }

  return {
    tick,
    phase: phase as Phase,
    rngState,
    trackName,
    trucks,
    countdownEndTick,
    raceEndTick,
    placements,
    missiles,
    mines,
    oils,
    drones,
    boxCooldowns,
    itemHeld,
    nextId,
  };
}

export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): FuseDriversRoom | undefined {
  if (fields.length !== 7 || !uint32(tick)) return;
  const [
    header,
    rawSeats,
    rawSettings,
    rawGrid,
    rawControls,
    rawBots,
    rawRace,
  ] = fields;
  if (
    !Array.isArray(header) ||
    header.length !== 3 ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawGrid) ||
    rawGrid.length > CAPACITY ||
    !Array.isArray(rawControls) ||
    rawControls.length > CAPACITY ||
    !Array.isArray(rawBots) ||
    rawBots.length > CAPACITY
  )
    return;
  const [matchId, round, stage] = header;
  const settings = parseSettings(rawSettings);
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    round < 1 ||
    round > MAX_ROUNDS ||
    !STAGES.includes(stage as Stage) ||
    !settings
  )
    return;

  const seats = new Map<string, SeatRecord>(),
    slots = new Set<number>();
  let watchers = 0;
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (!seat || seats.has(seat.id)) return;
    if (seat.watcher) watchers++;
    else if (slots.has(seat.slot)) return;
    else slots.add(seat.slot);
    seats.set(seat.id, seat);
  }
  if (watchers > MAX_WATCHERS) return;

  // The grid is formed when the race starts and never reordered. While it runs no seat can be reclaimed, so every
  // driver is still seated; once it is over a driver may have left the room with its truck still on the grid.
  const grid: string[] = [];
  for (const id of rawGrid) {
    if (!playerKey(id) || grid.includes(id)) return;
    if (stage === "running" && !seats.has(id)) return;
    grid.push(id);
  }

  const controls: Record<string, number> = {};
  for (const raw of rawControls) {
    if (!Array.isArray(raw) || raw.length !== 2) return;
    const [id, bits] = raw;
    if (!playerKey(id) || Object.hasOwn(controls, id) || !controlBits(bits))
      return;
    controls[id] = bits;
  }

  // Bot memory is seeded per grid slot when the race starts and written only for drivers on the grid.
  const bots: Record<string, BotMemory> = {};
  for (const raw of rawBots) {
    if (!Array.isArray(raw) || raw.length !== 7) return;
    const [
      id,
      rawQueue,
      lateral,
      anchorX,
      anchorY,
      anchorTick,
      reverseUntilTick,
    ] = raw;
    if (
      !playerKey(id) ||
      Object.hasOwn(bots, id) ||
      !grid.includes(id) ||
      seats.get(id)?.bot === false ||
      !Array.isArray(rawQueue) ||
      rawQueue.length > MAX_QUEUE ||
      !Number.isInteger(lateral) ||
      !real(lateral, MAX_COUNTER) ||
      !real(anchorX) ||
      !real(anchorY) ||
      !timer(anchorTick, tick * 2) ||
      !timer(reverseUntilTick, tick * 2)
    )
      return;
    const queue: TruckInput[] = [];
    for (const bits of rawQueue) {
      if (!controlBits(bits)) return;
      queue.push(unpackControls(bits));
    }
    bots[id] = {
      queue,
      lateral,
      anchorX,
      anchorY,
      anchorTick,
      reverseUntilTick,
    };
  }

  // A race exists exactly while one is being driven or has just been decided; the lobby holds none, and drops the
  // grid, the controls and the bot memory with it.
  const racing = stage === "running" || stage === "over";
  if (rawRace === null) {
    if (racing || grid.length || rawControls.length || rawBots.length) return;
    return {
      tick,
      matchId,
      round,
      stage: stage as Stage,
      seats,
      settings,
      grid,
      controls,
      bots,
    };
  }
  if (!racing) return;
  const race = decodeRace(rawRace, grid.length, tick);
  // The room calls the match over exactly when the race is: the fold sets one from the other.
  if (!race || (race.phase === "finished") !== (stage === "over")) return;
  return {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    race,
    grid,
    controls,
    bots,
  };
}

/** Canonical JSON (sorted keys, seats in slot then id order), then FNV-1a in two lanes: 16 hex characters. */
export function hashRoom(room: FuseDriversRoom): string {
  const seats = [...room.seats.values()].sort(
    (a, b) => a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const text = JSON.stringify({ ...room, seats }, (_key, value: unknown) =>
    plain(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : value,
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let index = 0; index < text.length; index++) {
    const code = text.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193) >>> 0;
    b = Math.imul(b ^ code, 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}
