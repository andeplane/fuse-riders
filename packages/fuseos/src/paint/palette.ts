/** The 28 colours of the Windows 98 Paint colour box, top row then bottom row. */
export const WIN98_PALETTE: readonly string[] = [
  "#000000",
  "#808080",
  "#800000",
  "#808000",
  "#008000",
  "#008080",
  "#000080",
  "#800080",
  "#808040",
  "#004040",
  "#0080ff",
  "#004080",
  "#8000ff",
  "#804000",
  "#ffffff",
  "#c0c0c0",
  "#ff0000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0000ff",
  "#ff00ff",
  "#ffff80",
  "#00ff80",
  "#80ffff",
  "#8080ff",
  "#ff0080",
  "#ff8040",
];

/** A name for every palette colour, so a colour can be asked for in words; aliases resolve too. */
export const PALETTE_NAMES: readonly {
  name: string;
  hex: string;
  aliases?: readonly string[];
}[] = [
  { name: "black", hex: "#000000" },
  { name: "gray", hex: "#808080", aliases: ["grey"] },
  { name: "maroon", hex: "#800000", aliases: ["dark red"] },
  { name: "olive", hex: "#808000" },
  { name: "green", hex: "#008000", aliases: ["dark green"] },
  { name: "teal", hex: "#008080" },
  { name: "navy", hex: "#000080", aliases: ["dark blue"] },
  { name: "purple", hex: "#800080" },
  { name: "khaki", hex: "#808040" },
  { name: "dark teal", hex: "#004040" },
  { name: "azure", hex: "#0080ff", aliases: ["sky blue"] },
  { name: "steel blue", hex: "#004080" },
  { name: "violet", hex: "#8000ff" },
  { name: "brown", hex: "#804000" },
  { name: "white", hex: "#ffffff" },
  { name: "silver", hex: "#c0c0c0", aliases: ["light gray", "light grey"] },
  { name: "red", hex: "#ff0000" },
  { name: "yellow", hex: "#ffff00" },
  { name: "lime", hex: "#00ff00", aliases: ["bright green"] },
  { name: "cyan", hex: "#00ffff", aliases: ["aqua"] },
  { name: "blue", hex: "#0000ff" },
  { name: "magenta", hex: "#ff00ff", aliases: ["fuchsia", "pink"] },
  { name: "light yellow", hex: "#ffff80" },
  { name: "spring green", hex: "#00ff80" },
  { name: "light cyan", hex: "#80ffff" },
  { name: "lavender", hex: "#8080ff", aliases: ["light blue"] },
  { name: "rose", hex: "#ff0080" },
  { name: "orange", hex: "#ff8040" },
];

function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, " ");
}

/**
 * A colour given in words ("red", "light blue") or as `#rgb` / `#rrggbb`, as a lowercase
 * `#rrggbb`; undefined when it is neither.
 */
export function resolveColor(value: string): string | undefined {
  const body = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim())?.[1];
  if (body !== undefined) {
    const digits =
      body.length === 3
        ? [...body].map((digit) => digit + digit).join("")
        : body;
    return `#${digits.toLowerCase()}`;
  }
  const wanted = normalizeName(value);
  return PALETTE_NAMES.find(
    (entry) =>
      entry.name === wanted ||
      entry.aliases?.some((alias) => normalizeName(alias) === wanted),
  )?.hex;
}

/** The palette name of a colour, e.g. "red" for `#ff0000`; the hex itself when it is not in the palette. */
export function colorName(hex: string): string {
  const normalized = resolveColor(hex) ?? hex;
  return PALETTE_NAMES.find((entry) => entry.hex === normalized)?.name ?? hex;
}

/** `colorName`, capitalized for a button label ("Teal", not "teal"); resolving a colour by name still matches case insensitively. */
export function capitalizedColorName(hex: string): string {
  const name = colorName(hex);
  return name.length === 0
    ? name
    : name.charAt(0).toUpperCase() + name.slice(1);
}

export type Rgba = [number, number, number, number];

/** `#rrggbb` (or `#rgb`) to opaque RGBA; anything else is black. */
export function parseHexColor(hex: string): Rgba {
  const body = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())?.[1];
  if (body === undefined) return [0, 0, 0, 255];
  const digits =
    body.length === 3 ? [...body].map((digit) => digit + digit).join("") : body;
  return [
    parseInt(digits.slice(0, 2), 16),
    parseInt(digits.slice(2, 4), 16),
    parseInt(digits.slice(4, 6), 16),
    255,
  ];
}

export function toHexColor(r: number, g: number, b: number): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.max(0, Math.min(255, Math.round(channel)))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}
