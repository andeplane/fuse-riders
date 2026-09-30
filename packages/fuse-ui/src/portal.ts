/** What a game writes in its `games/<id>/portal.json` to appear on the app portal. */
export interface PortalEntry {
  /** Display name, e.g. "Fuse Riders". */
  name: string;
  /** One short line shown under the name. */
  tagline: string;
  /** One to three characters drawn in the game's tile, e.g. "FR". */
  mark: string;
  /** Tile colour as `#rrggbb`. */
  accent: string;
  /** Lower sorts first; games without one sort after those with one, by name. */
  order: number;
}

/** A portal entry as the build hands it to the page: the game id and its path under the site base. */
export interface PortalGame extends PortalEntry {
  id: string;
  /** "" for the root page, otherwise `<id>/`. */
  path: string;
}

declare const __FUSE_PORTAL_GAMES__: readonly PortalGame[] | undefined;

/** Every game on the portal, filled in by vite.config.ts from `games/<id>/portal.json`; empty outside a Vite build. */
export const PORTAL_GAMES: readonly PortalGame[] =
  typeof __FUSE_PORTAL_GAMES__ === "undefined" ? [] : __FUSE_PORTAL_GAMES__;

const DEFAULT_ORDER = 100;
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max;

/** Validates a parsed `portal.json`; null when a field is missing or malformed. */
export function parsePortalEntry(raw: unknown): PortalEntry | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { name, tagline, mark, accent, order } = raw as Record<string, unknown>;
  if (!text(name, 40) || !text(tagline, 80) || !text(mark, 3)) return null;
  if (typeof accent !== "string" || !/^#[0-9a-f]{6}$/i.test(accent))
    return null;
  if (order !== undefined && !Number.isFinite(order)) return null;
  return {
    name,
    tagline,
    mark,
    accent,
    order: typeof order === "number" ? order : DEFAULT_ORDER,
  };
}

export interface AppPortalOptions {
  document: Document;
  /** The id of the game showing the portal; its tile is marked as the current page. */
  current: string;
  /** The site base, `import.meta.env.BASE_URL` (e.g. "/" or "/fuse-riders/"). */
  base: string;
  /** The page's `location.search`; a `mute` flag carries over to the other games. */
  search?: string;
  games?: readonly PortalGame[];
}

export interface AppPortal {
  element: HTMLElement;
  open(): void;
  close(): void;
  readonly isOpen: boolean;
}

/**
 * A Google-style app launcher: a 3×3 dot button that opens a grid of every Fuse game. Games put `element` first in
 * their header, top left; it renders nothing when the build lists no games.
 */
export function createAppPortal(options: AppPortalOptions): AppPortal {
  const { document, current, base } = options;
  const games = options.games ?? PORTAL_GAMES;
  const muted = new URLSearchParams(options.search ?? "").has("mute");
  const element = document.createElement("div");
  element.className = "fui-portal";
  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "fui-portal-toggle";
  toggle.setAttribute("aria-label", "Fuse games");
  toggle.setAttribute("aria-haspopup", "true");
  toggle.setAttribute("aria-expanded", "false");
  toggle.title = "Fuse games";
  for (let dot = 0; dot < 9; dot++) {
    const span = document.createElement("span");
    span.className = "fui-portal-dot";
    toggle.append(span);
  }
  const panel = document.createElement("nav");
  panel.className = "fui-portal-panel";
  panel.id = `fui-portal-${current}`;
  panel.setAttribute("aria-label", "Fuse games");
  panel.setAttribute("hidden", "");
  toggle.setAttribute("aria-controls", panel.id);
  const heading = document.createElement("p");
  heading.className = "fui-portal-heading";
  heading.textContent = "FUSE GAMES";
  const grid = document.createElement("ul");
  grid.className = "fui-portal-grid";
  for (const game of games) {
    const item = document.createElement("li");
    const link = document.createElement("a");
    link.className = "fui-portal-game";
    link.href = `${base}${game.path}${muted ? "?mute" : ""}`;
    link.title = game.tagline;
    link.style.setProperty("--fui-portal-accent", game.accent);
    if (game.id === current) link.setAttribute("aria-current", "page");
    const mark = document.createElement("span");
    mark.className = "fui-portal-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = game.mark;
    const name = document.createElement("span");
    name.className = "fui-portal-name";
    name.textContent = game.name;
    link.append(mark, name);
    link.addEventListener("click", () => close());
    item.append(link);
    grid.append(item);
  }
  panel.append(heading, grid);
  element.append(toggle, panel);
  if (games.length === 0) element.setAttribute("hidden", "");

  let isOpen = false;
  const onPointer = (event: Event) => {
    if (!element.isConnected || !element.contains(event.target as Node))
      close();
  };
  const onKey = (event: Event) => {
    if ((event as KeyboardEvent).key !== "Escape") return;
    close();
    toggle.focus();
  };
  function open() {
    if (isOpen || games.length === 0) return;
    isOpen = true;
    panel.removeAttribute("hidden");
    toggle.setAttribute("aria-expanded", "true");
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.setAttribute("hidden", "");
    toggle.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onPointer);
    document.removeEventListener("keydown", onKey);
  }
  toggle.addEventListener("click", () => (isOpen ? close() : open()));
  return {
    element,
    open,
    close,
    get isOpen() {
      return isOpen;
    },
  };
}
