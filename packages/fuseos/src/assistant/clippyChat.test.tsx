import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { createTestAssistantDeps } from "../__mocks__/assistantDeps";
import {
  renderWithProviders,
  TEST_SYSTEM_PROBE,
} from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import { NO_WEBGPU_REASON } from "../llm/intent";
import type { LlmMessage } from "../llm/llmChat";
import { DEFAULT_MODEL_ID } from "../llm/modelCatalog";
import type { LoadProgress } from "../llm/webLlmChat";

import {
  DEFAULT_ASSISTANT_OPTIONS,
  MemoryAssistantOptionsStore,
} from "./assistantOptionsStore";
import { useClippyChat } from "./clippyChat";

function greeted(model = DEFAULT_MODEL_ID) {
  return new MemoryAssistantOptionsStore({
    ...DEFAULT_ASSISTANT_OPTIONS,
    greeted: true,
    model,
  });
}

function balloon() {
  return screen.getByRole("region", { name: "Clippy balloon" });
}

function sprite() {
  return screen.getByRole("img", { name: "Clippy, the Office Assistant" });
}

async function openBalloon(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Clippy" }));
  return balloon();
}

async function ask(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.type(
    within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    `${text}{Enter}`,
  );
}

/** The desktop with the real Clippy chat over the fake engine factory. */
function renderClippy(options: { hasWebGpu?: boolean; model?: string } = {}) {
  return renderWithProviders(<Desktop />, {
    assistantDeps: createTestAssistantDeps({ useChat: useClippyChat }),
    assistantOptions: greeted(options.model),
    systemProbe: { ...TEST_SYSTEM_PROBE, hasWebGpu: options.hasWebGpu ?? true },
  });
}

