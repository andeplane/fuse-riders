import type { DisplayTab } from "../../controlpanel/displayTabs";

import { AppearanceTab } from "./AppearanceTab";
import { EffectsTab } from "./EffectsTab";

/** The tabs this package adds to Display Properties, in order: Appearance (colour schemes) and Effects (the CRT monitor). `controlpanel/displayTabs.ts` mounts them. */
export const DISPLAY_EFFECT_TABS: readonly DisplayTab[] = [
  { id: "appearance", label: "Appearance", component: AppearanceTab },
  { id: "effects", label: "Effects", component: EffectsTab },
];
