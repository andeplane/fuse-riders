import { createContext } from "react";

import type { ModelCache } from "./modelCache";
import { browserModelCache } from "./modelCache";
import type { EngineFactory } from "./webLlmChat";
import { webLlmEngineFactory } from "./webLlmChat";

/** How Clippy reaches a model: loading one, and the browser cache the downloads live in. Tests hand in fakes. */
export type LlmDeps = {
  createEngine: EngineFactory;
  modelCache: ModelCache;
};

export const defaultLlmDeps: LlmDeps = {
  createEngine: webLlmEngineFactory,
  modelCache: browserModelCache,
};

export const LlmDepsContext = createContext<LlmDeps>(defaultLlmDeps);
