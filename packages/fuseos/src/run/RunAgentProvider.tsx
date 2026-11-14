import type { ReactNode } from "react";
import { useEffect, useMemo, useRef } from "react";

import type { RunPort } from "../agenttools/agentOs";
import { AgentRunContext } from "../agenttools/agentRunContext";

import { useRunCommand } from "./useRunExecutor";

/**
 * Hands Start > Run...'s command runner to Clippy's agent, whose `run` tool appears once this is mounted. The
 * port is one object for the desktop's lifetime and reads the latest runner through a ref: the runner changes
 * with every window opened, and a new port would rebuild Clippy's tools and drop his conversation.
 */
export function RunAgentProvider({ children }: { children: ReactNode }) {
  const runCommand = useRunCommand();
  const latest = useRef(runCommand);
  useEffect(() => {
    latest.current = runCommand;
  }, [runCommand]);
  const port = useMemo<RunPort>(
    () => ({ run: (command) => latest.current(command) }),
    [],
  );
  return (
    <AgentRunContext.Provider value={port}>{children}</AgentRunContext.Provider>
  );
}
