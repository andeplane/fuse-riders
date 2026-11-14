import type { Rect, Size } from "../windows/windowManager";
import { clampRect, TASKBAR_HEIGHT } from "../windows/windowManager";

/** The launcher's name in the title bar, the Start menu and on the desktop. */
export const LAUNCHER_TITLE = "Fusteam";

/** The one launcher window: a fixed id, so opening it again focuses it instead of adding a second. */
export const LAUNCHER_WINDOW_ID = "launcher";

/** Room for the games list, a 16:9 screenshot beside it and the bottom bar; centred on a 1280x800 desktop. */
export const LAUNCHER_WINDOW_SIZE: Size = { width: 900, height: 600 };

/** Narrower or shorter than this and the window would not fit: it opens maximized and the list stacks above the details. */
export const LAUNCHER_FIT_VIEWPORT: Size = { width: 960, height: 700 };

export function shouldMaximizeLauncher(viewport: Size): boolean {
  return (
    viewport.width < LAUNCHER_FIT_VIEWPORT.width ||
    viewport.height < LAUNCHER_FIT_VIEWPORT.height
  );
}

/** The launcher centred in the desktop area (above the taskbar), kept inside it on a small display. */
export function centeredLauncherRect(viewport: Size): Rect {
  const area = viewport.height - TASKBAR_HEIGHT;
  return clampRect(
    {
      x: Math.round((viewport.width - LAUNCHER_WINDOW_SIZE.width) / 2),
      y: Math.round((area - LAUNCHER_WINDOW_SIZE.height) / 2),
      ...LAUNCHER_WINDOW_SIZE,
    },
    viewport,
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function pad(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * "Last played" as the old client said it: "Never", "Today, 14:02", "Yesterday", "3 days ago", then the date.
 * Rendered in UTC so the text does not depend on the machine's zone (the stored value is a UTC timestamp).
 */
export function formatLastPlayed(
  playedAt: number | undefined,
  now: number,
): string {
  if (playedAt === undefined) return "Never";
  const played = new Date(playedAt);
  const dayOf = (time: number) => Math.floor(time / DAY_MS);
  const days = dayOf(now) - dayOf(playedAt);
  if (days <= 0)
    return `Today, ${pad(played.getUTCHours())}:${pad(played.getUTCMinutes())}`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days} days ago`;
  return `${played.getUTCDate()} ${MONTHS[played.getUTCMonth()]} ${played.getUTCFullYear()}`;
}

/** A plausible, stable "disk usage" for a game: nothing is installed, so it is a hash of the id between 180 and 980 MB. */
export function fakeDiskUsage(gameId: string): string {
  let hash = 2166136261;
  for (const char of gameId) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const megabytes = 180 + (hash % 801);
  return `${megabytes} MB`;
}
