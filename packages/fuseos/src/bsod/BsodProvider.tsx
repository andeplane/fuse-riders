import type { ReactNode } from "react";
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { FuseGamesContext } from "../fusegames/registry";

import type { BsodControls } from "./bsodContext";
import { BsodContext } from "./bsodContext";
import { isBsodChord, isDismissKey } from "./bsodKeys";
import { pickCulprit } from "./bsodMessage";
import { BsodScreen } from "./BsodScreen";

export type BsodProviderProps = {
  /** Picks the game that gets the blame; `Math.random` in the app, a fixed sequence in tests. */
  random?: () => number;
  children: ReactNode;
};

/**
 * Owns the Blue Screen of Death: raises it on Ctrl+Alt+Delete / Ctrl+Alt+Backspace or when a
 * descendant calls `useBsod().showBsod()`, and takes it down on any key or click.
 *
 * The chord is heard on `document`, like the other desktop keys, so it only fires while the OS
 * document has the keyboard: keys pressed inside a focused game iframe never reach it and stay
 * the game's. While the screen is up, keys are taken in the capture phase on `window` and
 * stopped there, so the key that dismisses it does nothing else on the desktop.
 */
export function BsodProvider({
  random = Math.random,
  children,
}: BsodProviderProps) {
  const { games } = useContext(FuseGamesContext);
  const [culprit, setCulprit] = useState<string | null>(null);

  // Whoever raised the screen and is waiting for it to go (the SYSTEM32 gag restarts the desktop after it).
  const waiting = useRef<(() => void)[]>([]);

  const showBsod = useCallback(() => {
    // Raising it twice keeps the first culprit rather than reshuffling the blame.
    setCulprit((current) => current ?? pickCulprit(games, random));
    return new Promise<void>((resolve) => {
      waiting.current.push(resolve);
    });
  }, [games, random]);
  const dismiss = useCallback(() => {
    setCulprit(null);
    const resolvers = waiting.current;
    waiting.current = [];
    for (const resolve of resolvers) resolve();
  }, []);

  const shown = culprit !== null;

  useEffect(() => {
    if (shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isBsodChord(event)) return;
      event.preventDefault();
      void showBsod();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shown, showBsod]);

  useEffect(() => {
    if (!shown) return;
    const onKeyDown = (event: KeyboardEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDismissKey(event)) dismiss();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [shown, dismiss]);

  const controls = useMemo<BsodControls>(() => ({ showBsod }), [showBsod]);

  return (
    <BsodContext.Provider value={controls}>
      {children}
      {culprit !== null ? (
        <BsodScreen culprit={culprit} onDismiss={dismiss} />
      ) : null}
    </BsodContext.Provider>
  );
}
