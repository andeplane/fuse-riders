import { renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useMemo } from "react";

import { createTestAssistantDeps } from "../__mocks__/assistantDeps";
import { renderWithProviders } from "../__mocks__/renderWithProviders";
import { Desktop } from "../desktop/Desktop";
import type { AssistantTool } from "../llm/tools";

import {
  DEFAULT_ASSISTANT_OPTIONS,
  MemoryAssistantOptionsStore,
} from "./assistantOptionsStore";
import {
  AssistantToolsProvider,
  useRegisterAssistantTool,
  useRegisteredAssistantTools,
} from "./assistantToolsContext";
import { useClippyChat } from "./clippyChat";

function editTool(
  edits: { path: string; body: string | undefined }[],
): AssistantTool {
  return {
    name: "edit",
    describe: () =>
      "[edit:<path>] followed by a fenced code block replaces that file.",
    sentence: ({ arg }) => `Editing ${arg}`,
    run: ({ arg, body }) => {
      edits.push({ path: arg, body });
      return { ok: true, sentence: `Saved ${arg} to your C: drive` };
    },
  };
}

/** A window that brings its own tool, the way a later Notepad++ would. */
function EditorWindow({ tool }: { tool: AssistantTool }) {
  useRegisterAssistantTool(tool);
  return <div data-testid="editor" />;
}

describe("assistant tools context", () => {
  it("registers a tool while the component is mounted and removes it on unmount", () => {
    const edits: { path: string; body: string | undefined }[] = [];
    const tool = editTool(edits);
    const { result, rerender } = renderHook(
      ({ mounted }: { mounted: boolean }) => {
        const current = useMemo(() => (mounted ? tool : undefined), [mounted]);
        useRegisterAssistantTool(current);
        return useRegisteredAssistantTools();
      },
      { wrapper: AssistantToolsProvider, initialProps: { mounted: true } },
    );
    expect(result.current).toEqual([tool]);
    rerender({ mounted: false });
    expect(result.current).toEqual([]);
  });

  it("gives each provider its own registry", () => {
    const tool = editTool([]);
    const a = renderHook(
      () => {
        useRegisterAssistantTool(tool);
        return useRegisteredAssistantTools();
      },
      { wrapper: AssistantToolsProvider },
    );
    const b = renderHook(() => useRegisteredAssistantTools(), {
      wrapper: AssistantToolsProvider,
    });
    expect(a.result.current).toHaveLength(1);
    expect(b.result.current).toHaveLength(0);
  });

  it("puts a registered tool in the prompt and runs it from a reply marker with its code block", async () => {
    const user = userEvent.setup();
    const edits: { path: string; body: string | undefined }[] = [];
    const tool = editTool(edits);
    const deps = createTestAssistantDeps({ useChat: useClippyChat });
    const { llmFactory } = renderWithProviders(
      <>
        <Desktop />
        <EditorWindow tool={tool} />
      </>,
      {
        assistantDeps: deps,
        assistantOptions: new MemoryAssistantOptionsStore({
          ...DEFAULT_ASSISTANT_OPTIONS,
          greeted: true,
        }),
      },
    );
    llmFactory.reply = () => [
      "Done! [edit:src/hello.ts]\n```ts\nexport const hi = 1;\n```\n",
    ];
    await user.click(screen.getByRole("button", { name: "Clippy" }));
    const balloon = screen.getByRole("region", { name: "Clippy balloon" });
    await user.type(
      within(balloon).getByRole("textbox", { name: "Ask Clippy" }),
      "make hello.ts export 1{Enter}",
    );
    await waitFor(() =>
      expect(edits).toEqual([
        { path: "src/hello.ts", body: "export const hi = 1;\n" },
      ]),
    );
    const system = llmFactory.engines[0]?.requests[0]?.[0]?.content ?? "";
    expect(system).toContain("[edit:<path>] followed by a fenced code block");
    expect(system).toContain("[open:<id>]");
    const log = within(balloon).getByRole("log", { name: "Conversation" });
    await waitFor(() =>
      expect(log).toHaveTextContent("Saved src/hello.ts to your C: drive"),
    );
    expect(log).toHaveTextContent("export const hi = 1;");
    expect(log).not.toHaveTextContent("[edit:");
  });
});
