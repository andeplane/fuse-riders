/** Fuse Riders product metrics, using the shared fuse.* event namespace and gameId. */
import { TICK_HZ } from "../engine/game.js";
import { BOT_ID_PREFIX } from "../engine/bot-controller.js";
import type { MatchPlayerStats } from "../engine/match-stats.js";
import type { DecidedRound, RoundShot } from "../engine/shot-log.js";

import {
  createAnalytics as createSharedAnalytics,
  createBrowserAnalytics,
  type AnalyticsEnvironment,
} from "fuse-ui/analytics";
export {
  EVENT_PREFIX,
  MIXPANEL_CONFIG,
  OPT_OUT_KEY,
  SDK_QUEUE_KEYS,
  analyticsOverride,
  analyticsEnabled,
  doNotTrackOn,
  analyticsStatus,
  type AnalyticsStatus,
  type AnalyticsEnvironment,
  type Analytics,
  type MixpanelLike,
} from "fuse-ui/analytics";

export const createAnalytics = (environment: AnalyticsEnvironment) =>
  createSharedAnalytics("fuse-riders", environment);
const page = createBrowserAnalytics("fuse-riders");
export const startAnalytics = page.start;
export const track = page.track;
export const analyticsStatusNow = page.status;
export const setAnalyticsOptOut = page.setOptOut;
export const onAnalyticsChange = page.onChange;
export const reportBootFailure = page.reportBootFailure;
export const reportGraphics = page.reportGraphics;

const seconds = (ticks: number) => Math.round(ticks / TICK_HZ);
/** Tenths, where whole seconds would put nearly every Gun and Shell kill in the same bucket. */
const tenths = (ticks: number) => Math.round((ticks / TICK_HZ) * 10) / 10;

/**
 * Identifies the snapshot that begins a match, or `undefined` for every other snapshot. Callers report a match
 * start whenever this returns a key they have not already reported.
 *
 * Keyed on the first round of a match id rather than on a phase transition: every round opens with its own
 * countdown, so `lobby -> countdown` would count rounds, and solo never passes through the lobby at all —
 * `LocalRuntime.start` seats four bots and starts the match before the first snapshot reaches the UI, so its
 * first observed phase is already `countdown`. A rematch takes a fresh match id and returns to round 1, so it
 * keys apart from the match before it; a device that joins at round 3 reports no start, which is the truth.
 */
export function matchStartKey(
  matchId: string,
  phase: string,
  round: number,
): string | undefined {
  return phase === "countdown" && round === 1
    ? `${matchId}:${round}`
    : undefined;
}

/**
 * One event per finished match, from the authoritative end-of-match stats. `playerId` is this device's rider:
 * a shared-TV display or a spectator has none, and reports only the shape of the match it watched.
 */
export function matchEndedProps(
  stats: readonly MatchPlayerStats[],
  playerId: string,
): Record<string, unknown> {
  const botCount = stats.filter((entry) =>
    entry.playerId.startsWith(BOT_ID_PREFIX),
  ).length;
  const mine = stats.find((entry) => entry.playerId === playerId);
  return {
    playerCount: stats.length,
    botCount,
    humanCount: stats.length - botCount,
    rounds: stats.reduce(
      (most, entry) => Math.max(most, entry.roundsPlayed),
      0,
    ),
    played: Boolean(mine),
    ...(mine
      ? {
          placement: mine.matchPlacement,
          won: mine.matchPlacement === 1,
          roundWins: mine.roundWins,
          eliminations: mine.eliminations,
          pickups: mine.pickupsCollected,
          bombsPlaced: mine.bombsPlaced,
          bombsExploded: mine.bombsExploded,
          distance: Math.round(mine.distanceUnits),
          survivalSeconds: seconds(mine.survivalTicks),
          // Optional chaining rather than trust: this is built inside the host's publish loop, where a throw stops
          // the room publishing for everyone, so the invariant belongs here and not only in the code upstream.
          deathsWall: mine.deathsByCause?.wall,
          deathsTrail: mine.deathsByCause?.trail,
          deathsExplosion: mine.deathsByCause?.explosion,
          deathsRider: mine.deathsByCause?.rider,
        }
      : {}),
  };
}

