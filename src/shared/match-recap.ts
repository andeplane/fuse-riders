import { durationText } from './duration-text.js';
import type { MatchPlayerStats } from './match-stats.js';
import { CUT_OFF_MAX_AGE_TICKS, MOMENT_KINDS, momentKey, type Moment, type MomentKind } from './moments.js';

/**
 * Pure end-of-match presentation model shared by the LAN TV and the online UI.
 * It only reads authoritative `MatchPlayerStats`; it never invents or rescores data.
 * Durations use the formatter added by #55, relocated from `src/client/` to `src/shared/` so this
 * module — which `src/online/` renders too — keeps one implementation without importing client code.
 */
export { durationText };
export const RECAP_KICKER = 'MATCH COMPLETE // AFTER ACTION REPORT';
export const RECAP_TITLE = 'Grid legends';
export const RECAP_EMPTY_MESSAGE = 'Compiling the after action report…';
export const COMPARISON_KEY = 'BOMBS = EXPLODED / PLACED   ·   DEATHS = WALL / TRAIL / BLAST / RIDER';
export const PODIUM_PLACES = 3;

export function distanceText(units: number): string {
  return `${Math.round(Math.max(0, units))}u`;
}

/** Placement first, then seat order, so ties keep a stable, explainable order. */
export function orderedStats(stats: ReadonlyArray<MatchPlayerStats>): MatchPlayerStats[] {
  return [...stats].sort((a, b) => a.matchPlacement - b.matchPlacement || a.slot - b.slot || a.playerId.localeCompare(b.playerId));
}

/** Changes whenever any rendered figure changes; renderers use it to skip identical rebuilds. */
export function recapSignature(stats: ReadonlyArray<MatchPlayerStats>, moments: ReadonlyArray<Moment> = []): string {
  const figures = orderedStats(stats).map((entry) => [entry.playerId, entry.matchPlacement, entry.roundsPlayed, entry.roundWins, entry.roundsDrawn, entry.survivalTicks,
    entry.longestSurvivalTicks, entry.distanceUnits, entry.bombsPlaced, entry.bombsExploded, entry.eliminations, entry.pickupsCollected,
    entry.invulnerableTicks, entry.wallBounces, entry.earlyExits, entry.powerPickups, entry.starPickups, entry.beerPickups, entry.inkPickups,
    entry.triplePickups, entry.fivePickups, entry.targetPickups, entry.shieldPickups, entry.portalPickups, entry.portalTransits,
    entry.deathsByCause.wall, entry.deathsByCause.trail, entry.deathsByCause.explosion, entry.deathsByCause.rider].join(':')).join('|');
  return moments.length ? `${figures}#${moments.map((moment) => `${moment.kind}:${moment.round}:${moment.tick}:${moment.playerId}:${moment.value}`).join(',')}` : figures;
}

export const HIGHLIGHTS_TITLE = 'HIGHLIGHT REEL';
/** Cards on the reel, and how many may share one kind or one protagonist so five bomb dodges never fill it. */
export const RECAP_HIGHLIGHTS = 5;
export const HIGHLIGHT_VARIETY = 2;

export interface HighlightEntry {
  /** `momentKey` of the moment, what a screen looks a replay clip up by. */
  key: string;
  kind: MomentKind;
  round: number;
  tick: number;
  /** `ROUND 2 · 0:37`: the round and the time into it. */
  when: string;
  title: string;
  icon: string;
  copy: string;
  playerId: string;
  name: string;
  color: string;
  score: number;
}

/** Presentation weight only (ADR 043): kills outrank survivals, and a play that took several riders outranks one that took one. */
export function highlightScore(moment: Moment): number {
  switch (moment.kind) {
    case 'multiKill': return moment.value >= 3 ? 100 : 60;
    case 'directHit': return 70;
    case 'boxedIn': return 50;
    case 'trickShot': return 45 + 5 * Math.min(moment.value, 3);
    case 'bombDodge': return 35;
    case 'cutOff': return 30 + 2 * Math.max(0, CUT_OFF_MAX_AGE_TICKS - moment.value);
    case 'mutualDestruction': return 25;
    case 'ownGoal': return 12;
  }
}

