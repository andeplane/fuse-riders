import { useContext, useEffect, useMemo, useState } from "react";

import { SystemProbeContext } from "../../controlpanel/systemProbeContext";
import { DesktopUiContext } from "../../desktop/desktopUiContext";
import type { ChatEngine } from "../../llm/llmChat";
import { LlmDepsContext } from "../../llm/llmDepsContext";
import { findLlmModel, modelLabel } from "../../llm/modelCatalog";
import { createWebLlmChatEngine } from "../../llm/webLlmChat";

import type { RegularsBrain } from "./brain";
import { cannedBrain, engineBrain } from "./brain";

/** An engine that never answers, so a model that cannot load leaves the regulars on their canned lines. */
export const SILENT_ENGINE: ChatEngine = {
  backend: () => ({ kind: "rules", reason: "no model" }),
  reply: async function* () {
    // Nothing: the brain falls back to canned lines.
  },
  dispose: () => undefined,
};

export type BrainChoice = {
  brain: RegularsBrain;
  /** Why the regulars are or are not thinking, for the Tools menu and Status. */
  label: string;
  /** The model is usable here (WebGPU) but may need a download first. */
  canThink: boolean;
  downloadMb: number | undefined;
};

/**
 * The regulars' brain from the shared FuseOS model (Clippy's choice in the Control Panel): used when the
 * browser has WebGPU and either the model is already downloaded or the user switched "smart regulars" on.
 * Otherwise, canned lines. Nothing loads until a regular first answers.
 */
export function useRegularsBrain(smart: boolean, random: () => number): BrainChoice {
  const llm = useContext(LlmDepsContext);
  const probe = useContext(SystemProbeContext);
  const { assistantOptions } = useContext(DesktopUiContext);
  const modelId = assistantOptions.model;
  const hasWebGpu = probe().hasWebGpu;
  const [cached, setCached] = useState(false);
  useEffect(() => {
    let live = true;
    llm.modelCache
      .has(modelId)
      .then((has) => {
        if (live) setCached(has);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [llm.modelCache, modelId]);
  const thinking = hasWebGpu && (smart || cached);
  const brain = useMemo(
    () =>
      thinking
        ? engineBrain(
            createWebLlmChatEngine({ modelId, createEngine: llm.createEngine, fallback: SILENT_ENGINE }),
            random,
          )
        : cannedBrain(random),
    [thinking, modelId, llm.createEngine, random],
  );
  useEffect(() => () => brain.dispose(), [brain]);
  return {
    brain,
    label: thinking ? modelLabel(modelId) : hasWebGpu ? "canned lines" : "canned lines (no WebGPU)",
    canThink: hasWebGpu,
    downloadMb: cached ? undefined : findLlmModel(modelId)?.downloadMb,
  };
}
