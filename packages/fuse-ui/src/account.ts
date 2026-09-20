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
  | "error";

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
};

/** The panel's words. Defaults are neutral; a game names its players and its title. */
export interface AccountText {
  title: string;
  label: string;
  signIn: string;
  signInWith: string;
  signedOutNote: string;
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
  myStats: string;
  globalLeaderboard: string;
  history: string;
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
  loadFailed: "Could not load your games. Try again in a moment.",
  loadingLeaderboard: "Loading leaderboard…",
  leaderboardFailed: "Could not load the leaderboard. Close and try again.",
  myStats: "MY STATS",
  globalLeaderboard: "GLOBAL LEADERBOARD",
  history: "MATCH HISTORY",
  older: "OLDER GAMES",
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

export interface AccountDialogOptions<
  Account extends { name: string },
  Profile extends AccountProfile,
  Match extends { endedAt: number },
  Player,
> {
  auth: AccountAuth<Account>;
  fetch: typeof fetch;
  /** GET the signed-in player's history; `before` pages backwards from an `endedAt`. */
  historyUrl(before?: number): string;
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
  /** Career totals for a history page's profile. */
  totals(page: AccountPage<Profile, Match>): Node;
  /** One past match: the match results view. */
  match(entry: Match): Node;
  leaderboard(players: Player[]): Node;
  /** The avatar beside the username. */
  avatar(id: string): HTMLElement;
  /** A full page; fewer means the history ended. Default 20. */
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
  leaderboardButton: HTMLButtonElement;
  dialog: HTMLDialogElement;
  /** Refresh the header's rating soon (coalesced: at most one profile request per 15 seconds). */
  refresh(): void;
  dispose(): void;
}

/**
 * The account button, the leaderboard button and their dialog: sign in, career totals, past matches and the global
 * leaderboard. Everything a server or another player supplied is written as text or through the game's renderers,
 * never as markup. Every fetch shows a loading line, and a failed one says so.
 */
export function createAccountDialog<
  Account extends { name: string },
  Profile extends AccountProfile,
  Match extends { endedAt: number },
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
  const leaderboardButton = plainButton(text.leaderboard, c("button"));
  const button = plainButton(text.signIn, c("button"));
  const { dialog, body } = createDialog({
    title: text.title,
    label: text.label,
    ...(options.dialogClasses ? { classes: options.dialogClasses } : {}),
    document: doc,
  });
  let account: Account | undefined,
    generation = 0,
    view: "stats" | "leaderboard" = "stats";
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

  interface StatsView {
    heading: HTMLElement;
    list: HTMLUListElement;
    totals: HTMLElement;
    more: HTMLButtonElement;
    note: HTMLElement;
    name: HTMLInputElement;
  }
  async function load(parts: StatsView, before?: number): Promise<void> {
    const { heading, list, totals, more, note, name } = parts;
    const mine = generation;
    more.hidden = true;
    note.textContent = text.loading;
    try {
      const token = await auth.token();
      if (!token) throw new Error("signed out");
      const response = await options.fetch(options.historyUrl(before), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error(String(response.status));
      const page = (await response.json()) as AccountPage<Profile, Match>;
      if (mine !== generation) return; // signed out, or reopened, while this was in flight
      if (before === undefined) {
        // An account without a username takes the name this browser already plays under, else the first word of the
        // full name: the player should have one from the first room on, and the field right here changes it.
        let username = page.profile?.username;
        if (!username) {
          const stored = options.localName()?.trim(),
            first = options.names.valid(stored)
              ? stored
              : options.names.suggest(account?.name ?? "");
          if (first && (await saveUsername(first))) username = first;
        }
        if (mine !== generation) return;
        if (username) {
          heading.textContent = username;
          if (page.profile?.avatarId)
            heading.prepend(options.avatar(page.profile.avatarId));
          auth.remember(username);
          if (doc.activeElement !== name) name.value = username;
        }
        totals.replaceChildren(options.totals(page));
        void refreshLanding();
      }
      list.append(...page.matches.map((entry) => options.match(entry)));
      note.textContent = list.childElementCount ? "" : text.empty;
      const last = page.matches.at(-1);
      // A full page means there may be more; the oldest entry is the cursor for the next one.
      more.hidden = page.matches.length < pageSize || !last;
      if (last)
        more.onclick = () => {
          void load(parts, last.endedAt);
        };
    } catch {
      if (mine === generation) note.textContent = text.loadFailed;
    }
  }

  function renderLeaderboard(): void {
    const mine = generation,
      message = node("p", text.loadingLeaderboard, c("muted"));
    const back = plainButton(text.myStats);
    back.onclick = () => {
      view = "stats";
      render();
    };
    body.replaceChildren(back, message);
    void (async () => {
      try {
        const token = await auth.token();
        const response = await options.fetch(options.leaderboardUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error("leaderboard");
        const page = (await response.json()) as { players: Player[] };
        if (mine === generation)
          body.replaceChildren(back, options.leaderboard(page.players));
      } catch {
        if (mine === generation) message.textContent = text.leaderboardFailed;
      }
    })();
  }

  function renderSignedOut(error: HTMLElement): void {
    const enter = plainButton(text.signInWith);
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
    body.replaceChildren(
      node("p", text.signedOutNote, c("note")),
      enter,
      error,
    );
  }

  function render(): void {
    generation++;
    if (view === "leaderboard") return renderLeaderboard();
    const error = node("p", "", c("error"));
    error.setAttribute("role", "alert");
    if (!account) return renderSignedOut(error);
    const heading = node("h2", account.name, c("heading")),
      totals = node("div", "", c("totals")),
      list = node("ul", "", c("list")),
      note = node("p", "", c("note")),
      more = plainButton(text.older),
      leave = plainButton(text.signOut),
      row = node("div", "", c("actions"));
    more.hidden = true;
    leave.onclick = async () => {
      leave.disabled = true;
      try {
        await auth.signOut();
      } catch {
        error.textContent = text.signOutFailed;
        leave.disabled = false;
      }
    };
    row.append(more, leave);
    const rename = node("form", "", c("rename")),
      label = node("label", text.username),
      name = node("input"),
      save = node("button", text.save),
      saved = node("small");
    name.maxLength = options.names.max + 2;
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
      if (!options.names.valid(value)) {
        saved.textContent = text.nameRule(options.names.max);
        return;
      }
      save.disabled = true;
      saved.textContent = text.saving;
      const mine = generation;
      try {
        const success = await saveUsername(value);
        saved.textContent = success ? text.saved : text.saveFailed;
        if (success && mine === generation) {
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
    const leaderboard = plainButton(text.globalLeaderboard);
    leaderboard.onclick = () => {
      view = "leaderboard";
      render();
    };
    body.replaceChildren(
      heading,
      totals,
      leaderboard,
      node("h3", text.history),
      list,
      note,
      row,
      settings,
      error,
    );
    void load({ heading, list, totals, more, note, name });
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
    if (next) void refreshLanding();
    if (dialog.open) render();
  });
  // Sign-in loads when the pointer arrives, so its popup can open inside the click that asks for it.
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