describe(useClippyChat.name, () => {
  it("loads nothing until the first question, then streams the model's answer with Clippy's prompt", async () => {
    const user = userEvent.setup();
    const { llmFactory, store } = renderClippy();
    await openBalloon(user);
    expect(llmFactory.loads).toEqual([]);
    expect(within(balloon()).queryByTestId("chat-backend-notice")).toBeNull();

    llmFactory.reply = () => ["Fuseball is five-a-side ", "with rockets!"];
    await ask(user, "What is Fuseball?");
    const log = await within(balloon()).findByRole("log", {
      name: "Conversation",
    });
    await waitFor(() =>
      expect(log).toHaveTextContent("Fuseball is five-a-side with rockets!"),
    );
    expect(llmFactory.loads.map((load) => load.modelId)).toEqual([
      DEFAULT_MODEL_ID,
    ]);
    const request: LlmMessage[] = llmFactory.engines[0]?.requests[0] ?? [];
    expect(request[0]?.role).toBe("system");
    expect(request[0]?.content).toContain("You are Clippy");
    expect(request[0]?.content).toContain(
      "- Fuseball: Five-a-side with rockets",
    );
    expect(request[0]?.content).toContain(
      "[open:<id>] opens a game or app. Ids: fuseball, fuse-riders, fuse-birds, doom",
    );
    expect(request[0]?.content).toContain("Current desktop: FuseOS desktop.");
    expect(request[1]).toEqual({ role: "user", content: "What is Fuseball?" });
    expect(store.load().windows).toEqual([]);
  });

  it("shows the download as Clippy processing with the percentage, then the answer", async () => {
    const user = userEvent.setup();
    const { llmFactory } = renderClippy();
    await openBalloon(user);
    let ready: () => void = () => undefined;
    llmFactory.loadGate = new Promise<void>((resolve) => {
      ready = resolve;
    });
    llmFactory.reply = () => ["Hello!"];
    await ask(user, "hi");
    await waitFor(() => expect(llmFactory.loads).toHaveLength(1));
    const report: ((progress: LoadProgress) => void) | undefined =
      llmFactory.loads[0]?.onProgress;
    act(() => report?.({ progress: 0.42, text: "Fetching param cache[3/10]" }));
    const log = within(balloon()).getByRole("log", { name: "Conversation" });
    await waitFor(() =>
      expect(log).toHaveTextContent("Downloading the model 42%..."),
    );
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Processing"),
    );
    expect(
      within(balloon()).getByRole("textbox", { name: "Ask Clippy" }),
    ).toBeDisabled();
    act(() => ready());
    await waitFor(() => expect(log).toHaveTextContent("Hello!"));
    expect(log).not.toHaveTextContent("Downloading");
  });

  it("executes the reply's open marker through the window commands and narrates it inline", async () => {
    const user = userEvent.setup();
    const { llmFactory, store } = renderClippy();
    await openBalloon(user);
    llmFactory.reply = () => [
      "Opening Fuseball right away! ",
      "[open:fuseball]",
    ];
    await ask(user, "open fuseball");
    const log = await within(balloon()).findByRole("log", {
      name: "Conversation",
    });
    await waitFor(() =>
      expect(store.load().windows.map((window) => window.kind)).toEqual([
        "fusegame",
      ]),
    );
    expect(log).toHaveTextContent("Opening Fuseball right away!");
    expect(log).not.toHaveTextContent("[open:");
    expect(log).toHaveTextContent("Opened Fuseball");
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Congratulate"),
    );
  });

  it("says when a marker named nothing on the desktop", async () => {
    const user = userEvent.setup();
    const { llmFactory, store } = renderClippy();
    await openBalloon(user);
    llmFactory.reply = () => ["Sure! [open:excel]"];
    await ask(user, "open excel");
    const log = await within(balloon()).findByRole("log", {
      name: "Conversation",
    });
    await waitFor(() =>
      expect(log).toHaveTextContent(
        'There is nothing called "excel" on this desktop (that did not work)',
      ),
    );
    expect(store.load().windows).toEqual([]);
  });

  it("answers with the rules, and says why, in a browser without WebGPU", async () => {
    const user = userEvent.setup();
    const { llmFactory, store } = renderClippy({ hasWebGpu: false });
    await openBalloon(user);
    expect(
      within(balloon()).getByTestId("chat-backend-notice"),
    ).toHaveTextContent(NO_WEBGPU_REASON);
    await ask(user, "open DOOM");
    await waitFor(() =>
      expect(store.load().windows.map((window) => window.kind)).toEqual([
        "retro",
      ]),
    );
    expect(
      within(balloon()).getByRole("log", { name: "Conversation" }),
    ).toHaveTextContent("Opening DOOM!");
    expect(llmFactory.loads).toEqual([]);
  });

  it("falls back to the rules when the model cannot load, answering the question anyway", async () => {
    const user = userEvent.setup();
    const { llmFactory, store } = renderClippy();
    await openBalloon(user);
    llmFactory.failLoad = new Error("Cannot find WebGPU adapter");
    await ask(user, "play some music");
    await waitFor(() =>
      expect(store.load().windows.map((window) => window.kind)).toEqual([
        "winamp",
      ]),
    );
    expect(
      within(balloon()).getByTestId("chat-backend-notice"),
    ).toHaveTextContent(
      "Clippy's model (Qwen 2.5 0.5B) could not start: Cannot find WebGPU adapter.",
    );
    expect(within(balloon()).queryByText(/could not answer/)).toBeNull();
  });

  it("starts a new chat on the chosen model when the Control Panel changes it, and unloads the old one", async () => {
    const user = userEvent.setup();
    const { llmFactory, assistantOptions } = renderClippy();
    await openBalloon(user);
    await ask(user, "hi");
    await waitFor(() => expect(llmFactory.engines).toHaveLength(1));
    const log = within(balloon()).getByRole("log", { name: "Conversation" });
    await waitFor(() => expect(log).toHaveTextContent("Echo: hi"));

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByRole("button", { name: "Clippy" }),
    });
    await user.click(
      within(
        screen.getByRole("menu", { name: "Office Assistant menu" }),
      ).getByRole("menuitem", { name: "Options..." }),
    );
    const panel = await screen.findByRole("dialog", { name: "Control Panel" });
    await user.click(within(panel).getByLabelText(/Llama 3.2 1B/));
    expect(assistantOptions.get().model).toBe(
      "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    );
    await waitFor(() => expect(llmFactory.engines[0]?.unloaded).toBe(true));
    expect(
      within(balloon()).queryByRole("log", { name: "Conversation" }),
    ).toBeNull();
    await ask(user, "again");
    await waitFor(() =>
      expect(llmFactory.loads.map((load) => load.modelId)).toEqual([
        DEFAULT_MODEL_ID,
        "Llama-3.2-1B-Instruct-q4f16_1-MLC",
      ]),
    );
  });

  it("reports a model that fails mid-answer and plays Alert", async () => {
    const user = userEvent.setup();
    const { llmFactory } = renderClippy();
    await openBalloon(user);
    llmFactory.reply = () => ["Well"];
    llmFactory.failStream = new Error("Device lost");
    await ask(user, "hi");
    await waitFor(() => expect(balloon()).toHaveTextContent("Device lost"));
    await waitFor(() =>
      expect(sprite()).toHaveAttribute("data-animation", "Alert"),
    );
    expect(
      within(balloon()).getByRole("log", { name: "Conversation" }),
    ).toHaveTextContent("Well");
  });
});
