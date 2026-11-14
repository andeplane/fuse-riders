/**
 * What a player has set up for themselves on this device: the keys, the scroll, and the three timing offsets. Stored
 * under one key; anything unreadable falls back to the defaults field by field.
 */
export const ACTIONS = ["left", "down", "up", "right", "item"] as const;
export type Action = (typeof ACTIONS)[number];
/** The arrow columns, in the engine's order. */
export const COLUMN_ACTIONS: readonly Action[] = [
  "left",
  "down",
  "up",
  "right",
];

export interface Prefs {
  /** `KeyboardEvent.code`s per action; a code belongs to one action at most. */
  keys: Record<Action, string[]>;
  /** Scroll speed, `MIN_SPEED` to `MAX_SPEED`. */
  speed: number;
  /** Arrows fall to targets at the bottom; otherwise they rise to targets at the top, as in StepMania. */
  down: boolean;
  /** Milliseconds this player's presses are heard late (Bluetooth, a slow keyboard): taken off every press's time. */
  offsetMs: number;
  /** Milliseconds the picture is drawn ahead of the sound (positive) or behind it (negative). */
  visualMs: number;
  /**
   * Milliseconds the sound reaches the player later than the browser knows (Bluetooth, a TV, a soundbar). It moves
   * the picture and the judging together, where the input offset moves only the judging.
   */
  audioMs: number;
}

export const MIN_SPEED = 0.5,
  MAX_SPEED = 5,
  /**
   * The furthest an input offset may go. The room takes a press no further than `LATE_MS` (250) behind the tick it
   * is logged for and no further than `EARLY_MS` (150) ahead of it, and the song may be 120 ms from the room's
   * clock before it is realigned: an offset past this would have presses pulled to the tick and judged there. A
   * lag that large is the sound's (Bluetooth, a TV), and belongs in the audio offset.
   */
  MAX_OFFSET_MS = 150,
  MAX_VISUAL_MS = 200,
  MAX_AUDIO_MS = 500,
  /** Keys one action may have. */
  MAX_KEYS = 4;
/** The speeds the song select offers; the settings' slider reaches the ones between. */
export const SPEEDS: readonly number[] = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5];

/** WASD and IJKL are the arrows, with the arrow keys themselves; Space throws a power-up. */
export const DEFAULT_PREFS: Prefs = {
  keys: {
    left: ["KeyA", "KeyJ", "ArrowLeft"],
    down: ["KeyS", "KeyK", "ArrowDown"],
    up: ["KeyW", "KeyI", "ArrowUp"],
    right: ["KeyD", "KeyL", "ArrowRight"],
    item: ["Space"],
  },
  speed: 1.5,
  down: false,
  offsetMs: 0,
  visualMs: 0,
  audioMs: 0,
};
export const PREFS_KEY = "fusemania-prefs-v1";

export interface PrefsStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, value))
    : fallback;
const copy = (prefs: Prefs): Prefs => ({
  ...prefs,
  keys: {
    left: [...prefs.keys.left],
    down: [...prefs.keys.down],
    up: [...prefs.keys.up],
    right: [...prefs.keys.right],
    item: [...prefs.keys.item],
  },
});
export const defaultPrefs = (): Prefs => copy(DEFAULT_PREFS);

/** Keys that stay the browser's or the page's (M is the shared mute): they are never bound. */
export const RESERVED_CODES: readonly string[] = [
  "Escape",
  "Tab",
  "KeyM",
  "MetaLeft",
  "MetaRight",
  "F5",
  "F11",
  "F12",
];
const code = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[A-Za-z0-9]{1,24}$/.test(value) &&
  !RESERVED_CODES.includes(value);

