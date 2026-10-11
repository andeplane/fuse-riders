import {
  ACTION,
  BOT,
  PRESENCE,
  SPECTATOR,
  applyManagementTick,
  defaultText,
  isManagementEntry,
  uint32,
  type LifecycleHooks,
  type ManagedRoom,
  type ManagementEntry,
  type RollbackGame,
  type SeatRecord,
  type Stage,
  type StreamEntries,
} from "fuse-netcode";
import {
  CAPACITY,
  INPUT_MASK,
  RULES,
  STAGES as PLANS,
  STEPS_PER_TICK,
  HERO_KINDS,
  botInput,
  carryOf,
  createWorld,
  decodeWorld,
  defeated,
  encodeWorld,
  isInput,
  revive,
  seedOf,
  stageCleared,
  stepTick,
  toView,
  type HeroEntry,
  type HeroKind,
  type World,
  type WorldView,
} from "../engine/index.js";
import {
  BOT_AVATAR,
  BOT_NAMES,
  BOT_PREFIX,
  DEFAULT_HERO,
  isHero,
  playerKey,
  seatHero,
  seatName,
  validMatchId,
  validName,
} from "./names.js";

/**
 * Fuse Axe behind the netcode's `RollbackGame`. The room keeps the seats and the run: the stage the party is on
 * (`round`), that stage's world, the clock of a stage-clear tally or a continue countdown (`until`), whether the stage's
 * continue is spent, the run's banked tallies and, once it is over, its outcome. One log tick folds the management
 * entries; then, in a run, a CONTINUE while the countdown runs, each hero's held controls and `STEPS_PER_TICK`
 * simulation steps, and the stage flow (`runTick`); between stages, the tally's clock; in the lobby and once the run is
 * over, each member's hero pick.
 */
export const PLAY = 0,
  PICK = 1,
  CONTINUE = 2;
/** A seat's held control bits from this tick on, for the run and stage it names. */
export type PlayEntry = [
  seq: number,
  tick: number,
  kind: typeof PLAY,
  matchId: string,
  round: number,
  bits: number,
];
/**
 * A seated member's hero for the next run: its own entry, applied only in the lobby or once the run is over. Camp
 * between stages is part of the run, whose heroes are the ones it set out with, so a pick there changes nothing.
 */
export type PickEntry = [
  seq: number,
  tick: number,
  kind: typeof PICK,
  hero: HeroKind,
];
/**
 * A hero's vote to continue the run and stage it names once every hero is out. The fold takes it only from a present
 * human seat playing a hero of the run, only while the countdown runs and only once a stage: the first one folded
 * revives the party, and any other (a duplicate, a late one, one for another run or stage) changes nothing.
 */
export type ContinueEntry = [
  seq: number,
  tick: number,
  kind: typeof CONTINUE,
  matchId: string,
  round: number,
];
export type Entry =
  ManagementEntry<Settings> | PlayEntry | PickEntry | ContinueEntry;
/** Whether the fold applies `PICK` entries in `stage`: in the lobby and once the run is over, never in a run or camp. */
export const picksApply = (stage: Stage): boolean =>
  stage === "lobby" || stage === "over";

export const MAX_WATCHERS = 5;
/** A run's stages, in order: Ashen Village, then Wyrmbone Pass (`STAGES` in the engine); clearing the last wins it. */
export const LAST_STAGE = PLANS.length;
/** Log ticks (50 ms each) the stage-clear tally shows before the run goes on: 6 s. */
export const CLEAR_TICKS = 120;
/** Log ticks the party has to continue once every hero is out: 10 s. */
export const CONTINUE_TICKS = 200;
/** How a run ended: "" until it is over. */
export const OUTCOMES = ["", "victory", "defeat"] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** One hero of the run's tallies: hit points taken from enemies, and enemies knocked down. */
export interface Tally {
  seat: number;
  kind: HeroKind;
  damage: number;
  knockdowns: number;
}

