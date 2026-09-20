import { createDialog, type DialogPart } from "./dialog.js";
import { el, partClass, type PartClasses } from "./dom.js";

/**
 * What the account panel needs from sign-in. The game supplies it (Firebase, or a fake in a browser test); nothing
 * here downloads an SDK or keeps a credential.
 */
export interface AccountAuth<Account extends { name: string }> {
  /** Called now and on every change; returns a stop function. */
  watch(listener: (account: Account | undefined) => void): () => void;
  /** A bearer token for the service, or nothing when signed out. It only ever goes in a request header. */
  token(): Promise<string | undefined>;
  /** Settles once sign-in can open its popup inside a click. */
  ready(): Promise<void>;
  /** Start loading sign-in before the click that needs it. */
  warm(): void;
  signIn(): Promise<void>;
  signOut(): Promise<void>;
  /** Remember the username on this browser. */
  remember(username: string): void;
  /** Why a sign-in failed, for the player. */
  failure(error: unknown): string;
}

/** The profile fields the panel reads; a game's profile has more. */
export interface AccountProfile {
  username?: string;
  name?: string;
  avatarId?: string;
  rank?: number;
}

/** One page of the signed-in player's history. */
export interface AccountPage<Profile extends AccountProfile, Match> {
  profile?: Profile;
  matches: Match[];
}

/** Which section of the dialog is on screen. */
export type AccountView = "stats" | "matches" | "leaderboard";
/** Whose recent games the MATCHES tab lists. */
export type AccountScope = "everyone" | "mine";

export type AccountPart =
  | "button"
  | "heading"
  | "totals"
  | "list"
  | "note"
  | "actions"
  | "rename"
  | "settings"
  | "muted"
  | "error"
  | "tabs"
  | "scope"
  | "day"
  | "back";

const ACCOUNT_CLASSES: Record<AccountPart, string> = {
  button: "fui-account-button",
  heading: "fui-account-name",
  totals: "fui-account-totals",
  list: "fui-account-matches",
  note: "fui-account-note",
  actions: "fui-account-actions",
  rename: "fui-account-username",
  settings: "fui-account-settings",
  muted: "fui-account-muted",
  error: "fui-account-error",
  tabs: "fui-account-tabs",
  scope: "fui-account-scope",
  day: "fui-account-day",
  back: "fui-account-back",
};

/** The panel's words. Defaults are neutral; a game names its players and its title. */
export interface AccountText {
  title: string;
  label: string;
  signIn: string;
  signInWith: string;
  signedOutNote: string;
  /** The MATCHES tab's note for a signed-out viewer who asked for their own games. */
  signedOutMatches: string;
  signedInAs(name: string): string;
  signedOutTitle: string;
  leaderboard: string;
  rankedLeaderboard(rank: number): string;
  profileButton(name: string, rating: number): string;
  profileTitle: string;
  offline: string;
  offlineTitle: string;
  loading: string;
  empty: string;
  loadFailed: string;
  loadingLeaderboard: string;
  leaderboardFailed: string;
  /** Tab labels, and the MATCHES button's title on the page's top bar. */
  statsTab: string;
  matchesTab: string;
  leaderboardTab: string;
  matchesTitle: string;
  everyone: string;
  yours: string;
  everyoneNote: string;
  yoursNote: string;
  loadingMatches: string;
  loadingOlder: string;
  matchesFailed: string;
  emptyEveryone: string;
  tryAgain: string;
  back: string;
  today: string;
  yesterday: string;
  older: string;
  signOut: string;
  signOutFailed: string;
  unreachable: string;
  settings: string;
  username: string;
  save: string;
  nameRule(max: number): string;
  saving: string;
  saved: string;
  saveFailed: string;
}

