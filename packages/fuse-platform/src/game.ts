import { LEGACY_GAME_ID, RoomError, validGameId } from "fuse-network-be";

/**
 * What the platform itself reads of one player's result. Every game reports these, under these names, beside its own
 * stats: attestation, early exits, rating eligibility and Elo are decided from them alone.
 */
export interface PlayerResult {
  /** The room seat's peer id (24 hex characters), or a bot id the game's `isBot` recognises. */
  playerId: string;
  name: string;
  /** Seat order; results are sorted by it, so equal results serialize to equal bytes. */
  slot: number;
  roundsPlayed: number;
  roundWins: number;
  /** The placement score Elo compares first; `roundWins` breaks ties. */
  matchScoreUnits: number;
  /** 1 for the winner; at most the number of players. */
  matchPlacement: number;
  /** A player who left early is never rated for the round. */
  earlyExits: number;
}

/** How often one player got the better of another in one match, as rivalries count it. */
export interface RivalOutcome {
  kills: number;
  deaths: number;
}

/**
 * A game's part of the shared backend. The platform owns attestation, settlement, Elo, ratings, leaderboards and
 * storage; the game owns what a player's stats are and what they add up to on an account.
 *
 * `P` is one player's stored result, `T` an account's totals in this game and `C` what one confirmed match adds to
 * them. `T` is stored spread into the account's standing document beside its rating, so its keys must not be one of
 * `RESERVED_KEYS`.
 */
export interface GameRegistration<
  P extends PlayerResult = PlayerResult,
  T extends object = object,
  C = unknown,
> {
  /** The gameId everywhere: rooms, match records, ratings, routes. Lowercase `[a-z0-9-]`, at most 32 characters. */
  readonly id: string;
  /** Bots never hold an account, never attest and are never rated. */
  isBot(playerId: string): boolean;
  /**
   * The runtime boundary for one reported or stored player: every field checked, unknown fields refused, and the
   * player rebuilt in one key order so that equal results hash equally whatever order a client sent. `rounds` is the
   * result's length, the bound for per-round counters.
   */
  parseStats(raw: unknown, rounds: number): P | undefined;
  /** Checks that need the whole field, e.g. that stats naming other players name players of this match. */
  validField?(players: readonly P[]): boolean;
  emptyTotals(): T;
  /** What one confirmed whole match adds to one account. Round receipts never credit totals. */
  credit(player: P, players: readonly P[]): C;
  addTotals(totals: T, credit: C): void;
  /**
   * The storage boundary for an account's totals: `document` is the whole standing document. Missing totals start
   * empty; totals that are present and malformed are undefined, which fails the read rather than overwriting them.
   */
  parseTotals(document: Record<string, unknown>): T | undefined;
  /** Rivalries between two signed-in players of a confirmed whole match; undefined when the result says nothing. */
  rivals?(player: P, opponent: P): RivalOutcome | undefined;
}

/** The account every game shares: a name, an avatar and when they last changed. */
export interface AccountRules {
  validName(value: unknown): value is string;
  validAvatar(value: unknown): value is string;
  /** What a refused rename is told. */
  nameRule: string;
  /** What a leaderboard shows for an account that never chose or played under a name. */
  fallbackName: string;
}

/** Fields of a standing document and profile that belong to the platform, never to a game's totals. */
export const RESERVED_KEYS: ReadonlySet<string> = new Set([
  "username",
  "name",
  "avatarId",
  "updatedAt",
  "rating",
  "rank",
  "ranked",
  "elo",
  "gameId",
  "uid",
]);

/**
 * A registration as the platform holds it. Its methods are only ever called with the players, totals and credits the
 * same registration produced, which is what method parameter bivariance lets a concrete registration promise here.
 */
export type AnyGame = GameRegistration<PlayerResult, object, unknown>;

/** The games one backend serves, and the account rules they share. */
export class Platform {
  readonly games: ReadonlyMap<string, AnyGame>;
  constructor(
    readonly account: AccountRules,
    games: readonly AnyGame[],
  ) {
    if (!games.length) throw new RangeError("Register at least one game");
    const registered = new Map<string, AnyGame>();
    for (const game of games) {
      if (!validGameId(game.id) || registered.has(game.id))
        throw new RangeError(`Invalid or duplicate game id: ${game.id}`);
      const reserved = Object.keys(game.emptyTotals()).filter((key) =>
        RESERVED_KEYS.has(key),
      );
      if (reserved.length)
        throw new RangeError(`${game.id} totals use ${reserved.join(", ")}`);
      registered.set(game.id, game);
    }
    this.games = registered;
  }
  /** The registration, or the refusal an unknown game gets at every boundary. */
  game(gameId: string): AnyGame {
    const game = this.games.get(gameId);
    if (!game) throw new RoomError(404, "Unknown game");
    return game;
  }
  get gameIds(): string[] {
    return [...this.games.keys()];
  }
}

/**
 * The game from before match records, rooms and routes carried a gameId. Its records without one are its own, its
 * routes have no `/api/games/` prefix, and its ratings and totals stay on the user document; every other game keeps
 * them in `${prefix}-ratings`. See docs/design/multi-game.md.
 */
export const userDocumentGame = (gameId: string): boolean =>
  gameId === LEGACY_GAME_ID;
export { LEGACY_GAME_ID };