/** The room's settings: so far only whether it is one shared screen with phones as controllers. */
export interface Settings {
  display: boolean;
}
export const DEFAULT_SETTINGS: Settings = { display: false };
/** The settings a log entry or a checkpoint carries, exactly; anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const { display } = raw as Record<string, unknown>;
  return Object.keys(raw).length === 1 && typeof display === "boolean"
    ? { display }
    : undefined;
}

export interface Room extends ManagedRoom<Settings> {
  tick: number;
  /** The run's id, which seeds its worlds. */
  matchId: string;
  /** The stage the run is on, from 1; 0 in the lobby. */
  round: number;
  stage: Stage;
  /** Each hero's held bits by member id, from the latest entry its seat logged this stage. */
  held: Record<string, number>;
  world: World | null;
  /**
   * The log tick a clock runs out at, 0 when none runs: between stages, the stage-clear tally's; in a run whose heroes
   * are all out, the continue countdown's. The fold acts on the first tick at or past it.
   */
  until: number;
  /** The party has spent this stage's continue: the next time every hero is out, the run is lost. */
  continued: boolean;
  /** How the run ended, once it is `over`; "" before. */
  outcome: Outcome;
  /**
   * Every hero of the run, in seat order, with its tallies over the stages that have ended: a stage's are banked
   * from its world when it is cleared or lost, so they outlive it. While a stage runs, its own are the world's.
   */
  tally: Tally[];
}

export interface SeatView {
  id: string;
  name: string;
  slot: number;
  bot: boolean;
  connected: boolean;
  away: boolean;
  watcher: boolean;
  /** The hero this seat plays in the next run (in a run, the one it plays now); null for a watcher. */
  hero: HeroKind | null;
}
/** A hero of the run's tallies: this stage's, and the whole run's so far (this stage's included). */
export interface TallyView {
  seat: number;
  kind: HeroKind;
  stage: { damage: number; knockdowns: number };
  run: { damage: number; knockdowns: number };
}
/** What the screen renders. */
export interface View {
  /** The game clock: simulation steps. */
  tick: number;
  logTick: number;
  stage: Stage;
  matchId: string;
  round: number;
  /** The run's last stage: a cleared one wins it. */
  lastStage: number;
  settings: Settings;
  seats: SeatView[];
  world: WorldView | null;
  /** Log ticks left on the stage-clear tally (between stages) or the continue countdown (a run with every hero out). */
  countdown: number;
  /** This stage's continue is spent. */
  continued: boolean;
  outcome: Outcome;
  /** Every hero of the run, in seat order; empty in the lobby. */
  tally: TallyView[];
}

const payloads = {
  name: validName,
  avatar: isHero,
  settings: (value: unknown) => parseSettings(value) !== undefined,
  capacity: CAPACITY,
};
export function isEntry(raw: unknown): raw is Entry {
  if (isManagementEntry(raw, payloads)) {
    if (raw[2] === ACTION) return validMatchId(raw[4]);
    const at =
      raw[2] === BOT || raw[2] === SPECTATOR ? 4 : raw[2] <= PRESENCE ? 3 : -1;
    return at < 0 || playerKey((raw as unknown[])[at]);
  }
  if (
    !Array.isArray(raw) ||
    !uint32(raw[0]) ||
    raw[0] === 0 ||
    !uint32(raw[1]) ||
    raw[1] === 0
  )
    return false;
  if (raw[2] === PLAY)
    return (
      raw.length === 6 &&
      validMatchId(raw[3]) &&
      uint32(raw[4]) &&
      isInput(raw[5])
    );
  if (raw[2] === CONTINUE)
    return raw.length === 5 && validMatchId(raw[3]) && uint32(raw[4]);
  return raw[2] === PICK && raw.length === 4 && isHero(raw[3]);
}

export function createRoom(matchId: string, settings: Settings): Room {
  return {
    tick: 0,
    matchId,
    round: 0,
    stage: "lobby",
    seats: new Map(),
    settings: { ...settings },
    held: {},
    world: null,
    until: 0,
    continued: false,
    outcome: "",
    tally: [],
  };
}

const bySlot = (a: SeatRecord, b: SeatRecord) =>
  a.slot - b.slot || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** Seats in slot order, watchers excluded. */
const riders = (room: Room): SeatRecord[] =>
  [...room.seats.values()].filter((seat) => !seat.watcher).sort(bySlot);
/** The rider in `slot`, if any. A scan, not `riders`: the fold asks for every hero's seat on every tick. */
function seatAt(room: Room, slot: number): SeatRecord | undefined {
  for (const seat of room.seats.values())
    if (!seat.watcher && seat.slot === slot) return seat;
  return undefined;
}
/** Who sets out on a new run: every seat that is here, stepped away or a bot. */
const entrants = (room: Room) =>
  riders(room).filter((seat) => seat.connected || seat.away || seat.bot);
