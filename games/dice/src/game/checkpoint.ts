import { uint32, type SeatRecord, type Stage } from "fuse-netcode";
import {
  BETWEEN_TICKS,
  CAPACITY,
  MAX_PARTICIPANTS,
  MAX_POINTS,
  MAX_ROUNDS,
  MAX_TURN_TICKS,
  MAX_WATCHERS,
  WINS_NEEDED,
  isAvatar,
  parseSettings,
  playerKey,
  players,
  validName,
  type DiceRoom,
  type RosterEntry,
  type RoundRecord,
} from "./rules.js";

/**
 * The room as snapshot fields, and back. `decode` checks every field and how the fields fit together, and builds a
 * fresh room only once all of them pass: a corrupt or hostile snapshot yields `undefined`, never part of a room.
 */
const STAGES: readonly Stage[] = ["lobby", "running", "between", "over"];
/** The most a bot waits between entries (`botDelay`). */
const MAX_BOT_DELAY = 20;

export function encodeRoom(room: DiceRoom): unknown[] {
  return [
    [room.matchId, room.round, room.stage, room.rng, room.turnNo, room.rolls],
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
    [
      room.turn,
      room.turnTotal,
      room.deadline,
      room.nextAct,
      room.lastRoll,
      room.lastRoller,
      room.roundWinner,
      room.winner,
      room.resumeAt,
    ],
    [
      room.scores,
      room.wins,
      room.played,
      Object.entries(room.roster).map(([id, entry]) => [
        id,
        entry.name,
        entry.slot,
      ]),
      room.history.map((record) => [
        record.round,
        record.winnerId,
        record.scores,
      ]),
    ],
  ];
}

const plain = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const optionalId = (value: unknown): value is string =>
  value === "" || playerKey(value);

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
/** A record of counts keyed by known players, rebuilt as own data properties. */
function counts(
  raw: unknown,
  known: ReadonlySet<string>,
  most: number,
): Record<string, number> | undefined {
  if (!plain(raw)) return;
  const entries = Object.entries(raw);
  if (
    entries.length > MAX_PARTICIPANTS ||
    !entries.every(
      ([id, count]) => known.has(id) && uint32(count) && count <= most,
    )
  )
    return;
  return Object.fromEntries(entries) as Record<string, number>;
}

export function decodeRoom(
  fields: readonly unknown[],
  tick: number,
): DiceRoom | undefined {
  if (fields.length !== 5 || !uint32(tick)) return;
  const [header, rawSeats, rawSettings, rawTurn, tallies] = fields;
  if (
    !Array.isArray(header) ||
    header.length !== 6 ||
    !Array.isArray(rawSeats) ||
    rawSeats.length > CAPACITY + MAX_WATCHERS ||
    !Array.isArray(rawTurn) ||
    rawTurn.length !== 9 ||
    !Array.isArray(tallies) ||
    tallies.length !== 5
  )
    return;
  const [matchId, round, stage, rng, turnNo, rolls] = header;
  const settings = parseSettings(rawSettings);
  if (
    typeof matchId !== "string" ||
    !/^[\x21-\x7e]{1,64}$/.test(matchId) ||
    !uint32(round) ||
    round < 1 ||
    round > MAX_ROUNDS ||
    !STAGES.includes(stage as Stage) ||
    !uint32(rng) ||
    !uint32(turnNo) ||
    !uint32(rolls) ||
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

  const [rawScores, rawWins, rawPlayed, rawRoster, rawHistory] = tallies;
  if (
    !Array.isArray(rawRoster) ||
    rawRoster.length > MAX_PARTICIPANTS ||
    !Array.isArray(rawHistory) ||
    rawHistory.length > MAX_ROUNDS
  )
    return;
  const roster: Record<string, RosterEntry> = {};
  for (const raw of rawRoster) {
    if (!Array.isArray(raw) || raw.length !== 3) return;
    const [id, name, slot] = raw;
    if (
      !playerKey(id) ||
      Object.hasOwn(roster, id) ||
      !validName(name) ||
      !uint32(slot) ||
      slot >= CAPACITY
    )
      return;
    roster[id] = { name, slot };
  }
  const known = new Set(Object.keys(roster));
  const scores = counts(rawScores, known, MAX_POINTS),
    wins = counts(rawWins, known, WINS_NEEDED),
    played = counts(rawPlayed, known, MAX_ROUNDS);
  if (!scores || !wins || !played) return;
  const history: RoundRecord[] = [];
  for (const raw of rawHistory) {
    if (!Array.isArray(raw) || raw.length !== 3) return;
    const [at, winnerId, roundScores] = raw;
    const decided = counts(roundScores, known, MAX_POINTS);
    if (
      !uint32(at) ||
      at < 1 ||
      at > round ||
      // Rounds are decided in order, one record each.
      at <= (history.at(-1)?.round ?? 0) ||
      !known.has(winnerId as string) ||
      !decided
    )
      return;
    history.push({ round: at, winnerId: winnerId as string, scores: decided });
  }

  const [
    turn,
    turnTotal,
    deadline,
    nextAct,
    lastRoll,
    lastRoller,
    roundWinner,
    winner,
    resumeAt,
  ] = rawTurn;
  const turnSeat = typeof turn === "string" ? seats.get(turn) : undefined;
  if (
    !optionalId(turn) ||
    (turn !== "" && (stage !== "running" || !turnSeat || turnSeat.watcher)) ||
    !uint32(turnTotal) ||
    turnTotal > MAX_POINTS ||
    (turn === "" && turnTotal !== 0) ||
    !uint32(deadline) ||
    deadline > tick + MAX_TURN_TICKS ||
    !uint32(nextAct) ||
    nextAct > tick + MAX_BOT_DELAY ||
    !uint32(lastRoll) ||
    lastRoll > 6 ||
    !optionalId(lastRoller) ||
    (lastRoll === 0) !== (lastRoller === "") ||
    !optionalId(roundWinner) ||
    (roundWinner !== "" && !known.has(roundWinner)) ||
    !optionalId(winner) ||
    (stage === "over") !==
      (winner !== "" && (wins[winner] ?? 0) >= WINS_NEEDED) ||
    !uint32(resumeAt) ||
    resumeAt > tick + BETWEEN_TICKS ||
    (turn !== "" && turnNo === 0) ||
    // A round win is exactly one decided round.
    history.length > round ||
    Object.values(wins).reduce((sum, count) => sum + count, 0) !==
      history.length
  )
    return;
  return {
    tick,
    matchId,
    round,
    stage: stage as Stage,
    seats,
    settings,
    rng,
    turnNo,
    rolls,
    turn,
    turnTotal,
    deadline,
    nextAct,
    lastRoll,
    lastRoller,
    roundWinner,
    winner,
    resumeAt,
    scores,
    wins,
    played,
    roster,
    history,
  };
}

/** Canonical JSON (sorted keys, seats in slot then id order), then FNV-1a in two lanes: 16 hex characters. */
export function hashRoom(room: DiceRoom): string {
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
