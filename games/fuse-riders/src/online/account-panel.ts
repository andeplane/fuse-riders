import { createAccountDialog, el } from "fuse-ui";
import type { AvatarId } from "../engine/avatar-id.js";
import { createAvatarPortrait } from "../client/avatar-heads.js";
import "./account-panel.css";
import {
  playerStats,
  leaderboardTable,
  type StatsPage,
} from "./player-stats.js";
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
 * The landing page's account button and its dialog: sign in, career totals and past matches. Everything a server or
 * another player supplied (names, colours, numbers) is written with textContent or a validated style property, never
 * as markup.
 */
interface HistoryEntry {
  id: string;
  endedAt: number;
  roomCode: string;
  you?: string;
  result: { length: number; winnerId?: string; players: MatchPlayerStats[] };
}
type HistoryPage = StatsPage;
export interface AccountPanelDependencies {
  /** GET the signed-in player's history; `before` pages backwards from an `endedAt`. */
  historyUrl: (before?: number) => string;
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
const count = (value: unknown): string =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.round(value).toLocaleString()
    : "0";

function matchRow(entry: HistoryEntry): HTMLLIElement {
  const row = el("li", "", "account-match"),
    detail = el("details"),
    head = el("summary"),
    riders = el("ul", "", "account-riders");
  const mine = entry.result.players.find(
    (player) => player.playerId === entry.you,
  );
  row.dataset.won = String(mine?.matchPlacement === 1);
  head.append(
    el(
      "strong",
      mine
        ? `${ordinal(mine.matchPlacement)} OF ${entry.result.players.length}`
        : "PLAYED",
    ),
    el(
      "span",
      `${new Date(entry.endedAt).toLocaleDateString()} · ROOM ${entry.roomCode}`,
    ),
  );
  for (const player of [...entry.result.players].sort(
    (a, b) => a.matchPlacement - b.matchPlacement,
  )) {
    const item = el("li"),
      dot = el("i");
    // The service only stores #rrggbb, and a colour that is not one is simply not applied.
    if (/^#[0-9a-fA-F]{6}$/.test(player.color))
      dot.style.background = player.color;
    item.dataset.you = String(player.playerId === entry.you);
    item.append(
      dot,
      document.createTextNode(
        `${player.name} · ${player.roundWins}W · ${player.eliminations}K`,
      ),
    );
    riders.append(item);
  }
  detail.append(head, riders);
  row.append(detail);
  return row;
}

/** Fuse Riders' account panel: fuse-ui's account dialog with the rider-name rule, career stats and match rows. */
export function createAccountPanel(dependencies: AccountPanelDependencies): {
  button: HTMLButtonElement;
  leaderboardButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  refresh: () => void;
  dispose: () => void;
} {
  const auth = dependencies.auth ?? liveAuth;
  return createAccountDialog<
    Account,
    NonNullable<StatsPage["profile"]>,
    HistoryEntry,
    LeaderboardEntry
  >({
    auth: { ...auth, failure: signInFailure },
    fetch: dependencies.fetch,
    historyUrl: dependencies.historyUrl,
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
    totals: (page) => playerStats(page as HistoryPage),
    match: matchRow,
    leaderboard: leaderboardTable,
    avatar: (id) => createAvatarPortrait(id as AvatarId),
    ...(dependencies.refreshClock
      ? { refreshClock: dependencies.refreshClock }
      : {}),
    text: {
      title: "RIDER STATS",
      signedOutNote:
        "Sign in to keep a history of every match you finish and your career totals, on any device. Playing never needs an account. Your rider name, avatar and Elo appear on the public leaderboard after a rated round; your email is never shown.",
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
    },
    dialogClasses: {
      root: "fui-dialog game-dialog stats-dialog",
      bar: "fui-dialog-bar dialog-bar",
      title: "fui-dialog-title",
      actions: "fui-dialog-actions dialog-actions",
      close: "",
      body: "fui-dialog-body dialog-body account-panel",
    },
  });
}
