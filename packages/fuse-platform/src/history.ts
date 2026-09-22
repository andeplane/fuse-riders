import { createHash } from "node:crypto";
import {
  RoomError,
  digest,
  peerId,
  roomGameId,
  validCode,
  validToken,
  type RoomStore,
} from "fuse-network-be";
import {
  LEGACY_GAME_ID,
  type AnyGame,
  type GameRegistration,
  type Platform,
  type PlayerResult,
} from "./game.js";
import {
  SOLO_RATING_PLAYER_ID,
  type LeaderboardEntry,
  type RatingPoint,
  type Rivalries,
} from "./rating.js";
import {
  attestationsNeeded,
  humansOf,
  matchRecordId,
  parseMatchResult,
  plain,
  type MatchRecord,
  type MatchResult,
} from "./result.js";
import type { Credit, HistoryMutation, Profile } from "./settlement.js";
import { publicIdOf } from "./friends.js";

/**
 * Match history for every game. Gameplay is peer-to-peer, so the service never sees a match: every player's device
 * reports the result it computed and a result is kept once a majority of the players named in it have reported the
 * same one.
 *
 * A result is identified by its own content, so two devices that disagree create two records rather than competing
 * for one. A forged result can therefore never displace the honest one; without a majority of its own players it stays
 * pending and expires.
 */

export interface HistoryDatabase {
  /**
   * Like RoomDatabase.transact: the operation is pure and may be retried. Credits commit atomically with the match,
   * settled by `gameId`'s registration into that game's standing.
   */
  transactMatch<T>(
    gameId: string,
    id: string,
    operation: (current: MatchRecord | undefined) => HistoryMutation<T>,
  ): Promise<T>;
  /**
   * Confirmed whole games of one game, every player's, newest first and strictly before `before`.
   *
   * `before` is a `feedAt` in milliseconds, so two games confirmed in the same millisecond on a page boundary can
   * cost one of them its listing. A tie-proof cursor would have to page on `(feedAt, document id)`, which no test
   * here can exercise against Firestore; see docs/design/PLAYER-STATS.md.
   */
  recentMatches(
    gameId: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]>;
  /** Confirmed matches of an account in one game, newest first. */
  matchesFor(
    gameId: string,
    uid: string,
    before: number | undefined,
    limit: number,
  ): Promise<MatchRecord[]>;
  profile(gameId: string, uid: string): Promise<Profile | undefined>;
  leaderboard(gameId: string, uid?: string): Promise<LeaderboardEntry[]>;
  rank(gameId: string, elo: number): Promise<number>;
  rivals(gameId: string, uid: string): Promise<Rivalries>;
  /** The account's name in every game. */
  setUsername(uid: string, username: string, at: number): Promise<void>;
}

export const PENDING_TTL_MS = 24 * 3_600_000;
export const GUEST_MATCH_TTL_MS = 30 * 24 * 3_600_000;
export const HISTORY_PAGE = 20;
const RENAMES_PER_HOUR = 20,
  SUBMISSIONS_PER_HOUR = 40,
  SUBMISSIONS_PER_ADDRESS_PER_HOUR = 240,
  LINKS_PER_HOUR = 30,
  READS_PER_HOUR = 300;

/** A seat proven by its room token, in a room of `gameId`. Only GameHistory.admit and admitSolo make one. */
export interface Reporter {
  gameId: string;
  code: string;
  rider: string;
  incarnation: string;
}
/**
 * What anyone may see of a confirmed game: every player's stats, which seat was the caller's own, and the public id
 * of every seat an account owns (for adding that player as a friend). Never a room code, never an account id itself,
 * never a round receipt.
 */
export interface FeedEntry<P extends PlayerResult = PlayerResult> {
  id: string;
  endedAt: number;
  you?: string;
  avatars: Record<string, string>;
  /** Seat id to public id, for the seats an account owns. */
  accounts: Record<string, string>;
  result: MatchResult<P>;
}
export type SubmitOutcome = {
  status: "pending" | "confirmed";
  attestations: number;
  needed: number;
  linked: boolean;
};
/**
 * What an account may see of a match: every player's stats, which seat was its own and the public id of every seat an
 * account owns; never another player's account itself.
 */
export interface HistoryEntry<P extends PlayerResult = PlayerResult> {
  rating?: RatingPoint;
  id: string;
  endedAt: number;
  roomCode: string;
  you?: string;
  attestations: number;
  avatars: Record<string, string>;
  accounts: Record<string, string>;
  result: MatchResult<P>;
}

/** Every seat an account owns, as the public id other players may address. */
const publicSeats = (record: MatchRecord): Record<string, string> =>
  Object.fromEntries(
    Object.entries(record.uidByPlayer).map(([seat, owner]) => [
      seat,
      publicIdOf(owner),
    ]),
  );

