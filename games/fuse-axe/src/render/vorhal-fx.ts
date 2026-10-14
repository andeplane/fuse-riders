import { SIGIL } from "../engine/view-kit.js";
import { MASTER } from "./pixel/palette.js";
import type { Sprite } from "./pixel/sprite.js";

/**
 * Vorhal's fire spell, painted once into sprites the scene bakes and blits. A sigil is a horned rune in a ring on the
 * floor, under the figures: the ring traces itself round in ember, the rune lighting inside it halfway, until for its
 * last `PRIMED` steps the whole of it flashes white-hot as the eruption nears (`sigilSprite`). Then its pillar of fire
 * stands among the figures by its depth: it shoots up from the floor over its first steps, burns its full height in
 * bands from a dark ember rim to a white-hot core, licking with the 60 Hz frame, and sinks as it dies (`pillarSprite`).
 * Both are pure functions of the sigil's age and the frame; an age outside theirs (or not a number) has none.
 */
export const PILLAR_H = 72;
/** The steps before the eruption the sigil flashes, the flash's half-period in frames, the ring's stages. */
export const PRIMED = 12;
const FLASH = 4;
export const STAGES = 8;
/** The ring's half-axes: wider than the pillar, foreshortened on the floor to its depth. */
const RX = SIGIL.half + 4;
const RY = SIGIL.lane;

/** A sprite from rows of master-palette keys, its anchor at (`ax`, `ay`). */
function sprite(rows: readonly string[], ax: number, ay: number): Sprite {
  const keys = [...new Set(rows.join(""))].filter((key) => key !== ".");
  const palette = Object.fromEntries(keys.map((key) => [key, MASTER[key]!]));
  return { w: rows[0]!.length, h: rows.length, ax, ay, palette, rows };
}

/** The horned rune inside the ring, centred on it: horns rising either side of a mark like his helm's. */
const RUNE = [
  "x.............x",
  ".x...........x.",
  "..xx...x...xx..",
  "....x.xxx.x....",
  ".....x.x.x.....",
  ".......x.......",
  "......x.x......",
];

/**
 * A sigil with its ring traced `traced` of the way round (from the top, clockwise) in `ring` and the floor inside it
 * glowing in `glow` there, the rest of the ring faint, and its rune in `rune` (none: not yet lit).
 */
function sigil(traced: number, ring: string, glow: string, rune?: string) {
  const rows = Array.from({ length: 2 * RY + 3 }, (_, y) =>
    Array.from({ length: 2 * RX + 3 }, (_, x) => {
      const [dx, dy] = [(x - RX - 1) / RX, (y - RY - 1) / RY];
      const d = Math.hypot(dx, dy);
      const lit = (Math.atan2(dx, -dy) / (2 * Math.PI) + 1) % 1 < traced;
      if (rune && RUNE[y - RY + 2]?.[x - RX + 6] === "x") return rune;
      if (d > 1.04) return ".";
      if (d >= 0.74) return lit ? ring : "=";
      return lit && (x + y) % 2 === 0 ? glow : ".";
    }).join(""),
  );
  return sprite(rows, RX + 1, RY + 1);
}
const FILLING = Array.from(
  { length: STAGES },
  (_, k) =>
  k < STAGES / 2 ? sigil((k + 1) / STAGES, "~", "=") : sigil((k + 1) / STAGES, "f", "=", "~"), // prettier-ignore
);
const FLASHING = [sigil(1, "F", "~", "F"), sigil(1, "f", "=", "~")] as const;

/**
 * The sigil `age` steps after he marked it, at 60 Hz `frame`: its ring tracing round through every stage before its
 * last `PRIMED` steps, then flashing; none before it is marked or once its pillar erupts.
 */
export function sigilSprite(age: number, frame: number): Sprite | undefined {
  if (!(age >= 0 && age < SIGIL.delay)) return undefined;
  if (age >= SIGIL.delay - PRIMED)
    return FLASHING[Math.floor(Math.abs(frame) / FLASH) % 2 || 0];
  return FILLING[Math.floor((age * STAGES) / (SIGIL.delay - PRIMED))];
}

/** A shade darker: white-hot to gold, gold to orange, orange to the dark ember rim. */
const COOLER: Readonly<Record<string, string>> = { F: "f", f: "~", "~": "=" };

/**
 * A pillar `height` tall with its licks at `phase`: a column `SIGIL.half` either side, flaring at the floor and tapering
 * to a ragged top, banded from its rim to a white-hot core; `cooled` steps darker as it dies.
 */
function pillar(height: number, phase: number, cooled = 0): Sprite {
  const half = SIGIL.half;
  const w = 2 * (half + 4) + 1;
  const top = PILLAR_H + 6;
  const rows = Array.from({ length: top }, (_, y) => {
    const up = top - 1 - y;
    const u = up / height;
    const flare = up < 6 ? (6 - up) / 2 : 0;
    const lick = 1.4 * Math.sin(up * 0.33 + phase * 2.1);
    const span = half * (1 - 0.3 * u * u) + flare + lick;
    return Array.from({ length: w }, (_, x) => {
      const across = Math.abs(x - half - 4) / span;
      const crown =
        height - 9 * across * across - 3 * Math.abs(Math.sin(x * 1.7 + phase));
      if (across > 1 || up > crown) {
        // Embers fly off the top.
        const ember = (x * 7 + up * 5 + phase * 3) % 17 === 0;
        return ember && across <= 1 && up > crown + 1 && up < height + 5 && cooled === 0 ? "f" : "."; // prettier-ignore
      }
      let key = across < 0.3 ? "F" : across < 0.62 ? "f" : "~";
      if (up > crown - 3 || across > 0.9) key = COOLER[key] ?? key;
      for (let n = 0; n < cooled; n++) key = COOLER[key] ?? key;
      return key;
    }).join("");
  });
  return sprite(rows, half + 4, top - 1);
}
const ERUPTING = [24, 46, 64].map((height, i) => pillar(height, i));
const BURNING = [0, 1, 2].map((phase) => pillar(PILLAR_H, phase));
const DYING = [pillar(60, 1, 1), pillar(44, 2, 1), pillar(26, 0, 2)];

/**
 * The pillar of fire `age` steps after its sigil was marked, at 60 Hz `frame`: from `SIGIL.delay` for `SIGIL.burn`
 * steps, erupting over its first steps and dying over its last; none before or after.
 */
export function pillarSprite(age: number, frame: number): Sprite | undefined {
  const burnt = Math.floor(age - SIGIL.delay);
  if (!(burnt >= 0 && burnt < SIGIL.burn)) return undefined;
  if (burnt < ERUPTING.length) return ERUPTING[burnt];
  const left = SIGIL.burn - burnt;
  if (left <= 2 * DYING.length)
    return DYING[DYING.length - Math.ceil(left / 2)];
  return BURNING[Math.floor(Math.abs(frame) / 3) % 3 || 0];
}
