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

| Model                      | Download | How it acts (`loop`)                                          |
| -------------------------- | -------- | ------------------------------------------------------------- |
| Qwen 2.5 0.5B (default)    | 290 MB   | `markers`: one reply, one action                              |
| Llama 3.2 1B               | 705 MB   | `markers`                                                     |
| Clippy Pro (Qwen 2.5 1.5B) | 880 MB   | `json`: the agent loop, several steps per request (see below) |

The weights download from the Hugging Face CDN on the **first question** and stay
in the browser's Cache API, so the second visit loads from disk. Nothing typed
into the balloon leaves the device.

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

## The agent loop: Clippy Pro operates the desktop

A model whose catalogue entry says `loop: "json"` does not answer in one reply.
It works like a user would: one action, look at the result, the next action.

```
useEngineChat ─ engine.loopStyle() = "json" ─▶ runAgentLoop (llm/agentLoop.ts)
   ┌──────────────────────────────────────────────────────────────┐
   │ model reply, held to the tools' JSON schema by web-llm:      │
   │   {"tool":"open_app","args":{"id":"paint"}}                  │
   │ → coerceArgs → tool.run → step log "Opening Paint… Opened"   │
   │ → "Result of open_app: Done: Opened Paint" back to the model │
   └── repeat until {"tool":"answer","args":{"text":"…"}} ────────┘
```

- **Wire format.** Every reply is one JSON object, `{"tool", "args"}`. The
  schema (`stepSchema` in `agenttools/agentTool.ts`) has one alternative per
  tool with that tool's own arguments, ids as enums, plus `answer`; web-llm's
  JSON mode compiles it to a grammar, so even a 1.5B model cannot name a tool
  or an id that does not exist. web-llm's own OpenAI-style `tools` only work on
  its 4 to 5 GB Hermes models (`NATIVE_TOOL_MODEL_IDS`); `loopStyleFor` picks
  `"native"` for those and the loop speaks that format too, but no catalogue
  model uses it.
- **Limits.** Eight steps (`MAX_AGENT_STEPS`), then one last reply that can
  only be an answer. A reply may take 90 s and a tool 15 s; a tool that times
  out or throws is a failed step the model is told about, a reply that times
  out ends the turn. The same call three times in a row is not run a third
  time, and the next reply can only be an answer.
- **Malformed replies.** A reply that is not a tool call gets one corrective
  retry; a second one ends the turn with "I got my wires crossed…" and what was
  done so far. A reply with no JSON at all is taken as the answer.
- **Cancel.** The balloon's Cancel button aborts the turn: the generation is
  interrupted and Clippy says what got done.