const DEFAULT_TEXT: AccountText = {
  title: "PLAYER STATS",
  label: "Account",
  signIn: "SIGN IN",
  signInWith: "SIGN IN WITH GOOGLE",
  signedOutNote:
    "Sign in to keep a history of every match you finish and your career totals, on any device. Playing never needs an account. Your name, avatar and Elo appear on the public leaderboard after a rated round; your email is never shown.",
  signedOutMatches:
    "Sign in to keep a history of every match you finish, on any device. Playing never needs an account.",
  signedInAs: (name) => `Signed in as ${name}`,
  signedOutTitle: "Sign in to keep your match history",
  leaderboard: "LEADERBOARD",
  rankedLeaderboard: (rank) => `#${rank} · LEADERBOARD`,
  profileButton: (name, rating) =>
    `${name}\n${Math.round(rating).toLocaleString()} ELO`,
  profileTitle: "Your global rank and Elo · Open player stats",
  offline: "MY STATS · OFFLINE",
  offlineTitle: "Could not refresh Elo · Showing the last available rating",
  loading: "Loading your games…",
  empty:
    "No games yet. Finish a match in a room while signed in and it lands here.",
  loadFailed: "Could not load your games.",
  loadingLeaderboard: "Loading leaderboard…",
  leaderboardFailed: "Could not load the leaderboard. Close and try again.",
  statsTab: "STATS",
  matchesTab: "MATCHES",
  leaderboardTab: "LEADERBOARD",
  matchesTitle: "Recent matches, everyone's or your own",
  everyone: "EVERYONE",
  yours: "YOURS",
  everyoneNote: "Recent finished games, newest first.",
  yoursNote: "Every game you finished while signed in, newest first.",
  loadingMatches: "Loading matches…",
  loadingOlder: "Loading older matches…",
  matchesFailed: "Could not load matches.",
  emptyEveryone: "No finished games yet. Start a room and be the first.",
  tryAgain: "TRY AGAIN",
  back: "‹ MATCHES",
  today: "TODAY",
  yesterday: "YESTERDAY",
  older: "OLDER MATCHES",
  signOut: "SIGN OUT",
  signOutFailed: "Could not sign out. Try again.",
  unreachable: "Could not reach the sign-in service. Close this and try again.",
  settings: "Account settings",
  username: "USERNAME",
  save: "SAVE",
  nameRule: (max) => `1 to ${max} characters`,
  saving: "Saving…",
  saved: "Saved. This is your name in every room.",
  saveFailed: "Could not save. Try again.",
};

/** What a row renderer is given besides its entry. */
export interface AccountMatchContext {
  /** The clock the list is grouped against, so a row's own words agree with its day heading. */
  now: number;
  /** TODAY, YESTERDAY or the date, as the heading above the row reads. */
  day: string;
  /** Show this match's full results inside the dialog. */
  open(): void;
}

export interface AccountDialogOptions<
  Account extends { name: string },
  Profile extends AccountProfile,
  Match extends { id: string; endedAt: number },
  Player,
> {
  auth: AccountAuth<Account>;
  fetch: typeof fetch;
  /** GET the signed-in player's history; `before` pages backwards from an `endedAt`. */
  historyUrl(before?: number): string;
  /** GET everyone's recent games; `before` pages backwards from a listed `endedAt`. */
  matchesUrl(before?: number): string;
  /** GET the profile, PUT `{ username }`. */
  profileUrl: string;
  /** GET `{ players }`. */
  leaderboardUrl: string;
  /** The name this browser already plays under, the natural first username. */
  localName(): string | null;
  track(event: string): void;
  /** The account's username rule. */
  names: {
    valid(name: string | null | undefined): boolean;
    /** A username from a full (e.g. Google) name, or nothing. */
    suggest(fullName: string): string | undefined;
    max: number;
  };
  /** The profile's rating value for the header button (a new player's default when the profile has none). */
  rating(profile: Profile | undefined): number;
  /** Career totals for a history page's profile; `openMatch` opens one of its matches in the MATCHES tab. */
  totals(
    page: AccountPage<Profile, Match>,
    handlers: { openMatch(entry: Match): void },
  ): Node;
  /** One row of the recent-games list. */
  match(entry: Match, context: AccountMatchContext): Node;
  /** An opened match: its full results, as the post-match report shows them. */
  matchDetail(entry: Match, context: { now: number; day: string }): Node;
  leaderboard(players: Player[]): Node;
  /** The avatar beside the username. */
  avatar(id: string): HTMLElement;
  /** A full page; fewer means the list ended. Default 20. */
  pageSize?: number;
  refreshClock?: {
    now(): number;
    schedule(callback: () => void, delayMs: number): () => void;
  };
  text?: Partial<AccountText>;
  classes?: PartClasses<AccountPart>;
  dialogClasses?: PartClasses<DialogPart>;
  document?: Document;
}

