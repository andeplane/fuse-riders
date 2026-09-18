import { createAvatarPortrait } from "../client/avatar-heads.js";
import "./account-panel.css";
import {
  playerStats,
  leaderboardTable,
  type StatsPage,
} from "./player-stats.js";
import { renderMatchRecap } from "./match-recap-view.js";
import { newRating, type LeaderboardEntry } from "../shared/rating.js";
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
import type { FeedEntry } from "../service/history.js";
import {
  MAX_RIDER_NAME,
  suggestRiderName,
  validRiderName,
} from "../engine/rider-name.js";

/**
 * The player dialog behind the landing page's account and leaderboard buttons: your stats, recent matches (everyone's
 * or your own) and the global leaderboard, one tab each. A match opens into its full results. Everything a server or
 * another player supplied (names, colours, numbers) is written with textContent or a validated style property, never
 * as markup.
 */
type HistoryPage = StatsPage;
type MatchEntry = FeedEntry;
type View = "stats" | "matches" | "leaderboard";
type Scope = "everyone" | "mine";
/** A server page is full at this size, so a shorter one is the last. Mirrors HISTORY_PAGE in the service. */
const PAGE = 20;
export interface AccountPanelDependencies {
  /** GET the signed-in player's history; `before` pages backwards from an `endedAt`. */
  historyUrl: (before?: number) => string;
  /** GET everyone's recent games; `before` pages backwards from an `endedAt`. */
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

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text = "",
  className = "",
): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.textContent = text;
  if (className) e.className = className;
  return e;
};
const ordinal = (place: number): string =>
  `${place}${place % 100 >= 11 && place % 100 <= 13 ? "TH" : (["TH", "ST", "ND", "RD"][place % 10] ?? "TH")}`;
const clock = (at: number): string =>
  new Date(at).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
/** TODAY, YESTERDAY, else the date; the year only when it is not this one. */
function dayLabel(at: number, now: number): string {
  const midnight = (value: number): number => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return "TODAY";
  if (days === 1) return "YESTERDAY";
  const date = new Date(at);
  return date
    .toLocaleDateString(undefined, {
      weekday: "short",
      month: "short",
      day: "numeric",
      ...(date.getFullYear() === new Date(now).getFullYear()
        ? {}
        : { year: "numeric" }),
    })
    .toUpperCase();
}
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

function matchRow(
  entry: MatchEntry,
  now: number,
  open: (entry: MatchEntry) => void,
): HTMLLIElement {
  const item = el("li", "", "account-match"),
    button = el("button", "", "account-match-open"),
    riders = el("span", "", "account-riders");
  button.type = "button";
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
  button.append(
    el("span", clock(entry.endedAt), "account-match-time"),
    summary,
    place,
    chevron,
  );
  button.setAttribute(
    "aria-label",
    `${headline(entry)}, ${players.length} riders, ${rounds} rounds, ${dayLabel(entry.endedAt, now).toLowerCase()} ${clock(entry.endedAt)}${mine ? `, you finished ${ordinal(mine.matchPlacement).toLowerCase()}` : ""}. Open results.`,
  );
  button.dataset.focus = `match-${entry.id}`;
  button.onclick = () => open(entry);
  item.append(button);
  return item;
}

/** One list of recent games and how far back it has been read. */
interface Feed {
  matches: MatchEntry[];
  more: boolean;
  state: "idle" | "loading" | "failed";
}
const emptyFeed = (): Feed => ({ matches: [], more: true, state: "idle" });
/** Appends a page, dropping anything already listed: two games can end in the same millisecond at a page boundary. */
function extend(feed: Feed, page: readonly MatchEntry[]): void {
  const known = new Set(feed.matches.map((entry) => entry.id));
  feed.matches.push(...page.filter((entry) => !known.has(entry.id)));
  feed.more = page.length >= PAGE;
}

