/**
 * The models Clippy can run in the browser: ids from web-llm's prebuilt list (weights from the Hugging Face CDN,
 * cached by the browser after the first download). Kept apart from `@mlc-ai/web-llm` so the Control Panel can list
 * them without loading the library.
 */
import type { LoopStyle } from "./llmChat";

export type LlmModel = {
  id: string;
  /** Shown in the Control Panel. */
  label: string;
  /** Rough download size, as shown next to the label. */
  downloadMb: number;
  description: string;
  /**
   * How the model drives the desktop: the multi-step agent loop ("json": every reply one tool call, held to the
   * tools' schema by web-llm's grammar) or one reply with `[name:argument]` markers, which is all the smallest
   * models manage reliably.
   */
  loop: LoopStyle;
  /** The one to pick for getting things done; flagged in the Control Panel. */
  recommended?: boolean;
};

/**
 * The models web-llm serves OpenAI-style `tools` for (its `functionCallingModelIds`, copied here because the
 * library must not be imported before the first question). They are 4 to 5 GB, too large for the catalogue, but
 * a model listed here would run the loop over native function calling.
 */
export const NATIVE_TOOL_MODEL_IDS: readonly string[] = [
  "Hermes-2-Pro-Llama-3-8B-q4f16_1-MLC",
  "Hermes-2-Pro-Llama-3-8B-q4f32_1-MLC",
  "Hermes-2-Pro-Mistral-7B-q4f16_1-MLC",
  "Hermes-3-Llama-3.1-8B-q4f32_1-MLC",
  "Hermes-3-Llama-3.1-8B-q4f16_1-MLC",
];

export const LLM_MODELS: readonly LlmModel[] = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 0.5B",
    downloadMb: 290,
    description: "Small and quick; the default. Does one thing per request.",
    loop: "markers",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    downloadMb: 705,
    description: "Twice the download, better at conversation.",
    loop: "markers",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Clippy Pro (Qwen 2.5 1.5B)",
    downloadMb: 880,
    description:
      "Works through a request step by step: opens, arranges, reads and edits.",
    loop: "json",
    recommended: true,
  },
];

export const DEFAULT_MODEL_ID = "Qwen2.5-0.5B-Instruct-q4f16_1-MLC";

export function isLlmModelId(value: unknown): value is string {
  return (
    typeof value === "string" && LLM_MODELS.some((model) => model.id === value)
  );
}

export function findLlmModel(id: string): LlmModel | undefined {
  return LLM_MODELS.find((model) => model.id === id);
}

/** The label for an id, or the id itself for a model not in the catalogue. */
export function modelLabel(id: string): string {
  return findLlmModel(id)?.label ?? id;
}

/**
 * How a model drives the desktop: native function calling where web-llm has it, else what the catalogue says,
 * else markers (a model that is not in the catalogue is assumed small).
 */
export function loopStyleFor(id: string): LoopStyle {
  if (NATIVE_TOOL_MODEL_IDS.includes(id)) return "native";
  return findLlmModel(id)?.loop ?? "markers";
}
