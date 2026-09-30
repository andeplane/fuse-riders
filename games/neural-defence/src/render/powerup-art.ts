import type { PowerupKind } from "../engine/powerups.js";

/** Colour and glyph per powerup; the glyph is drawn in a 20-unit box around 0,0. */
export const POWERUP_STYLE: Record<
  PowerupKind,
  { color: string; light: string; glyph: string }
> = {
  // A seed pod: a hexagonal kernel.
  cache: {
    color: "#f2c14e",
    light: "#fff1c2",
    glyph:
      "M0 -6L5.2 -3V3L0 6L-5.2 3V-3ZM0 -2.6L2.3 -1.3V1.3L0 2.6L-2.3 1.3V-1.3Z",
  },
  // A cross of new tissue.
  regrowth: {
    color: "#6ff08e",
    light: "#e4ffe9",
    glyph: "M-1.8 -6H1.8V-1.8H6V1.8H1.8V6H-1.8V1.8H-6V-1.8H-1.8Z",
  },
  // Two rising chevrons.
  surge: {
    color: "#6fd3ff",
    light: "#e2f7ff",
    glyph:
      "M-5.5 -0.5L0 -5.5L5.5 -0.5L3.8 1.2L0 -2.4L-3.8 1.2ZM-5.5 5L0 0L5.5 5L3.8 6.7L0 3.1L-3.8 6.7Z",
  },
  // A lightning bolt.
  frenzy: {
    color: "#ff6b9d",
    light: "#ffe3ee",
    glyph: "M1.5 -7L-5 1H-0.5L-2 7L5 -1.5H0.5Z",
  },
};

export function powerupDefs(): string {
  return Object.entries(POWERUP_STYLE)
    .map(
      ([kind, s]) =>
        `<radialGradient id="nd-powerup-${kind}" fx="0.36" fy="0.3"><stop offset="0" stop-color="${s.light}"/><stop offset="0.35" stop-color="${s.color}"/><stop offset="1" stop-color="${s.color}" stop-opacity="0.35"/></radialGradient>`,
    )
    .join("");
}

const f = (n: number) => n.toFixed(1);

/** A floating orb above a pulsing ground ring; blinks in its last seconds. */
export function powerupMarkup(
  kind: PowerupKind,
  cell: number,
  x: number,
  y: number,
  expiring: boolean,
): string {
  const s = POWERUP_STYLE[kind];
  return `<g class="powerup powerup-${kind}${expiring ? " expiring" : ""}" data-cell="${cell}" data-kind="${kind}" pointer-events="none" style="--powerup:${s.color}"><ellipse class="powerup-shadow" cx="${f(x + 2)}" cy="${f(y + 6)}" rx="12" ry="5"/><ellipse class="powerup-ring" cx="${f(x)}" cy="${f(y + 4)}" rx="20" ry="${f(20 * 0.72)}" stroke="${s.color}"/><g transform="translate(${f(x)} ${f(y - 16)})"><g class="powerup-orb"><circle r="11.5" fill="url(#nd-powerup-${kind})" stroke="${s.light}" stroke-opacity="0.6" stroke-width="0.8"/><path d="${s.glyph}" fill="#0c1622" fill-opacity="0.78"/><ellipse cx="-3.8" cy="-5" rx="3.6" ry="2" fill="#fff" opacity="0.55" transform="rotate(-25 -3.8 -5)"/></g></g></g>`;
}

/** A label that rises and fades where a powerup was claimed. */
export function claimLabelMarkup(
  label: string,
  kind: PowerupKind,
  x: number,
  y: number,
): string {
  return `<text class="claim-label" x="${f(x)}" y="${f(y - 34)}" text-anchor="middle" fill="${POWERUP_STYLE[kind].light}" stroke="#061018" stroke-width="3" paint-order="stroke">${label}</text>`;
}
