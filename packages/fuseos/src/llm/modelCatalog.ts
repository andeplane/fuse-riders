/**
 * The models Clippy can run in the browser: ids from web-llm's prebuilt list (weights from the Hugging Face CDN,
 * cached by the browser after the first download). Kept apart from `@mlc-ai/web-llm` so the Control Panel can list
 * them without loading the library.
 */
export type LlmModel = {
  id: string;
  /** Shown in the Control Panel. */
  label: string;
  /** Rough download size, as shown next to the label. */
  downloadMb: number;
  description: string;
};

export const LLM_MODELS: readonly LlmModel[] = [
  {
    id: "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 0.5B",
    downloadMb: 300,
    description: "Small and quick; the default.",
  },
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B",
    downloadMb: 700,
    description: "Twice the download, better at conversation.",
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
