import { ACTION, BOT, JOIN, type StreamEntries } from "fuse-netcode";
import {
  AVATARS,
  BRIEFING,
  CAPACITY,
  DEFAULT_SETTINGS,
  GOALS,
  HANDOFF,
  READY,
  createRoom,
  decodeRoom,
  encodeRoom,
  foldTick,
  fuseLaneView,
  seatName,
  validGoal,
  validMatchId,
  type FuseLaneEntry,
  type FuseLaneEvent,
  type FuseLaneRoom,
  type FuseLaneView,
  type Goals,
} from "../game/index.js";

/**
 * A match played on one device: solo against bots, or hot-seat with up to four people passing the phone. It is the
 * same pure fold an online room runs (`foldTick`), driven here with one stream per human and no network: each tick
 * folds whatever the device logged for the player whose turn it is. A checkpoint of the room is all a save needs.
 */
export interface LocalSetup {
  /** Who plays on this device, 1 to 4, each with a name and an avatar. */
  humans: { name: string; avatar: string }[];
  /** Bot opponents, so that humans + bots is 1 to 5. */
  bots: number;
  /** Bot level: 0 easy, 1 normal, 2 hard. */
  level: number;
  goals: Goals;
  weekSeconds: number;
  /** The match id, which seeds every roll: a fresh one per game. */
  seed: string;
}

export const MAX_HUMANS = 4;
export const humanId = (index: number) => `p${index + 1}`;
const BOT_NAMES = ["Jones", "Morgan", "Riley", "Casey"];

/** The setup as the menu may send it: every field checked, or undefined. */
export function validSetup(setup: LocalSetup): boolean {
  const total = setup.humans.length + setup.bots;
  return (
    setup.humans.length >= 1 &&
    setup.humans.length <= MAX_HUMANS &&
    Number.isInteger(setup.bots) &&
    setup.bots >= 0 &&
    total <= CAPACITY &&
    setup.humans.every(
      (human) =>
        seatName(human.name) === human.name &&
        (AVATARS as readonly string[]).includes(human.avatar),
    ) &&
    new Set(setup.humans.map((human) => human.name)).size ===
      setup.humans.length &&
    [0, 1, 2].includes(setup.level) &&
    setup.goals.length === 4 &&
    setup.goals.every(validGoal) &&
    [45, 60, 90].includes(setup.weekSeconds) &&
    validMatchId(setup.seed)
  );
}

export interface SavedMatch {
  v: 1;
  tick: number;
  room: unknown[];
  humans: string[];
}

export class LocalMatch {
  private seq = 0;
  private pending = new Map<string, unknown[][]>();
  private constructor(
    readonly room: FuseLaneRoom,
    /** The human seats' ids, in seat order. */
    readonly humans: readonly string[],
  ) {}

  /** A new match from the menu's setup: seats, bots and goals logged by the first human, then the start. */
  static create(setup: LocalSetup): LocalMatch {
    if (!validSetup(setup)) throw new Error("Invalid setup");
    const room = createRoom(setup.seed, {
      ...DEFAULT_SETTINGS,
      weekSeconds: setup.weekSeconds,
      turns: true,
      level: setup.level,
    });
    const humans = setup.humans.map((_, index) => humanId(index));
    const match = new LocalMatch(room, humans);
    const host = humans[0]!;
    match.pending.set(host, [
      ...setup.humans.map((human, slot) => [
        JOIN,
        humanId(slot),
        human.name,
        slot,
        human.avatar,
        1,
      ]),
      ...Array.from({ length: setup.bots }, (_, index) => {
        const slot = setup.humans.length + index;
        return [
          BOT,
          "add",
          `bot:${index + 1}`,
          BOT_NAMES[index] ?? `Bot ${index + 1}`,
          slot,
        ];
      }),
    ]);
    match.step();
    for (const id of humans)
      match.pending.set(id, [[GOALS, 0, ...setup.goals]]);
    match.step();
    match.pending.set(host, [[ACTION, "start", setup.seed]]);
    match.step();
    return match;
  }

  /** A saved match, or undefined when the save does not decode (another version, a damaged store). */
  static resume(saved: unknown): LocalMatch | undefined {
    if (saved === null || typeof saved !== "object") return;
    const { v, tick, room: fields, humans } = saved as Partial<SavedMatch>;
    if (
      v !== 1 ||
      !Number.isSafeInteger(tick) ||
      !Array.isArray(fields) ||
      !Array.isArray(humans)
    )
      return;
    const room = decodeRoom(fields, tick!);
    if (
      !room ||
      room.stage !== "running" ||
      !room.turns ||
      humans.length < 1 ||
      new Set(humans).size !== humans.length ||
      !humans.every(
        (id) =>
          typeof id === "string" &&
          room.seats.has(id) &&
          !room.seats.get(id)!.bot,
      ) ||
      // Every person seated plays on this device: a seat nobody here can play would stall its turn for ever.
      ![...room.seats.values()].every(
        (seat) => seat.bot || (humans as unknown[]).includes(seat.id),
      )
    )
      return;
    return new LocalMatch(room, humans as string[]);
  }

  save(): SavedMatch {
    return {
      v: 1,
      tick: this.room.tick,
      room: encodeRoom(this.room),
      humans: [...this.humans],
    };
  }

  /** Whose turn it is on this device, or "" between turns. */
  current(): string {
    const room = this.room;
    if (room.stage !== "running" || room.phase === BRIEFING) return "";
    return room.order[room.turn] ?? "";
  }

  /**
   * Logs a play entry body for the next tick: READY on Monday is every human's (the device is everyone's), anything
   * else is the current player's. Returns false when nobody can take it.
   */
  play(body: readonly unknown[]): boolean {
    const room = this.room;
    if (room.stage !== "running") return false;
    const ids =
      room.phase === BRIEFING
        ? body[0] === READY
          ? [...this.humans]
          : []
        : [this.current()].filter((id) => this.humans.includes(id));
    for (const id of ids) {
      const list = this.pending.get(id) ?? [];
      list.push([...body]);
      this.pending.set(id, list);
    }
    return ids.length > 0;
  }

  /** Folds one tick with what the device logged since the last one. */
  step(): FuseLaneEvent[] {
    const tick = this.room.tick + 1,
      streams = new Map<string, StreamEntries<FuseLaneEntry>>();
    for (const [id, bodies] of this.pending)
      streams.set(id, {
        generation: 1,
        entries: bodies.map(
          (body) => [++this.seq, tick, ...body] as FuseLaneEntry,
        ),
      });
    this.pending.clear();
    return foldTick(this.room, this.humans[0]!, streams);
  }

  view(): FuseLaneView {
    return fuseLaneView(this.room);
  }

  /** Waiting on a person (a handoff) rather than on the clock. */
  waiting(): boolean {
    return this.room.stage === "running" && this.room.phase === HANDOFF;
  }
}
