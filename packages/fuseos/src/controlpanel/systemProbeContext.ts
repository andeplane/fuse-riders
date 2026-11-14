import { createContext } from "react";

import type { SystemProbe } from "./systemInfo";
import { probeBrowser } from "./systemInfo";

/** How Control Panel, System reads the machine; tests hand in a fixed probe. */
export const SystemProbeContext = createContext<() => SystemProbe>(probeBrowser);