/** The hero a seat plays: its own pick (the log guard and the checkpoint only let a hero in), or a bot its seat's. */
export const heroOf = (seat: SeatRecord): HeroKind =>
  seat.bot ? seatHero(seat.slot) : (seat.avatarId as HeroKind);

function toLobby(room: Room, matchId: string): void {
  room.matchId = matchId;
  room.stage = "lobby";
  room.round = 0;
  room.held = {};
  room.world = null;
  room.until = 0;
  room.continued = false;
  room.outcome = "";
  room.tally = [];
}
/**
 * Stage `round` of the run for `heroes`: that stage's world, seeded for the run and the stage
 * (`seedOf("matchId:round")`, which the checkpoint holds every world to), nothing held, no clock running and the
 * stage's continue unspent.
 */
function beginStage(room: Room, round: number, heroes: HeroEntry[]): void {
  room.stage = "running";
  room.round = round;
  room.held = {};
  room.until = 0;
  room.continued = false;
  room.world = createWorld({
    seed: seedOf(`${room.matchId}:${round}`),
    heroes,
    stage: round,
  });
}
/** Stage 1 for everyone seated, with nothing tallied yet, or (nobody left to play) an empty lobby again. */
function startRun(room: Room, matchId: string): void {
  const seats = entrants(room);
  if (!seats.length) return toLobby(room, matchId);
  const heroes = seats.map((seat) => ({ seat: seat.slot, kind: heroOf(seat) }));
  room.matchId = matchId;
  room.outcome = "";
  room.tally = heroes.map(({ seat, kind }) => ({
    seat,
    kind,
    damage: 0,
    knockdowns: 0,
  }));
  beginStage(room, 1, heroes);
}

export const lifecycle: LifecycleHooks<Room, Settings> = {
  stage: (room) => room.stage,
  maxWatchers: MAX_WATCHERS,
  parseSettings,
  botAvatar: BOT_AVATAR,
  start(room, matchId) {
    if (entrants(room).length) startRun(room, matchId);
  },
  // From "over" only (the netcode's rule): a won or lost run sets out again with whoever is seated now.
  rematch: startRun,
  lobby: toLobby,
};

/** Adds the stage's tallies, from its world, to the run's: once, as the stage ends. */
function bank(room: Room, world: World): void {
  room.tally = room.tally.map((row) => {
    const hero = world.heroes.find((each) => each.seat === row.seat);
    return hero
      ? {
          ...row,
          damage: row.damage + hero.damage,
          knockdowns: row.knockdowns + hero.knockdowns,
        }
      : row;
  });
}
/** The run is over: nothing is held from here on, no clock runs, and the next run's heroes are picked. */
function finish(room: Room, outcome: Outcome): void {
  room.stage = "over";
  room.outcome = outcome;
  room.until = 0;
  room.held = {};
}
/**
 * The stage-clear tally has shown. Past the last stage (`LAST_STAGE`) the run is won; otherwise the next stage begins
 * under the policy in design.md ("Stage flow"): each hero of the cleared world whose seat is still here (its slot held
 * by a member playing its hero: camp gives up a seat that leaves, and a newcomer may take the slot) sets out with the
 * lives it has, one that went out with one, and the magic pots it holds (`carryOf`), at full health with a fresh
 * continue, its tallies banked in the room. The hero belongs to its slot, not to a member: a newcomer in the freed
 * slot, or a bot added there, who plays the same hero carries it on as the one who left would, while one playing
 * another hero leaves it behind. With none of them left the run is over and the room an empty lobby.
 */
function nextStage(room: Room): void {
  if (room.round >= LAST_STAGE) return finish(room, "victory");
  const heroes: HeroEntry[] = [];
  for (const hero of room.world!.heroes) {
    const seat = seatAt(room, hero.seat);
    if (seat && heroOf(seat) === hero.kind)
      heroes.push({ seat: hero.seat, kind: hero.kind, carry: carryOf(hero) });
  }
  if (!heroes.length) return toLobby(room, room.matchId);
  beginStage(room, room.round + 1, heroes);
}

