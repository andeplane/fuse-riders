import { createAccountDialog, el, type AccountMatchContext } from "fuse-ui";
import type { AvatarId } from "../shared/avatars.js";
import { createAvatarPortrait } from "../client/avatar-heads.js";
import "./account-panel.css";
import {
  playerStats,
  leaderboardTable,
  type StatsPage,
} from "./player-stats.js";
import { renderMatchRecap } from "./match-recap-view.js";
import { newRating, type LeaderboardEntry } from "fuse-platform/rating";
import {
  accountReady,
  identityToken,
  rememberUsername,
  signIn,
  signInFailure,
  signOut,
  warmAccount,
  watchAccount,
  type Account,
} from "./account.js";
import type { MatchPlayerStats } from "../engine/match-stats.js";
import {
  MAX_RIDER_NAME,
  suggestRiderName,
  validRiderName,
} from "../engine/rider-name.js";

/**
 * The rider dialog behind the landing page's account, matches and leaderboard buttons: your stats, recent matches
 * (everyone's or your own) and the global leaderboard, one tab each. A match opens into its full results. Everything
 * a server or another rider supplied (names, colours, numbers) is written with textContent or a validated style
 * property, never as markup.
 *
 * Both lists carry the same fields: `/api/matches` publishes a public game, `/api/me/matches` the caller's own with
 * more besides, so one row renderer serves both.
 */
interface MatchEntry {
  id: string;
  endedAt: number;
  you?: string;
  result: { length: number; winnerId?: string; players: MatchPlayerStats[] };
}
type HistoryPage = StatsPage;
export interface AccountPanelDependencies {
  /** GET the signed-in rider's history; `before` pages backwards from an `endedAt`. */
  historyUrl: (before?: number) => string;
  /** GET everyone's recent games; `before` pages backwards from a listed `endedAt`. */
  matchesUrl: (before?: number) => string;
  /** GET the profile, PUT `{ username }`. */
  profileUrl: string;
  leaderboardUrl: string;
  /** Browser smoke tests inject an explicit identity surface, never real credentials. */
  auth?: AccountPanelAuth;
  refreshClock?: {
    now: () => number;
    schedule: (callback: () => void, delayMs: number) => () => void;
  };
  /** The rider name this browser already uses, the natural first username. */
  localName: () => string | null;
  fetch: typeof fetch;
  track: (event: string, props?: Record<string, unknown>) => void;
}

export interface AccountPanelAuth {
  watch: typeof watchAccount;
  token: typeof identityToken;
  ready: typeof accountReady;
  warm: typeof warmAccount;
  signIn: typeof signIn;
  signOut: typeof signOut;
  remember: typeof rememberUsername;
}
const liveAuth: AccountPanelAuth = {
  watch: watchAccount,
  token: identityToken,
  ready: accountReady,
  warm: warmAccount,
  signIn,
  signOut,
  remember: rememberUsername,
};

const ordinal = (place: number): string =>
  `${place}${place % 100 >= 11 && place % 100 <= 13 ? "TH" : (["TH", "ST", "ND", "RD"][place % 10] ?? "TH")}`;
const clock = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
const roundsOf = (entry: MatchEntry): number =>
  Math.max(0, ...entry.result.players.map((player) => player.roundsPlayed));
function headline(entry: MatchEntry): string {
  const winners = entry.result.players.filter(
    (player) => player.matchPlacement === 1,
  );
  if (winners.length !== 1) return "Shared win";
  return winners[0]!.playerId === entry.you
    ? "You won"
    : `${winners[0]!.name} won`;
}

