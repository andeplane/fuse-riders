import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { ChatBackend, ChatMessage } from "../llm/llmChat";
import { findLlmModel, formatDownload } from "../llm/modelCatalog";
import type { LoadPhase } from "../llm/webLlmChat";
import { parseLoadProgress } from "../llm/webLlmChat";

import type { ToolCallReport } from "./assistantState";
import type { OfficeAssistantViewModel } from "./useOfficeAssistantViewModel";

/** One tool call of the current turn, as an inline status line: running, done, or what went wrong. */
function ToolCallLine({ call }: { call: ToolCallReport }) {
  return (
    <li
      className={`assistant-tool${call.phase === "started" ? " assistant-tool-running" : ""}`}
      data-phase={call.phase}
      role={call.phase === "started" ? "status" : undefined}
    >
      {call.phase === "started" ? `${call.sentence}...` : call.sentence}
      {call.phase === "failed" ? " (that did not work)" : null}
    </li>
  );
}

const LOAD_NOTES: Record<LoadPhase, string> = {
  downloading: "It downloads once and then stays in this browser.",
  loading: "Already downloaded: loading it from this browser.",
  preparing: "Getting the model ready.",
  warming: "Almost there.",
};

/**
 * The model on its way in, as a panel in the conversation: what is coming, how large it is, and how far along,
 * so a first question that waits on several hundred megabytes says so.
 */
function ModelLoadPanel({
  progress,
  load,
  backend,
}: {
  progress: string;
  load: { phase: LoadPhase; percent: number };
  backend: ChatBackend;
}) {
  const model =
    backend.kind === "model" ? findLlmModel(backend.modelId) : undefined;
  return (
    <li
      className="assistant-download"
      role="status"
      aria-label="Model download"
      data-phase={load.phase}
    >
      <span>{progress}...</span>
      <div
        className="progress-indicator segmented"
        role="progressbar"
        aria-label="Model download progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={load.percent}
      >
        <span
          className="progress-indicator-bar"
          style={{ width: `${load.percent}%` }}
        />
      </div>
      <span className="text-[grey]">
        {model ? `${model.label}, ${formatDownload(model.downloadMb)}. ` : null}
        {LOAD_NOTES[load.phase]}
      </span>
    </li>
  );
}

function Message({ message }: { message: ChatMessage }) {
  return (
    <li
      className={message.role === "user" ? "assistant-user" : "assistant-reply"}
      data-role={message.role}
    >
      {message.role === "user" ? (
        <span className="font-bold">You: </span>
      ) : null}
      <span className="whitespace-pre-wrap">{message.text}</span>
      {message.isStreaming ? <span aria-hidden>▌</span> : null}
    </li>
  );
}

/**
 * The Office Assistant's speech balloon: the classic yellow bubble with a tail pointing at the character,
 * carrying the greeting, tips and the chat.
 */
export function AssistantBalloon({ vm }: { vm: OfficeAssistantViewModel }) {
  const [draft, setDraft] = useState("");
  const log = useRef<HTMLUListElement>(null);
  const { chat } = vm;
  const load = parseLoadProgress(chat.progress);

  // Keep the newest turn in view.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.messages, chat.progress, chat.calls]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft;
    setDraft("");
    void vm.ask(text);
  };

  return (
    <section className="assistant-balloon win98" aria-label="Clippy balloon">
      <header className="flex items-center gap-1 border-b border-black/20 pb-1">
        <span className="font-bold">Clippy</span>
        <button
          type="button"
          className="flat ml-auto"
          style={{ minWidth: 0 }}
          aria-label="Close balloon"
          onClick={vm.closeBalloon}
        >
          ×
        </button>
      </header>

      {vm.speech ? (
        <p
          className="assistant-speech"
          role="status"
          data-kind={vm.speech.kind}
        >
          {vm.speech.text}
        </p>
      ) : null}
      {vm.greeting ? (
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-label="Greeting options"
        >
          {vm.tipSuggestion ? (
            <button
              type="button"
              className="default"
              onClick={vm.tryTip}
              disabled={!chat.available || chat.isStreaming}
            >
              Try this
            </button>
          ) : null}
          <button
            type="button"
            className={vm.tipSuggestion ? undefined : "default"}
            onClick={() => vm.answerGreeting("yes")}
          >
            Yes, help me
          </button>
          <button type="button" onClick={() => vm.answerGreeting("tip")}>
            Show me a tip
          </button>
          <button type="button" onClick={() => vm.answerGreeting("no")}>
            No thanks
          </button>
        </div>
      ) : null}
      {vm.speech?.kind === "tip" ? (
        <div className="flex gap-1">
          {vm.tipSuggestion ? (
            <button
              type="button"
              className="default"
              onClick={vm.tryTip}
              disabled={!chat.available || chat.isStreaming}
            >
              Try this
            </button>
          ) : null}
          <button type="button" onClick={vm.nextTip}>
            Next tip
          </button>
          <button type="button" onClick={vm.dismissSpeech}>
            Close tip
          </button>
        </div>
      ) : null}

      {chat.messages.length > 0 || chat.isStreaming ? (
        <ul
          ref={log}
          className="assistant-log sunken-panel"
          role="log"
          aria-label="Conversation"
        >
          {chat.messages.map((message) => (
            <Message key={message.id} message={message} />
          ))}
          {chat.calls.map((call, index) => (
            <ToolCallLine key={`${call.name}-${index}`} call={call} />
          ))}
          {chat.isStreaming && chat.progress && load ? (
            <ModelLoadPanel
              progress={chat.progress}
              load={load}
              backend={chat.backend}
            />
          ) : chat.isStreaming && chat.progress ? (
            <li className="assistant-tool assistant-tool-running" role="status">
              {chat.progress}...
            </li>
          ) : null}
        </ul>
      ) : null}
      {chat.error ? <p className="text-[maroon]">{chat.error}</p> : null}
      {!chat.available && chat.unavailableReason ? (
        <p className="text-[grey]">{chat.unavailableReason}</p>
      ) : null}
      {chat.available && chat.backend.kind === "rules" ? (
        <p className="text-[grey]" data-testid="chat-backend-notice">
          {chat.backend.reason}
        </p>
      ) : null}

      <form className="flex gap-1" onSubmit={submit}>
        <input
          type="text"
          className="min-w-0 flex-1"
          aria-label="Ask Clippy"
          placeholder="Ask Clippy..."
          value={draft}
          disabled={!chat.available || chat.isStreaming}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button
          type="submit"
          disabled={!chat.available || chat.isStreaming || draft.trim() === ""}
        >
          Send
        </button>
        {chat.isStreaming ? (
          <button
            type="button"
            title="Stop what Clippy is doing"
            onClick={vm.stopChat}
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={vm.newChat}
            disabled={chat.messages.length === 0}
          >
            New chat
          </button>
        )}
      </form>
    </section>
  );
}
