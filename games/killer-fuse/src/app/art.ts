import type { VictoryKind } from "../engine/index.js";
import { UNITS, type UnitArt } from "./guide.js";

/**
 * Small pictures for the page (the How to play panel, the countdown card) cut from the renderer's art sheets as CSS
 * backgrounds. It reads only the few fields a picture needs, sheet by sheet, so a manifest the renderer would refuse
 * (a sheet it requires is missing while the art is being redrawn) still gives the page every picture it can.
 */
export interface IconSheet {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly frameCount: number;
  readonly frames: Readonly<Record<string, number>>;
  /** The feet: the picture is cut off below it. */
  readonly anchor: readonly [number, number];
}
export type IconSheets = Readonly<Record<string, IconSheet>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const positive = (value: unknown): value is number =>
  typeof value === "number" && Number.isInteger(value) && value > 0;

function iconSheet(raw: unknown): IconSheet | undefined {
  if (!isRecord(raw) || typeof raw.file !== "string") return undefined;
  const { width, height, frameWidth, frameHeight, anchor, frames } = raw;
  if (
    !positive(width) ||
    !positive(height) ||
    !positive(frameWidth) ||
    !positive(frameHeight) ||
    !Array.isArray(anchor) ||
    typeof anchor[0] !== "number" ||
    typeof anchor[1] !== "number"
  )
    return undefined;
  const named: Record<string, number> = {};
  if (isRecord(frames))
    for (const [name, index] of Object.entries(frames))
      if (typeof index === "number") named[name] = index;
  return {
    file: raw.file,
    width,
    height,
    frameWidth,
    frameHeight,
    frameCount: positive(raw.frameCount) ? raw.frameCount : 1,
    frames: named,
    anchor: [anchor[0], anchor[1]],
  };
}

/** Every sheet of a manifest's JSON that a picture can be cut from; anything malformed is left out. */
export function readIconSheets(manifest: unknown): IconSheets {
  const sheets: Record<string, IconSheet> = {};
  if (!isRecord(manifest) || !isRecord(manifest.assets)) return sheets;
  for (const [id, raw] of Object.entries(manifest.assets)) {
    const sheet = iconSheet(raw);
    if (sheet) sheets[id] = sheet;
  }
  return sheets;
}

/** How to draw one picture as a CSS background, a whole number of CSS pixels to the art pixel. */
export interface Icon {
  url: string;
  width: number;
  height: number;
  size: string;
  position: string;
}
/** Draws `icon` as the background of `slot`; an element with no icon yet keeps whatever it already had. */
export function paint(slot: HTMLElement, icon: Icon | undefined): void {
  if (!icon) return;
  Object.assign(slot.style, {
    width: `${icon.width}px`,
    height: `${icon.height}px`,
    backgroundImage: `url("${icon.url}")`,
    backgroundSize: icon.size,
    backgroundPosition: icon.position,
  });
}

/** Art pixels from a frame's top down to the feet (its anchor): the unit standing, without the rows under it. */
export const standing = (sheet: IconSheet): number =>
  Math.min(sheet.frameHeight, Math.max(1, sheet.anchor[1] + 1));

/** Frame `frame` (a name; unknown is frame 0) of `sheet` at `scale`, cut off below its feet. */
export function sheetIcon(
  sheet: IconSheet,
  artUrl: string,
  frame: string,
  scale: number,
): Icon {
  const columns = Math.max(1, Math.floor(sheet.width / sheet.frameWidth)),
    index = Math.min(
      Math.max(0, sheet.frameCount - 1),
      Math.max(0, sheet.frames[frame] ?? 0),
    ),
    sx = (index % columns) * sheet.frameWidth,
    sy = Math.floor(index / columns) * sheet.frameHeight;
  return {
    url: `${artUrl}${sheet.file}`,
    width: sheet.frameWidth * scale,
    height: standing(sheet) * scale,
    size: `${sheet.width * scale}px ${sheet.height * scale}px`,
    position: `${-sx * scale}px ${-sy * scale}px`,
  };
}

/** The largest whole scale at which `art` art pixels fit `pixels` CSS pixels; never below 1. */
export const fit = (pixels: number, art: number): number =>
  Math.max(1, Math.floor(pixels / Math.max(1, art)));

const teamName = (team: number): string => (team === 1 ? "pink" : "cyan");

/**
 * Every unit's idle frame for `team`, all at one whole scale: the largest at which the tallest unit, measured from
 * its frame top to its feet, fits `height` CSS pixels, so a Queen stays taller than a Worker. A unit the manifest
 * lacks has no picture.
 */
export function unitIcons(
  sheets: IconSheets,
  artUrl: string,
  team: number,
  height: number,
): Partial<Record<UnitArt, Icon>> {
  const found = UNITS.flatMap((unit) => {
    const sheet = sheets[`${unit.art}-${teamName(team)}`];
    return sheet ? [{ art: unit.art, sheet }] : [];
  });
  const scale = fit(
      height,
      Math.max(1, ...found.map(({ sheet }) => standing(sheet))),
    ),
    icons: Partial<Record<UnitArt, Icon>> = {};
  for (const { art, sheet } of found)
    icons[art] = sheetIcon(sheet, artUrl, "idle", scale);
  return icons;
}

/**
 * The three ways to win as pictures, for a player of `team` (a watcher passes -1): the military win picture in the
 * enemy's colour, a berry pile, the snail. Each picture is scaled on its own to fit `height`.
 */
export function winIcons(
  sheets: IconSheets,
  artUrl: string,
  team: number,
  height: number,
): Partial<Record<VictoryKind, Icon>> {
  const picks: Record<VictoryKind, { id: string; frame: string }> = {
    military: {
      id: `win-military-${teamName(team === 0 ? 1 : 0)}`,
      frame: "icon",
    },
    economy: { id: "berry-pile", frame: "5" },
    snail: { id: "snail", frame: "idle" },
  };
  const icons: Partial<Record<VictoryKind, Icon>> = {};
  for (const kind of ["military", "economy", "snail"] as const) {
    const { id, frame } = picks[kind],
      sheet = sheets[id];
    if (sheet)
      icons[kind] = sheetIcon(
        sheet,
        artUrl,
        frame,
        fit(height, standing(sheet)),
      );
  }
  return icons;
}
