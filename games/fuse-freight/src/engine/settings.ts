/**
 * The room's settings: how many round wins take the match, how long a round runs, and whether the room is one
 * shared screen with phones as controllers.
 */
export const WIN_TARGETS = [1, 2, 3] as const;
export const ROUND_SECONDS = [60, 75, 90] as const;

export interface Settings {
  /** Round wins that take the match. */
  wins: (typeof WIN_TARGETS)[number];
  /** Seconds of play in a round. */
  seconds: (typeof ROUND_SECONDS)[number];
  /** One shared screen, with phones as controllers. */
  display: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  wins: 2,
  seconds: 75,
  display: false,
};

const KEYS = ["wins", "seconds", "display"];
/** The settings a log entry or a checkpoint carries, exactly; anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw);
  if (keys.length !== KEYS.length || !KEYS.every((key) => keys.includes(key)))
    return;
  const { wins, seconds, display } = raw as Record<string, unknown>;
  if (
    !(WIN_TARGETS as readonly unknown[]).includes(wins) ||
    !(ROUND_SECONDS as readonly unknown[]).includes(seconds) ||
    typeof display !== "boolean"
  )
    return;
  return {
    wins: wins as Settings["wins"],
    seconds: seconds as Settings["seconds"],
    display,
  };
}
