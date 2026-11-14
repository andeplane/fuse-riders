import { createContext } from 'react';

import type { WinampControls } from './winampControls';

/**
 * Playback is transient (not host-synced), so every mounted Winamp window publishes its
 * live controls here by window id: the agent bridge reads its status for `look` and
 * presses the same transport the mouse does. Mirrors `PaintRegistryContext`.
 */
export const WinampRegistryContext = createContext<Map<string, WinampControls>>(new Map());
