import { createContext } from "react";

import type { ColorSchemeId } from "./colorSchemes";
import type { CrtMode, DisplayEffects } from "./effectsStore";
import { DEFAULT_DISPLAY_EFFECTS } from "./effectsStore";

export type DisplayEffectsValue = {
  effects: DisplayEffects;
  setCrt: (mode: CrtMode) => void;
  setCurvature: (on: boolean) => void;
  setScheme: (scheme: ColorSchemeId) => void;
};

export const DisplayEffectsContext = createContext<DisplayEffectsValue>({
  effects: DEFAULT_DISPLAY_EFFECTS,
  setCrt: () => undefined,
  setCurvature: () => undefined,
  setScheme: () => undefined,
});
