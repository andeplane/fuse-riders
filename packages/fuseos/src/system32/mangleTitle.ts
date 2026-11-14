/**
 * Playful misspellings for window titles while the OS folds. Deterministic: the same title always
 * comes out the same way, so React keeps a stable string and tests can assert it.
 */
const WORDS: Record<string, string> = {
  paint: "Pinat",
  winamp: "Wimanp",
  control: "Cntorl",
  panel: "Panle",
  display: "Dsiplay",
  properties: "Proprties",
  about: "Abuot",
  fuseos: "FsueOS",
  explorer: "Exploder",
  computer: "Compooter",
  games: "Gmaes",
  settings: "Setings",
  untitled: "Untiteld",
  help: "Hlep",
  system: "Sytsem",
  windows: "Widnows",
};

/** Swaps two inner letters of a word of four or more letters; shorter words are left alone. */
function swapInner(word: string): string {
  if (word.length < 4) return word;
  const i = 1 + (word.length % (word.length - 3));
  return (
    word.slice(0, i) + word.charAt(i + 1) + word.charAt(i) + word.slice(i + 2)
  );
}

export function mangleTitle(title: string): string {
  return title.replace(/[A-Za-z]+/g, (word) => {
    const known = WORDS[word.toLowerCase()];
    if (known) return word === word.toUpperCase() ? known.toUpperCase() : known;
    return swapInner(word);
  });
}