export interface AccountDialog {
  /** The header button: SIGN IN, or the player's name and rating. */
  button: HTMLButtonElement;
  /** Opens the dialog on its MATCHES tab. */
  matchesButton: HTMLButtonElement;
  leaderboardButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  /** Refresh the header's rating soon (coalesced: at most one profile request per 15 seconds). */
  refresh(): void;
  dispose(): void;
}

/** One list of recent games and how far back it has been read. */
interface Feed<Match> {
  matches: Match[];
  more: boolean;
  state: "idle" | "loading" | "failed";
}
const emptyFeed = <Match>(): Feed<Match> => ({
  matches: [],
  more: true,
  state: "idle",
});

/**
 * TODAY, YESTERDAY, else the date; the year only when it is not the current one. Local days, so a game played last
 * night reads as YESTERDAY wherever the player is.
 */
export function dayLabel(
  at: number,
  now: number,
  words: { today: string; yesterday: string } = {
    today: "TODAY",
    yesterday: "YESTERDAY",
  },
): string {
  const midnight = (value: number): number => {
    const d = new Date(value);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  };
  const days = Math.round((midnight(now) - midnight(at)) / 86_400_000);
  if (days === 0) return words.today;
  if (days === 1) return words.yesterday;
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

/**
 * The account, matches and leaderboard buttons and their dialog: sign in and career totals, recent games (everyone's
 * or the player's own, grouped by day, each opening into its full results) and the global leaderboard, one tab each.
 * Everything a server or another player supplied is written as text or through the game's renderers, never as markup.
 * Every fetch shows a loading line and a failed one says so and offers to try again; a page is read once per opening
 * and kept while the dialog is up, so switching tabs or redrawing a list never refetches.
 */
export function createAccountDialog<
  Account extends { name: string },
  Profile extends AccountProfile,
  Match extends { id: string; endedAt: number },
  Player,
>(
  options: AccountDialogOptions<Account, Profile, Match, Player>,
): AccountDialog {
  const doc = options.document ?? document;
  const auth = options.auth;
  const text: AccountText = { ...DEFAULT_TEXT, ...options.text };
  const c = (part: AccountPart) =>
    partClass(ACCOUNT_CLASSES, options.classes, part);
  const node = <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    content = "",
    className = "",
  ) => el(tag, content, className, doc);
  const plainButton = (content: string, className = "") => {
    const result = node("button", content, className);
    result.type = "button";
    return result;
  };
  const pageSize = options.pageSize ?? 20;
  const matchesButton = plainButton(text.matchesTab, c("button"));
  matchesButton.title = text.matchesTitle;
  const leaderboardButton = plainButton(text.leaderboard, c("button"));
  const button = plainButton(text.signIn, c("button"));
  const { dialog, title, body } = createDialog({
    title: text.title,
    label: text.label,
    ...(options.dialogClasses ? { classes: options.dialogClasses } : {}),
    document: doc,
  });
  // The three sections are the dialog's navigation, so they stand in for its title; its accessible name is unchanged.
  const tabs = node("nav", "", c("tabs"));
  tabs.setAttribute("aria-label", text.label);
  const tabButtons = new Map<AccountView, HTMLButtonElement>();
  for (const [key, label] of [
    ["stats", text.statsTab],
    ["matches", text.matchesTab],
    ["leaderboard", text.leaderboardTab],
  ] as const) {
    const tab = plainButton(label);
    tab.onclick = () => show(key);
    tabButtons.set(key, tab);
    tabs.append(tab);
  }
  title.replaceWith(tabs);

  let account: Account | undefined,
    generation = 0,
    view: AccountView = "stats",
    scope: AccountScope = "everyone",
    opened: Match | undefined,
    listScroll = 0;
  // Read once per opening and kept while the dialog is up, so switching tabs never refetches.
  let session = 0,
    history:
      | {
          page: AccountPage<Profile, Match>;
          username?: string;
          feed: Feed<Match>;
        }
      | "loading"
      | "failed"
      | undefined,
    everyone = emptyFeed<Match>();
  let landingGeneration = 0;
  const refreshClock = options.refreshClock ?? {
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
      const response = await options.fetch(options.profileUrl, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error("profile");
      const { profile } = (await response.json()) as { profile?: Profile };
      if (mine !== landingGeneration || !account) return;
      leaderboardButton.textContent = profile?.rank
        ? text.rankedLeaderboard(profile.rank)
        : text.leaderboard;
      const nickname =
        [profile?.username, profile?.name, options.localName()].find((name) =>
          options.names.valid(name),
        ) ?? account.name;
      button.textContent = text.profileButton(
        nickname,
        options.rating(profile),
      );
      button.title = text.profileTitle;
    } catch {
      if (mine === landingGeneration && account) {
        if (!button.textContent?.includes("ELO"))
          button.textContent = text.offline;
        button.title = text.offlineTitle;
      }
    }
  }

  async function saveUsername(username: string): Promise<boolean> {
    const token = await auth.token();
    if (!token) return false;
    const response = await options.fetch(options.profileUrl, {
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
    const response = await options.fetch(url, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as T;
  }

  /** Forget everything read so far: the dialog reopened or the account changed, and a reply still in flight is stale. */
  function reset(): void {
    session++;
    history = undefined;
    everyone = emptyFeed<Match>();
    opened = undefined;
    listScroll = 0;
  }

  /** Appends a page, dropping anything already listed: two games can end in the same millisecond at a page boundary. */
  function extend(feed: Feed<Match>, page: readonly Match[]): void {
    const known = new Set(feed.matches.map((entry) => entry.id));
    feed.matches.push(...page.filter((entry) => !known.has(entry.id)));
    feed.more = page.length >= pageSize;
  }

  /** The signed-in history's first page: profile, totals and the newest of the player's own games. */
  async function loadHistory(): Promise<void> {
    const mine = session;
    history = "loading";
    try {
      const page = await get<AccountPage<Profile, Match>>(
        options.historyUrl(),
        true,
      );
      if (mine !== session) return;
      // An account without a username takes the name this browser already plays under, else the first word of the
      // full name: the player should have one from the first room on, and the STATS tab changes it.
      let username = page.profile?.username;
      if (!username) {
        const stored = options.localName()?.trim(),
          first = options.names.valid(stored)
            ? stored
            : options.names.suggest(account?.name ?? "");
        if (first && (await saveUsername(first))) username = first;
      }
      if (mine !== session) return;
      if (username) auth.remember(username);
      const feed = emptyFeed<Match>();
      extend(feed, page.matches);
      history = { page, ...(username ? { username } : {}), feed };
      void refreshLanding();
    } catch {
      if (mine !== session) return;
      history = "failed";
    }
    // Only the views that show the player's own games change; redrawing another would refetch or move focus for nothing.
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
  async function loadMatches(which: AccountScope): Promise<void> {
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
          ? (await get<{ matches: Match[] }>(options.matchesUrl(before), false))
              .matches
          : (
              await get<AccountPage<Profile, Match>>(
                options.historyUrl(before),
                true,
              )
            ).matches;
      if (mine !== session) return;
      extend(feed, page);
      feed.state = "idle";
    } catch {
      if (mine !== session) return;
      feed.state = "failed";
    }
    redrawList();
  }

  function focusPart(key: string): void {
    body
      .querySelector<HTMLElement>(`[data-focus="${cssEscape(key)}"]`)
      ?.focus({ preventScroll: true });
  }
  /** `CSS.escape` where the document has it; a match id is hexadecimal, so a plain quote is enough elsewhere. */
  const cssEscape = (value: string): string =>
    typeof CSS === "object" && typeof CSS.escape === "function"
      ? CSS.escape(value)
      : value.replace(/["\\]/g, "\\$&");

  function show(next: AccountView, entry?: Match): void {
    // A match opened from the list returns to where the list was; one opened from elsewhere returns to its top.
    if (next === "matches" && entry)
      listScroll = view === "matches" && !opened ? body.scrollTop : 0;
    const back =
      next === "matches" && !entry && view === "matches" ? opened : undefined;
    view = next;
    opened = entry;
    render();
    body.scrollTop = back ? listScroll : 0;
    if (back) focusPart(`match-${back.id}`);
  }

  function signInPrompt(message: string): HTMLElement[] {
    const error = node("p", "", c("error")),
      enter = plainButton(text.signInWith);
    error.setAttribute("role", "alert");
    enter.onclick = async () => {
      enter.disabled = true;
      error.textContent = "";
      try {
        await auth.signIn();
        options.track("Signed In");
      } catch (failure) {
        error.textContent = auth.failure(failure);
      } finally {
        enter.disabled = false;
      }
    };
    // Held until sign-in is loaded: a tap that had to wait for the download would find its popup blocked, notably in Safari.
    const mine = generation;
    enter.disabled = true;
    auth.ready().then(
      () => {
        if (mine === generation) enter.disabled = false;
      },
      () => {
        if (mine === generation) error.textContent = text.unreachable;
      },
    );
    return [node("p", message, c("note")), enter, error];
  }

  /** Loading, failed or signed out: what stands in for the signed-in history. Undefined once it is ready. */
  function historyPending(signedOut: string): HTMLElement[] | undefined {
    if (!account) return signInPrompt(signedOut);
    if (typeof history === "object") return undefined;
    if (history === undefined) void loadHistory();
    if (history !== "failed") return [node("p", text.loading, c("note"))];
    const retry = plainButton(text.tryAgain);
    retry.dataset.focus = "retry";
    retry.onclick = () => {
      history = undefined;
      render();
    };
    return [node("p", text.loadFailed, c("note")), retry];
  }

  function renderStats(): void {
    const pending = historyPending(text.signedOutNote);
    if (pending || typeof history !== "object" || !account) {
      body.replaceChildren(...(pending ?? []));
      return;
    }
    const cache = history,
      heading = node("h2", cache.username ?? account.name, c("heading"));
    if (cache.page.profile?.avatarId)
      heading.prepend(options.avatar(cache.page.profile.avatarId));
    const error = node("p", "", c("error"));
    error.setAttribute("role", "alert");
    const leave = plainButton(text.signOut);
    leave.onclick = async () => {
      leave.disabled = true;
      try {
        await auth.signOut();
      } catch {
        error.textContent = text.signOutFailed;
        leave.disabled = false;
      }
    };
    const rename = node("form", "", c("rename")),
      label = node("label", text.username),
      name = node("input"),
      save = node("button", text.save),
      saved = node("small");
    name.maxLength = options.names.max + 2;
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
      if (!options.names.valid(value)) {
        saved.textContent = text.nameRule(options.names.max);
        return;
      }
      save.disabled = true;
      saved.textContent = text.saving;
      try {
        const success = await saveUsername(value);
        saved.textContent = success ? text.saved : text.saveFailed;
        // The cache is this opening's own; one thrown away while the save was in flight must not come back.
        if (success && history === cache) {
          cache.username = value;
          const portrait = heading.firstElementChild;
          heading.replaceChildren(
            ...(portrait ? [portrait] : []),
            doc.createTextNode(value),
          );
        }
      } catch {
        saved.textContent = text.saveFailed;
      } finally {
        save.disabled = false;
      }
    };
    rename.append(label, name, save, saved);
    const settings = node("details", "", c("settings"));
    settings.append(node("summary", text.settings), rename, leave);
    body.replaceChildren(
      heading,
      options.totals(cache.page, {
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
    const filter = node("div", "", c("scope"));
    filter.setAttribute("role", "group");
    filter.setAttribute("aria-label", text.matchesTitle);
    for (const [key, label] of [
      ["everyone", text.everyone],
      ["mine", text.yours],
    ] as const) {
      const choice = plainButton(label);
      choice.setAttribute("aria-pressed", String(scope === key));
      choice.dataset.focus = `scope-${key}`;
      choice.onclick = () => {
        if (scope === key) return;
        scope = key;
        show("matches");
      };
      filter.append(choice);
    }
    const intro = node(
      "p",
      scope === "everyone" ? text.everyoneNote : text.yoursNote,
      c("muted"),
    );
    if (scope === "mine") {
      const pending = historyPending(text.signedOutMatches);
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
          : emptyFeed<Match>();
    // Only a feed never read yet loads by itself; an empty first page sets `more` false, so it is not asked again.
    if (
      scope === "everyone" &&
      !feed.matches.length &&
      feed.state === "idle" &&
      feed.more
    )
      void loadMatches("everyone");
    const now = refreshClock.now(),
      list = node("div", "", c("list"));
    let day: string | undefined, rows: HTMLUListElement | undefined;
    for (const entry of feed.matches) {
      const label = dayLabel(entry.endedAt, now, text);
      if (label !== day || !rows) {
        day = label;
        rows = node("ul");
        const group = node("section", "", c("day"));
        group.append(node("h3", label), rows);
        list.append(group);
      }
      rows.append(
        options.match(entry, {
          now,
          day: label,
          open: () => show("matches", entry),
        }),
      );
    }
    const note = node("p", "", c("note"));
    if (feed.state === "loading")
      note.textContent = feed.matches.length
        ? text.loadingOlder
        : text.loadingMatches;
    else if (feed.state === "failed") note.textContent = text.matchesFailed;
    else if (!feed.matches.length)
      note.textContent = scope === "everyone" ? text.emptyEveryone : text.empty;
    const more = plainButton(
      feed.state === "failed"
        ? text.tryAgain
        : feed.state === "loading"
          ? text.loadingMatches
          : text.older,
    );
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

  function renderMatch(entry: Match): void {
    const back = plainButton(text.back, c("back"));
    back.onclick = () => show("matches");
    const now = refreshClock.now();
    body.replaceChildren(
      back,
      options.matchDetail(entry, {
        now,
        day: dayLabel(entry.endedAt, now, text),
      }),
    );
    back.focus({ preventScroll: true });
  }

  function renderLeaderboard(): void {
    const mine = generation,
      message = node("p", text.loadingLeaderboard, c("muted"));
    body.replaceChildren(message);
    void (async () => {
      try {
        const page = await get<{ players: Player[] }>(
          options.leaderboardUrl,
          false,
        );
        if (mine === generation)
          body.replaceChildren(options.leaderboard(page.players));
      } catch {
        if (mine === generation) message.textContent = text.leaderboardFailed;
      }
    })();
  }

  function render(): void {
    generation++;
    // A redraw replaces the focused control; the same control in the new view takes the focus back.
    const active = doc.activeElement as HTMLElement | null;
    const focused =
      active && body.contains(active) ? active.dataset?.focus : undefined;
    for (const [key, tab] of tabButtons)
      if (key === view) tab.setAttribute("aria-current", "page");
      else tab.removeAttribute("aria-current");
    body.dataset.view = opened ? "match" : view;
    if (view === "leaderboard") renderLeaderboard();
    else if (view === "stats") renderStats();
    else if (opened) renderMatch(opened);
    else renderMatches();
    if (focused) focusPart(focused);
  }

  const stop = auth.watch((next) => {
    cancelRefresh?.();
    cancelRefresh = undefined;
    account = next;
    leaderboardButton.textContent = text.leaderboard;
    button.textContent = next ? next.name : text.signIn;
    button.dataset.signedIn = String(Boolean(next));
    button.title = next ? text.signedInAs(next.name) : text.signedOutTitle;
    landingGeneration++;
    reset();
    if (next) void refreshLanding();
    if (dialog.open) render();
  });
  // Sign-in loads when the pointer arrives, so its popup can open inside the click that asks for it.
  button.addEventListener("pointerenter", auth.warm, { once: true });
  button.addEventListener("focus", auth.warm, { once: true });
  const open = (next: AccountView) => {
    reset();
    view = next;
    scope = "everyone";
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
