import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  renderWithProviders,
  TEST_SYSTEM_PROBE,
} from "../__mocks__/renderWithProviders";
import {
  DEFAULT_ASSISTANT_OPTIONS,
  MemoryAssistantOptionsStore,
} from "../assistant/assistantOptionsStore";
import { MemoryModelCache } from "../llm/modelCache";
import { DEFAULT_MODEL_ID } from "../llm/modelCatalog";
import type { AppState } from "../state/appState";
import { DEFAULT_STATE } from "../state/appState";

import { ControlPanelWindow } from "./ControlPanelWindow";
import { formatDownload, NO_WEBGPU_NOTICE } from "./AssistantApplet";

const OPEN_ON_ASSISTANT: AppState = {
  ...DEFAULT_STATE,
  windows: [
    {
      id: "w1",
      minimized: false,
      maximized: false,
      kind: "controlpanel",
      applet: "assistant",
    },
  ],
};

function renderApplet(
  options: {
    downloaded?: boolean;
    hasWebGpu?: boolean;
    forgetError?: Error;
  } = {},
) {
  const cache = new MemoryModelCache(
    new Set(options.downloaded ? [DEFAULT_MODEL_ID] : []),
  );
  const context = renderWithProviders(<ControlPanelWindow windowId="w1" />, {
    initialState: OPEN_ON_ASSISTANT,
    assistantOptions: new MemoryAssistantOptionsStore({
      ...DEFAULT_ASSISTANT_OPTIONS,
      greeted: true,
    }),
    systemProbe: { ...TEST_SYSTEM_PROBE, hasWebGpu: options.hasWebGpu ?? true },
    llmDeps: {
      modelCache: options.forgetError
        ? {
            has: async () => true,
            forget: async () => {
              throw options.forgetError;
            },
          }
        : cache,
    },
  });
  return { ...context, cache };
}

function brain() {
  return screen.getByRole("group", { name: "Clippy's brain" });
}

describe("AssistantApplet", () => {
  it("offers the models, remembers the choice and says the chosen one is not downloaded", async () => {
    const user = userEvent.setup();
    const { assistantOptions } = renderApplet();
    const radios = within(brain()).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(
      within(brain()).getByLabelText(/^Qwen 2.5 0.5B \(about 290 MB\)/),
    ).toBeChecked();
    // The model that works step by step is flagged, with its download size.
    expect(
      within(brain()).getByLabelText(
        /^Clippy Pro \(Qwen 2.5 1.5B\) \(about 880 MB, recommended\): Works through a request step by step/,
      ),
    ).not.toBeChecked();
    expect(formatDownload(1817)).toBe("about 1.8 GB");
    await waitFor(() =>
      expect(
        within(brain()).getByRole("status", { name: "Model status" }),
      ).toHaveTextContent("Not downloaded yet"),
    );
    expect(
      within(brain()).getByRole("button", { name: "Forget model" }),
    ).toBeDisabled();
    expect(within(brain()).queryByText(NO_WEBGPU_NOTICE)).toBeNull();

    await user.click(
      within(brain()).getByLabelText(/Llama 3.2 1B \(about 705 MB\)/),
    );
    expect(assistantOptions.get().model).toBe(
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    );
    expect(within(brain()).getByLabelText(/Llama 3.2 1B/)).toBeChecked();
  });

  it("forgets a downloaded model and re-reads the status", async () => {
    const user = userEvent.setup();
    const { cache } = renderApplet({ downloaded: true });
    await waitFor(() =>
      expect(
        within(brain()).getByRole("status", { name: "Model status" }),
      ).toHaveTextContent("Downloaded: the model is stored in this browser."),
    );
    const forget = within(brain()).getByRole("button", {
      name: "Forget model",
    });
    await waitFor(() => expect(forget).toBeEnabled());
    await user.click(forget);
    await waitFor(() => expect(cache.forgotten).toEqual([DEFAULT_MODEL_ID]));
    await waitFor(() =>
      expect(
        within(brain()).getByRole("status", { name: "Model status" }),
      ).toHaveTextContent("Not downloaded yet"),
    );
    expect(forget).toBeDisabled();
  });

  it("shows why forgetting failed", async () => {
    const user = userEvent.setup();
    renderApplet({ forgetError: new Error("Storage is locked") });
    const forget = within(brain()).getByRole("button", {
      name: "Forget model",
    });
    await waitFor(() => expect(forget).toBeEnabled());
    await user.click(forget);
    await waitFor(() => expect(brain()).toHaveTextContent("Storage is locked"));
  });

  it("warns that the rules answer when the browser has no WebGPU", () => {
    renderApplet({ hasWebGpu: false });
    expect(within(brain()).getByText(NO_WEBGPU_NOTICE)).toBeInTheDocument();
  });

  it("keeps the Office Assistant options above the model", async () => {
    const user = userEvent.setup();
    const { assistantOptions } = renderApplet();
    await user.click(screen.getByLabelText("Show tips"));
    expect(assistantOptions.get().showTips).toBe(false);
    expect(assistantOptions.get().model).toBe(DEFAULT_MODEL_ID);
  });
});
