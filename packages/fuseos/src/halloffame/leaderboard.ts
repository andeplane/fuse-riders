/**
 * What the Hall of Fame shows of a game's leaderboard: the platform's `LeaderboardEntry`
 * (`fuse-platform/rating`), re-validated here because a response is a wire boundary and a
 * type is not a check. Mirrors `GET /api/games/<id>/leaderboard` -> `{ players: [...] }`.
 */
export interface HallOfFameEntry {
  rank: number;
  name: string;
  elo: number;
  /** Rated games settled for the player. */
  games: number;
  /** Individual rated rounds; absent on older settlements. */
  rounds?: number;
  avatarId?: string;
  publicId?: string;
  /** The caller's own seat, when the request carried a sign-in. The OS never signs in, so never set in practice. */
  you?: boolean;
}

/** The server lists at most this many; anything longer is not a leaderboard of ours. */
export const MAX_LEADERBOARD_ENTRIES = 50;
const MAX_NAME_LENGTH = 64;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isCount = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const isElo = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isFinite(value) &&
  Math.abs(value) < 1_000_000;
const isOptionalText = (value: unknown): value is string | undefined =>
  value === undefined ||
  (typeof value === "string" && value.length > 0 && value.length <= 128);

/** One listed player, or undefined when any field is off. Unknown fields are ignored: the server may add some. */
export function parseHallOfFameEntry(
  raw: unknown,
): HallOfFameEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const { rank, name, elo, games, rounds, avatarId, publicId, you } = raw;
  if (
    !isCount(rank) ||
    rank < 1 ||
    typeof name !== "string" ||
    name.trim().length === 0 ||
    name.length > MAX_NAME_LENGTH ||
    !isElo(elo) ||
    !isCount(games) ||
    (rounds !== undefined && (!isCount(rounds) || rounds > games)) ||
    !isOptionalText(avatarId) ||
    !isOptionalText(publicId) ||
    (you !== undefined && you !== true)
  )
    return undefined;
  return {
    rank,
    name,
    elo: Math.round(elo),
    games,
    ...(rounds === undefined ? {} : { rounds }),
    ...(avatarId === undefined ? {} : { avatarId }),
    ...(publicId === undefined ? {} : { publicId }),
    ...(you === undefined ? {} : { you }),
  };
}

/** The whole response body, or undefined when it is not a leaderboard. Ranks must not go backwards down the list. */
export function parseLeaderboard(raw: unknown): HallOfFameEntry[] | undefined {
  if (!isRecord(raw) || !Array.isArray(raw.players)) return undefined;
  if (raw.players.length > MAX_LEADERBOARD_ENTRIES) return undefined;
  const entries: HallOfFameEntry[] = [];
  for (const value of raw.players) {
    const entry = parseHallOfFameEntry(value);
    if (!entry) return undefined;
    const previous = entries.at(-1);
    if (previous && entry.rank < previous.rank) return undefined;
    entries.push(entry);
  }
  return entries;
}

export type HallOfFameColumn = "rank" | "name" | "elo" | "rounds" | "games";
export type SortDirection = "asc" | "desc";
export interface HallOfFameSort {
  column: HallOfFameColumn;
  direction: SortDirection;
}

/** Rank first, as the server lists it. */
export const DEFAULT_SORT: HallOfFameSort = {
  column: "rank",
  direction: "asc",
};

/** The order a first click on a column header gives: numbers biggest first, except rank; names A to Z. */
export function defaultDirection(column: HallOfFameColumn): SortDirection {
  return column === "rank" || column === "name" ? "asc" : "desc";
}

/** Clicking the sorted column flips it; clicking another column sorts by it in its natural direction. */
export function toggleSort(
  current: HallOfFameSort,
  column: HallOfFameColumn,
): HallOfFameSort {
  if (current.column !== column)
    return { column, direction: defaultDirection(column) };
  return {
    column,
    direction: current.direction === "asc" ? "desc" : "asc",
  };
}

function compare(
  a: HallOfFameEntry,
  b: HallOfFameEntry,
  column: HallOfFameColumn,
): number {
  switch (column) {
    case "name":
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    case "rounds":
      return (a.rounds ?? 0) - (b.rounds ?? 0);
    case "rank":
    case "elo":
    case "games":
      return a[column] - b[column];
  }
}

/** A stable sort by one column; ties keep the server's rank order so equal values never jitter. */
export function sortEntries(
  entries: readonly HallOfFameEntry[],
  sort: HallOfFameSort,
): HallOfFameEntry[] {
  const sign = sort.direction === "asc" ? 1 : -1;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort(
      (a, b) =>
        sign * compare(a.entry, b.entry, sort.column) || a.index - b.index,
    )
    .map(({ entry }) => entry);
}
