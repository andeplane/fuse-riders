/**
 * Product analytics: which riders reach a match, and what happened when they did.
 *
 * Eleven events, all prefixed `FlowRiders.`. Nothing fires per tick, per pickup or per explosion — a match's
 * detail rides along on `FlowRiders.Match Ended`, read from the same authoritative `matchStats` the recap
 * renders. The exception is weapons: `Kill` and `Miss` fire once per kill and once per shot that killed nobody,
 * after each round, so which powerup kills and how often it misses can be counted directly. This is separate from `telemetry.ts`, which posts raw
 * runtime diagnostics to the dev server; this posts product events to Mixpanel from real play.
 *
 * Off on LAN and local dev (a port in the address) so test rooms never reach the production project, on with
 * `?analytics=1` to verify a build, off outright with `?analytics=0`. The Mixpanel bundle is imported only
 * once analytics is on, so a LAN game never downloads it.
 */
import { TICK_HZ } from '../shared/game.js';
import { BOT_ID_PREFIX } from '../shared/bot-controller.js';
import type { MatchPlayerStats } from '../shared/match-stats.js';
import type { DecidedRound, RoundShot } from '../shared/shot-log.js';

type Mixpanel = (typeof import('mixpanel-browser'))['default'];

/** A Mixpanel project token is a write-only public identifier — every browser bundle reporting to a project ships one. It is not a credential and grants no read access. */
const TOKEN = 'b5022dd7fe5b3cd0396d84284ae647e6';
const PREFIX = 'FlowRiders.';
/**
 * Also the ordering guarantee: every `track` attaches its own reaction to this one promise, and same-promise
 * reactions run in the order they were attached, so calls made before Mixpanel loads still arrive in order.
 * They are not chained — attaching to the result of the previous `track` would serialise on each send instead.
 */
let client: Promise<Mixpanel> | undefined;

const OVERRIDE_KEY = 'fuse-analytics';

/**
 * The override sticks for the browser rather than riding the URL. `appUrl` replaces the query string on every
 * navigation out of the landing page — deliberately, so an invite can never inherit a capability — so a flag
 * read only from `location.search` would last exactly one page: `?analytics=0` would come back on at CREATE
 * ROOM, and `?analytics=1` could never reach the room half of the funnel it exists to verify.
 *
 * Only an exact `1` or `0` is honoured or stored. Treating any present value as "on" would make `?analytics=off`
 * and `?analytics=false` report a dev session into the production project, the opposite of what someone typing
 * them wants.
 */
export function analyticsOverride(search: string, storage: Pick<Storage, 'getItem' | 'setItem'>): string | null {
  const found = new URLSearchParams(search).get('analytics');
  try {
    if (found === '1' || found === '0') { storage.setItem(OVERRIDE_KEY, found); return found; }
    return storage.getItem(OVERRIDE_KEY);
  } catch { return found; }
}

export function analyticsEnabled(override: string | null, port: string): boolean {
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
  if (!analyticsEnabled(analyticsOverride(location.search, localStorage), location.port)) return;
  // localStorage over cookies: the game stores everything else there too, and a batch that outlives a navigation
  // is what lets CREATE ROOM report before the page it triggers replaces this one.
  client ??= import('mixpanel-browser').then(module => {
    module.default.init(TOKEN, {
      persistence: 'localStorage', track_pageview: false, autocapture: false,
      // A room page is `?room=AB42`, and that code is the whole join credential — there is no second token, so
      // anyone holding the URL can walk into the game. Mixpanel attaches `$current_url` and `$referrer` to every
      // event by default, which would ship a live invite to a third party on every seat, match and setting change.
      // The `*_domain` properties survive: they answer where players come from and carry no room code.
      property_blacklist: ['$current_url', '$referrer', '$initial_referrer'],
    });
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
/** Tenths, where whole seconds would put nearly every Gun, Target and Shell kill in the same bucket. */
const tenths = (ticks: number) => Math.round(ticks / TICK_HZ * 10) / 10;

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
      // Optional chaining rather than trust: this is built inside the host's publish loop, where a throw stops
      // the room publishing for everyone, so the invariant belongs here and not only in the code upstream.
      deathsWall: mine.deathsByCause?.wall,
      deathsTrail: mine.deathsByCause?.trail,
      deathsExplosion: mine.deathsByCause?.explosion,
      deathsRider: mine.deathsByCause?.rider,
    } : {}),
  };
}

export interface AnalyticsEvent { event: string; properties: Record<string, unknown> }

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
export interface RoundContext { round: number; riders: number; bots: number }
export function roundShotEvents(shots: readonly RoundShot[], playerId: string, { round, riders, bots }: RoundContext): AnalyticsEvent[] {
  const events: AnalyticsEvent[] = [];
  for (const shot of shots) {
    if (!playerId || shot.shooterId !== playerId) continue;
    const pulled = {
      weapon: shot.weapon, round, secondsIntoRound: tenths(shot.elapsed), bombs: shot.bombs,
      power: shot.power, extraBombs: shot.extraBombs, fuseLevel: shot.fuseLevel, grip: shot.grip, riders, bots,
    };
    if (shot.kills.length === 0) { events.push({ event: 'Miss', properties: pulled }); continue; }
    shot.kills.forEach((kill, index) => events.push({ event: 'Kill', properties: {
      ...pulled,
      victimBot: kill.victimId.startsWith(BOT_ID_PREFIX),
      shotKills: shot.kills.length,
      firstKillOfShot: index === 0,
      secondsToKill: tenths(kill.elapsed - shot.elapsed),
    } }));
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
  decided: DecidedRound | undefined, playerId: string, confirmedTick: number, reported: string, room: { riders: number; bots: number },
): { key: string; events: AnalyticsEvent[] } | undefined {
  if (!decided || !playerId || decided.tick > confirmedTick) return undefined;
  const key = `${decided.matchId}:${decided.round}:${playerId}`;
  if (key === reported) return undefined;
  return { key, events: roundShotEvents(decided.shots, playerId, { round: decided.round, ...room }) };
}
