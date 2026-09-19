import { createDialog, el } from "fuse-ui";
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

export function createAccountPanel(dependencies: AccountPanelDependencies): {
  button: HTMLButtonElement;
  leaderboardButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  refresh: () => void;
  dispose: () => void;
} {
  const auth = dependencies.auth ?? liveAuth;
  const leaderboardButton = el("button", "LEADERBOARD", "landing-account");
  leaderboardButton.type = "button";
  const button = el("button", "SIGN IN", "landing-account");
  button.type = "button";
  const { dialog, body } = createDialog({
    title: "RIDER STATS",
    label: "Account",
    classes: {
      root: "game-dialog stats-dialog",
      bar: "dialog-bar",
      title: "",
      actions: "dialog-actions",
      close: "",
      body: "dialog-body account-panel",
    },
  });
  let account: Account | undefined,
    generation = 0,
    view: "stats" | "leaderboard" = "stats";
  let landingGeneration = 0;
  const refreshClock = dependencies.refreshClock ?? {
    now: Date.now,
    schedule: (callback: () => void, delayMs: number) => {
      const timer = setTimeout(callback, delayMs);
      return () => clearTimeout(timer);
    },
  };
  let lastRefresh = 0;
  let cancelRefresh: (() => void) | undefined;
  // Coalesce round completions and focus changes: no background polling, at most one profile refresh per 15 seconds.
  const refresh = () => {
    if (!account || cancelRefresh !== undefined) return;
    cancelRefresh = refreshClock.schedule(
      () => {
        cancelRefresh = undefined;
        void refreshLanding();
      },
      Math.max(1500, 15_000 - (refreshClock.now() - lastRefresh)),
    );
  };
  async function refreshLanding(): Promise<void> {
    const mine = ++landingGeneration;
    if (!account) return;
    lastRefresh = refreshClock.now();
    try {
      const token = await auth.token();
      if (!token) return;
      const response = await dependencies.fetch(dependencies.profileUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("profile");
      const { profile } = (await response.json()) as {
        profile?: StatsPage["profile"];
      };
      if (mine !== landingGeneration || !account) return;
      const rating = profile?.rating ?? newRating();
      leaderboardButton.textContent = profile?.rank
        ? `#${profile.rank} · LEADERBOARD`
        : "LEADERBOARD";
      const nickname =
        [profile?.username, profile?.name, dependencies.localName()].find(
          validRiderName,
        ) ?? account.name;
      button.textContent = `${nickname}\n${Math.round(rating.value).toLocaleString()} ELO`;
      button.title = "Your global rank and Elo · Open player stats";
    } catch {
      if (mine === landingGeneration && account) {
        if (!button.textContent?.includes("ELO"))
          button.textContent = "MY STATS · OFFLINE";
        button.title =
          "Could not refresh Elo · Showing the last available rating";
      }
    }
  }

  async function saveUsername(username: string): Promise<boolean> {
    const token = await auth.token();
    if (!token) return false;
    const response = await dependencies.fetch(dependencies.profileUrl, {
      method: "PUT",
      body: JSON.stringify({ username }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) return false;
    auth.remember(username);
    return true;
  }

  async function load(
    list: HTMLUListElement,
    totals: HTMLElement,
    more: HTMLButtonElement,
    note: HTMLElement,
    name: HTMLInputElement,
    before?: number,
  ): Promise<void> {
    const mine = generation;
    more.hidden = true;
    note.textContent = "Loading your games…";
    try {
      const token = await auth.token();
      if (!token) throw new Error("signed out");
      const response = await dependencies.fetch(
        dependencies.historyUrl(before),
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as HistoryPage;
      if (mine !== generation) return; // signed out, or reopened, while this was in flight
      if (before === undefined) {
        // An account without a username takes the name this browser already rides under, else the first word of the
        // Google name: the rider should have one from the first room on, and the field right here changes it.
        let username = page.profile?.username;
        if (!username) {
          const stored = dependencies.localName()?.trim(),
            first = validRiderName(stored)
              ? stored
              : suggestRiderName(account?.name ?? "");
          if (first && (await saveUsername(first))) username = first;
        }
        if (mine !== generation) return;
        if (username) {
          const heading = body.querySelector(".stats-player-name");
          if (heading) {
            heading.textContent = username;
            if (page.profile?.avatarId)
              heading.prepend(createAvatarPortrait(page.profile.avatarId));
          }
          auth.remember(username);
          if (document.activeElement !== name) name.value = username;
        }
        totals.replaceChildren(playerStats(page));
        void refreshLanding();
      }
      list.append(...page.matches.map(matchRow));
      note.textContent = list.childElementCount
        ? ""
        : "No games yet. Finish a match in a room while signed in and it lands here.";
      const last = page.matches.at(-1);
      // A full page means there may be more; the oldest entry is the cursor for the next one.
      more.hidden = page.matches.length < 20 || !last;
      if (last)
        more.onclick = () => {
          void load(list, totals, more, note, name, last.endedAt);
        };
    } catch {
      if (mine === generation)
        note.textContent = "Could not load your games. Try again in a moment.";
    }
  }

  function render(): void {
    generation++;
    if (view === "leaderboard") {
      const mine = generation,
        message = el("p", "Loading leaderboard…", "stats-muted");
      const back = el("button", "MY STATS");
      back.type = "button";
      back.onclick = () => {
        view = "stats";
        render();
      };
      body.replaceChildren(back, message);
      void (async () => {
        try {
          const token = await auth.token();
          const response = await dependencies.fetch(
            dependencies.leaderboardUrl,
            { headers: token ? { Authorization: `Bearer ${token}` } : {} },
          );
          if (!response.ok) throw new Error("leaderboard");
          const page = (await response.json()) as {
            players: LeaderboardEntry[];
          };
          if (mine === generation)
            body.replaceChildren(back, leaderboardTable(page.players));
        } catch {
          if (mine === generation)
            message.textContent =
              "Could not load the leaderboard. Close and try again.";
        }
      })();
      return;
    }
    const error = el("p", "", "account-error");
    error.setAttribute("role", "alert");
    if (!account) {
      const enter = el("button", "SIGN IN WITH GOOGLE");
      enter.type = "button";
      enter.onclick = async () => {
        enter.disabled = true;
        error.textContent = "";
        try {
          await auth.signIn();
          dependencies.track("Signed In");
        } catch (failure) {
          error.textContent = signInFailure(failure);
        } finally {
          enter.disabled = false;
        }
      };
      // Held until the SDK is in: a tap that had to wait for the download would find its popup blocked, notably in Safari.
      const mine = generation;
      enter.disabled = true;
      auth.ready().then(
        () => {
          if (mine === generation) enter.disabled = false;
        },
        () => {
          if (mine === generation)
            error.textContent =
              "Could not reach the sign-in service. Close this and try again.";
        },
      );
      body.replaceChildren(
        el(
          "p",
          "Sign in to keep a history of every match you finish and your career totals, on any device. Playing never needs an account. Your rider name, avatar and Elo appear on the public leaderboard after a rated round; your email is never shown.",
          "account-note",
        ),
        enter,
        error,
      );
      return;
    }
    const totals = el("div", "", "account-dashboard"),
      list = el("ul", "", "account-matches"),
      note = el("p", "", "account-note"),
      more = el("button", "OLDER GAMES"),
      leave = el("button", "SIGN OUT"),
      row = el("div", "", "account-actions");
    more.type = "button";
    leave.type = "button";
    more.hidden = true;
    leave.onclick = async () => {
      leave.disabled = true;
      try {
        await auth.signOut();
      } catch {
        error.textContent = "Could not sign out. Try again.";
        leave.disabled = false;
      }
    };
    row.append(more, leave);
    const rename = el("form", "", "account-username"),
      label = el("label", "USERNAME"),
      name = el("input"),
      save = el("button", "SAVE"),
      saved = el("small");
    name.maxLength = MAX_RIDER_NAME + 2;
    name.setAttribute("autocomplete", "nickname");
    name.id = "account-username";
    label.htmlFor = name.id;
    saved.setAttribute("role", "status");
    name.oninput = () => {
      saved.textContent = "";
    };
    rename.onsubmit = async (event) => {
      event.preventDefault();
      const value = name.value.trim();
      if (!validRiderName(value)) {
        saved.textContent = `1 to ${MAX_RIDER_NAME} characters`;
        return;
      }
      save.disabled = true;
      saved.textContent = "Saving…";
      const mine = generation;
      try {
        const success = await saveUsername(value);
        saved.textContent = success
          ? "Saved. This is your name in every room."
          : "Could not save. Try again.";
        if (success && mine === generation) {
          const heading = body.querySelector(".stats-player-name");
          const portrait = heading?.querySelector(".avatar-portrait");
          heading?.replaceChildren(
            ...(portrait ? [portrait] : []),
            document.createTextNode(value),
          );
        }
      } catch {
        saved.textContent = "Could not save. Try again.";
      } finally {
        save.disabled = false;
      }
    };
    rename.append(label, name, save, saved);
    const settings = el("details", "", "stats-details");
    settings.append(el("summary", "Account settings"), rename, leave);
    const leaderboard = el("button", "GLOBAL LEADERBOARD");
    leaderboard.type = "button";
    leaderboard.onclick = () => {
      view = "leaderboard";
      render();
    };
    body.replaceChildren(
      el("h2", account.name, "stats-player-name"),
      totals,
      leaderboard,
      el("h3", "MATCH HISTORY"),
      list,
      note,
      row,
      settings,
      error,
    );
    void load(list, totals, more, note, name);
  }

  const stop = auth.watch((next) => {
    cancelRefresh?.();
    cancelRefresh = undefined;
    account = next;
    leaderboardButton.textContent = "LEADERBOARD";
    button.textContent = next ? next.name : "SIGN IN";
    button.dataset.signedIn = String(Boolean(next));
    button.title = next
      ? `Signed in as ${next.name}`
      : "Sign in to keep your match history";
    landingGeneration++;
    if (next) void refreshLanding();
    if (dialog.open) render();
  });
  // The SDK is fetched when the pointer arrives, so the Google popup can open inside the click that asks for it.
  button.addEventListener("pointerenter", auth.warm, { once: true });
  button.addEventListener("focus", auth.warm, { once: true });
  button.onclick = () => {
    view = "stats";
    auth.warm();
    render();
    dialog.showModal();
  };
  leaderboardButton.onclick = () => {
    view = "leaderboard";
    render();
    dialog.showModal();
  };
  dialog.addEventListener("close", () => {
    generation++;
  });
  return {
    button,
    leaderboardButton,
    dialog,
    refresh,
    dispose: () => {
      account = undefined;
      cancelRefresh?.();
      generation++;
      landingGeneration++;
      stop();
    },
  };
}