export function createAccountPanel(dependencies: AccountPanelDependencies): {
  button: HTMLButtonElement;
  matchesButton: HTMLButtonElement;
  leaderboardButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  refresh: () => void;
  dispose: () => void;
} {
  const auth = dependencies.auth ?? liveAuth;
  const matchesButton = el("button", "MATCHES", "landing-account");
  matchesButton.type = "button";
  matchesButton.title = "Recent matches, everyone's or your own";
  const leaderboardButton = el("button", "LEADERBOARD", "landing-account");
  leaderboardButton.type = "button";
  const button = el("button", "SIGN IN", "landing-account");
  button.type = "button";
  const dialog = el("dialog", "", "game-dialog stats-dialog");
  dialog.setAttribute("aria-label", "Player");
  const bar = el("header", "", "dialog-bar"),
    close = el("button", "✕  CLOSE", "dialog-close"),
    actions = el("span", "", "dialog-actions"),
    tabs = el("nav", "", "stats-tabs"),
    body = el("div", "", "dialog-body account-panel");
  close.type = "button";
  close.setAttribute("aria-label", "CLOSE");
  close.onclick = () => dialog.close();
  actions.append(close);
  tabs.setAttribute("aria-label", "Player sections");
  const tabButtons = new Map<View, HTMLButtonElement>();
  for (const [key, label] of [
    ["stats", "STATS"],
    ["matches", "MATCHES"],
    ["leaderboard", "LEADERBOARD"],
  ] as const) {
    const tab = el("button", label);
    tab.type = "button";
    tab.onclick = () => show(key);
    tabButtons.set(key, tab);
    tabs.append(tab);
  }
  bar.append(tabs, actions);
  dialog.append(bar, body);
  let account: Account | undefined,
    generation = 0,
    view: View = "stats",
    scope: Scope = "everyone",
    opened: MatchEntry | undefined,
    listScroll = 0;
  // Read once per opening and kept while the dialog is up, so switching tabs never refetches.
  let session = 0,
    history:
      | { page: HistoryPage; username?: string; feed: Feed }
      | "loading"
      | "failed"
      | undefined,
    everyone = emptyFeed();
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

  async function get<T>(url: string, signedIn: boolean): Promise<T> {
    const token = await auth.token();
    if (signedIn && !token) throw new Error("signed out");
    const response = await dependencies.fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as T;
  }

  /** Forget everything read so far: the dialog reopened or the account changed, and a reply still in flight is stale. */
  function reset(): void {
    session++;
    history = undefined;
    everyone = emptyFeed();
    opened = undefined;
    listScroll = 0;
  }

  /** The signed-in history's first page: profile, stats and the newest of your own games. */
  async function loadHistory(): Promise<void> {
    const mine = session;
    history = "loading";
    try {
      const page = await get<HistoryPage>(dependencies.historyUrl(), true);
      if (mine !== session) return;
      // An account without a username takes the name this browser already rides under, else the first word of the
      // Google name: the rider should have one from the first room on, and the stats tab changes it.
      let username = page.profile?.username;
      if (!username) {
        const stored = dependencies.localName()?.trim(),
          first = validRiderName(stored)
            ? stored
            : suggestRiderName(account?.name ?? "");
        if (first && (await saveUsername(first))) username = first;
      }
      if (mine !== session) return;
      if (username) auth.remember(username);
      const feed = emptyFeed();
      extend(feed, page.matches);
      history = { page, ...(username ? { username } : {}), feed };
      void refreshLanding();
    } catch {
      if (mine !== session) return;
      history = "failed";
    }
    // Only the views that show your games change; redrawing another would refetch or move focus for nothing.
    if (
      dialog.open &&
      (view === "stats" || (view === "matches" && scope === "mine" && !opened))
    )
      render();
  }

  /** Redraws an open list in place, where it was scrolled. */
  function redrawList(): void {
    if (!dialog.open || view !== "matches" || opened) return;
    const top = body.scrollTop;
    render();
    body.scrollTop = top;
  }

  /** The next page of a list of games: the first when it is empty, else strictly older than its last. */
  async function loadMatches(which: Scope): Promise<void> {
    const feed =
      which === "everyone"
        ? everyone
        : typeof history === "object"
          ? history.feed
          : undefined;
    if (!feed || feed.state === "loading") return;
    const mine = session,
      before = feed.matches.at(-1)?.endedAt;
    feed.state = "loading";
    redrawList();
    try {
      const page =
        which === "everyone"
          ? (
              await get<{ matches: MatchEntry[] }>(
                dependencies.matchesUrl(before),
                false,
              )
            ).matches
          : (await get<HistoryPage>(dependencies.historyUrl(before), true))
              .matches;
      if (mine !== session) return;
      extend(feed, page);
      feed.state = "idle";
    } catch {
      if (mine !== session) return;
      feed.state = "failed";
    }
    redrawList();
  }

  function show(next: View, entry?: MatchEntry): void {
    // A match opened from the list returns to where the list was; one opened from elsewhere returns to its top.
    if (next === "matches" && entry)
      listScroll = view === "matches" && !opened ? body.scrollTop : 0;
    const back =
      next === "matches" && !entry && view === "matches" ? opened : undefined;
    view = next;
    opened = entry;
    render();
    body.scrollTop = back ? listScroll : 0;
    if (back)
      body
        .querySelector<HTMLElement>(
          `[data-focus="${CSS.escape(`match-${back.id}`)}"]`,
        )
        ?.focus({ preventScroll: true });
  }

  function signInPrompt(message: string): HTMLElement[] {
    const error = el("p", "", "account-error"),
      enter = el("button", "SIGN IN WITH GOOGLE");
    error.setAttribute("role", "alert");
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
    return [el("p", message, "account-note"), enter, error];
  }

  /** Loading, failed or signed out: what stands in for the signed-in history. Undefined once it is ready. */
  function historyPending(signedOut: string): HTMLElement[] | undefined {
    if (!account) return signInPrompt(signedOut);
    if (typeof history === "object") return undefined;
    if (history === undefined) void loadHistory();
    if (history !== "failed")
      return [el("p", "Loading your games…", "account-note")];
    const retry = el("button", "TRY AGAIN");
    retry.type = "button";
    retry.onclick = () => {
      history = undefined;
      render();
    };
    return [el("p", "Could not load your games.", "account-note"), retry];
  }

  function renderStats(): void {
    const pending = historyPending(
      "Sign in to keep a history of every match you finish and your career totals, on any device. Playing never needs an account. Your rider name, avatar and Elo appear on the public leaderboard after a rated round; your email is never shown.",
    );
    if (pending || typeof history !== "object" || !account) {
      body.replaceChildren(...(pending ?? []));
      return;
    }
    const cache = history,
      heading = el("h2", cache.username ?? account.name, "stats-player-name");
    if (cache.page.profile?.avatarId)
      heading.prepend(createAvatarPortrait(cache.page.profile.avatarId));
    const error = el("p", "", "account-error");
    error.setAttribute("role", "alert");
    const leave = el("button", "SIGN OUT");
    leave.type = "button";
    leave.onclick = async () => {
      leave.disabled = true;
      try {
        await auth.signOut();
      } catch {
        error.textContent = "Could not sign out. Try again.";
        leave.disabled = false;
      }
    };
    const rename = el("form", "", "account-username"),
      label = el("label", "USERNAME"),
      name = el("input"),
      save = el("button", "SAVE"),
      saved = el("small");
    name.maxLength = MAX_RIDER_NAME + 2;
    name.setAttribute("autocomplete", "nickname");
    name.id = "account-username";
    name.value = cache.username ?? "";
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
      try {
        const success = await saveUsername(value);
        saved.textContent = success
          ? "Saved. This is your name in every room."
          : "Could not save. Try again.";
        if (success && history === cache) {
          cache.username = value;
          const portrait = heading.querySelector(".avatar-portrait");
          heading.replaceChildren(
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
    body.replaceChildren(
      heading,
      playerStats(cache.page, {
        openMatch: (entry) => {
          scope = "mine";
          show("matches", entry);
        },
      }),
      settings,
      error,
    );
  }

  function renderMatches(): void {
    const filter = el("div", "", "account-scope");
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", "Whose matches");
    for (const [key, label] of [
      ["everyone", "EVERYONE"],
      ["mine", "YOURS"],
    ] as const) {
      const choice = el("button", label);
      choice.type = "button";
      choice.setAttribute("aria-pressed", String(scope === key));
      choice.dataset.focus = `scope-${key}`;
      choice.onclick = () => {
        if (scope === key) return;
        scope = key;
        show("matches");
      };
      filter.append(choice);
    }
    const intro = el(
      "p",
      scope === "everyone"
        ? "Recent finished games across Fuse Riders, newest first."
        : "Every game you finished while signed in, newest first.",
      "stats-muted",
    );
    if (scope === "mine") {
      const pending = historyPending(
        "Sign in to keep a history of every match you finish, on any device. Playing never needs an account.",
      );
      if (pending) {
        body.replaceChildren(filter, ...pending);
        return;
      }
    }
    const feed =
      scope === "everyone"
        ? everyone
        : typeof history === "object"
          ? history.feed
          : emptyFeed();
    // Only a feed never read yet loads by itself; an empty first page sets `more` false, so it is not asked again.
    if (
      scope === "everyone" &&
      !feed.matches.length &&
      feed.state === "idle" &&
      feed.more
    )
      void loadMatches("everyone");
    const now = refreshClock.now(),
      list = el("div", "", "account-matches");
    let day: string | undefined, rows: HTMLUListElement | undefined;
    for (const entry of feed.matches) {
      const label = dayLabel(entry.endedAt, now);
      if (label !== day || !rows) {
        day = label;
        rows = el("ul");
        const group = el("section", "", "account-day");
        group.append(el("h3", label), rows);
        list.append(group);
      }
      rows.append(matchRow(entry, now, (match) => show("matches", match)));
    }
    const note = el("p", "", "account-note");
    if (feed.state === "loading")
      note.textContent = feed.matches.length
        ? "Loading older matches…"
        : "Loading matches…";
    else if (feed.state === "failed")
      note.textContent = "Could not load matches.";
    else if (!feed.matches.length)
      note.textContent =
        scope === "everyone"
          ? "No finished games yet. Start a room and be the first."
          : "No games yet. Finish a match in a room while signed in and it lands here.";
    const more = el(
      "button",
      feed.state === "failed"
        ? "TRY AGAIN"
        : feed.state === "loading"
          ? "LOADING…"
          : "OLDER MATCHES",
    );
    more.type = "button";
    more.dataset.focus = "more";
    // Disabled rather than hidden while loading, so a keyboard user's focus survives the redraw.
    more.disabled = feed.state === "loading";
    // A failure always offers TRY AGAIN, including a first page that never arrived.
    more.hidden =
      feed.state === "loading"
        ? !feed.matches.length
        : feed.state === "idle" && (!feed.more || !feed.matches.length);
    more.onclick = () => void loadMatches(scope);
    body.replaceChildren(filter, intro, list, note, more);
  }

  function renderMatch(entry: MatchEntry): void {
    const back = el("button", "‹ MATCHES", "account-back");
    back.type = "button";
    back.onclick = () => show("matches");
    const now = refreshClock.now(),
      day = dayLabel(entry.endedAt, now);
    body.replaceChildren(
      back,
      renderMatchRecap(entry.result.players, [], {
        playerId: entry.you ?? "",
        canWatch: () => false,
        watch: () => {},
        kicker: `${day} · ${clock(entry.endedAt)}`,
        expanded: true,
      }),
    );
    back.focus({ preventScroll: true });
  }

  function renderLeaderboard(): void {
    const mine = generation,
      message = el("p", "Loading leaderboard…", "stats-muted");
    body.replaceChildren(message);
    void (async () => {
      try {
        const page = await get<{ players: LeaderboardEntry[] }>(
          dependencies.leaderboardUrl,
          false,
        );
        if (mine === generation)
          body.replaceChildren(leaderboardTable(page.players));
      } catch {
        if (mine === generation)
          message.textContent =
            "Could not load the leaderboard. Close and try again.";
      }
    })();
  }

  function render(): void {
    generation++;
    // A redraw replaces the focused control; the same control in the new view takes the focus back.
    const focused =
      document.activeElement instanceof HTMLElement &&
      body.contains(document.activeElement)
        ? document.activeElement.dataset.focus
        : undefined;
    for (const [key, tab] of tabButtons)
      if (key === view) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    body.dataset.view = opened ? "match" : view;
    if (view === "leaderboard") renderLeaderboard();
    else if (view === "stats") renderStats();
    else if (opened) renderMatch(opened);
    else renderMatches();
    if (focused)
      body
        .querySelector<HTMLElement>(`[data-focus="${CSS.escape(focused)}"]`)
        ?.focus({ preventScroll: true });
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
    reset();
    if (next) void refreshLanding();
    if (dialog.open) render();
  });
  // The SDK is fetched when the pointer arrives, so the Google popup can open inside the click that asks for it.
  button.addEventListener("pointerenter", auth.warm, { once: true });
  button.addEventListener("focus", auth.warm, { once: true });
  const open = (next: View) => {
    reset();
    view = next;
    render();
    dialog.showModal();
  };
  button.onclick = () => {
    auth.warm();
    open("stats");
  };
  matchesButton.onclick = () => open("matches");
  leaderboardButton.onclick = () => open("leaderboard");
  dialog.addEventListener("close", () => {
    generation++;
  });
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (
      event.clientX < r.left ||
      event.clientX > r.right ||
      event.clientY < r.top ||
      event.clientY > r.bottom
    )
      dialog.close();
  });
  return {
    button,
    matchesButton,
    leaderboardButton,
    dialog,
    refresh,
    dispose: () => {
      account = undefined;
      cancelRefresh?.();
      generation++;
      landingGeneration++;
      reset();
      stop();
    },
  };
}
