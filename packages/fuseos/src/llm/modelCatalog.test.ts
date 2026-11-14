import {
  DEFAULT_MODEL_ID,
  findLlmModel,
  isLlmModelId,
  LLM_MODELS,
  modelLabel,
} from "./modelCatalog";

describe("model catalogue", () => {
  it("offers the small Qwen by default and Llama as the bigger option", () => {
    expect(LLM_MODELS.map((model) => model.id)).toEqual([
      "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    ]);
    expect(isLlmModelId(DEFAULT_MODEL_ID)).toBe(true);
    expect(LLM_MODELS[0]?.id).toBe(DEFAULT_MODEL_ID);
    expect(LLM_MODELS.every((model) => model.downloadMb > 0)).toBe(true);
  });

  it("recognises only catalogue ids", () => {
    expect(isLlmModelId("Llama-3.2-1B-Instruct-q4f16_1-MLC")).toBe(true);
    expect(isLlmModelId("gpt-4")).toBe(false);
    expect(isLlmModelId(42)).toBe(false);
    expect(findLlmModel("gpt-4")).toBeUndefined();
    expect(findLlmModel(DEFAULT_MODEL_ID)?.label).toBe("Qwen 2.5 0.5B");
  });

  it("labels an unknown model by its id", () => {
    expect(modelLabel(DEFAULT_MODEL_ID)).toBe("Qwen 2.5 0.5B");
    expect(modelLabel("Mystery-MLC")).toBe("Mystery-MLC");
  });
});
