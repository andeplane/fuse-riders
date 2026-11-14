import type { ReactNode } from "react";
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";

import type { AssistantTool, ToolRegistry } from "../llm/tools";
import { createToolRegistry } from "../llm/tools";

export type { AssistantTool, ToolInvocation, ToolResult } from "../llm/tools";

/**
 * The tools windows add to Clippy while they are mounted. The desktop's own tools (`open`, `music`) come from
 * `useDesktopTools`; this registry carries the extra ones, such as an editor's `[edit:<path>]`, so a new tool is a
 * `useRegisterAssistantTool` call in the window that provides it and nothing in the assistant changes.
 */
export const AssistantToolsContext =
  createContext<ToolRegistry>(createToolRegistry());

/** A registry per desktop, so one mounted shell never sees another's tools. */
export function AssistantToolsProvider({ children }: { children: ReactNode }) {
  const [registry] = useState(createToolRegistry);
  return createElement(
    AssistantToolsContext.Provider,
    { value: registry },
    children,
  );
}

/** The registered tools, re-read whenever one is added or removed. */
export function useRegisteredAssistantTools(): readonly AssistantTool[] {
  const registry = useContext(AssistantToolsContext);
  return useSyncExternalStore(registry.subscribe, () => registry.tools);
}

/**
 * Registers `tool` for as long as the calling component is mounted. Pass a memoised tool (or one built with
 * `useMemo`): a new object on every render re-registers on every render.
 */
export function useRegisterAssistantTool(
  tool: AssistantTool | undefined,
): void {
  const registry = useContext(AssistantToolsContext);
  useEffect(() => {
    if (!tool) return undefined;
    return registry.register(tool);
  }, [registry, tool]);
}
