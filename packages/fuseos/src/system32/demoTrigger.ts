import type { FoldDemo } from "./system32Deps";

/**
 * The hidden demo trigger: `?fold=now` plays the whole gag from the first question, `?fold=stage:4`
 * lands on the fourth stage and stays there (screenshots), `?fold=bsod` goes straight to the blue
 * screen. Anything else, or no parameter, is no demo.
 */
export const FOLD_PARAM = "fold";

export function parseFoldParam(search: string): FoldDemo | undefined {
  const raw = new URLSearchParams(search).get(FOLD_PARAM);
  if (raw === null) return undefined;
  const value = raw.trim().toLowerCase();
  if (value === "now") return { kind: "now" };
  if (value === "bsod") return { kind: "bsod" };
  const stage = /^stage:(\d+)$/.exec(value);
  if (stage?.[1] !== undefined)
    return { kind: "stage", stage: Number.parseInt(stage[1], 10) };
  return undefined;
}

/** The same URL without `?fold=`, so a reload after the restart boots a healthy desktop. */
export function withoutFoldParam(href: string): string {
  const url = new URL(href);
  url.searchParams.delete(FOLD_PARAM);
  return url.href;
}
