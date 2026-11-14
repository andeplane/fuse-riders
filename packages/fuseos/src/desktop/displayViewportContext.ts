import { createContext } from 'react';

import type { DisplayGeometry } from './displayModes';

/** Undefined outside the app's display provider preserves standalone window-manager tests. */
export const DisplayViewportContext = createContext<DisplayGeometry | undefined>(undefined);