/**
 * Solo play has no room, so no incarnation; the account stands in for one. The legacy game keeps the form it always
 * had, so its record ids and rating scopes do not move; any other game's solo rounds are kept apart by its id.
 */
const soloIncarnation = (gameId: string, uid: string): string =>
  gameId === LEGACY_GAME_ID ? `solo:${uid}` : `solo:${gameId}:${uid}`;

/** Every game's history, over one database and one room store. */
export class HistoryStore {
  private views = new Map<string, GameHistory>();
  constructor(
    readonly platform: Platform,
    private database: HistoryDatabase,
    private rooms: RoomStore,
    private now: () => number,
  ) {}
  /**
   * One game's history, by id or by the registration itself (which types the view). An unregistered game is refused
   * with 404.
   */
  game<
    P extends PlayerResult = PlayerResult,
    T extends object = object,
    C = unknown,
  >(registration: string | GameRegistration<P, T, C>): GameHistory<P, T> {
    const game = this.platform.game(
      typeof registration === "string" ? registration : registration.id,
    );
    if (typeof registration !== "string" && registration !== game)
      throw new RangeError(`${game.id} is registered differently`);
    let view = this.views.get(game.id);
    if (!view) {
      view = new GameHistory(
        game,
        this.platform,
        this.database,
        this.rooms,
        this.now,
      );
      this.views.set(game.id, view);
    }
    return view as GameHistory<P, T>;
  }
}

/** One game's history; `P` and `T` are its registration's player and totals, for callers that know them. */
export class GameHistory<
  P extends PlayerResult = PlayerResult,
  T extends object = object,
