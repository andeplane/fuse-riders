import type { ComponentType } from "react";

import { AppearanceTab } from "./AppearanceTab";
import { EffectsTab } from "./EffectsTab";

/** One tab of the Display Properties dialog; the shape the dialog's tab registration takes. */
export type DisplayPropertiesTab = {
  id: string;
  label: string;
  component: ComponentType<{ windowId: string }>;
};

/** The tabs this package adds to Display Properties, in order: Appearance (colour schemes) and Effects (CRT, palette, resolution). */
export const DISPLAY_EFFECT_TABS: readonly DisplayPropertiesTab[] = [
  { id: "appearance", label: "Appearance", component: AppearanceTab },
  { id: "effects", label: "Effects", component: EffectsTab },
];
