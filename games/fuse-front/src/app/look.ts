/** The HUD's and lobby's art: stroke spell icons, hero roles, and portraits from the 3D models (pixel ones without). */
import { el } from "fuse-ui";
import {
  HERO_KINDS,
  type HeroKind,
  type SpellEffect,
} from "../engine/index.js";
import { Img } from "../render/pixel/image.js";
import { PORTRAIT_SIZE, portrait } from "../render/pixel/portraits.js";
import { unitModel } from "../render3d/models.js";
import { renderPortraits } from "../render3d/portrait.js";

export const HERO_ROLES: Readonly<Record<HeroKind, string>> = {
  brick: "Siege commander",
  vix: "Infiltrator",
  rivet: "Field engineer",
  tally: "Scout",
};

/** Each spell's icon: SVG path data on a 24-unit square, drawn as a 1.8-unit stroke in the button's colour. */
// prettier-ignore
export const SPELL_ICONS: Readonly<Record<SpellEffect, string>> = {
  shockwave: "M12 4v7M8 8l4 4 4-4M3 17a9 3 0 1 0 18 0a9 3 0 1 0-18 0M7 17a5 1.6 0 1 0 10 0a5 1.6 0 1 0-10 0",
  rally: "M3 10v4h4l6 4V6L7 10zM16 9a4 4 0 0 1 0 6M19 6a8 8 0 0 1 0 12",
  ironHide: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6zM12 7v10M8 11h8",
  orbitalDrop: "M12 2v11M8 9l4 4 4-4M5 16h14v5H5zM15 16v-2h4",
  snipe: "M12 4a8 8 0 1 0 0 16a8 8 0 1 0 0-16M12 2v5M12 17v5M2 12h5M17 12h5",
  cloak: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M4 20L20 4",
  stickyMine: "M12 7a6 6 0 1 0 0 12a6 6 0 1 0 0-12M12 7V3M9 3h6M8 13h8",
  hijack: "M4 8h14l-4-4M20 16H6l4 4",
  repair: "M12 6v12M6 12h12M4 4h16v16H4z",
  turretDrop: "M5 21h14M8 21v-5h8v5M12 16v-5M12 11l7-3M9 11h6",
  fortify: "M6 21V3M6 4h11l-2 4 2 4H6M15 14l3 1v2c0 1.5-1.3 2.5-3 3-1.7-.5-3-1.5-3-3v-2z",
  overclock: "M13 2L5 14h6l-1 8 8-12h-6z",
  dash: "M3 12h11M10 6l6 6-6 6M19 5v14",
  flare: "M12 2v4M12 18v4M2 12h4M18 12h4M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6M5 5l2.5 2.5M16.5 16.5L19 19M5 19l2.5-2.5M16.5 7.5L19 5",
  spotter: "M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12zM12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6",
  blitz: "M4 6l6 6-6 6M12 6l6 6-6 6",
};

const SVG = "http://www.w3.org/2000/svg";
export function spellIcon(effect: SpellEffect): SVGSVGElement {
  const svg = document.createElementNS(SVG, "svg");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("d", SPELL_ICONS[effect]);
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.append(path);
  return svg;
}

const TEAM_TINT = [0xe0442c, 0x3a6ee8];
let art: Map<string, string> | undefined;

/** Renders every hero for both teams from its 3D model, once; a failure (no WebGL) leaves the pixel portraits. */
export function loadPortraits(): void {
  if (art) return;
  art = new Map();
  try {
    const jobs = HERO_KINDS.flatMap((kind) =>
      [0, 1].map((team) => ({
        key: `${kind}:${team}`,
        model: unitModel(kind),
        tint: TEAM_TINT[team]!,
      })),
    );
    art = renderPortraits(jobs);
  } catch (failure) {
    console.warn("Fuse Front: 3D portraits unavailable", failure);
  }
}

/** The hero's portrait for `team`: the 3D render when there is one, else the pixel art. */
export function heroPortrait(kind: HeroKind, team: number): HTMLElement {
  const url = art?.get(`${kind}:${team}`);
  if (url) {
    const img = el("img", "", "ff-portrait");
    [img.src, img.alt] = [url, `${kind} portrait`];
    return img;
  }
  const img = new Img(PORTRAIT_SIZE, PORTRAIT_SIZE);
  portrait(img, 0, 0, kind, team ? "blue" : "red");
  const canvas = el("canvas", "", "ff-portrait ff-pixel");
  [canvas.width, canvas.height] = [img.w, img.h];
  const ctx = canvas.getContext("2d");
  const data = ctx?.createImageData(img.w, img.h);
  if (ctx && data) ctx.putImageData((data.data.set(img.d), data), 0, 0);
  return canvas;
}
