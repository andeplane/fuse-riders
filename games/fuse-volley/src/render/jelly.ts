import type { BlobView } from "../engine/view.js";

/**
 * The blobs' jelly: cosmetic springs layered on the squash frame the rules use. Each blob has a vertical stretch and a
 * lean (the top lagging behind the feet), both underdamped so they overshoot and wobble back. Jumps stretch, landings
 * and hits squash, running leans, and an idle blob breathes. It reads only the views it is shown and the wall clock,
 * so it never feeds back into the match; the deviation is small (a few per cent), so what you see stays what collides.
 */
export interface JellyPose {
  /** Vertical scale about the feet; width follows inversely, so the volume holds. */
  stretch: number;
  /** Horizontal shear of the top, as a fraction of the height: positive leans right. */
  lean: number;
  /** 0 open, 1 shut. */
  blink: number;
}

interface Spring {
  value: number;
  speed: number;
}
interface BlobJelly {
  stretch: Spring;
  lean: Spring;
  x: number;
  y: number;
  air: boolean;
  seen: boolean;
  /** Wall-clock ms of the next blink, and when the current one started. */
  blinkAt: number;
  blinkStart: number;
}

/** Spring stiffness and damping, per second: underdamped, about three visible wobbles. */
const STIFF = 260,
  DAMP = 11,
  LEAN_STIFF = 180,
  LEAN_DAMP = 9;
const MAX_STRETCH = 0.16,
  MAX_LEAN = 0.18,
  BLINK_MS = 140;

const step = (
  spring: Spring,
  target: number,
  dt: number,
  k = STIFF,
  c = DAMP,
) => {
  spring.speed += (k * (target - spring.value) - c * spring.speed) * dt;
  spring.value += spring.speed * dt;
};
const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

export interface Jelly {
  /** Advances every blob to wall time `nowMs` with the views shown now; returns each blob's pose, by slot. */
  update(blobs: readonly BlobView[], nowMs: number): JellyPose[];
  /** A squash kick for the blob in `slot`, from a hit (`strength` 0–1) or a landing. */
  kick(slot: number, strength: number): void;
  /** A stretch kick, for a jump. */
  spring(slot: number, strength: number): void;
  /** Forgets motion, for a new match or a teleport. */
  reset(): void;
}

export function createJelly(random: () => number = Math.random): Jelly {
  const fresh = (): BlobJelly => ({
    stretch: { value: 0, speed: 0 },
    lean: { value: 0, speed: 0 },
    x: 0,
    y: 0,
    air: false,
    seen: false,
    blinkAt: 0,
    blinkStart: -1e9,
  });
  let blobs: BlobJelly[] = [];
  const at = (slot: number): BlobJelly => (blobs[slot] ??= fresh());
  let last = -1;
  return {
    update(views, nowMs) {
      const dt =
        last < 0 ? 0 : Math.min(0.05, Math.max(0, (nowMs - last) / 1000));
      last = nowMs;
      return views.map((view, side) => {
        const jelly = at(side);
        if (!jelly.seen || Math.abs(view.x - jelly.x) > 60) {
          jelly.x = view.x;
          jelly.y = view.y;
          jelly.air = view.air;
          jelly.seen = true;
          jelly.blinkAt = nowMs + 1500 + random() * 3000;
        }
        // Screen px a second; y grows downwards, so rising is negative.
        const vx = dt > 0 ? (view.x - jelly.x) / dt : 0,
          vy = dt > 0 ? (view.y - jelly.y) / dt : 0;
        // Rising fast stretches tall; falling stretches a little; standing breathes.
        const breathing = view.air
          ? 0
          : 0.014 * Math.sin(nowMs / 420 + side * 1.7);
        const target = view.air
          ? clamp(-vy / 3000, MAX_STRETCH) * (vy < 0 ? 1 : 0.4)
          : breathing;
        // Running leans the top back against the motion; it springs past upright when the blob stops.
        const leanTarget = clamp(-vx / 2400, MAX_LEAN);
        if (dt > 0) {
          // Integrate in small slices so a long frame cannot blow the springs up.
          const slices = Math.ceil(dt / 0.008);
          for (let i = 0; i < slices; i++) {
            step(jelly.stretch, target, dt / slices);
            step(jelly.lean, leanTarget, dt / slices, LEAN_STIFF, LEAN_DAMP);
          }
        }
        jelly.stretch.value = clamp(jelly.stretch.value, MAX_STRETCH * 1.6);
        jelly.lean.value = clamp(jelly.lean.value, MAX_LEAN * 1.4);
        jelly.x = view.x;
        jelly.y = view.y;
        jelly.air = view.air;
        if (nowMs >= jelly.blinkAt) {
          jelly.blinkStart = nowMs;
          jelly.blinkAt = nowMs + 2000 + random() * 3500;
        }
        const since = nowMs - jelly.blinkStart;
        const blink =
          since >= 0 && since < BLINK_MS
            ? Math.sin((since / BLINK_MS) * Math.PI)
            : 0;
        return {
          stretch: 1 + jelly.stretch.value,
          lean: jelly.lean.value,
          blink,
        };
      });
    },
    kick(slot, strength) {
      at(slot).stretch.speed -= 2.6 + 2.2 * Math.max(0, Math.min(1, strength));
    },
    spring(slot, strength) {
      at(slot).stretch.speed += 1.6 * Math.max(0, Math.min(1, strength));
    },
    reset() {
      blobs = [];
      last = -1;
    },
  };
}
