import { useContext, useEffect, useState } from "react";

import { LlmDepsContext } from "../llm/llmDepsContext";
import { LLM_MODELS } from "../llm/modelCatalog";

import { SystemProbeContext } from "./systemProbeContext";
import { useControlPanelViewModel } from "./useControlPanelViewModel";

const ASSISTANT_FLAGS: {
  key: "showTips" | "narrate" | "animate" | "sounds";
  label: string;
}[] = [
  { key: "showTips", label: "Show tips" },
  { key: "narrate", label: "Narrate what the assistant does" },
  { key: "animate", label: "Play animations" },
  { key: "sounds", label: "Play sounds" },
];

export const NO_WEBGPU_NOTICE =
  "This browser has no WebGPU, so Clippy follows simple commands instead of running a model. Chrome or Edge on a computer runs the model.";

/** Whether the chosen model's weights are in the browser; re-read when the model changes or after Forget. */
function useDownloaded(modelId: string): {
  downloaded: boolean | undefined;
  refresh: () => void;
} {
  const { modelCache } = useContext(LlmDepsContext);
  const [downloaded, setDownloaded] = useState<boolean | undefined>(undefined);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setDownloaded(undefined);
    modelCache
      .has(modelId)
      .then((has) => {
        if (!cancelled) setDownloaded(has);
      })
      .catch(() => {
        if (!cancelled) setDownloaded(false);
      });
    return () => {
      cancelled = true;
    };
  }, [modelCache, modelId, tick]);
  return { downloaded, refresh: () => setTick((count) => count + 1) };
}

/** Control Panel, Assistant: the Office Assistant's visibility, Options, and the model behind the chat. */
export function AssistantApplet({ windowId }: { windowId: string }) {
  const vm = useControlPanelViewModel(windowId);
  const { assistantOptions: options } = vm;
  const { modelCache } = useContext(LlmDepsContext);
  const probe = useContext(SystemProbeContext);
  const hasWebGpu = probe().hasWebGpu;
  const { downloaded, refresh } = useDownloaded(options.model);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<string | null>(null);

  const forget = async () => {
    setForgetting(true);
    setForgetError(null);
    try {
      await modelCache.forget(options.model);
    } catch (error) {
      setForgetError(
        error instanceof Error
          ? error.message
          : "The model could not be removed.",
      );
    } finally {
      setForgetting(false);
      refresh();
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex flex-col gap-2">
        <legend>Office Assistant</legend>
        <div className="field-row">
          <input
            id="assistant-shown"
            type="checkbox"
            checked={vm.assistantShown}
            onChange={(event) => vm.setAssistantShown(event.target.checked)}
          />
          <label htmlFor="assistant-shown">Show the Office Assistant</label>
        </div>
        {ASSISTANT_FLAGS.map((flag) => (
          <div key={flag.key} className="field-row">
            <input
              id={`assistant-${flag.key}`}
              type="checkbox"
              checked={options[flag.key]}
              onChange={(event) =>
                vm.setAssistantOptions({ [flag.key]: event.target.checked })
              }
            />
            <label htmlFor={`assistant-${flag.key}`}>{flag.label}</label>
          </div>
        ))}
      </fieldset>
      <fieldset className="flex flex-col gap-2">
        <legend>Clippy's brain</legend>
        <p>
          Questions are answered by a small model that runs in this browser on
          your graphics card. It downloads once, on the first question, and
          nothing you type leaves this device.
        </p>
        {hasWebGpu ? null : <p className="text-[maroon]">{NO_WEBGPU_NOTICE}</p>}
        <div
          className="flex flex-col gap-1"
          role="radiogroup"
          aria-label="Model"
        >
          {LLM_MODELS.map((model) => (
            <div key={model.id} className="field-row">
              <input
                id={`assistant-model-${model.id}`}
                type="radio"
                name="assistant-model"
                value={model.id}
                checked={options.model === model.id}
                onChange={() => vm.setAssistantOptions({ model: model.id })}
              />
              <label htmlFor={`assistant-model-${model.id}`}>
                {model.label} (about {model.downloadMb} MB): {model.description}
              </label>
            </div>
          ))}
        </div>
        <p role="status" aria-label="Model status">
          {downloaded === undefined
            ? "Checking whether the model is downloaded..."
            : downloaded
              ? "Downloaded: the model is stored in this browser."
              : "Not downloaded yet: the first question fetches it."}
        </p>
        <div className="field-row">
          <button
            type="button"
            disabled={!downloaded || forgetting}
            onClick={() => void forget()}
          >
            Forget model
          </button>
          <span className="text-[grey]">
            Removes the download from this browser.
          </span>
        </div>
        {forgetError ? <p className="text-[maroon]">{forgetError}</p> : null}
      </fieldset>
    </div>
  );
}
