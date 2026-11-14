import { diceRegistration } from "dice/platform";
import { fuseDriversRegistration } from "fuse-drivers/platform";
import { birdsRegistration } from "fuse-birds-game/platform";
import { hookRegistration } from "hook-havok/platform";
import { axeRegistration } from "fuse-axe/platform";
import { bombersRegistration } from "fuse-bombers/platform";
import { choppersRegistration } from "fuse-choppers/platform";
import { craftRegistration } from "fuse-craft/platform";
import { freightRegistration } from "fuse-freight/platform";
import { frontRegistration } from "fuse-front/platform";
import { graveyardRegistration } from "graveyard-shift/platform";
import { fuseLaneRegistration } from "fuse-lane/platform";
import { ballBrosRegistration } from "ball-bros/platform";
import { fuseballRegistration } from "fuseball/platform";
import { fuseVolleyRegistration } from "fuse-volley/platform";
import { elastoFuseRegistration } from "elasto-fuse/platform";
import {
  ACCOUNT_RULES,
  fuseRiders,
  type MatchRecord,
  type UserProfile,
} from "fuse-riders-game/platform";
import {
  Platform,
  parseMatchRecord as parsePlatformRecord,
  parseProfile as parsePlatformProfile,
} from "fuse-platform";

/**
 * The service's `platform`: the account rules every game shares and every registered game. Each game owns its
 * registration: Fuse Riders' is `games/fuse-riders/src/platform.ts`, Pig's `games/dice/src/platform.ts`.
 */

/** Every game this repo serves. tests/registered-games.test.ts fails when a game's `src/platform.ts` is missing here. */
export const GAMES = [
  fuseRiders,
  diceRegistration,
  hookRegistration,
  choppersRegistration,
  craftRegistration,
  freightRegistration,
  axeRegistration,
  bombersRegistration,
  fuseLaneRegistration,
  ballBrosRegistration,
  graveyardRegistration,
  fuseDriversRegistration,
  birdsRegistration,
  frontRegistration,
  fuseballRegistration,
  fuseVolleyRegistration,
  elastoFuseRegistration,
] as const;

/** Fuse Riders plus the named games: a smaller service for tests. The room service is configured with the same ids. */
export const platformFor = (ids: readonly string[]): Platform =>
  new Platform(
    ACCOUNT_RULES,
    GAMES.filter((game) => game.id === fuseRiders.id || ids.includes(game.id)),
  );
/**
 * Every registered game: what Cloud Run and the dev service serve and what a stored record may name. A game's rooms
 * open in production when its registration lands in `GAMES` and the merge deploys; there is no switch to flip.
 */
export const platform = platformFor(GAMES.map((game) => game.id));

/** A stored record of any registered game; one without a `gameId` reads as Fuse Riders'. */
export const parseMatchRecord = (raw: unknown): MatchRecord | undefined =>
  parsePlatformRecord(platform, raw) as MatchRecord | undefined;
/** The user document, validated before it can affect Elo or appear on a page. */
export const parseProfile = (data: unknown): UserProfile | undefined =>
  parsePlatformProfile(platform, fuseRiders.id, data) as
    UserProfile | undefined;
