import { DOWN, FIRE, LEFT, RIGHT, UP } from "../../engine/input.js";
import type { DeviceId, InputSource } from "./hub.js";

/** One keyboard rider: a direction cluster and a fire key. */
export interface KeyCluster {
  readonly device: DeviceId;
  /** The fire key's on-screen name (it also joins and leaves in the lobby). */
  readonly fire: string;
  /** Every key of the cluster (`KeyboardEvent.code`) and the input bit it holds. */
  readonly keys: Readonly<Record<string, number>>;
}

/**
 * Four riders on one keyboard, each a direction cluster and a fire key, spread out so four people can crowd round
 * one laptop: WASD + Space on the left, IJKL + H in the middle, the arrows + `/` on the right and the numpad (8 4 5 6,
 * 2 also down) + 0 (or numpad Enter) for a fourth player at a full-size keyboard. None of them is a menu key (Enter,
 * Esc, Backspace, 2–6, R, B). Codes are layout-independent (`KeyboardEvent.code`), so `KeyW` is the key above `A`
 * on AZERTY too. Opposite keys held together both stay held; the engine's `thrustDirection` cancels them.
 */
export const KEY_BINDINGS: readonly KeyCluster[] = [
  cluster("key:WASD", "SPACE", "KeyW KeyS KeyA KeyD Space"),
  cluster("key:IJKL", "H", "KeyI KeyK KeyJ KeyL KeyH"),
  cluster("key:ARROWS", "/", "ArrowUp ArrowDown ArrowLeft ArrowRight Slash"),
  cluster(
    "key:NUMPAD",
    "NUM0",
    "Numpad8 Numpad5|Numpad2 Numpad4 Numpad6 Numpad0|NumpadEnter",
  ),
];

/** A cluster from its up, down, left, right and fire keys, in that order; `a|b` is two keys holding one bit. */
function cluster(device: DeviceId, fire: string, codes: string): KeyCluster {
  const bits = [UP, DOWN, LEFT, RIGHT, FIRE];
  const keys = codes
    .split(" ")
    .flatMap((alts, i) => alts.split("|").map((code) => [code, bits[i] ?? 0]));
  return { device, fire, keys: Object.fromEntries(keys) };
}

/** The fire key of a keyboard rider (`SPACE`, `/`…), or undefined for another device. */
export function fireKeyLabel(device: DeviceId): string | undefined {
  return KEY_BINDINGS.find((cluster) => cluster.device === device)?.fire;
}

/** The part of a `KeyboardEvent` the keyboard source reads. */
export type KeyEventLike = Pick<
  KeyboardEvent,
  "code" | "repeat" | "ctrlKey" | "metaKey" | "altKey" | "preventDefault"
> & { readonly target?: EventTarget | null };

/** Where key events come from: `window` in the browser, a fake in tests. */
export interface KeyboardTarget {
  addEventListener(
    type: "keydown" | "keyup",
    listener: (event: KeyEventLike) => void,
  ): void;
  addEventListener(
    type: "blur" | "visibilitychange",
    listener: () => void,
  ): void;
  removeEventListener(
    type: "keydown" | "keyup",
    listener: (event: KeyEventLike) => void,
  ): void;
  removeEventListener(
    type: "blur" | "visibilitychange",
    listener: () => void,
  ): void;
}

/**
 * Whether `code` typed at `target` belongs to the page rather than the game: every key in a form field (a name box, a
 * select), and Space on a focused button or link (the app portal, the sound toggle), which presses it.
 */
function ownedByPage(
  code: string,
  target: EventTarget | null | undefined,
): boolean {
  const element = target as {
    tagName?: unknown;
    isContentEditable?: unknown;
  } | null;
  if (!element) return false;
  const tag = typeof element.tagName === "string" ? element.tagName : "";
  if (tag === "BUTTON" || tag === "A") return code === "Space";
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    element.isContentEditable === true
  );
}

/**
 * Report each cluster's held bits (`hold`, the hub's `setHeld`) whenever a bound key goes down or up. Auto-repeat is
 * ignored. Shortcuts with Ctrl, Cmd or Alt are left to the browser, and so are keys the page owns (`ownedByPage`).
 *
 * A key whose keyup never arrives would stay held (steering forever, never firing again), so held keys are released
 * whenever a keyup may be lost: on window blur, on a visibility change (tab switch), and when a modifier goes down
 * (macOS drops the keyup of a key released while Cmd is held).
 */
export function attachKeyboard(
  target: KeyboardTarget,
  hold: (device: DeviceId, bits: number) => void,
  options: { arrowsPrimary?: () => boolean } = {},
): InputSource {
  let primary = options.arrowsPrimary?.() ?? false;
  const bindings = (): readonly KeyCluster[] =>
    primary
      ? KEY_BINDINGS.map((binding) =>
          binding.device === "key:WASD"
            ? {
                ...binding,
                keys: {
                  ...binding.keys,
                  ArrowUp: UP,
                  ArrowDown: DOWN,
                  ArrowLeft: LEFT,
                  ArrowRight: RIGHT,
                },
              }
            : binding.device === "key:ARROWS"
              ? { ...binding, keys: { Slash: FIRE } }
              : binding,
        )
      : KEY_BINDINGS;
  const mapping = () =>
    new Map(
      bindings().flatMap((cluster) =>
        Object.keys(cluster.keys).map((code) => [code, cluster] as const),
      ),
    );
  let clusterOf = mapping();
  const held = new Set<string>();
  const report = (cluster: KeyCluster): void => {
    let bits = 0;
    for (const [code, bit] of Object.entries(cluster.keys))
      if (held.has(code)) bits |= bit;
    hold(cluster.device, bits);
  };
  const releaseAll = (): void => {
    const clusters = new Set([...held].map((code) => clusterOf.get(code)));
    held.clear();
    for (const cluster of clusters) if (cluster) report(cluster);
  };
  // Seating an arrows rider changes ownership. Drop held keys rather than steering two seats or transferring a hold.
  const refresh = (): void => {
    const next = options.arrowsPrimary?.() ?? false;
    if (primary === next) return;
    releaseAll();
    primary = next;
    clusterOf = mapping();
  };

  const onKeyDown = (event: KeyEventLike): void => {
    refresh();
    if (event.ctrlKey || event.metaKey || event.altKey) return releaseAll();
    const cluster = clusterOf.get(event.code);
    if (!cluster || ownedByPage(event.code, event.target)) return;
    event.preventDefault(); // Arrows and Space would scroll, `/` would open Firefox's quick find.
    if (event.repeat || held.has(event.code)) return;
    held.add(event.code);
    report(cluster);
  };
  const onKeyUp = (event: KeyEventLike): void => {
    refresh();
    const cluster = clusterOf.get(event.code);
    if (!held.delete(event.code) || !cluster) return;
    report(cluster);
  };

  target.addEventListener("keydown", onKeyDown);
  target.addEventListener("keyup", onKeyUp);
  target.addEventListener("blur", releaseAll);
  target.addEventListener("visibilitychange", releaseAll);
  return {
    poll: refresh,
    dispose: () => {
      target.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("keyup", onKeyUp);
      target.removeEventListener("blur", releaseAll);
      target.removeEventListener("visibilitychange", releaseAll);
    },
  };
}
