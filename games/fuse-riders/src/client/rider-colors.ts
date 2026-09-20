import { RIDER_COLORS } from "../engine/tuning.js";
import { createPicker, el, type Picker } from "fuse-ui";
import "./rider-colors.css";

const COLOR_KEY = "fuse-riders-color";

/**
 * What each of `RIDER_COLORS` is called on screen, in the same order. Kept beside the picker rather than in the engine,
 * which has no business naming things for a player, and pinned to the palette's length by `riderColorChoices` so a
 * colour added without a name is caught rather than drawn nameless.
 */
export const RIDER_COLOR_LABELS = [
  "Cyan",
  "Pink",
  "Lime",
  "Orange",
  "Violet",
  "Amber",
  "Red",
  "Emerald",
  "Blue",
  "Fuchsia",
] as const;

export type RiderColorId = (typeof RIDER_COLORS)[number];

/** The palette as the picker's choices: the colour itself is the option's id, which is what a rider's `color` holds. */
export function riderColorChoices(): { id: RiderColorId; label: string }[] {
  return RIDER_COLORS.map((color, index) => ({
    id: color,
    label: RIDER_COLOR_LABELS[index] ?? color,
  }));
}
/** Where a colour sits in `RIDER_COLORS`, which is what a `COLOR` entry carries; `-1` for anything else. */
export const riderColorIndex = (color: string): number =>
  (RIDER_COLORS as readonly string[]).indexOf(color);
export const riderColorLabel = (color: string): string =>
  RIDER_COLOR_LABELS[riderColorIndex(color)] ?? "Colour";
export const isRiderColorId = (value: unknown): value is RiderColorId =>
  typeof value === "string" && riderColorIndex(value) >= 0;

/** A filled disc of one colour: the option's picture in the grid, and the swatch on a rider's row. */
export function createColorSwatch(color: string): HTMLSpanElement {
  const swatch = el("span", "", "color-swatch");
  swatch.style.setProperty("--swatch", color);
  swatch.setAttribute("aria-hidden", "true");
  return swatch;
}

/**
 * The colour grid on fuse-ui's picker, the avatar grid's twin. The choice is remembered on this browser and sent as a
 * `COLOR` entry; whether it sticks is the room's answer, since no two riders wear one colour. `fold` puts the grid
 * behind one button showing the current colour and CHANGE, as the join form does for avatars.
 */
export function createColorPicker(
  storage: Pick<Storage, "getItem" | "setItem">,
  onChange?: (color: RiderColorId) => void,
  fold?: { id: string },
): Picker<RiderColorId> {
  const stored = storage.getItem(COLOR_KEY);
  const selected: RiderColorId = isRiderColorId(stored)
    ? stored
    : RIDER_COLORS[0];
  const picker = createPicker<RiderColorId>({
    legend: "Choose your colour",
    choices: riderColorChoices(),
    selected,
    art: createColorSwatch,
    dataKey: "riderColor",
    onPick: (color) => {
      storage.setItem(COLOR_KEY, color);
      onChange?.(color);
    },
    ...(fold
      ? {
          fold: {
            id: fold.id,
            summary: (color: RiderColorId) => [
              createColorSwatch(color),
              el("span", `Colour · ${riderColorLabel(color)}`),
            ],
            label: (color: RiderColorId) =>
              `Colour · ${riderColorLabel(color)}, change`,
          },
        }
      : {}),
    classes: {
      root: "color-picker",
      options: "color-options",
      option: "color-option",
      summary: "color-current",
      change: "color-change",
    },
  });
  return {
    ...picker,
    // The room may hand back a different colour than the one asked for (someone else had it), and that answer is the
    // one this browser remembers: the next room starts from the colour the player actually wore.
    sync(color) {
      if (picker.selected() === color) return;
      storage.setItem(COLOR_KEY, color);
      picker.sync(color);
    },
  };
}