/** Anything as preferences: each field kept when it is valid, the default otherwise. */
export function parsePrefs(raw: unknown): Prefs {
  const prefs = defaultPrefs();
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return prefs;
  const stored = raw as Record<string, unknown>;
  const keys = stored.keys;
  if (keys && typeof keys === "object" && !Array.isArray(keys)) {
    const taken = new Set<string>();
    const parsed = {} as Record<Action, string[]>;
    let valid = true;
    for (const action of ACTIONS) {
      const list = (keys as Record<string, unknown>)[action];
      if (!Array.isArray(list) || list.length > MAX_KEYS) {
        valid = false;
        break;
      }
      parsed[action] = [];
      for (const item of list as unknown[]) {
        if (!code(item) || taken.has(item)) continue;
        taken.add(item);
        parsed[action].push(item);
      }
    }
    // A layout that leaves an arrow without a key is not one to play with.
    if (valid && COLUMN_ACTIONS.every((action) => parsed[action].length > 0))
      prefs.keys = parsed;
  }
  prefs.speed = clamp(stored.speed, MIN_SPEED, MAX_SPEED, prefs.speed);
  if (typeof stored.down === "boolean") prefs.down = stored.down;
  prefs.offsetMs = Math.round(
    clamp(stored.offsetMs, -MAX_OFFSET_MS, MAX_OFFSET_MS, 0),
  );
  prefs.audioMs = Math.round(
    clamp(stored.audioMs, -MAX_AUDIO_MS, MAX_AUDIO_MS, 0),
  );
  // An input offset from before there was an audio offset, too large to be a keyboard's: it was the sound's.
  if (
    stored.audioMs === undefined &&
    typeof stored.offsetMs === "number" &&
    Number.isFinite(stored.offsetMs) &&
    Math.abs(stored.offsetMs) > MAX_OFFSET_MS
  ) {
    prefs.audioMs = Math.round(
      clamp(stored.offsetMs, -MAX_AUDIO_MS, MAX_AUDIO_MS, 0),
    );
    prefs.offsetMs = 0;
  }
  prefs.visualMs = Math.round(
    clamp(stored.visualMs, -MAX_VISUAL_MS, MAX_VISUAL_MS, 0),
  );
  return prefs;
}

export function loadPrefs(store: PrefsStore): Prefs {
  try {
    return parsePrefs(JSON.parse(store.getItem(PREFS_KEY) ?? "null"));
  } catch {
    return defaultPrefs();
  }
}
export function savePrefs(store: PrefsStore, prefs: Prefs): void {
  try {
    store.setItem(PREFS_KEY, JSON.stringify(parsePrefs(prefs)));
  } catch {
    // A store that refuses writes only costs the remembered choice.
  }
}

/** The action a key is bound to. */
export function actionOf(prefs: Prefs, key: string): Action | undefined {
  return ACTIONS.find((action) => prefs.keys[action].includes(key));
}

/**
 * `prefs` with `key` bound to `action`: taken from whichever action had it, added to this one, and the oldest of
 * this action's keys dropped when it has `MAX_KEYS` already. A reserved key changes nothing.
 */
export function bindKey(prefs: Prefs, action: Action, key: string): Prefs {
  if (!code(key)) return prefs;
  const next = copy(prefs);
  for (const other of ACTIONS)
    next.keys[other] = next.keys[other].filter((bound) => bound !== key);
  next.keys[action] = [...next.keys[action], key].slice(-MAX_KEYS);
  // Taking an arrow's last key away would leave it unplayable: the binding is refused.
  if (COLUMN_ACTIONS.some((column) => next.keys[column].length === 0))
    return prefs;
  return next;
}
/** `prefs` without `key` on `action`; an arrow keeps its last key. */
export function unbindKey(prefs: Prefs, action: Action, key: string): Prefs {
  if (COLUMN_ACTIONS.includes(action) && prefs.keys[action].length <= 1)
    return prefs;
  const next = copy(prefs);
  next.keys[action] = next.keys[action].filter((bound) => bound !== key);
  return next;
}

/** A key's name as a player reads it: `KeyA` is A, `ArrowLeft` is ←. */
export function keyLabel(key: string): string {
  const arrows: Record<string, string> = {
    ArrowLeft: "←",
    ArrowDown: "↓",
    ArrowUp: "↑",
    ArrowRight: "→",
    Space: "SPACE",
    Enter: "ENTER",
    ShiftLeft: "L SHIFT",
    ShiftRight: "R SHIFT",
    ControlLeft: "L CTRL",
    ControlRight: "R CTRL",
    AltLeft: "L ALT",
    AltRight: "R ALT",
    Backspace: "BKSP",
  };
  if (arrows[key]) return arrows[key];
  const match = /^(?:Key|Digit)(.+)$/.exec(key);
  if (match) return match[1]!.toUpperCase();
  const pad = /^Numpad(.+)$/.exec(key);
  if (pad) return `NUM ${pad[1]!.toUpperCase()}`;
  return key.toUpperCase();
}