/** The seat's own entries at `tick`, from the stream generation its controls follow, in seq order. */
function ownEntries(
  seat: SeatRecord,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): Entry[] {
  const stream = streams.get(seat.id);
  const source =
    stream?.generation === seat.generation
      ? stream
      : stream?.retired?.find((old) => old.generation === seat.generation);
  return (source?.entries ?? [])
    .filter((entry) => entry[1] === tick)
    .sort((a, b) => a[0] - b[0]);
}

/**
 * Every hero's controls for one tick and its steps: a seat's latest bits this stage are held for every step, and
 * every entry it logged this tick is folded into the first (`first = last | every tap`), so a tap shorter than a
 * tick still presses. A bot's bits are `botInput`'s from the world as the tick begins, following the heroes present
 * players steer: every replica folds the same, and the room keeps none of them (the world holds what a bot pressed).
 * An absent or away seat holds nothing.
 */
function playTick(
  room: Room,
  world: World,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): World {
  const held: number[] = [],
    first: number[] = [];
  // A run holds every hero's seat for it (`consistent`), so a hero always has one.
  const seats = world.heroes.map((hero) => seatAt(room, hero.seat)!);
  const humans = world.heroes
    .filter((_, index) => !seats[index]!.bot && seats[index]!.connected)
    .map((hero) => hero.id);
  for (const [index, hero] of world.heroes.entries()) {
    const seat = seats[index]!;
    if (seat.bot) {
      held[hero.seat] = first[hero.seat] = botInput(world, hero.id, humans);
      continue;
    }
    let bits = 0,
      tapped = 0;
    if (seat.connected) {
      bits = room.held[seat.id] ?? 0;
      for (const entry of ownEntries(seat, streams, tick))
        if (
          entry[2] === PLAY &&
          entry[3] === room.matchId &&
          entry[4] === room.round
        ) {
          tapped |= entry[5] & INPUT_MASK;
          bits = entry[5] & INPUT_MASK;
        }
    }
    if (bits) room.held[seat.id] = bits;
    else delete room.held[seat.id];
    held[hero.seat] = bits;
    first[hero.seat] = bits | tapped;
  }
  return stepTick(world, held, first);
}

/**
 * Whether a hero of the run voted to continue it at `tick`: a CONTINUE for this run and stage from the seat of a hero
 * in the world, played by a present human. A bot logs nothing and a watcher plays no hero, so neither has a vote.
 */
function continues(
  room: Room,
  world: World,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): boolean {
  return world.heroes.some((hero) => {
    const seat = seatAt(room, hero.seat)!;
    return (
      !seat.bot &&
      seat.connected &&
      ownEntries(seat, streams, tick).some(
        (entry) =>
          entry[2] === CONTINUE &&
          entry[3] === room.matchId &&
          entry[4] === room.round,
      )
    );
  });
}

/**
 * A log tick of a run. While the continue countdown runs, a hero's CONTINUE revives the party first (`revive`: every
 * hero drops back in with every life, the waves keep their progress) and spends the stage's continue. Then the
 * controls and the steps. Then the stage flow, in this order: a cleared stage banks its tallies and shows them
 * (`between`), even if every hero has fallen meanwhile; a countdown that has run out loses the run; and a party
 * newly all out starts the countdown, or, with the continue spent, loses the run at once.
 */
function runTick(
  room: Room,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
  tick: number,
): void {
  if (room.until > 0 && continues(room, room.world!, streams, tick)) {
    room.world = revive(room.world!);
    room.until = 0;
    room.continued = true;
  }
  const world = (room.world = playTick(room, room.world!, streams, tick));
  if (stageCleared(world)) {
    bank(room, world);
    room.stage = "between";
    room.held = {};
    room.until = tick + CLEAR_TICKS;
  } else if (
    room.until > 0 ? tick >= room.until : defeated(world) && room.continued
  ) {
    bank(room, world);
    finish(room, "defeat");
  } else if (room.until === 0 && defeated(world))
    room.until = tick + CONTINUE_TICKS;
}

/**
 * One log tick: management first; then a run's tick (`runTick`), the stage-clear tally's clock between stages, or hero
 * picks in the lobby and after the run.
 */
export function foldTick(
  room: Room,
  creatorId: string,
  streams: ReadonlyMap<string, StreamEntries<Entry>>,
): never[] {
  const tick = room.tick + 1;
  applyManagementTick(room, tick, creatorId, streams, lifecycle);
  if (room.stage === "running") runTick(room, streams, tick);
  else if (room.stage === "between") {
    if (tick >= room.until) nextStage(room);
  } else if (picksApply(room.stage))
    // Each pick touches only its own seat, so the seats need no order.
    for (const seat of room.seats.values())
      if (!seat.watcher && !seat.bot && seat.connected)
        for (const entry of ownEntries(seat, streams, tick))
          if (entry[2] === PICK) seat.avatarId = entry[3];
  room.tick = tick;
  return [];
}