/** One finished game in the MATCHES list: when it ended, who won, the riders, your placement, and the way in. */
function matchRow(
  entry: MatchEntry,
  context: AccountMatchContext,
): HTMLLIElement {
  const item = el("li", "", "account-match"),
    open = el("button", "", "account-match-open"),
    riders = el("span", "", "account-riders");
  open.type = "button";
  const players = [...entry.result.players].sort(
      (a, b) => a.matchPlacement - b.matchPlacement,
    ),
    mine = players.find((player) => player.playerId === entry.you),
    rounds = roundsOf(entry);
  item.dataset.won = String(mine?.matchPlacement === 1);
  for (const player of players) {
    const rider = el("span"),
      dot = el("i");
    // The service only stores #rrggbb, and a colour that is not one is simply not applied.
    if (/^#[0-9a-fA-F]{6}$/.test(player.color))
      dot.style.background = player.color;
    rider.dataset.you = String(player.playerId === entry.you);
    rider.append(dot, document.createTextNode(player.name));
    riders.append(rider);
  }
  const summary = el("span", "", "account-match-summary");
  summary.append(
    el(
      "strong",
      `${headline(entry)} · ${rounds} ${rounds === 1 ? "round" : "rounds"}`,
    ),
    riders,
  );
  const place = el("span", "", "account-match-place");
  if (mine)
    place.append(
      el("strong", ordinal(mine.matchPlacement)),
      el("small", `OF ${players.length}`),
    );
  const chevron = el("span", "›", "account-match-chevron");
  chevron.setAttribute("aria-hidden", "true");
  open.append(
    el("span", clock(entry.endedAt), "account-match-time"),
    summary,
    place,
    chevron,
  );
  open.setAttribute(
    "aria-label",
    `${headline(entry)}, ${players.length} riders, ${rounds} rounds, ${context.day.toLowerCase()} ${clock(entry.endedAt)}${mine ? `, you finished ${ordinal(mine.matchPlacement).toLowerCase()}` : ""}. Open results.`,
  );
  open.dataset.focus = `match-${entry.id}`;
  open.onclick = () => context.open();
  item.append(open);
  return item;
}

/**
 * An opened match: the same post-match report the game shows, rebuilt from the stored per-rider stats. Highlight
 * moments are not stored, so a past match has no replays and the full stats open straight away.
 */
function matchDetail(entry: MatchEntry, context: { day: string }): HTMLElement {
  return renderMatchRecap(entry.result.players, [], {
    playerId: entry.you ?? "",
    canWatch: () => false,
    watch: () => {},
    kicker: `${context.day} · ${clock(entry.endedAt)}`,
    expanded: true,
  });
}

/** Fuse Riders' account panel: fuse-ui's account dialog with the rider-name rule, career stats and match rows. */
export function createAccountPanel(dependencies: AccountPanelDependencies): {
  button: HTMLButtonElement;
  matchesButton: HTMLButtonElement;
  leaderboardButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  refresh: () => void;
  dispose: () => void;
} {
  const auth = dependencies.auth ?? liveAuth;
  return createAccountDialog<
    Account,
    NonNullable<StatsPage["profile"]>,
    MatchEntry,
    LeaderboardEntry
  >({
    auth: { ...auth, failure: signInFailure },
    fetch: dependencies.fetch,
    historyUrl: dependencies.historyUrl,
    matchesUrl: dependencies.matchesUrl,
    profileUrl: dependencies.profileUrl,
    leaderboardUrl: dependencies.leaderboardUrl,
    localName: dependencies.localName,
    track: (event) => dependencies.track(event),
    names: {
      valid: validRiderName,
      suggest: (name) => suggestRiderName(name) || undefined,
      max: MAX_RIDER_NAME,
    },
    rating: (profile) => (profile?.rating ?? newRating()).value,
    totals: (page, handlers) =>
      playerStats(page as HistoryPage, { openMatch: handlers.openMatch }),
    match: matchRow,
    matchDetail,
    leaderboard: leaderboardTable,
    avatar: (id) => createAvatarPortrait(id as AvatarId),
    ...(dependencies.refreshClock
      ? { refreshClock: dependencies.refreshClock }
      : {}),
    text: {
      title: "RIDER STATS",
      label: "Player",
      everyoneNote: "Recent finished games across Fuse Riders, newest first.",
      signedOutNote:
        "Sign in to keep a history of every match you finish and your career totals, on any device. Playing never needs an account. Your rider name, avatar and Elo appear on the public leaderboard after a rated round; your email is never shown.",
      signedOutMatches:
        "Sign in to keep a history of every match you finish, on any device. Playing never needs an account.",
    },
    classes: {
      button: "landing-account",
      heading: "stats-player-name",
      totals: "account-dashboard",
      list: "account-matches",
      note: "account-note",
      actions: "account-actions",
      rename: "account-username",
      settings: "stats-details",
      muted: "stats-muted",
      error: "account-error",
      tabs: "stats-tabs",
      scope: "account-scope",
      day: "account-day",
      back: "account-back",
    },
    dialogClasses: {
      root: "fui-dialog game-dialog stats-dialog",
      bar: "fui-dialog-bar dialog-bar",
      title: "fui-dialog-title",
      actions: "fui-dialog-actions dialog-actions",
      close: "dialog-close",
      body: "fui-dialog-body dialog-body account-panel",
    },
  });
}