- **Checklist.** Where the rules can split the request into parts
  (`requestChecklist` in `llm/intent.ts`: "open Paint", "maximize it", "256
  colors"), the loop does not take an answer while a part has had no tool
  call: it replies `Not finished: you have not done "maximize it" yet. Call
maximize_window for it now` once per part. A 1.5B model otherwise does the
  first part and reports all three. The model still chooses the call and its
  arguments; a single request, or one the rules do not follow, has no
  checklist.
- **Step log.** Each tool call is a line in the balloon while it runs and after
  ("Opening Paint...", then "Opened Paint"), with "Thinking (step 3 of 8)..."
  under it.
- **No confirmation.** Nothing on this desktop is risky (file edits land in the
  browser's own overlay and `undo_edit` reverts them), so every tool runs
  directly.

The loop is a pure function: the model is a `complete` function, the clock a
pair of timers, the desktop a list of `AgentTool`s. `llm/agentLoop.test.ts`
drives every path with a scripted model.

### The typed tools (`src/agenttools/`)

A tool declares its parameters once (`AgentTool` in `agentTool.ts`); from that
come its prompt line, its part of the schema, the argument check and a
`[name:argument]` marker (`toMarkerTool`) for the rules and the small models.
Tools reach the desktop only through `AgentOs` (`agentOs.ts`), one narrow port
per thing a user can operate; `useAgentTools` builds the real one from the
desktop's contexts and `__mocks__/agentOs.ts` is the typed fake the tests use.

| Tool                                                                             | Does                                                                                   |
| -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `get_desktop_state()`                                                            | The open windows (id, title, state), Start menu, display and music status              |
| `open_app(id)`                                                                   | Opens a program, a retro game or a Fuse game (the latter as the Games applet says)     |
| `launch_game(id, mode?)`                                                         | Starts a Fuse game in a `window` or a browser `tab`                                    |
| `list_games()`                                                                   | The Fuse games with taglines, and the retro games                                      |
| `focus_window` / `close_window` / `minimize_window` / `maximize_window(window)`  | By title, id, kind or part of the title                                                |
| `open_start_menu(open?)`                                                         | Presses Start                                                                          |
| `explorer_open(path)`                                                            | Explorer on a folder or drive; a text file opens in Notepad++                          |
| `list_dir(path)` / `read_file(path)`                                             | C: (the repository) and A:; listings capped at 40 entries, files at 1200 characters    |
| `edit_file(path, content, mode?)` / `undo_edit()`                                | Replace, append or prepend through `EditorCommands` (the browser's overlay), with undo |
| `music(action, level?)`                                                          | play, pause, stop, next, previous, volume (0 to 100)                                   |
| `set_display(color_mode?, resolution?, scheme?, crt?, curvature?, large_fonts?)` | Display Properties without the dialog                                                  |
| `set_wallpaper(color)`                                                           | The desktop as a solid Windows 98 palette colour                                       |
| `screensaver_preview()`                                                          | Starts the screen saver                                                                |
| `show_message(text, title?)`                                                     | A message box                                                                          |
| `run(command)`                                                                   | Start, Run; only where `AgentRunContext` provides a runner (no Run dialog on main yet) |

A window's own marker tool (`useRegisterAssistantTool`) is offered to the loop
too, as `name(arg, body?)`, unless a typed tool covers it (Notepad++'s `edit`:
`edit_file`). A feature that Clippy should be able to operate adds a port to
`AgentOs`, a tool next to the others and its line in `createAgentTools`.

### Choosing the model

Measured in headless Chrome with WebGPU on an M4 (26 scripted requests against
the fake desktop, one to three tool calls each, pass = exactly the right calls
and an answer):

| Variant                                    | Pass  | Per request |
| ------------------------------------------ | ----- | ----------- |
| Qwen 2.5 1.5B, plain `{"tool","args"}`     | 19/26 | 2.4 s       |
| the same with batched `{"calls":[…]}`      | 18/26 | 2.4 s       |
| the same with a leading `"thought"` string | 16/26 | 3.5 s       |

Hermes 3 (Llama 3.2 3B, 1.8 GB) was tried by hand on the live desktop and was
worse than the 1.5B Qwen: it kept calling tools nobody asked for (it edited a
file after being asked what a folder holds), repeated calls until the step cap,
and took twice as long per step. Qwen 2.5 3B is non-commercial. So Clippy Pro is
Qwen 2.5 1.5B with the plain format and the checklist. Prompt-side fixes for
the dropped second part (a thought, a numbered list, batching) all scored
below the plain format; the checklist, which is code, fixed it. What the model
still gets wrong: rarer tools (`show_message`, `read_file`, volume) sometimes
lose to `open_app` or `set_display`, and the answer then claims success.

### The download in the chat

While the model loads, the conversation shows a panel instead of a status
line (`ModelLoadPanel` in `AssistantBalloon.tsx`): the progress line, a
progress bar, the model's name and download size from the catalogue, and what
the phase means ("It downloads once and then stays in this browser",
"Already downloaded: loading it from this browser"). `parseLoadProgress` reads
the phase and percentage back from the progress line `formatLoadProgress` writes.

## The rules: several commands in one sentence

Without WebGPU, or when the model cannot load, `src/llm/intent.ts` answers.
`parseIntents` splits a sentence at "and", "then", "also", commas and full
stops, reads each clause, and carries the subject along, so "open Paint and
maximize it" is `[open:paint] [maximize_window:Paint]`. A sentence that does
not split into two understood requests is read whole ("rock and roll" stays one
unknown request; "black and white" and a game called "Cops and Robbers" are
never split). Beyond open and music the rules know: close, minimize, maximize
and focus a window; volume; colour depth, resolution, colour scheme, CRT and
large fonts; the desktop colour; the screen saver; the Start menu; reading,
listing and opening a drive path; "what is open"; undo; and a game "in a new
tab". Each becomes the marker of a typed tool, run through the one marker
pipeline, with a turn of the event loop between two markers so the second sees
what the first did.

## Tools: what a reply can do

A reply makes the desktop act by ending with a marker, `[name:argument]`. When
the reply has finished streaming, the markers of registered tools are removed
from the text and each tool runs with its argument; the balloon lists each call
inline ("Opening Fuseball...", then "Opened Fuseball" or what went wrong) and
the character thinks while it runs.

The desktop registers `open` and every typed tool as a marker
(`src/assistant/desktopTools.ts`); a small model's prompt lists only these two:

| Marker                                        | Does                                                                                                                                                              |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `[open:<id>]`                                 | Opens a Fuse game (its portal id), a retro game (`doom`, `keen1`, ...), or an app: `paint`, `winamp`, `settings`, `display`, `about`. Names and aliases work too. |
| `[music:<play\|pause\|stop\|next\|previous>]` | Drives the running Winamp's transport; `play` opens Winamp when none is open and presses Play once it has loaded. `[music:volume,40]` sets the volume.            |

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
- `src/llm/agentLoop.test.ts`: the loop over a scripted model: tool call,
  result, answer; the step cap; cancel before, during and after a step; both
  timeouts; a malformed reply retried once, then the graceful message; the
  repeat guard; native function calling.
- `src/agenttools/*.test.ts(x)`: every tool against the typed fake desktop
  (`agentTools.test.ts`), the parameter check, schema and marker form
  (`agentTool.test.ts`), the disk port over the fixture repository, and
  `useAgentTools` against the real desktop's providers.
- `src/llm/useEngineChatAgent.test.tsx`, `src/assistant/clippyAgent.test.tsx`:
  the loop through the chat hook and on the desktop with the fake engine
  factory: a three-step request, a file edit and its undo, Cancel, malformed
  replies, the fallback to the rules, the small model staying on markers.
- `src/llm/intentMulti.test.ts`: the rules' new commands and several of them in
  one sentence.
- `tests/fuseos-lazy.test.ts`: the lazy-loading guard, source and build.