// ---- checkpoint ----
const FIELDS = 11;
const SEAT_KEYS = [
  "id",
  "name",
  "slot",
  "avatarId",
  "connected",
  "bot",
  "watcher",
  "generation",
  "away",
];
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

export function encode(room: Room): unknown[] {
  return [
    room.matchId,
    room.round,
    room.stage,
    { ...room.settings },
    [...room.seats.values()].sort(bySlot).map((seat) => ({ ...seat })),
    Object.entries(room.held).sort(([a], [b]) => (a < b ? -1 : 1)),
    room.world ? encodeWorld(room.world) : null,
    room.until,
    room.continued,
    room.outcome,
    room.tally.map((row) => [row.seat, row.kind, row.damage, row.knockdowns]),
  ];
}

/** One tally row, `[seat, kind, damage, knockdowns]`. */
function decodeTally(raw: unknown): Tally | undefined {
  if (
    !Array.isArray(raw) ||
    raw.length !== 4 ||
    !uint32(raw[0]) ||
    raw[0] >= CAPACITY ||
    !HERO_KINDS.includes(raw[1] as HeroKind) ||
    !uint32(raw[2]) ||
    !uint32(raw[3])
  )
    return;
  return {
    seat: raw[0],
    kind: raw[1] as HeroKind,
    damage: raw[2],
    knockdowns: raw[3],
  };
}

function decodeSeat(raw: unknown): SeatRecord | undefined {
  if (!plain(raw) || Object.keys(raw).some((key) => !SEAT_KEYS.includes(key)))
    return;
  const {
    id,
    name,
    slot,
    avatarId,
    connected,
    bot,
    watcher,
    generation,
    away,
  } = raw;
  if (
    !playerKey(id) ||
    !validName(name) ||
    typeof connected !== "boolean" ||
    typeof bot !== "boolean" ||
    (watcher !== undefined && watcher !== true) ||
    (away !== undefined && away !== true) ||
    (away === true && connected) ||
    (watcher ? slot !== -1 : !uint32(slot) || slot >= CAPACITY) ||
    (watcher
      ? avatarId !== ""
      : bot
        ? avatarId !== BOT_AVATAR
        : !isHero(avatarId)) ||
    (bot ? generation !== undefined || watcher === true : !uint32(generation))
  )
    return;
  return {
    id,
    name,
    slot: slot as number,
    avatarId: avatarId as string,
    connected,
    bot,
    ...(watcher ? { watcher: true } : {}),
    ...(generation !== undefined ? { generation: generation as number } : {}),
    ...(away ? { away: true } : {}),
  };
}

/**
 * Where the stage flow can stand, as the fold leaves it. A run in play has no outcome and an uncleared stage (a
 * cleared one moves on at once); its clock runs exactly while every hero is out, and only with the continue unspent,
 * for no more than the countdown. Between stages the stage is cleared and the tally's clock runs. Over, no clock
 * runs: a won run cleared the last stage, a lost one has every hero out.
 */
function flowHolds(room: Room, world: World): boolean {
  const cleared = stageCleared(world),
    clock = (span: number) =>
      room.until > room.tick && room.until <= room.tick + span;
  if (room.stage === "running")
    return (
      room.outcome === "" &&
      !cleared &&
      room.until > 0 === defeated(world) &&
      (room.until === 0 || (!room.continued && clock(CONTINUE_TICKS)))
    );
  if (room.stage === "between")
    return room.outcome === "" && cleared && clock(CLEAR_TICKS);
  return (
    room.until === 0 &&
    (room.outcome === "victory"
      ? cleared && room.round === LAST_STAGE
      : room.outcome === "defeat" && !cleared && defeated(world))
  );
}

/**
 * The run's banked tallies: a row per hero of the run in seat order. In stage 1 they are exactly the world's heroes:
 * nothing is banked while it runs, and once it has ended its own tallies are, exactly. A later stage's world has the
 * heroes still here, so the rows are at least those (a hero that left keeps its row), each the hero the world has in
 * that seat, and once the stage has ended a row holds at least that hero's tallies in it.
 */
