/**
 * The room's settings. `lift` is the controls experiment: `classic` is the helicopter game (hold to climb, let go
 * to fall), `thrust` the developer trial where W and S fly up and down and the chopper hovers when neither is held.
 * `combat` switches the nudge mechanics: shots, bumping between choppers, both or neither.
 */
export const LIFT_MODES = ["classic", "thrust"] as const;
export const COMBAT_MODES = ["all", "shoot", "bump", "off"] as const;
export const WIN_TARGETS = [1, 2, 3, 5] as const;
export type LiftMode = (typeof LIFT_MODES)[number];
export type CombatMode = (typeof COMBAT_MODES)[number];

export interface Settings {
  lift: LiftMode;
  combat: CombatMode;
  powerUps: boolean;
  /** Crowns that win the match. */
  wins: (typeof WIN_TARGETS)[number];
  /** One shared screen, with phones as controllers. */
  display: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  lift: "classic",
  combat: "all",
  powerUps: true,
  wins: 3,
  display: false,
};

const KEYS = ["lift", "combat", "powerUps", "wins", "display"];
/** The settings a log entry or a checkpoint carries, exactly; anything else is refused. */
export function parseSettings(raw: unknown): Settings | undefined {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return;
  const keys = Object.keys(raw);
  if (keys.length !== KEYS.length || !KEYS.every((key) => keys.includes(key)))
    return;
  const { lift, combat, powerUps, wins, display } = raw as Record<
    string,
    unknown
  >;
  if (
    !(LIFT_MODES as readonly unknown[]).includes(lift) ||
    !(COMBAT_MODES as readonly unknown[]).includes(combat) ||
    typeof powerUps !== "boolean" ||
    !(WIN_TARGETS as readonly unknown[]).includes(wins) ||
    typeof display !== "boolean"
  )
    return;
  return {
    lift: lift as LiftMode,
    combat: combat as CombatMode,
    powerUps,
    wins: wins as Settings["wins"],
    display,
  };
}

export const shooting = (combat: CombatMode): boolean =>
  combat === "all" || combat === "shoot";
export const bumping = (combat: CombatMode): boolean =>
  combat === "all" || combat === "bump";