export interface AnalyticsEvent {
  event: string;
  properties: Record<string, unknown>;
}

/**
 * One `Kill` per rider this device's rider killed and one `Miss` per pull of its own that killed nobody, for a
 * decided round. Only the shooter's own device reports its shots, so every kill and miss is sent exactly once
 * however many devices are in the room; a shared-TV display and a spectator report none, and nobody reports a
 * bot's shots.
 *
 * Why after the round rather than live: replicas simulate ahead of confirmed input, and a rollback cannot retract
 * an event already sent, so a live kill could be one that never happened. See `decidedRoundReport` for when.
 *
 * `shotKills` is how many riders the pull killed, so a double kill is two `Kill` events that agree on it, and
 * `firstKillOfShot` marks exactly one of them: hit rate is `count(Kill where firstKillOfShot) / (that + count(Miss))`.
 *
 * Every event carries what might explain its outcome, so any of it can be a histogram's breakdown: the shooter's
 * upgrades at the pull (`power`, `extraBombs`, `fuseLevel`, `grip`), how many bombs the pull launched, and the room
 * it happened in (`riders`, `bots`).
 */
export interface RoundContext {
  round: number;
  riders: number;
  bots: number;
}
export function roundShotEvents(
  shots: readonly RoundShot[],
  playerId: string,
  { round, riders, bots }: RoundContext,
): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  for (const shot of shots) {
    if (!playerId || shot.shooterId !== playerId) continue;
    const pulled = {
      weapon: shot.weapon,
      round,
      secondsIntoRound: tenths(shot.elapsed),
      bombs: shot.bombs,
      power: shot.power,
      extraBombs: shot.extraBombs,
      fuseLevel: shot.fuseLevel,
      rangeLevel: shot.rangeLevel,
      grip: shot.grip,
      riders,
      bots,
    };
    if (shot.kills.length === 0) {
      events.push({ event: "Miss", properties: pulled });
      continue;
    }
    shot.kills.forEach((kill, index) =>
      events.push({
        event: "Kill",
        properties: {
          ...pulled,
          victimBot: kill.victimId.startsWith(BOT_ID_PREFIX),
          shotKills: shot.kills.length,
          firstKillOfShot: index === 0,
          secondsToKill: tenths(kill.elapsed - shot.elapsed),
        },
      }),
    );
  }
  return events;
}

/**
 * Whether this device should report a decided round now: the key to remember and the events to send, or `undefined`.
 *
 * A snapshot this device renders is its own prediction, so a decided round in it can still be undone by a late
 * packet. The round is final only once every connected rider's input is confirmed through the tick it was decided
 * at, which is what `confirmedTick` must be. The simulation keeps the decided log until the next round is decided,
 * so a device that catches up past the round-over pause in one jump still finds it here.
 *
 * The key names the rider as well as the round, so a second tab seated as a different rider still reports its own,
 * while a reload or a reopened tab of the same rider does not report the same round twice. A device with no rider
 * yet consumes nothing: it may learn its seat on the next snapshot.
 */
export function decidedRoundReport(
  decided: DecidedRound | undefined,
  playerId: string,
  confirmedTick: number,
  reported: string,
  room: { riders: number; bots: number },
): { key: string; events: AnalyticsEvent[] } | undefined {
  if (!decided || !playerId || decided.tick > confirmedTick) return undefined;
  const key = `${decided.matchId}:${decided.round}:${playerId}`;
  if (key === reported) return undefined;
  return {
    key,
    events: roundShotEvents(decided.shots, playerId, {
      round: decided.round,
      ...room,
    }),
  };
}