function tallyHolds(room: Room, world: World): boolean {
  const banked = room.stage !== "running",
    rows = new Map(room.tally.map((row) => [row.seat, row]));
  if (room.round === 1 && room.tally.length !== world.heroes.length)
    return false;
  return (
    room.tally.every(
      (row, index) => index === 0 || row.seat > room.tally[index - 1]!.seat,
    ) &&
    world.heroes.every((hero) => {
      const row = rows.get(hero.seat);
      if (!row || row.kind !== hero.kind) return false;
      if (room.round === 1)
        return (
          row.damage === (banked ? hero.damage : 0) &&
          row.knockdowns === (banked ? hero.knockdowns : 0)
        );
      return (
        !banked ||
        (row.damage >= hero.damage && row.knockdowns >= hero.knockdowns)
      );
    })
  );
}

/**
 * What spans the fields. The lobby has no stage, no world, nothing held, no clock, no continue spent, no outcome and
 * no tallies. A run has a world: the one `beginStage` seeds for this run and stage, of that stage and with a hero at
 * least, run whole log ticks no later than this one; every hero's seat is held for it in play by a member playing that
 * hero, and only a human playing a hero holds bits, and only in play: the stage flow clears them as a stage ends, so
 * camp and a run that is over hold none and a pick after game over leaves a checkpoint that still decodes. The flow
 * and the tallies hold (`flowHolds`, `tallyHolds`).
 */
function consistent(room: Room): boolean {
  const world = room.world;
  if (!world)
    return (
      room.stage === "lobby" &&
      room.round === 0 &&
      Object.keys(room.held).length === 0 &&
      room.until === 0 &&
      !room.continued &&
      room.outcome === "" &&
      room.tally.length === 0
    );
  if (
    room.stage === "lobby" ||
    room.round === 0 ||
    world.step % STEPS_PER_TICK !== 0 ||
    world.step > room.tick * STEPS_PER_TICK ||
    world.seed !== seedOf(`${room.matchId}:${room.round}`) ||
    world.stage !== room.round ||
    world.heroes.length === 0 ||
    (room.stage !== "running" && Object.keys(room.held).length > 0) ||
    !flowHolds(room, world) ||
    !tallyHolds(room, world)
  )
    return false;
  const plays = (seat: SeatRecord | undefined) =>
    !!seat &&
    !seat.watcher &&
    world.heroes.some(
      (hero) => hero.seat === seat.slot && hero.kind === heroOf(seat),
    );
  return (
    Object.keys(room.held).every((id) => {
      const seat = room.seats.get(id);
      return plays(seat) && !seat!.bot;
    }) &&
    (room.stage !== "running" ||
      world.heroes.every((hero) => plays(seatAt(room, hero.seat))))
  );
}

export function decode(
  fields: readonly unknown[],
  tick: number,
): Room | undefined {
  if (fields.length !== FIELDS || !uint32(tick)) return;
  const [
    matchId,
    round,
    stage,
    rawSettings,
    rawSeats,
    rawHeld,
    rawWorld,
    until,
    continued,
    outcome,
    rawTally,
  ] = fields;
  const settings = parseSettings(rawSettings);
  if (
    !validMatchId(matchId) ||
    !uint32(round) ||
    round > LAST_STAGE ||
    !STAGES.includes(stage as Stage) ||
    !settings ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawHeld) ||
    rawHeld.length > CAPACITY ||
    !uint32(until) ||
    typeof continued !== "boolean" ||
    !OUTCOMES.includes(outcome as Outcome) ||
    !Array.isArray(rawTally) ||
    rawTally.length > CAPACITY
  )
    return;
  const tally: Tally[] = [];
  for (const raw of rawTally) {
    const row = decodeTally(raw);
    if (!row) return;
    tally.push(row);
  }
  const seats = new Map<string, SeatRecord>();
  for (const raw of rawSeats) {
    const seat = decodeSeat(raw);
    if (
      !seat ||
      seats.has(seat.id) ||
      (!seat.watcher &&
        [...seats.values()].some((s) => !s.watcher && s.slot === seat.slot))
    )
      return;
    seats.set(seat.id, seat);
  }
  if ([...seats.values()].filter((s) => s.watcher).length > MAX_WATCHERS)
    return;
  const held: Record<string, number> = {};
  for (const pair of rawHeld) {
    if (
      !Array.isArray(pair) ||
      pair.length !== 2 ||
      !playerKey(pair[0]) ||
      Object.hasOwn(held, pair[0]) ||
      !isInput(pair[1]) ||
      pair[1] === 0
    )
      return;
    held[pair[0]] = pair[1];
  }
  const world = rawWorld === null ? null : decodeWorld(rawWorld);
  if (world === undefined) return;
  const room: Room = {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    held,
    world,
    until,
    continued,
    outcome: outcome as Outcome,
    tally,
  };
  return consistent(room) ? room : undefined;
}

