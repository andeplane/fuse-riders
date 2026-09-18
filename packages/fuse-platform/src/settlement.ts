import { createHash } from "node:crypto";
import { calculateElo } from "./elo.js";
import { newRating, type Rating } from "./rating.js";
import type { AnyGame } from "./game.js";
import type { MatchRecord } from "./result.js";

/** The account every game shares. */
export interface Account {
  /** The name the account chose; what its player is called in every room of every game. Absent until chosen. */
  username?: string;
  /** The player name of the last credited match, from before usernames or from a device that was signed out of one. */
  name?: string;
  avatarId?: string;
  updatedAt: number;
}
export const ACCOUNT_KEYS = [
  "username",
  "name",
  "avatarId",
  "updatedAt",
] as const;
/**
 * One account as one game sees it: the shared account, that game's rating and that game's totals spread beside it
 * (`T`, from the game's registration). `rank` is filled in on read, never stored.
 */
export type Profile<T extends object = object> = Account &
  T & { rating?: Rating; rank?: number };

export interface RivalCredit {
  uid: string;
  opponent: string;
  name: string;
  kills: number;
  deaths: number;
  matches: number;
}
/** What one confirmed whole match adds to one account; `stats` is the game's `credit`. */
export interface Credit<C = unknown> {
  uid: string;
  name: string;
  avatarId?: string;
  at: number;
  stats: C;
}
export interface HistoryMutation<T> {
  match?: MatchRecord;
  credits?: Credit[];
  result: T;
}
export const opaqueOpponent = (uid: string): string =>
  createHash("sha256").update(`rider:${uid}`).digest("hex");
export function settlementUsers<T>(next: HistoryMutation<T>): string[] {
  return [
    ...new Set([
      ...(next.credits ?? []).map((c) => c.uid),
      ...Object.values(next.match?.uidByPlayer ?? {}),
    ]),
  ];
}
/**
 * Shared transaction body for memory and Firestore. All required profiles (of `game`) have been read before any
 * writes. The rules here are the platform's and the same for every game: totals only from whole matches, rivalries
 * once per pair, and a rating per round only when every player who stayed has reported, each on their own account.
 */
export function settleHistory<T>(
  game: AnyGame,
  next: HistoryMutation<T>,
  profiles: Map<string, Profile>,
  now: number,
  ratingClaimed: boolean,
): {
  profiles: Map<string, Profile>;
  rivals: RivalCredit[];
  claimed: boolean;
} {
  const updated = new Map<string, Profile>(),
    rivals: RivalCredit[] = [];
  const profileFor = (uid: string): Profile => {
    const existing = updated.get(uid);
    if (existing) return existing;
    const value = structuredClone(
      profiles.get(uid) ?? { updatedAt: 0, ...game.emptyTotals() },
    );
    updated.set(uid, value);
    return value;
  };
  for (const credit of next.credits ?? []) {
    const profile = profileFor(credit.uid);
    game.addTotals(profile, credit.stats);
    if (credit.at >= profile.updatedAt) {
      profile.name = credit.name;
      if (credit.avatarId) profile.avatarId = credit.avatarId;
    }
    profile.updatedAt = Math.max(profile.updatedAt, credit.at);
  }
  const match = next.match;
  if (!match || match.status !== "confirmed")
    return { profiles: updated, rivals, claimed: false };
  const linked = Object.entries(match.uidByPlayer).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const creditedPairs = new Set(match.rivalryPairs ?? []);
  const rivalsOf = game.rivals?.bind(game);
  for (
    let i = 0;
    rivalsOf && match.result.round === undefined && i < linked.length;
    i++
  )
    for (let j = i + 1; j < linked.length; j++) {
      const [a, aUid] = linked[i]!,
        [b, bUid] = linked[j]!,
        pair = `${a}:${b}`;
      if (creditedPairs.has(pair)) continue;
      const p = match.result.players.find((p) => p.playerId === a)!,
        q = match.result.players.find((p) => p.playerId === b)!;
      const outcome = rivalsOf(p, q);
      if (!outcome) continue;
      const { kills, deaths } = outcome;
      if (kills === 0 && deaths === 0) {
        creditedPairs.add(pair);
        continue;
      }
      rivals.push(
        {
          uid: aUid,
          opponent: opaqueOpponent(bUid),
          name: q.name,
          kills,
          deaths,
          matches: 1,
        },
        {
          uid: bUid,
          opponent: opaqueOpponent(aUid),
          name: p.name,
          kills: deaths,
          deaths: kills,
          matches: 1,
        },
      );
      creditedPairs.add(pair);
    }
  if (creditedPairs.size) match.rivalryPairs = [...creditedPairs];
  // Who could be rated is fixed by the agreed result: the humans who completed this individual round. A mid-round
  // leaver is left out rather than voiding the round for the players who stayed.
  const stayed = match.result.players.filter(
    (p) =>
      !game.isBot(p.playerId) &&
      match.result.finishers.includes(p.playerId) &&
      p.roundsPlayed === match.result.length &&
      p.earlyExits === 0,
  );
  // Settling waits for every one of them to report, so a player is never left out for reporting a moment later
  // than the rest; one who reports as a guest is then left out too.
  const humans = stayed.filter((p) => match.uidByPlayer[p.playerId]);
  const eligible =
    match.result.round !== undefined &&
    !ratingClaimed &&
    !match.ratings &&
    match.ratingScope &&
    stayed.every((p) => match.attesters.includes(p.playerId)) &&
    humans.length >= 1 &&
    new Set(humans.map((p) => match.uidByPlayer[p.playerId])).size ===
      humans.length;
  if (!eligible) return { profiles: updated, rivals, claimed: false };
  const field = humans.map((p) => ({
    id: p.playerId,
    rating: (
      profiles.get(match.uidByPlayer[p.playerId]!)?.rating ?? newRating()
    ).value,
    score: p.matchScoreUnits,
    wins: p.roundWins,
  }));
  const calculated = calculateElo(field, (id) => game.isBot(id));
  match.ratings = {};
  // All players share a timestamp later than their previous settlement, even if clocks step backwards.
  const at = Math.max(
    now,
    ...humans.map(
      (p) =>
        profiles.get(match.uidByPlayer[p.playerId]!)?.rating?.points.at(-1)
          ?.at ?? 0,
    ),
  );
  for (const player of field) {
    const profile = profileFor(match.uidByPlayer[player.id]!);
    const participant = match.result.players.find(
      (p) => p.playerId === player.id,
    )!;
    if (now >= profile.updatedAt) {
      profile.name = participant.name;
      profile.updatedAt = now;
    }
    const rating = profile.rating ?? newRating(),
      value = calculated.get(player.id)!;
    const point = {
      match: match.id,
      at,
      before: player.rating,
      after: value,
      round: match.result.round!,
      opponents: humans.length - 1,
    };
    profile.rating = {
      value,
      games: rating.games + 1,
      rounds: (rating.rounds ?? 0) + 1,
      peak: Math.max(rating.peak, value),
      points: [...rating.points, point].slice(-100),
    };
    match.ratings[player.id] = point;
  }
  return { profiles: updated, rivals, claimed: true };
}
