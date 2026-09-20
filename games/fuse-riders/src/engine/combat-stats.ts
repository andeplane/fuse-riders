import { WEAPONS, type Weapon } from "./shot-log.js";
export const KILL_METHODS = [
  ...WEAPONS,
  "trail",
  "rider",
  "wall",
  "unknown",
] as const;
export type KillMethod = (typeof KILL_METHODS)[number];
export type MethodCounts = Record<KillMethod, number>;
export interface CombatStats {
  versus: Record<"human" | "ai", { kills: MethodCounts; deaths: MethodCounts }>;
  kills: MethodCounts;
  deaths: MethodCounts;
  uses: Record<Weapon, number>;
  victims: Record<string, number>;
  killers: Record<string, number>;
  roundPlaces: number[];
  selfDeaths: number;
}
export const methodCounts = (): MethodCounts =>
  Object.fromEntries(KILL_METHODS.map((k) => [k, 0])) as MethodCounts;
export const emptyCombat = (): CombatStats => ({
  versus: {
    human: { kills: methodCounts(), deaths: methodCounts() },
    ai: { kills: methodCounts(), deaths: methodCounts() },
  },
  kills: methodCounts(),
  deaths: methodCounts(),
  uses: Object.fromEntries(WEAPONS.map((k) => [k, 0])) as Record<
    Weapon,
    number
  >,
  victims: {},
  killers: {},
  roundPlaces: [0, 0, 0, 0, 0],
  selfDeaths: 0,
});
/** Shared strict boundary for persisted match detail and peer checkpoints. */
export function parseCombat(
  raw: unknown,
  max = Number.MAX_SAFE_INTEGER,
): CombatStats | undefined {
  const object = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === "object" && !Array.isArray(v);
  const count = (v: unknown): v is number =>
    Number.isSafeInteger(v) && (v as number) >= 0 && (v as number) <= max;
  const counts = (
    v: unknown,
    keys: readonly string[],
  ): v is Record<string, number> =>
    object(v) &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => count(v[k]));
  if (
    !object(raw) ||
    Object.keys(raw).length !== 8 ||
    !counts(raw.kills, KILL_METHODS) ||
    !counts(raw.deaths, KILL_METHODS) ||
    !counts(raw.uses, WEAPONS) ||
    !count(raw.selfDeaths)
  )
    return;
  if (!object(raw.versus) || Object.keys(raw.versus).length !== 2) return;
  for (const kind of ["human", "ai"]) {
    const split = raw.versus[kind];
    if (
      !object(split) ||
      Object.keys(split).length !== 2 ||
      !counts(split.kills, KILL_METHODS) ||
      !counts(split.deaths, KILL_METHODS)
    )
      return;
  }
  if (
    !object(raw.victims) ||
    Object.keys(raw.victims).length > 128 ||
    !Object.entries(raw.victims).every(
      ([id, n]) =>
        id.length > 0 &&
        id.length <= 128 &&
        !["__proto__", "constructor", "prototype"].includes(id) &&
        count(n),
    )
  )
    return;
  if (
    !object(raw.killers) ||
    Object.keys(raw.killers).length > 128 ||
    !Object.entries(raw.killers).every(
      ([id, n]) =>
        id.length > 0 &&
        id.length <= 128 &&
        !["__proto__", "constructor", "prototype"].includes(id) &&
        count(n),
    )
  )
    return;
  if (
    !Array.isArray(raw.roundPlaces) ||
    raw.roundPlaces.length !== 5 ||
    !raw.roundPlaces.every(count)
  )
    return;
  const ordered = (
    value: unknown,
    keys: readonly string[],
  ): Record<string, number> =>
    Object.fromEntries(
      keys.map((key) => [key, (value as Record<string, number>)[key]!]),
    );
  const versus = raw.versus as Record<
    "human" | "ai",
    { kills: unknown; deaths: unknown }
  >;
  return {
    versus: {
      human: {
        kills: ordered(versus.human.kills, KILL_METHODS) as MethodCounts,
        deaths: ordered(versus.human.deaths, KILL_METHODS) as MethodCounts,
      },
      ai: {
        kills: ordered(versus.ai.kills, KILL_METHODS) as MethodCounts,
        deaths: ordered(versus.ai.deaths, KILL_METHODS) as MethodCounts,
      },
    },
    kills: ordered(raw.kills, KILL_METHODS) as MethodCounts,
    deaths: ordered(raw.deaths, KILL_METHODS) as MethodCounts,
    uses: ordered(raw.uses, WEAPONS) as Record<Weapon, number>,
    victims: ordered(raw.victims, Object.keys(raw.victims).sort()),
    killers: ordered(raw.killers, Object.keys(raw.killers).sort()),
    roundPlaces: [...raw.roundPlaces],
    selfDeaths: raw.selfDeaths,
  };
}
