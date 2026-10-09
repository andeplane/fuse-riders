// Colours of the cartoon look: player colours, gate colours and the two landscape themes.

/** Player colours in slot order (roof, launcher band, health bar, rockets). */
export const PLAYER_COLORS: readonly number[] = [
  0xe8403a, 0x2f86e8, 0x3fbf4a, 0xf7c52b, 0xa258e0, 0x19c4c0,
];

export function playerColor(id: number): number {
  return PLAYER_COLORS[id % PLAYER_COLORS.length] ?? 0xffffff;
}

/** `0xrrggbb` → `#rrggbb` for canvas and text styles. */
export function css(color: number): string {
  return `#${color.toString(16).padStart(6, "0")}`;
}

export function gateColor(multiplier: number): number {
  if (multiplier >= 10) return 0xffc233;
  if (multiplier >= 5) return 0xd35cff;
  if (multiplier >= 3) return 0x45e36b;
  return 0x2fd0ff;
}

export interface Theme {
  /** Sky gradient, top to horizon. */
  sky: readonly string[];
  sun: string;
  /** Far and near mountain ranges; the far range gets snow caps. */
  far: string;
  near: string;
  snow: string;
  /** Ground body, top to bottom, and the strata lines drawn across it. */
  ground: readonly string[];
  strata: string;
  /** Grass or sand on untouched surface, and the dark outline on every surface. */
  top: string;
  outline: string;
}

export const THEMES: readonly Theme[] = [
  {
    sky: ["#3a86e0", "#7dc0f5", "#d8f1ff"],
    sun: "#fff7c2",
    far: "#8eaed6",
    near: "#6f93c2",
    snow: "#f6fbff",
    ground: ["#b07a4c", "#8a5a37", "#5d3b24"],
    strata: "rgba(60, 34, 18, 0.28)",
    top: "#6fcf45",
    outline: "#2c1b0f",
  },
  {
    sky: ["#6b3fa8", "#f26b4a", "#ffc873"],
    sun: "#fff0b0",
    far: "#b0587a",
    near: "#8a3f5e",
    snow: "#ffd9c2",
    ground: ["#e5a55a", "#c27438", "#84451f"],
    strata: "rgba(110, 50, 20, 0.3)",
    top: "#ffd98a",
    outline: "#4a200c",
  },
];