export function clockText(ticks: number): string {
  const seconds = Math.max(0, Math.floor(ticks / 20));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 'S'}`;
const list = (names: readonly string[]): string => names.join(' + ');
const HIGHLIGHT_COPY: Record<MomentKind, { icon: string; title: (moment: Moment) => string; copy: (name: string, targets: readonly string[], moment: Moment) => string }> = {
  multiKill: { icon: '✹', title: (moment) => moment.value >= 4 ? 'GRID WIPE' : moment.value === 3 ? 'TRIPLE TAP' : 'DOUBLE TAP', copy: (name, targets) => `${name} TOOK OUT ${list(targets)} AT ONCE` },
  directHit: { icon: '◎', title: () => 'BULLSEYE', copy: (name, targets) => `${name} BOMBED ${list(targets)} ON THE HEAD` },
  trickShot: { icon: '↯', title: () => 'BANK SHOT', copy: (name, targets, moment) => `${name} BANKED ${plural(moment.value, 'BOUNCE')} INTO ${list(targets)}` },
  cutOff: { icon: '⟋', title: () => 'CUT OFF', copy: (name, targets, moment) => `${name} CUT OFF ${list(targets)} · TRAIL ${(moment.value / 20).toFixed(1)}s OLD` },
  boxedIn: { icon: '▣', title: () => 'BOXED IN', copy: (name, targets) => `${list(targets)} HAD NOWHERE LEFT TO GO · ${name}'S TRAIL` },
  bombDodge: { icon: '✧', title: () => 'OUT OF THE FIRE', copy: (name, targets, moment) => `${name} LEFT ${list(targets)}'S BLAST ZONE ${Math.max(0, moment.value)}u CLEAR` },
  ownGoal: { icon: '☹', title: () => 'OWN GOAL', copy: (name) => `${name} BOOMED THEMSELVES` },
  mutualDestruction: { icon: '✖', title: () => 'EVERYBODY DIES', copy: (name, targets, moment) => `${list([name, ...targets])} · ${plural(moment.value, 'RIDER')}, ONE TICK` },
};

export interface MomentCard { title: string; icon: string; copy: string; when: string }
/** Title, icon, copy and clock for one moment; `name` resolves a rider id, falling back to the id itself. */
export function describeMoment(moment: Moment, name: (id: string) => string): MomentCard {
  const text = HIGHLIGHT_COPY[moment.kind];
  return { title: text.title(moment), icon: text.icon, copy: text.copy(name(moment.playerId), moment.targetIds.map(name), moment), when: `ROUND ${moment.round} · ${clockText(moment.elapsed)}` };
}

/** Heaviest first, then earlier, then kind order: the order the reel and the replay pick from. */
export function rankMoments(moments: ReadonlyArray<Moment>): { moment: Moment; score: number }[] {
  return moments.map((moment) => ({ moment, score: highlightScore(moment) })).sort((a, b) =>
    b.score - a.score || a.moment.round - b.moment.round || a.moment.tick - b.moment.tick || MOMENT_KINDS.indexOf(a.moment.kind) - MOMENT_KINDS.indexOf(b.moment.kind));
}

/**
 * The reel: moments ranked by presentation score (then earlier, then kind order), one card per
 * `(round, tick, protagonist)` so a bomb that hit a head and took two riders is one card, and at most
 * `HIGHLIGHT_VARIETY` cards per kind and per protagonist. Riders are named from the statistics; a rider
 * unknown to them (which validation forbids) falls back to its id.
 */
export function matchHighlights(stats: ReadonlyArray<MatchPlayerStats>, moments: ReadonlyArray<Moment>): HighlightEntry[] {
  const byId = new Map(stats.map((entry) => [entry.playerId, entry]));
  const name = (id: string): string => byId.get(id)?.name ?? id;
  const ranked = rankMoments(moments);
  const seen = new Set<string>();
  const perKind = new Map<MomentKind, number>();
  const perRider = new Map<string, number>();
  const reel: HighlightEntry[] = [];
  for (const { moment, score } of ranked) {
    if (reel.length >= RECAP_HIGHLIGHTS) break;
    const key = `${moment.round}:${moment.tick}:${moment.playerId}`;
    if (seen.has(key)) continue;
    if ((perKind.get(moment.kind) ?? 0) >= HIGHLIGHT_VARIETY || (perRider.get(moment.playerId) ?? 0) >= HIGHLIGHT_VARIETY) continue;
    // Only a card that made the reel claims its play; a capped kind leaves the play to its next-best telling.
    seen.add(key);
    perKind.set(moment.kind, (perKind.get(moment.kind) ?? 0) + 1);
    perRider.set(moment.playerId, (perRider.get(moment.playerId) ?? 0) + 1);
    reel.push({
      key: momentKey(moment), kind: moment.kind, round: moment.round, tick: moment.tick, ...describeMoment(moment, name),
      playerId: moment.playerId, name: name(moment.playerId), color: byId.get(moment.playerId)?.color ?? '#ffffff', score,
    });
  }
  return reel;
}

export interface PodiumEntry {
  playerId: string;
  name: string;
  color: string;
  placement: number;
  roundWins: number;
  champion: boolean;
  placeLabel: string;
  winsLabel: string;
}

