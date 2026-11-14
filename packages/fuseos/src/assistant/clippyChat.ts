import { useContext, useEffect, useMemo } from "react";

import { SystemProbeContext } from "../controlpanel/systemProbeContext";
import { DesktopUiContext } from "../desktop/desktopUiContext";
import type { IntentCatalog } from "../llm/intent";
import { createIntentEngine, NO_WEBGPU_REASON } from "../llm/intent";
import type { ChatEngine, ChatHandle, ChatOptions } from "../llm/llmChat";
import { LlmDepsContext } from "../llm/llmDepsContext";
import { useEngineChat } from "../llm/useEngineChat";
import { createWebLlmChatEngine } from "../llm/webLlmChat";

import { useDesktopTools } from "./desktopTools";

/**
 * Clippy's chat in FuseOS: the chosen model over web-llm when the browser has WebGPU, the rules otherwise, both
 * through `useEngineChat`. Nothing of the model is touched until `send`: the engine is created lazily inside the
 * first reply. Changing the model in the Control Panel starts a new chat on the new model.
 */
export function createClippyEngine(options: {
  hasWebGpu: boolean;
  modelId: string;
  createEngine: Parameters<typeof createWebLlmChatEngine>[0]["createEngine"];
  intents: IntentCatalog;
}): ChatEngine {
  const rules = createIntentEngine(options.intents, NO_WEBGPU_REASON);
  if (!options.hasWebGpu) return rules;
  return createWebLlmChatEngine({
    modelId: options.modelId,
    createEngine: options.createEngine,
    fallback: rules,
  });
}

export function useClippyChat(options: ChatOptions): ChatHandle {
  const llm = useContext(LlmDepsContext);
  const probe = useContext(SystemProbeContext);
  const { assistantOptions } = useContext(DesktopUiContext);
  const { intents } = useDesktopTools();
  const hasWebGpu = probe().hasWebGpu;
  const modelId = assistantOptions.model;
  const engine = useMemo(
    () =>
      createClippyEngine({
        hasWebGpu,
        modelId,
        createEngine: llm.createEngine,
        intents,
      }),
    [hasWebGpu, modelId, llm.createEngine, intents],
  );
  useEffect(() => () => engine.dispose(), [engine]);
  return useEngineChat(engine, options);
}
