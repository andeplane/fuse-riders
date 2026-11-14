/**
 * Capability detection for the desktop's own Blue Screen of Death (`src/bsod`, Phase D1), which lands on its
 * own branch. When the build has `bsod/bsodContext.ts`, the SYSTEM32 gag and the Run dialog's `bsod` raise
 * that screen through its `useBsod()`; without it they fall back to the gag's own `BlueScreen`. Vite resolves
 * the glob at build time, so a build without D1 carries no reference to it and nothing fails to import.
 */

/** Raises a blue screen; may resolve when it has been dismissed. */
export type ShowBsod = () => Promise<void> | void;

/** The part of D1's `bsodContext` module this relies on. */
export type BsodModule = {
  useBsod: () => { showBsod: ShowBsod };
  NO_BSOD: { showBsod: ShowBsod };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBsodModule(value: unknown): value is BsodModule {
  return (
    isRecord(value) &&
    typeof value.useBsod === "function" &&
    isRecord(value.NO_BSOD) &&
    typeof value.NO_BSOD.showBsod === "function"
  );
}

/** Pulls D1's module out of a glob result; undefined when it is missing or not the shape this expects. */
export function pickBsodModule(
  modules: Record<string, unknown>,
): BsodModule | undefined {
  return Object.values(modules).find(isBsodModule);
}

const NO_SCREEN = (): ShowBsod | undefined => undefined;

/**
 * A hook that returns the desktop's `showBsod`, or undefined where there is none: no D1 in this build, or
 * D1 present but no `BsodProvider` above (its context default). Built once per module, so the hook a
 * component calls never changes between renders.
 */
export function createUseDesktopBsod(
  module: BsodModule | undefined,
): () => ShowBsod | undefined {
  if (!module) return NO_SCREEN;
  const { useBsod, NO_BSOD } = module;
  return function useDesktopBsod() {
    const controls = useBsod();
    return controls === NO_BSOD || controls.showBsod === NO_BSOD.showBsod
      ? undefined
      : controls.showBsod;
  };
}

export const desktopBsodModule = pickBsodModule(
  import.meta.glob("../bsod/bsodContext.ts", { eager: true }),
);

export const useDesktopBsod = createUseDesktopBsod(desktopBsodModule);
