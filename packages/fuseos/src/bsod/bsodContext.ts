import { createContext, useContext } from "react";

/**
 * The one thing other packages may do to the Blue Screen of Death: raise it. The Run dialog's
 * `bsod` command and any Start menu hook call `showBsod()`; outside a `BsodProvider` (a window
 * rendered on its own in a test) it does nothing.
 */
export interface BsodControls {
  showBsod(): void;
}

export const NO_BSOD: BsodControls = { showBsod: () => undefined };

export const BsodContext = createContext<BsodControls>(NO_BSOD);

/** `const { showBsod } = useBsod()`. */
export function useBsod(): BsodControls {
  return useContext(BsodContext);
}