/**
 * Riders placed 1..3 in display order: champions (every rider sharing placement 1) sit in the
 * centre, remaining podium places split evenly to either side. Placements are authoritative and
 * already share ties (1, 1, 3), so a tied first shows two champions and no second place.
 */
export function podiumOrder(stats: ReadonlyArray<MatchPlayerStats>): PodiumEntry[] {
  const placed = orderedStats(stats).filter((entry) => entry.matchPlacement >= 1 && entry.matchPlacement <= PODIUM_PLACES);
  const champions = placed.filter((entry) => entry.matchPlacement === 1);
  const runners = placed.filter((entry) => entry.matchPlacement !== 1);
  const centerAt = Math.ceil(runners.length / 2);
  return [...runners.slice(0, centerAt), ...champions, ...runners.slice(centerAt)].map((entry) => ({
    playerId: entry.playerId,
    name: entry.name,
    color: entry.color,
    placement: entry.matchPlacement,
    roundWins: entry.roundWins,
    champion: entry.matchPlacement === 1,
    placeLabel: entry.matchPlacement === 1 ? '♛  #1' : `#${entry.matchPlacement}`,
    winsLabel: `${entry.roundWins} ROUND ${entry.roundWins === 1 ? 'WIN' : 'WINS'}`,
  }));
}

export type AwardId = 'demolition' | 'trailblazer' | 'untouchable' | 'collector' | 'headhunter' | 'lastStand' | 'gateCrasher' | 'wallRider';

export interface AwardDefinition {
  id: AwardId;
  title: string;
  icon: string;
  value(entry: MatchPlayerStats): number;
  detail(value: number): string;
}

/** Every award reads one recorded counter; nothing here is derived from presentation state. */
export const AWARD_DEFINITIONS: ReadonlyArray<AwardDefinition> = [
  { id: 'demolition', title: 'DEMOLITION EXPERT', icon: '✹', value: (entry) => entry.bombsExploded, detail: (value) => `${value} ${value === 1 ? 'BOMB' : 'BOMBS'} BOOMED` },
  { id: 'trailblazer', title: 'TRAILBLAZER', icon: '⌁', value: (entry) => entry.distanceUnits, detail: (value) => `${distanceText(value)} TRAVELLED` },
  { id: 'untouchable', title: 'UNTOUCHABLE', icon: '✦', value: (entry) => entry.survivalTicks, detail: (value) => `${durationText(value)} ALIVE` },
  { id: 'collector', title: 'COLLECTOR', icon: '◆', value: (entry) => entry.pickupsCollected, detail: (value) => `${value} ${value === 1 ? 'POWER-UP' : 'POWER-UPS'}` },
  { id: 'headhunter', title: 'HEADHUNTER', icon: '☠', value: (entry) => entry.eliminations, detail: (value) => `${value} ${value === 1 ? 'RIDER' : 'RIDERS'} TAKEN OUT` },
  { id: 'lastStand', title: 'LAST STAND', icon: '⏱', value: (entry) => entry.longestSurvivalTicks, detail: (value) => `${durationText(value)} BEST ROUND` },
  { id: 'gateCrasher', title: 'GATE CRASHER', icon: '◎', value: (entry) => entry.portalTransits, detail: (value) => `${value} PORTAL ${value === 1 ? 'JUMP' : 'JUMPS'}` },
  { id: 'wallRider', title: 'WALL RIDER', icon: '⟁', value: (entry) => entry.wallBounces, detail: (value) => `${value} WALL ${value === 1 ? 'BOUNCE' : 'BOUNCES'}` },
];

export interface MatchAward {
  id: AwardId;
  title: string;
  icon: string;
  /** Every rider whose counter equals the best value, in placement order; joined with ' + ' for display. */
  winners: ReadonlyArray<{ playerId: string; name: string; color: string }>;
  winnerText: string;
  value: number;
  detail: string;
}

/**
 * Awards whose best value is above zero, in definition order. Ties share the award (all tied riders
 * are winners). Empty statistics and all-zero counters produce no awards rather than a placeholder.
 */
export function matchAwards(stats: ReadonlyArray<MatchPlayerStats>): MatchAward[] {
  const ordered = orderedStats(stats);
  if (!ordered.length) return [];
  const awards: MatchAward[] = [];
  for (const definition of AWARD_DEFINITIONS) {
    const best = Math.max(...ordered.map((entry) => definition.value(entry)));
    if (!(best > 0)) continue;
    const winners = ordered.filter((entry) => definition.value(entry) === best).map((entry) => ({ playerId: entry.playerId, name: entry.name, color: entry.color }));
    awards.push({ id: definition.id, title: definition.title, icon: definition.icon, winners, winnerText: winners.map((winner) => winner.name).join(' + '), value: best, detail: definition.detail(best) });
  }
  return awards;
}

