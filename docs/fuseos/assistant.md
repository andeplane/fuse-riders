# Clippy, the FuseOS Office Assistant

The paperclip bottom right of the desktop is the classic Office Assistant (the
sprite, frame table and sounds are described in [assistant/README.md](assistant/README.md)).
In FuseOS he also answers questions and runs the desktop: "open Fuseball",
"play some music", "which games are there?".

## What answers

| Browser                     | Backend                                                                       |
| --------------------------- | ----------------------------------------------------------------------------- |
| WebGPU, model loads         | A small language model running on the graphics card through `@mlc-ai/web-llm` |
| WebGPU, model fails to load | The rules, for the rest of the session, with the reason shown under the chat  |
| No WebGPU (Safari, Firefox) | The rules from the start, with a notice under the chat                        |

The models come from web-llm's prebuilt list (`src/llm/modelCatalog.ts`):
Qwen 2.5 0.5B (about 300 MB, the default) and Llama 3.2 1B (about 700 MB). The
weights download from the Hugging Face CDN on the **first question** and stay in
the browser's Cache API, so the second visit loads from disk. Nothing typed into
the balloon leaves the device.

Control Panel, Assistant ("Clippy's brain") picks the model, shows whether it is
downloaded and has a **Forget model** button that clears the download
(`src/llm/modelCache.ts` reads and clears web-llm's caches without loading the
library). Changing the model starts a new chat.

### Nothing loads until the first message

The library is a 6 MB chunk and the weights hundreds of megabytes, so neither
may be part of the desktop's boot. The rule is enforced in three places:

- `src/llm/webLlmChat.ts` reaches the library only inside
  `webLlmEngineFactory`, through `await import("@mlc-ai/web-llm")`, and spawns
  the worker (`src/llm/llmWorker.ts`) in the same function. The factory runs
  from `createWebLlmChatEngine` on the first `reply`, i.e. the first `send`.
  Opening the balloon, the greeting and the tips touch none of it.
- `tests/fuseos-lazy.test.ts` walks the static import graph from
  `packages/fuseos/src/main.tsx` and asserts it never reaches `@mlc-ai/web-llm`
  or `llmWorker.ts`; after `pnpm build` it also walks the chunks the page runs
  at boot (the page scripts, their static imports, and the OS chunk
  `site/main.ts` awaits) and asserts none carries the library's code.
- The Control Panel reads the download state from the Cache API directly.

Run the node test with `pnpm exec tsx --test tests/fuseos-lazy.test.ts`.

## How a question is answered

```
AssistantBalloon  ──send──▶  useEngineChat  ──reply──▶  ChatEngine
                                 │                        ├ createWebLlmChatEngine (model, lazy; falls back)
                                 │                        └ createIntentEngine (rules)
                                 ├ streams text into the last message, markers hidden
                                 └ runToolCalls(parseToolMarkers(reply), tools) ──▶ the desktop
```

- `src/llm/llmChat.ts` holds the interfaces: `ChatHandle` (what the balloon
  renders), `ChatOptions` (what the desktop passes: app context, system prompt,
  tools, a tool-call reporter), `ChatEngine` (what produces a reply) and
  `ChatBackend` (who is answering).
- `src/llm/useEngineChat.ts` turns any `ChatEngine` into a `ChatHandle`: it
  owns the conversation, caps the history at eight lines, streams, strips the
  markers while they arrive, and runs the tools once the reply is complete.
- `src/llm/webLlmChat.ts` is the model engine. `LlmEngine` is the narrow
  interface the chat drives (`stream`, `unload`); `EngineFactory` loads one.
  Download and load progress is reported as "Downloading the model 42%",
  "Loading the model 80%", "Warming up the model", during which the character
  plays `Processing`; a load failure records a reason and hands the question to
  the fallback engine.
- `src/llm/intent.ts` is the rules: keyword intents (open a target by name, id
  or alias; play, pause, stop, next, previous; which games; help; hello) answered
  in Clippy's voice with the same markers a model would write.
- `src/llm/systemPrompt.ts` builds the system prompt: the Clippy persona, the
  Fuse games with their taglines from the game registry, the retro games, the
  apps, and one line per tool.
- `src/assistant/clippyChat.ts` is the production `useChat`: it picks the
  engine from the WebGPU probe (`SystemProbeContext`), the chosen model
  (`AssistantOptions.model`) and `LlmDepsContext` (`createEngine`,
  `modelCache`), which tests replace with `src/__mocks__/llmEngine.ts` and
  `MemoryModelCache`.

## Tools: what a reply can do

