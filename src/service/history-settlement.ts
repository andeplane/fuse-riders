import { createHash } from "node:crypto";
import { calculateElo } from "../shared/elo.js";
import { emptyBuckets, mergeCareer } from "../shared/career-stats.js";
import { newRating } from "../shared/rating.js";
import {
  emptyTotals,
  TOTAL_KEYS,
  type Credit,
  type MatchRecord,
  type UserProfile,
} from "./history.js";
export interface RivalCredit {
  uid: string;
  opponent: string;
  name: string;
  kills: number;
  deaths: number;
  matches: number;
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
/** Shared transaction body for memory and Firestore. All required profiles have been read before any writes. */
export function settleHistory<T>(
  next: HistoryMutation<T>,
  profiles: Map<string, UserProfile>,
  now: number,
  ratingClaimed: boolean,
): {
  profiles: Map<string, UserProfile>;
  rivals: RivalCredit[];
  claimed: boolean;
} {
  const updated = new Map<string, UserProfile>(),
    rivals: RivalCredit[] = [];
  const profileFor = (uid: string): UserProfile => {
    const existing = updated.get(uid);
    if (existing) return existing;
    const value = structuredClone(
      profiles.get(uid) ?? { updatedAt: 0, totals: emptyTotals() },
    );
    updated.set(uid, value);
    return value;
  };
  for (const credit of next.credits ?? []) {
    const profile = profileFor(credit.uid);
    for (const key of TOTAL_KEYS) profile.totals[key] += credit.totals[key];
    if (credit.at >= profile.updatedAt) {
      profile.name = credit.name;
      if (credit.avatarId) profile.avatarId = credit.avatarId;
    }
    profile.updatedAt = Math.max(profile.updatedAt, credit.at);
    if (credit.career) {
      profile.career ??= emptyBuckets();
      mergeCareer(profile.career[credit.career.group], credit.career.stats);
    }
  }
  const match = next.match;
  if (!match || match.status !== "confirmed")
    return { profiles: updated, rivals, claimed: false };
  const linked = Object.entries(match.uidByPlayer).sort(([a], [b]) =>
    a.localeCompare(b),
  );
  const creditedPairs = new Set(match.rivalryPairs ?? []);
  for (let i = 0; i < linked.length; i++)
    for (let j = i + 1; j < linked.length; j++) {
      const [a, aUid] = linked[i]!,
        [b, bUid] = linked[j]!,
        pair = `${a}:${b}`;
      if (creditedPairs.has(pair)) continue;
      const p = match.result.players.find((p) => p.playerId === a)!,
        q = match.result.players.find((p) => p.playerId === b)!;
      if (!p.combat || !q.combat) continue;
      const kills = p.combat.victims[b] ?? 0,
        deaths = q.combat.victims[a] ?? 0;
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
  const humans = match.result.players.filter(
    (p) => !p.playerId.startsWith("bot:"),
  );
  const eligible =
    !ratingClaimed &&
    !match.ratings &&
    match.ratingScope &&
    humans.length >= 2 &&
    humans.every(
      (p) =>
        match.uidByPlayer[p.playerId] &&
        match.attesters.includes(p.playerId) &&
        match.result.finishers.includes(p.playerId) &&
        p.roundsPlayed === match.result.length &&
        p.earlyExits === 0,
    ) &&
    new Set(linked.map(([, uid]) => uid)).size === humans.length;
  if (!eligible) return { profiles: updated, rivals, claimed: false };
  const field = humans.map((p) => ({
    id: p.playerId,
    rating: (
      profiles.get(match.uidByPlayer[p.playerId]!)?.rating ?? newRating()
    ).value,
    score: p.matchScoreUnits,
    wins: p.roundWins,
  }));
  const calculated = calculateElo(field);
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
    const rating = profile.rating ?? newRating(),
      value = calculated.get(player.id)!;
    const point = { match: match.id, at, before: player.rating, after: value };
    profile.rating = {
      value,
      games: rating.games + 1,
      peak: Math.max(rating.peak, value),
      points: [...rating.points, point].slice(-100),
    };
    match.ratings[player.id] = point;
  }
  return { profiles: updated, rivals, claimed: true };
}
