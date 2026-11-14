import { CCBS_DATA as data } from "../ddr/ccbsData";

/**
 * The Norwegian DDR tournament results kept by CCBS (ccbs.sesse.net), 2002–2012: Challenge Cup seasons, the
 * Euromix 2 series, the Norwegian championships and the 2012 reunion. Fetched once for FuseOS and bundled; the
 * players in it are real people, so the simulation only ever cites them (CCBSbot's answers), never voices them.
 */
export type Tournament = {
  id: number;
  name: string;
  season: string;
  place: string;
  date: string;
  machine: string;
  /** Final ranking, best first: [player, points]. Empty where CCBS has no ranking list. */
  top: readonly (readonly [string, number])[];
};

export const CCBS_SOURCE = data.source;

export const TOURNAMENTS: readonly Tournament[] = data.tournaments.map(
  (entry) => ({
    ...entry,
    top: entry.top.map(
      ([player, points]) => [String(player), Number(points)] as const,
    ),
  }),
);

/** A player's name without the club tag: `Snute (HDC)` is `Snute`. */
export function playerName(entry: string): string {
  return entry.replace(/\s*\([^)]*\)\s*$/, "");
}

export function ranked(
  tournaments: readonly Tournament[] = TOURNAMENTS,
): Tournament[] {
  return tournaments.filter((tournament) => tournament.top.length > 0);
}

export function latest(
  tournaments: readonly Tournament[] = TOURNAMENTS,
): Tournament | undefined {
  // Team events rank teams ("Lag 1"), not players; the latest individual event is the one worth quoting.
  return ranked(tournaments)
    .filter((tournament) => !/lag/i.test(tournament.name))
    .at(-1);
}

/** Finds a tournament by id or by words in its name or season ("cc 3 2004", "reunion", "nm05 single"). */
export function findTournament(
  query: string,
  tournaments: readonly Tournament[] = TOURNAMENTS,
): Tournament | undefined {
  const trimmed = query.trim().toLowerCase();
  if (/^\d+$/.test(trimmed))
    return tournaments.find((t) => t.id === Number(trimmed));
  const words = trimmed
    .replace(/\bcc\b/g, "challenge cup")
    .split(/[\s#-]+/)
    .filter((word) => word.length > 0);
  if (words.length === 0) return undefined;
  const matches = ranked(tournaments).filter((t) => {
    const haystack = `${t.name} ${t.season} ${t.date}`.toLowerCase();
    const tokens = haystack.split(/[^a-z0-9æøå]+/);
    // A number must be a whole word ("1" is not the 1 in "2003-11-23"); other words may be part of one.
    return words.every((word) =>
      /^\d+$/.test(word) ? tokens.includes(word) : haystack.includes(word),
    );
  });
  return matches.at(-1);
}

export type PlayerRecord = {
  name: string;
  events: number;
  wins: number;
  podiums: number;
  best: { rank: number; tournament: Tournament } | undefined;
};

export function playerRecord(
  query: string,
  tournaments: readonly Tournament[] = TOURNAMENTS,
): PlayerRecord | undefined {
  const wanted = query.trim().toLowerCase();
  if (wanted.length === 0) return undefined;
  let name: string | undefined;
  let events = 0;
  let wins = 0;
  let podiums = 0;
  let best: PlayerRecord["best"];
  for (const tournament of ranked(tournaments)) {
    const index = tournament.top.findIndex(
      ([player]) => playerName(player).toLowerCase() === wanted,
    );
    if (index === -1) continue;
    name = playerName(tournament.top[index]?.[0] ?? query);
    events += 1;
    if (index === 0) wins += 1;
    if (index < 3) podiums += 1;
    if (!best || index + 1 < best.rank) best = { rank: index + 1, tournament };
  }
  return name === undefined ? undefined : { name, events, wins, podiums, best };
}

export function seasons(
  tournaments: readonly Tournament[] = TOURNAMENTS,
): string[] {
  return [...new Set(ranked(tournaments).map((t) => t.season))];
}

/** One line per podium place: `1. Tom (100)  2. Snute (90)  3. Th0rny (81)`. */
export function podium(tournament: Tournament, places = 3): string {
  return tournament.top
    .slice(0, places)
    .map(([player, points], index) => `${index + 1}. ${player} (${points})`)
    .join("  ");
}

export function describe(tournament: Tournament): string {
  return `${tournament.name} - ${tournament.date}, ${tournament.place} (${tournament.machine})`;
}
