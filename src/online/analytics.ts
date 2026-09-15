/**
 * Product analytics: which riders reach a match, and what happened when they did.
 *
 * Nine events, all prefixed `FlowRiders.`. Nothing fires per tick, per pickup or per explosion — a match's
 * detail rides along on `FlowRiders.Match Ended`, read from the same authoritative `matchStats` the recap
 * renders, so a busy arena still costs one event. This is separate from `telemetry.ts`, which posts raw
 * runtime diagnostics to the dev server; this posts product events to Mixpanel from real play.
 *
 * Off on LAN and local dev (a port in the address) so test rooms never reach the production project, on with
 * `?analytics=1` to verify a build, off outright with `?analytics=0`. The Mixpanel bundle is imported only
 * once analytics is on, so a LAN game never downloads it.
 */
import { TICK_HZ } from '../shared/game.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import type { MatchPlayerStats } from '../shared/match-stats.js';

type Mixpanel = (typeof import('mixpanel-browser'))['default'];

/** A Mixpanel project token is a write-only public identifier — every browser bundle reporting to a project ships one. It is not a credential and grants no read access. */
const TOKEN = 'b5022dd7fe5b3cd0396d84284ae647e6';
const PREFIX = 'FlowRiders.';
/** Also the queue: every `track` chains off it, so calls made before Mixpanel loads still arrive, in order. */
let client: Promise<Mixpanel> | undefined;

/**
 * Only `analytics=1` turns reporting on and only `analytics=0` turns it off; any other value falls through to
 * the address. Treating "present" as on would make `?analytics=off` and `?analytics=false` report a dev session
 * into the production project, which is the opposite of what someone typing them wants.
 */
export function analyticsEnabled(search: string, port: string): boolean {
  const override = new URLSearchParams(search).get('analytics');
  if (override === '1') return true;
  if (override === '0') return false;
  return port === '';
}

/**
 * Safe to call more than once: the landing page, a room and the boot-failure path all call it, and only the
 * first loads Mixpanel. Every call registers its super properties, so a later caller merges over an earlier
 * one's — which is what the boot-failure path wants when it reports against a room that had already started.
 */
export function startAnalytics(superProperties: Record<string, unknown>): void {
  if (!analyticsEnabled(location.search, location.port)) return;
  // localStorage over cookies: the game stores everything else there too, and a batch that outlives a navigation
  // is what lets CREATE ROOM report before the page it triggers replaces this one.
  client ??= import('mixpanel-browser').then(module => {
    module.default.init(TOKEN, { persistence: 'localStorage', track_pageview: false, autocapture: false });
    return module.default;
  });
  void client.then(mixpanel => mixpanel.register(superProperties)).catch(() => { /* analytics never breaks the game */ });
}

/**
 * Never name a property `length`. Mixpanel's bundled Underscore-style `each` treats any object whose `length`
 * is a number as an array, so a single `length` key makes it iterate indices instead of keys and the whole
 * property bag — super properties included — is dropped silently, with a 200 back from the API. Room settings
 * call theirs `length`; they are reported as `matchLength`.
 */
export function track(event: string, properties?: Record<string, unknown>): void {
  void client?.then(mixpanel => mixpanel.track(PREFIX + event, properties)).catch(() => { /* analytics never breaks the game */ });
}

const seconds = (ticks: number) => Math.round(ticks / TICK_HZ);

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
export function matchStartKey(matchId: string, phase: string, round: number): string | undefined {
  return phase === 'countdown' && round === 1 ? `${matchId}:${round}` : undefined;
}

/**
 * One event per finished match, from the authoritative end-of-match stats. `playerId` is this device's rider:
 * a shared-TV display or a spectator has none, and reports only the shape of the match it watched.
 */
export function matchEndedProps(stats: readonly MatchPlayerStats[], playerId: string): Record<string, unknown> {
  const botCount = stats.filter(entry => entry.playerId.startsWith(BOT_ID_PREFIX)).length;
  const mine = stats.find(entry => entry.playerId === playerId);
  return {
    playerCount: stats.length,
    botCount,
    humanCount: stats.length - botCount,
    rounds: stats.reduce((most, entry) => Math.max(most, entry.roundsPlayed), 0),
    played: Boolean(mine),
    ...(mine ? {
      placement: mine.matchPlacement,
      won: mine.matchPlacement === 1,
      roundWins: mine.roundWins,
      eliminations: mine.eliminations,
      pickups: mine.pickupsCollected,
      bombsPlaced: mine.bombsPlaced,
      bombsExploded: mine.bombsExploded,
      distance: Math.round(mine.distanceUnits),
      survivalSeconds: seconds(mine.survivalTicks),
      deathsWall: mine.deathsByCause.wall,
      deathsTrail: mine.deathsByCause.trail,
      deathsExplosion: mine.deathsByCause.explosion,
      deathsRider: mine.deathsByCause.rider,
    } : {}),
  };
}