A reply makes the desktop act by ending with a marker, `[name:argument]`. When
the reply has finished streaming, the markers of registered tools are removed
from the text and each tool runs with its argument; the balloon lists each call
inline ("Opening Fuseball...", then "Opened Fuseball" or what went wrong) and
the character thinks while it runs.

The desktop registers two tools (`src/assistant/desktopTools.ts`):

| Marker                                        | Does                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[open:<id>]`                                 | Opens a Fuse game (its portal id), a retro game (`doom`, `keen1`, ...), or an app: `paint`, `winamp`, `settings`, `display`, `about`. Names and aliases work too. |
| `[music:<play\|pause\|stop\|next\|previous>]` | Drives the running Winamp's transport; `play` opens Winamp when none is open and presses Play once it has loaded.                                                 |

### Adding a tool

Tools are a registry, not a switch statement, so a window can add one while it
is mounted without touching the assistant. The API is in
`src/assistant/assistantToolsContext.ts` (types re-exported from
`src/llm/tools.ts`):

Notepad++ registers the real one (`src/notepadpp/assistantEditTool.ts`,
`useNotepadEditTool` in `NotepadPlusPlusWindow.tsx`): while the window is open,
the prompt lists the open files and carries the active one's text (truncated to
`MAX_PROMPT_FILE_CHARS`, the local models have a small context), so "add a line
about yourself to the readme" comes back as a reply with the new file in a
fenced block and `[edit:README.md]`. The tool writes the block through
`EditorCommands.writeFile` to the browser's overlay (what File > Save writes),
the open tab follows unless it has unsaved typing, and Clippy says the change
is on "your C: drive, which is this browser and nowhere else". Only a path open
in Notepad++ may be edited, and a marker without a code block changes nothing.
`[edit:undo]` puts back what the last edit replaced: the earlier saved copy, or
the committed text (a revert) when there was none.

A window registers a tool like this:

```ts
import { useMemo } from "react";
import type { AssistantTool } from "../assistant/assistantToolsContext";
import { useRegisterAssistantTool } from "../assistant/assistantToolsContext";

function SomeWindow() {
  const tool = useMemo<AssistantTool>(
    () => ({
      name: "example",
      describe: () => "[example:<arg>] does something with arg.",
      sentence: ({ arg }) => `Doing ${arg}`,
      run: ({ arg }) => ({ ok: true, sentence: `Did ${arg}` }),
    }),
    [],
  );
  useRegisterAssistantTool(tool);
  ...
}
```

- `name` is the marker name (letters, digits, `-`, `_`). Registering a name
  again replaces the earlier tool; unmounting removes it.
- `describe()` is the tool's line in the system prompt. It is read for every
  question, so it can describe the current state ("the open file is ...").
- `sentence(invocation)` is what the balloon shows while the tool runs.
- `run(invocation)` gets `{ name, arg, body }`: `arg` is the text after the
  colon, trimmed; `body` is the first fenced code block after the marker and
  before the next one, without the fences, for tools that take content. Return
  `{ ok, sentence }`; a thrown error counts as a failure with its message.
- Memoise the tool object (`useMemo`): a new object each render re-registers
  each render.

`useRegisteredAssistantTools()` lists what is registered; the view model
concatenates it after the desktop's tools and passes the lot to the chat as
`ChatOptions.tools`. Markers of unregistered names are left in the text as
written.

The pure parts are in `src/llm/tools.ts`: `parseToolMarkers`,
`visibleReplyText`, `toolInstructions`, `runToolCalls` and
`createToolRegistry`, all unit tested without React.

## Tests

- `src/llm/*.test.ts(x)`: the marker parser and registry, the rules, the
  prompt, the catalogue, the cache (over a fake Cache API), the model engine
  (over a fake `EngineFactory`, including progress, fallback and abort), the
  web-llm adapter (over a fake engine), and `useEngineChat` with a scripted
  engine.
- `src/assistant/clippyChat.test.tsx`: the desktop with the real
  `useClippyChat` over the fake factory: nothing loads before the first message,
  download progress as Processing with a percentage, `[open:...]` opening a
  window, an unknown id, the no-WebGPU rules, the load-failure fallback, the
  model switch, a mid-answer failure.
- `src/assistant/assistantToolsContext.test.tsx`: a window registering an
  `[edit:<path>]` tool that receives its code block.
- `src/notepadpp/assistantEditTool.test.tsx`: the real edit tool over a fake
  editor (prompt line, write, undo, refusals) and, on the desktop, Clippy
  rewriting the open README and undoing it.
- `src/controlpanel/AssistantApplet.test.tsx`: the model picker, download
  status and Forget model.
- `tests/fuseos-lazy.test.ts`: the lazy-loading guard, source and build.
