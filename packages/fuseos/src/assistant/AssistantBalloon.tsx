import type { FormEvent } from "react";
import { useEffect, useRef, useState } from "react";

import type { ChatMessage } from "../llm/llmChat";

import type { OfficeAssistantViewModel } from "./useOfficeAssistantViewModel";

function Message({ message }: { message: ChatMessage }) {
  return (
    <li
      className={message.role === "user" ? "assistant-user" : "assistant-atlas"}
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

  // Keep the newest turn in view.
  useEffect(() => {
    const element = log.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [chat.messages, chat.progress]);

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
          {chat.isStreaming && chat.progress ? (
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
          <button type="button" onClick={vm.stopChat}>
            Stop
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
