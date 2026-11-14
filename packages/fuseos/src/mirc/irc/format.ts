/**
 * mIRC text formatting: the control codes people typed with Ctrl+B, Ctrl+K and friends.
 *
 *   \x02 bold   \x03 colour (fg[,bg], one or two digits each)   \x0F reset
 *   \x16 reverse   \x1D italic   \x1F underline   \x1E strikethrough   \x11 monospace
 */

export const BOLD = "\x02";
export const COLOR = "\x03";
export const RESET = "\x0f";
export const REVERSE = "\x16";
export const ITALIC = "\x1d";
export const UNDERLINE = "\x1f";

/** The sixteen colours of mIRC 5.x/6.x, index 0–15. */
export const MIRC_PALETTE: readonly string[] = [
  "#ffffff", // 0 white
  "#000000", // 1 black
  "#00007f", // 2 navy
  "#009300", // 3 green
  "#ff0000", // 4 red
  "#7f0000", // 5 brown (maroon)
  "#9c009c", // 6 purple
  "#fc7f00", // 7 orange
  "#ffff00", // 8 yellow
  "#00fc00", // 9 light green
  "#009393", // 10 teal
  "#00ffff", // 11 cyan
  "#0000fc", // 12 blue
  "#ff00ff", // 13 pink
  "#7f7f7f", // 14 grey
  "#d2d2d2", // 15 light grey
];

export type TextStyle = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  reverse: boolean;
  /** Palette index 0–15; undefined is the window's default. Codes 16–99 (mIRC 7) fall back to the default. */
  fg?: number;
  bg?: number;
};

export type StyledRun = { text: string } & TextStyle;

const PLAIN: TextStyle = {
  bold: false,
  italic: false,
  underline: false,
  reverse: false,
};

function readNumber(text: string, start: number): [number | undefined, number] {
  const match = /^\d{1,2}/.exec(text.slice(start));
  if (!match) return [undefined, start];
  return [Number(match[0]), start + match[0].length];
}

function paletteIndex(value: number | undefined): number | undefined {
  return value !== undefined && value < MIRC_PALETTE.length ? value : undefined;
}

/** Splits text into runs of one style each. Unknown control characters are dropped. */
export function parseFormatting(text: string): StyledRun[] {
  const runs: StyledRun[] = [];
  let style: TextStyle = { ...PLAIN };
  let buffer = "";
  const flush = () => {
    if (buffer.length === 0) return;
    runs.push({ text: buffer, ...style });
    buffer = "";
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] as string;
    switch (char) {
      case BOLD:
        flush();
        style = { ...style, bold: !style.bold };
        break;
      case ITALIC:
        flush();
        style = { ...style, italic: !style.italic };
        break;
      case UNDERLINE:
        flush();
        style = { ...style, underline: !style.underline };
        break;
      case REVERSE:
        flush();
        style = { ...style, reverse: !style.reverse };
        break;
      case RESET:
        flush();
        style = { ...PLAIN };
        break;
      case COLOR: {
        flush();
        const [fg, afterFg] = readNumber(text, index + 1);
        if (fg === undefined) {
          // A bare ^C ends colouring.
          const { fg: _fg, bg: _bg, ...rest } = style;
          style = rest;
          break;
        }
        let next = afterFg;
        let bg = style.bg;
        if (text[afterFg] === ",") {
          const [maybeBg, afterBg] = readNumber(text, afterFg + 1);
          if (maybeBg !== undefined) {
            bg = paletteIndex(maybeBg);
            next = afterBg;
          }
        }
        const { fg: _fg, bg: _bg, ...rest } = style;
        style = { ...rest };
        const fgIndex = paletteIndex(fg);
        if (fgIndex !== undefined) style.fg = fgIndex;
        if (bg !== undefined) style.bg = bg;
        index = next - 1;
        break;
      }
      default:
        // Other C0 controls (\x11 monospace, \x1e strike, stray bytes) are not drawn.
        if (char.charCodeAt(0) < 0x20) {
          flush();
          break;
        }
        buffer += char;
    }
  }
  flush();
  return runs;
}

/** The text without any formatting codes (for titles, the nicklist, search). */
export function stripFormatting(text: string): string {
  return parseFormatting(text)
    .map((run) => run.text)
    .join("");
}

/** Wraps text in a colour code, two-digit padded so a following digit is not read as part of it. */
export function colorize(text: string, fg: number, bg?: number): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${COLOR}${pad(fg)}${bg === undefined ? "" : `,${pad(bg)}`}${text}${COLOR}`;
}

/**
 * What the user typed in the editbox becomes the codes mIRC sends: Ctrl+B, Ctrl+K, Ctrl+U, Ctrl+R,
 * Ctrl+I and Ctrl+O insert these characters directly, so input needs no translation. This maps the
 * key to the character to insert, or undefined for other keys.
 */
export function formattingKey(key: string): string | undefined {
  switch (key.toLowerCase()) {
    case "b":
      return BOLD;
    case "k":
      return COLOR;
    case "u":
      return UNDERLINE;
    case "r":
      return REVERSE;
    case "i":
      return ITALIC;
    case "o":
      return RESET;
    default:
      return undefined;
  }
}
