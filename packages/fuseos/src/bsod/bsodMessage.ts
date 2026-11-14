/** The part of a Fuse game the crash report needs; `FuseGame` satisfies it. */
export type BsodCulpritSource = { readonly id: string };

/** Who gets the blame when no Fuse game is installed. */
export const FALLBACK_CULPRIT = "EXPLORER.EXE";

/** Longest file name stem DOS allows. */
const DOS_STEM = 8;

/**
 * A game id as its Windows 95 executable: upper case, letters and digits only, and squeezed
 * into 8.3 the way VFAT does it ("fuse-riders" -> "FUSERI~1.EXE").
 */
export function executableName(gameId: string): string {
  const stem = gameId.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (stem === "") return FALLBACK_CULPRIT;
  const short =
    stem.length > DOS_STEM ? `${stem.slice(0, DOS_STEM - 2)}~1` : stem;
  return `${short}.EXE`;
}

/** The executable of one of the games, chosen by `random` (a `Math.random`-shaped source). */
export function pickCulprit(
  games: readonly BsodCulpritSource[],
  random: () => number,
): string {
  if (games.length === 0) return FALLBACK_CULPRIT;
  const index = Math.min(
    games.length - 1,
    Math.max(0, Math.floor(random() * games.length)),
  );
  const game = games[index];
  return game ? executableName(game.id) : FALLBACK_CULPRIT;
}

export type BsodMessage = {
  /** The inverted block at the top. */
  title: string;
  /** "A fatal exception ..." */
  summary: string;
  /** The two starred instructions. */
  instructions: readonly string[];
  /** The last line, followed on screen by the blinking cursor. */
  prompt: string;
};

/** The words of the Windows 95 fatal exception screen, blaming `culprit`. */
export function bsodMessage(culprit: string): BsodMessage {
  return {
    title: "Windows",
    summary: `A fatal exception 0E has occurred at 0028:C0011E36 in VXD FUSE(01) + 00010E36, called from ${culprit}. The current application will be terminated.`,
    instructions: [
      "Press any key to terminate the current application.",
      "Press CTRL+ALT+DEL again to restart your computer. You will lose any unsaved information in all applications.",
    ],
    prompt: "Press any key to continue",
  };
}
