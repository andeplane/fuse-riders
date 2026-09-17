import { PICKUP_WEIGHTS } from "./pickup-weights.js";
import { ARENA_MAP_CHOICES, type ArenaMapChoice } from "./arena-map.js";
import { BOMB_MAX_CHARGE_TICKS, isBombChargeTicks } from "./bomb-launch.js";
import { PICKUP_TYPES, type PickupType } from "./game.js";
export interface RoomSettings {
  version: 1;
  mode: "shared" | "devices";
  match: "rounds";
  length: number;
  bombChargeTicks: number;
  /** A bomb caught in another's blast explodes with it. Off means every bomb waits for its own fuse (#166). */
  chainReaction: boolean;
  /** Holding past full reach walks the aim back down and up again instead of parking at maximum (#166). */
  aimBounce: boolean;
  /** Which ground and obstacles a round is played on. `rotate` cycles them; `classic` is the obstacle-free arena. */
  map: ArenaMapChoice;
  weights: Partial<Record<PickupType, number>>;
}
export const SETTINGS_KEY = "fuse-riders-room-settings-v1";
export function defaultRoomSettings(): RoomSettings {
  return {
    version: 1,
    mode: "devices",
    match: "rounds",
    length: 5,
    bombChargeTicks: BOMB_MAX_CHARGE_TICKS,
    chainReaction: true,
    aimBounce: true,
    map: "rotate",
    weights: Object.fromEntries(
      PICKUP_WEIGHTS.map((row) => [row.type, row.weight]),
    ),
  };
}
export function parseRoomSettings(raw: unknown): RoomSettings | undefined {
  if (!raw || typeof raw !== "object") return;
  const value = raw as RoomSettings;
  const bombChargeTicks =
    value.bombChargeTicks === undefined
      ? BOMB_MAX_CHARGE_TICKS
      : value.bombChargeTicks;
  if (!isBombChargeTicks(bombChargeTicks)) return;
  // Settings saved before #166 have no flag; they played with chaining on, so that is what they keep.
  const chainReaction =
    value.chainReaction === undefined ? true : value.chainReaction;
  if (typeof chainReaction !== "boolean") return;
  // Matches defaultRoomSettings, so a blob saved before the flag round-trips to what a new room would choose rather than
  // silently turning the feature off for anyone who has ever pressed SAVE SETTINGS.
  const aimBounce = value.aimBounce === undefined ? true : value.aimBounce;
  if (typeof aimBounce !== "boolean") return;
  // Like the flags above: a blob saved before maps existed round-trips to what a new room would choose, rather than
  // pinning every returning host to the classic arena for good.
  const map = value.map === undefined ? "rotate" : value.map;
  if (!(ARENA_MAP_CHOICES as readonly string[]).includes(map)) return;
  if (
    value.version !== 1 ||
    !["shared", "devices"].includes(value.mode) ||
    value.match !== "rounds" ||
    !Number.isInteger(value.length) ||
    value.length < 1 ||
    value.length > 20 ||
    !value.weights ||
    typeof value.weights !== "object"
  )
    return;
  const allowed = new Set<string>(PICKUP_TYPES);
  const weights: RoomSettings["weights"] = {};
  for (const [type, weight] of Object.entries(value.weights)) {
    if (
      !allowed.has(type as PickupType) ||
      typeof weight !== "number" ||
      !Number.isFinite(weight) ||
      weight < 0 ||
      weight > 10000
    )
      return;
    weights[type as PickupType] = weight;
  }
  return {
    version: 1,
    mode: value.mode,
    match: value.match,
    length: value.length,
    bombChargeTicks,
    chainReaction,
    aimBounce,
    map,
    weights,
  };
}
export function loadRoomSettings(
  storage: Pick<Storage, "getItem">,
): RoomSettings {
  try {
    const saved: unknown = JSON.parse(storage.getItem(SETTINGS_KEY) ?? "null");
    // Migrate browser preferences only; old rules are never accepted on the wire.
    const migrated =
      saved &&
      typeof saved === "object" &&
      "match" in saved &&
      saved.match === "wins"
        ? { ...saved, match: "rounds", length: 5 }
        : saved;
    // A pickup retired since the save (Boost, Target Bomb) would fail the whole parse and reset every other preference with it.
    // One added or enabled since (Star) has no key in the save at all: creating a room stores the whole blob, so without
    // the defaults underneath it would stay off for ever. A host who turned a pickup off saved an explicit 0, which wins.
    if (
      migrated &&
      typeof migrated === "object" &&
      "weights" in migrated &&
      migrated.weights &&
      typeof migrated.weights === "object"
    ) {
      const known = new Set<string>(PICKUP_TYPES);
      return (
        parseRoomSettings({
          ...migrated,
          weights: {
            ...defaultRoomSettings().weights,
            ...Object.fromEntries(
              Object.entries(migrated.weights).filter(([type]) =>
                known.has(type),
              ),
            ),
          },
        }) ?? defaultRoomSettings()
      );
    }
    return parseRoomSettings(migrated) ?? defaultRoomSettings();
  } catch {
    return defaultRoomSettings();
  }
}
export function roomPickup(
  roll: number,
  weights: RoomSettings["weights"],
): PickupType | undefined {
  const entries = Object.entries(weights) as [PickupType, number][];
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (!total) return;
  let remaining = roll * total;
  for (const [type, weight] of entries) {
    remaining -= weight;
    if (remaining < 0) return type;
  }
}
