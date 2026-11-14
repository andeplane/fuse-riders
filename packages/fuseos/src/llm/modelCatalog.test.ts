import {
  DEFAULT_MODEL_ID,
  findLlmModel,
  isLlmModelId,
  LLM_MODELS,
  loopStyleFor,
  modelLabel,
  NATIVE_TOOL_MODEL_IDS,
} from "./modelCatalog";

describe("model catalogue", () => {
  it("offers the small Qwen by default, Llama as the bigger option and one recommended Clippy Pro", () => {
    expect(LLM_MODELS.map((model) => model.id)).toEqual([
      "Qwen2.5-0.5B-Instruct-q4f16_1-MLC",
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    ]);
    expect(
      LLM_MODELS.filter((model) => model.recommended).map(
        (model) => model.label,
      ),
    ).toEqual(["Clippy Pro (Qwen 2.5 1.5B)"]);
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

  it("picks the loop per model: markers for the small ones, the JSON agent for Clippy Pro, native where web-llm has tools", () => {
    expect(loopStyleFor(DEFAULT_MODEL_ID)).toBe("markers");
    expect(loopStyleFor("Llama-3.2-1B-Instruct-q4f16_1-MLC")).toBe("markers");
    expect(loopStyleFor("Qwen2.5-1.5B-Instruct-q4f16_1-MLC")).toBe("json");
    expect(loopStyleFor("Mystery-MLC")).toBe("markers");
    for (const id of NATIVE_TOOL_MODEL_IDS)
      expect(loopStyleFor(id)).toBe("native");
    // None of web-llm's function-calling models is small enough for the catalogue.
    expect(NATIVE_TOOL_MODEL_IDS.some(isLlmModelId)).toBe(false);
  });

  it("labels an unknown model by its id", () => {
    expect(modelLabel(DEFAULT_MODEL_ID)).toBe("Qwen 2.5 0.5B");
    expect(modelLabel("Mystery-MLC")).toBe("Mystery-MLC");
  });
});