export interface ComparisonRow {
  playerId: string;
  name: string;
  color: string;
  placement: number;
  riderLabel: string;
  riderNote: string;
  wins: string;
  survived: string;
  best: string;
  distance: string;
  bombs: string;
  eliminations: string;
  pickups: string;
  star: string;
  deaths: string;
}

export type ComparisonColumnKey = Exclude<keyof ComparisonRow, 'playerId' | 'name' | 'color' | 'placement' | 'riderLabel' | 'riderNote'>;

export const COMPARISON_COLUMNS: ReadonlyArray<{ key: ComparisonColumnKey; label: string }> = [
  { key: 'wins', label: 'WINS' },
  { key: 'survived', label: 'SURVIVED' },
  { key: 'best', label: 'BEST' },
  { key: 'distance', label: 'DIST' },
  { key: 'bombs', label: 'BOMBS' },
  { key: 'eliminations', label: 'KOs' },
  { key: 'pickups', label: 'PICKUPS' },
  { key: 'star', label: 'STAR' },
  { key: 'deaths', label: 'DEATHS' },
];

export function comparisonRows(stats: ReadonlyArray<MatchPlayerStats>): ComparisonRow[] {
  return orderedStats(stats).map((entry) => {
    const deaths = entry.deathsByCause;
    return {
      playerId: entry.playerId,
      name: entry.name,
      color: entry.color,
      placement: entry.matchPlacement,
      riderLabel: `#${entry.matchPlacement} ${entry.name}`,
      riderNote: `${entry.wallBounces} BOUNCE · ${entry.earlyExits} EXIT`,
      wins: String(entry.roundWins),
      survived: durationText(entry.survivalTicks),
      best: durationText(entry.longestSurvivalTicks),
      distance: distanceText(entry.distanceUnits),
      bombs: `${entry.bombsExploded}/${entry.bombsPlaced}`,
      eliminations: String(entry.eliminations),
      pickups: `${entry.pickupsCollected} · XP${entry.powerPickups} S${entry.starPickups} 🍺${entry.beerPickups} I${entry.inkPickups} T${entry.triplePickups} F${entry.fivePickups} A${entry.targetPickups} O${entry.shieldPickups} P${entry.portalPickups}/${entry.portalTransits}`,
      star: durationText(entry.invulnerableTicks),
      deaths: `W${deaths.wall} T${deaths.trail} X${deaths.explosion} R${deaths.rider}`,
    };
  });
}

export interface MatchTotal {
  label: string;
  value: string;
}

/** Whole-match totals summed from the recorded counters; empty statistics give no totals. */
export function matchTotals(stats: ReadonlyArray<MatchPlayerStats>): MatchTotal[] {
  if (!stats.length) return [];
  const sum = (pick: (entry: MatchPlayerStats) => number) => stats.reduce((total, entry) => total + pick(entry), 0);
  const rounds = Math.max(...stats.map((entry) => entry.roundsPlayed));
  const draws = Math.max(...stats.map((entry) => entry.roundsDrawn));
  const deaths = sum((entry) => entry.deathsByCause.wall + entry.deathsByCause.trail + entry.deathsByCause.explosion + entry.deathsByCause.rider);
  return [
    { label: 'ROUNDS', value: draws > 0 ? `${rounds} · ${draws} DRAWN` : String(rounds) },
    { label: 'RIDERS', value: String(stats.length) },
    { label: 'BOMBS', value: `${sum((entry) => entry.bombsExploded)}/${sum((entry) => entry.bombsPlaced)}` },
    { label: 'KOs', value: String(sum((entry) => entry.eliminations)) },
    { label: 'CRASHES', value: String(deaths) },
    { label: 'DISTANCE', value: distanceText(sum((entry) => entry.distanceUnits)) },
    { label: 'POWER-UPS', value: String(sum((entry) => entry.pickupsCollected)) },
    { label: 'PORTAL JUMPS', value: String(sum((entry) => entry.portalTransits)) },
  ];
}

export interface MatchRecap {
  signature: string;
  podium: PodiumEntry[];
  awards: MatchAward[];
  totals: MatchTotal[];
  comparison: ComparisonRow[];
  highlights: HighlightEntry[];
}

export function buildMatchRecap(stats: ReadonlyArray<MatchPlayerStats>, moments: ReadonlyArray<Moment> = []): MatchRecap {
  return { signature: recapSignature(stats, moments), podium: podiumOrder(stats), awards: matchAwards(stats), totals: matchTotals(stats), comparison: comparisonRows(stats), highlights: matchHighlights(stats, moments) };
}