> {
  constructor(
    readonly game: AnyGame,
    private platform: Platform,
    private database: HistoryDatabase,
    private rooms: RoomStore,
    private now: () => number,
  ) {}

  /**
   * A rate-limit key for this game. Budgets are per game, so one game's play cannot spend another's; the legacy
   * game keeps its keys exactly as they were. Keys for one room and rider need no scope (a room serves one game) and
   * the rename budget is the shared account's; a per-address budget is scoped like any other.
   */
  private limit(key: string): string {
    return digest(
      this.game.id === LEGACY_GAME_ID ? key : `${this.game.id}:${key}`,
    );
  }

  /** Runtime boundary for a result of this game. */
  parseResult(raw: unknown): MatchResult<P> | undefined {
    return parseMatchResult(this.game, this.platform.account, raw) as
      MatchResult<P> | undefined;
  }

  /**
   * Who is reporting, decided from the room token alone and before anything costly: the HTTP layer reads the body and
   * verifies a sign-in only for a caller this has accepted. Room tokens are free to mint, so the address is limited too.
   * A room of another game is refused like a room that is not there.
   */
  async admit(
    code: string,
    token: string,
    address: string,
    roundReport = false,
  ): Promise<Reporter> {
    if (!validCode(code) || !validToken(token))
      throw new RoomError(401, "Invalid identity");
    const room = await this.rooms.get(code),
      rider = peerId(token),
      member = room.members[rider];
    if (roomGameId(room) !== this.game.id)
      throw new RoomError(404, "Room is for another game");
    if (!member || member.expiresAt <= this.now())
      throw new RoomError(403, "Join the room first");
    const allowed =
      (await this.rooms.database.allowance(
        digest(`${roundReport ? "round-results" : "results"}:${code}:${rider}`),
        this.now(),
        roundReport ? 600 : SUBMISSIONS_PER_HOUR,
      )) &&
      (await this.rooms.database.allowance(
        this.limit(
          `${roundReport ? "round-results" : "results"}-address:${address}`,
        ),
        this.now(),
        roundReport ? 3000 : SUBMISSIONS_PER_ADDRESS_PER_HOUR,
      ));
    if (!allowed) throw new RoomError(429, "Too many results; try later");
    return {
      gameId: this.game.id,
      code,
      rider,
      incarnation: room.incarnation,
    };
  }

  /** Local solo play has no room transport. Only an authenticated zero-change round can use this path. */
  async admitSolo(uid: string, address: string): Promise<Reporter> {
    const allowed =
      (await this.rooms.database.allowance(
        this.limit(`solo-round:${uid}`),
        this.now(),
        600,
      )) &&
      (await this.rooms.database.allowance(
        this.limit(`solo-round-address:${address}`),
        this.now(),
        3000,
      ));
    if (!allowed) throw new RoomError(429, "Too many solo rounds; try later");
    return {
      gameId: this.game.id,
      code: "SO00",
      rider: SOLO_RATING_PLAYER_ID,
      incarnation: soloIncarnation(this.game.id, uid),
    };
  }

  async submitSolo(
    reporter: Reporter,
    body: unknown,
    uid: string,
  ): Promise<SubmitOutcome> {
    const result = plain(body) ? this.parseResult(body.result) : undefined;
    if (
      !result ||
      result.round === undefined ||
      humansOf(this.game, result).length !== 1 ||
      humansOf(this.game, result)[0] !== SOLO_RATING_PLAYER_ID ||
      result.finishers.length !== 1 ||
      result.finishers[0] !== SOLO_RATING_PLAYER_ID ||
      reporter.incarnation !== soloIncarnation(this.game.id, uid)
    )
      throw new RoomError(
        400,
        "Solo reports must contain one signed-in human round",
      );
    return this.submit(reporter, body, uid);
  }

  /** One player's report. `uid` is that player's own verified account, or undefined for a guest; nothing in the body can name one. */
  async submit(
    reporter: Reporter,
    body: unknown,
    uid: string | undefined,
  ): Promise<SubmitOutcome> {
    const { code, rider } = reporter,
      game = this.game;
    if (reporter.gameId !== game.id)
      throw new RoomError(400, "Report for another game");
    if (
      !plain(body) ||
      !Object.keys(body).every(
        (key) => key === "result" || key === "avatarId",
      ) ||
      (body.avatarId !== undefined &&
        !this.platform.account.validAvatar(body.avatarId))
    )
      throw new RoomError(400, "Invalid match result");
    const result = this.parseResult(body.result),
      avatarId = body.avatarId as string | undefined;
    if (!result) throw new RoomError(400, "Invalid match result");
    const needed = attestationsNeeded(result);
    if (!humansOf(game, result).includes(rider))
      throw new RoomError(403, "Only a rider in the match can report it");
    // Only an account makes a record permanent, and fresh room tokens are free, so the per-rider limit above cannot
    // bound permanent storage. This one can: past it a report still counts, as a guest's, and the record expires.
    const account =
      uid !== undefined &&
      (await this.rooms.database.allowance(
        this.limit(
          `${result.round === undefined ? "link" : "round-link"}:${uid}`,
        ),
        this.now(),
        result.round === undefined ? LINKS_PER_HOUR : 600,
      ))
        ? uid
        : undefined;
    if (
      result.round !== undefined &&
      uid !== undefined &&
      account === undefined
    )
      throw new RoomError(429, "Too many rated rounds; try later");
    const id = matchRecordId(reporter.incarnation, result),
      player = result.players.find((entry) => entry.playerId === rider)!;
    const creditFor = (
      owner: string,
      seat: PlayerResult,
      avatar: string | undefined,
      at: number,
      players: PlayerResult[],
    ): Credit => ({
      uid: owner,
      name: seat.name,
      ...(avatar === undefined ? {} : { avatarId: avatar }),
      at,
      stats: game.credit(seat, players),
    });
    return this.database.transactMatch(game.id, id, (current) => {
      // Record ids hash a room incarnation, and a room serves one game; this only fails on a forged or corrupt record.
      if (current && current.gameId !== game.id)
        throw new RoomError(409, "Match belongs to another game");
      const now = this.now();
      const match: MatchRecord = current
        ? structuredClone(current)
        : {
            gameId: game.id,
            version: 1,
            ratingScope: createHash("sha256")
              .update(
                JSON.stringify([
                  reporter.incarnation,
                  result.matchId,
                  result.round ?? "game",
                ]),
              )
              .digest("hex")
              .slice(0, 40),
            id,
            roomCode: code,
            status: "pending",
            result,
            attesters: [],
            uidByPlayer: {},
            avatars: {},
            participantUids: [],
            createdAt: now,
            expiresAt: now + PENDING_TTL_MS,
          };
      const credits: Credit[] = [];
      if (!match.attesters.includes(rider)) match.attesters.push(rider);
      if (avatarId !== undefined) match.avatars[rider] = avatarId;
      // One account per seat and one seat per account: a second device on the same account reports, but is not credited twice.
      const linking =
        account !== undefined &&
        match.uidByPlayer[rider] === undefined &&
        !Object.values(match.uidByPlayer).includes(account);
      if (linking) match.uidByPlayer[rider] = account;
      if (
        match.status === "pending" &&
        match.attesters.filter((id) => result.finishers.includes(id)).length >=
          needed
      ) {
        match.status = "confirmed";
        match.endedAt = now;
        for (const [seat, owner] of Object.entries(match.uidByPlayer))
          credits.push(
            creditFor(
              owner,
              match.result.players.find((entry) => entry.playerId === seat)!,
              match.avatars[seat],
              now,
              match.result.players,
            ),
          );
      } else if (match.status === "confirmed" && linking)
        credits.push(
          creditFor(
            account,
            player,
            match.avatars[rider],
            match.endedAt ?? now,
            match.result.players,
          ),
        );
      if (result.round !== undefined) credits.length = 0;
      if (match.status === "confirmed") {
        match.participantUids = [...new Set(Object.values(match.uidByPlayer))];
        const hasAccounts = match.participantUids.length > 0;
        // Round receipts remain durable and idempotent, but do not appear as career games or in the public feed.
        if (result.round !== undefined) match.participantUids = [];
        // A lone guest confirms their own game, so it is public only once a second player vouches or an account (whose
        // links are rate limited) owns a seat: otherwise free room tokens could fill everyone's feed with inventions.
        else if (hasAccounts || match.attesters.length >= 2)
          match.feedAt ??= match.endedAt;
        if (hasAccounts) delete match.expiresAt;
        else match.expiresAt = (match.endedAt ?? now) + GUEST_MATCH_TTL_MS;
      }
      return {
        match,
        credits,
        result: {
          status: match.status,
          attestations: match.attesters.length,
          needed,
          linked: account !== undefined && match.uidByPlayer[rider] === account,
        },
      };
    });
  }

  /** The shared account with this game's rating, rank and totals. */
  async profile(uid: string): Promise<Profile<T> | undefined> {
    if (
      !(await this.rooms.database.allowance(
        this.limit(`history:${uid}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    const profile = (await this.database.profile(this.game.id, uid)) as
      Profile<T> | undefined;
    if (profile?.rating?.games)
      profile.rank = await this.database.rank(
        this.game.id,
        Math.round(profile.rating.value),
      );
    return profile;
  }

  /**
   * The account's username, the same in every game. Usernames are not unique and not reserved: they are what friends
   * call a player, not an identifier. The account is the identifier.
   */
  async rename(uid: string, body: unknown): Promise<{ username: string }> {
    if (
      !plain(body) ||
      Object.keys(body).length !== 1 ||
      !this.platform.account.validName(body.username)
    )
      throw new RoomError(400, this.platform.account.nameRule);
    if (
      !(await this.rooms.database.allowance(
        digest(`rename:${uid}`),
        this.now(),
        RENAMES_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many changes; try later");
    await this.database.setUsername(uid, body.username, this.now());
    return { username: body.username };
  }

  /**
   * Everyone's recent games in this game. Public like the leaderboard, so limited by address; a signed-in caller also
   * learns which seat was theirs. `before` pages backwards from a listed `endedAt`.
   */
  async feed(
    address: string,
    uid: string | undefined,
    before: number | undefined,
  ): Promise<{ matches: FeedEntry<P>[] }> {
    if (
      !(await this.rooms.database.allowance(
        this.limit(`feed:${address}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    const records = await this.database.recentMatches(
      this.game.id,
      before,
      HISTORY_PAGE,
    );
    return {
      matches: records.flatMap((record) => {
        // A record the storage layer ordered by `feedAt` still has to earn its place here.
        if (record.feedAt === undefined || record.result.round !== undefined)
          return [];
        const you =
          uid === undefined
            ? undefined
            : Object.entries(record.uidByPlayer).find(
                ([, account]) => account === uid,
              )?.[0];
        return [
          {
            id: record.id,
            // When the game ended, not when it became public: `feedAt` orders the feed, `endedAt` dates the row.
            endedAt: record.endedAt ?? record.createdAt,
            ...(you ? { you } : {}),
            avatars: record.avatars,
            accounts: publicSeats(record),
            result: record.result as MatchResult<P>,
          },
        ];
      }),
    };
  }

  async leaderboard(
    address: string,
    uid?: string,
  ): Promise<LeaderboardEntry[]> {
    if (
      !(await this.rooms.database.allowance(
        this.limit(`leaderboard:${address}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    return this.database.leaderboard(this.game.id, uid);
  }

  async history(
    uid: string,
    before: number | undefined,
  ): Promise<{
    profile: Profile<T> | undefined;
    matches: HistoryEntry<P>[];
    rivals: Rivalries;
  }> {
    if (
      !(await this.rooms.database.allowance(
        this.limit(`history:${uid}`),
        this.now(),
        READS_PER_HOUR,
      ))
    )
      throw new RoomError(429, "Too many requests; try later");
    const [profile, records, rivals] = await Promise.all([
      this.profile(uid),
      this.database.matchesFor(this.game.id, uid, before, HISTORY_PAGE),
      this.database.rivals(this.game.id, uid),
    ]);
    return {
      profile,
      rivals,
      matches: records.map((record) => {
        const you = Object.entries(record.uidByPlayer).find(
          ([, account]) => account === uid,
        )?.[0];
        return {
          ...(you && record.ratings?.[you]
            ? { rating: record.ratings[you] }
            : {}),
          id: record.id,
          endedAt: record.endedAt ?? record.createdAt,
          roomCode: record.roomCode,
          ...(you ? { you } : {}),
          attestations: record.attesters.length,
          avatars: record.avatars,
          accounts: publicSeats(record),
          result: record.result as MatchResult<P>,
        };
      }),
    };
  }
}
