import { createContext } from "react";

import type { RunPort } from "./agentOs";

/**
 * Start, Run as Clippy can use it. Undefined on a desktop without a Run dialog, and then Clippy has no `run`
 * tool; the build that adds the dialog provides its command runner here and the tool appears.
 */
export const AgentRunContext = createContext<RunPort | undefined>(undefined);
