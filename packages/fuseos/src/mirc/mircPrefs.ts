import { DEFAULT_NETWORK_ID, findNetwork } from "./irc/networks";
import { guestNick } from "./irc/session";

/**
 * What File > Options > Connect remembers, per browser. Nothing here ever leaves the browser except the
 * nick, alternative, real name and ident, which go to the IRC server the user connects to.
 */
export type MircPrefs = {
  nick: string;
  altNick: string;
  realName: string;
  /** "E-Mail Address": mIRC used the part before the @ as the ident (USER name). Never sent anywhere else. */
  email: string;
  networkId: string;
  invisible: boolean;
  timestamps: boolean;
  /** Pop up the Channels Folder after connecting. */
  folderOnConnect: boolean;
  /** Channels in the Channels Folder. */
  favorites: string[];
  /** When this browser first opened mIRC (ms), for the shareware day counter. */
  firstRun: number;
};

export interface MircPrefsStore {
  get(): MircPrefs | undefined;
  set(prefs: MircPrefs): void;
}

export const MIRC_PREFS_KEY = "fuseos.mirc";
export const DEFAULT_FAVORITES = ["#fuseos-test", "#chat", "#help"];

/** First-run settings: a Guest#### nick and EFnet selected, as a fresh 2001 install would have it. */
export function defaultPrefs(random: () => number, now: number): MircPrefs {
  const nick = guestNick(random);
  return {
    nick,
    altNick: `${nick}_`,
    realName: "FuseOS User",
    email: "",
    networkId: DEFAULT_NETWORK_ID,
    invisible: true,
    timestamps: false,
    folderOnConnect: true,
    favorites: DEFAULT_FAVORITES,
    firstRun: now,
  };
}

const NICK = /^[A-Za-z[\]\\`_^{|}][A-Za-z0-9[\]\\`_^{|}-]{0,29}$/;

export function isValidNick(nick: string): boolean {
  return NICK.test(nick);
}

/** Validates stored prefs field by field, falling back to `fallback` for anything missing or malformed. */
export function parsePrefs(
  raw: string | null | undefined,
  fallback: MircPrefs,
): MircPrefs {
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (typeof parsed !== "object" || parsed === null) return fallback;
  const record: Record<string, unknown> = { ...parsed };
  const text = (
    key: string,
    max: number,
    ok: (value: string) => boolean = () => true,
  ) => {
    const value = record[key];
    return typeof value === "string" && value.length <= max && ok(value)
      ? value
      : undefined;
  };
  const flag = (key: string) =>
    typeof record[key] === "boolean" ? (record[key] as boolean) : undefined;
  const favorites = Array.isArray(record.favorites)
    ? record.favorites
        .filter(
          (entry): entry is string =>
            typeof entry === "string" && /^[#&][^\s,]{1,49}$/.test(entry),
        )
        .slice(0, 30)
    : undefined;
  return {
    nick: text("nick", 30, isValidNick) ?? fallback.nick,
    altNick:
      text("altNick", 30, (value) => value === "" || isValidNick(value)) ??
      fallback.altNick,
    realName: text("realName", 100) ?? fallback.realName,
    email: text("email", 100) ?? fallback.email,
    networkId:
      text("networkId", 40, (value) => findNetwork(value) !== undefined) ??
      fallback.networkId,
    invisible: flag("invisible") ?? fallback.invisible,
    timestamps: flag("timestamps") ?? fallback.timestamps,
    folderOnConnect: flag("folderOnConnect") ?? fallback.folderOnConnect,
    favorites: favorites ?? fallback.favorites,
    firstRun:
      typeof record.firstRun === "number" && Number.isFinite(record.firstRun)
        ? record.firstRun
        : fallback.firstRun,
  };
}

/** The ident sent in USER: the e-mail's local part when given, else the nick. */
export function identFor(prefs: Pick<MircPrefs, "email" | "nick">): string {
  const local = prefs.email.split("@")[0] ?? "";
  return local.length > 0 ? local : prefs.nick;
}

/** Days since first run, counting the first day as day 1 (the shareware nag's counter). */
export function daysUsed(firstRun: number, now: number): number {
  return Math.max(1, Math.floor((now - firstRun) / 86_400_000) + 1);
}

export class MemoryMircPrefsStore implements MircPrefsStore {
  constructor(private prefs: MircPrefs | undefined = undefined) {}
  get(): MircPrefs | undefined {
    return this.prefs;
  }
  set(prefs: MircPrefs): void {
    this.prefs = prefs;
  }
}

/** localStorage backed; every access is guarded because storage can be unavailable. */
export class LocalStorageMircPrefsStore implements MircPrefsStore {
  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem"> | undefined,
    private readonly fallback: () => MircPrefs,
  ) {}

  get(): MircPrefs | undefined {
    try {
      const raw = this.storage?.getItem(MIRC_PREFS_KEY);
      return raw ? parsePrefs(raw, this.fallback()) : undefined;
    } catch {
      return undefined;
    }
  }

  set(prefs: MircPrefs): void {
    try {
      this.storage?.setItem(MIRC_PREFS_KEY, JSON.stringify(prefs));
    } catch {
      // Storage blocked or full: the settings last until the window closes.
    }
  }
}