/** Two FNV-1a lanes over the whole room, keys sorted: 16 hex characters. */
export function hash(room: Room): string {
  const text = JSON.stringify([room.tick, ...encode(room)], (_key, value) =>
    plain(value)
      ? Object.fromEntries(
          Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)),
        )
      : (value as unknown),
  );
  let a = 0x811c9dc5,
    b = 0x9747b28c;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = Math.imul(b ^ text.charCodeAt(i), 0x01000193) >>> 0;
    b = (b ^ (b >>> 13)) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0");
}

export function view(room: Room): View {
  return {
    tick: room.tick * STEPS_PER_TICK,
    logTick: room.tick,
    stage: room.stage,
    matchId: room.matchId,
    round: room.round,
    settings: { ...room.settings },
    seats: [...room.seats.values()].sort(bySlot).map((seat) => ({
      id: seat.id,
      name: seat.name,
      slot: seat.slot,
      bot: seat.bot,
      connected: seat.connected,
      away: seat.away === true,
      watcher: seat.watcher === true,
      hero: seat.watcher ? null : heroOf(seat),
    })),
    world: room.world ? toView(room.world) : null,
    lastStage: LAST_STAGE,
    countdown: room.until > room.tick ? room.until - room.tick : 0,
    continued: room.continued,
    outcome: room.outcome,
    tally: room.tally.map((row) => {
      const hero = room.world?.heroes.find((each) => each.seat === row.seat),
        stage = hero
          ? { damage: hero.damage, knockdowns: hero.knockdowns }
          : { damage: 0, knockdowns: 0 };
      // While a stage runs nothing of it is banked yet; once it has ended the bank holds it.
      const live = room.stage === "running";
      return {
        seat: row.seat,
        kind: row.kind,
        stage,
        run: {
          damage: row.damage + (live ? stage.damage : 0),
          knockdowns: row.knockdowns + (live ? stage.knockdowns : 0),
        },
      };
    }),
  };
}

export const axeGame: RollbackGame<Room, Entry, View, never, Settings> = {
  id: "fuse-axe",
  rules: RULES,
  isEntry,
  createRoom,
  createTicker: () => foldTick,
  scope: (room) => ({ matchId: room.matchId, round: room.round }),
  clock: (room) => room.tick * STEPS_PER_TICK,
  steps: () => STEPS_PER_TICK,
  maxSteps: STEPS_PER_TICK,
  view,
  hash,
  checkpoint: { leading: FIELDS, encode, decode },
  members: (room) => [...room.seats.values()].sort(bySlot),
  seat: (room, id) => room.seats.get(id),
  stage: (room) => room.stage,
  settings: (room) => room.settings,
  seating: {
    capacity: CAPACITY,
    minPlayers: 1,
    maxWatchers: MAX_WATCHERS,
    seatName,
    isAvatar: isHero,
    defaultAvatar: DEFAULT_HERO,
    parseSettings,
    soloSettings: (settings) => ({ ...settings, display: false }),
    sharedScreen: (settings) => settings.display,
    botId(room, pending) {
      let number = 1;
      while (
        room.seats.has(`${BOT_PREFIX}${number}`) ||
        pending.has(`${BOT_PREFIX}${number}`)
      )
        number++;
      return `${BOT_PREFIX}${number}`;
    },
    botName: (slot) => BOT_NAMES[slot % BOT_NAMES.length]!,
    // Solo opens on the lobby's hero picker, where its host adds companions (+ BOT) before setting out.
    solo: { name: "Hero", bots: 0 },
  },
  text: {
    ...defaultText,
    solo: "Solo run",
    needTwo: "At least one hero must be seated to set out.",
    matchRunning: "A run is already under way",
    rematchLater: "REMATCH opens once the run is over",
  },
};
