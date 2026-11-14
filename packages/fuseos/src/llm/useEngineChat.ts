import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ChatBackend,
  ChatEngine,
  ChatHandle,
  ChatMessage,
  ChatOptions,
  LlmMessage,
} from "./llmChat";
import { parseToolMarkers, runToolCalls, visibleReplyText } from "./tools";

/** How many earlier lines a model sees; the small models have a 4k context and the desktop prompt takes some. */
export const HISTORY_LINES = 8;

/**
 * A `ChatHandle` over any `ChatEngine`: owns the conversation, streams the reply into the last message with the
 * tool markers hidden, then runs the tools the finished reply asked for. Changing the engine starts a new chat.
 */
export function useEngineChat(
  engine: ChatEngine,
  options: ChatOptions,
): ChatHandle {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<ChatBackend>(() => engine.backend());
  const controller = useRef<AbortController | null>(null);
  const history = useRef<ChatMessage[]>([]);
  const seq = useRef(0);
  const latest = useRef(options);
  latest.current = options;

  const replace = useCallback((next: ChatMessage[]) => {
    history.current = next;
    setMessages(next);
  }, []);

  useEffect(() => {
    controller.current?.abort();
    controller.current = null;
    replace([]);
    setError(null);
    setProgress(null);
    setStreaming(false);
    setBackend(engine.backend());
  }, [engine, replace]);

  const nextId = () => {
    seq.current += 1;
    return `m${seq.current}`;
  };

  const send = useCallback(
    async (text: string) => {
      if (controller.current) return;
      const abort = new AbortController();
      controller.current = abort;
      const tools = latest.current.tools ?? [];
      const earlier = history.current;
      const replyId = nextId();
      const patchReply = (patch: Partial<ChatMessage>) =>
        replace(
          history.current.map((message) =>
            message.id === replyId ? { ...message, ...patch } : message,
          ),
        );
      replace([
        ...earlier,
        { id: nextId(), role: "user", text },
        { id: replyId, role: "assistant", text: "", isStreaming: true },
      ]);
      setError(null);
      setStreaming(true);
      setProgress("Thinking");

      const system = [
        latest.current.getSystemPrompt?.(),
        `Current desktop: ${latest.current.getAppContext()}`,
      ]
        .filter((section) => section)
        .join("\n\n");
      const lines: LlmMessage[] = [
        ...earlier
          .filter((message) => message.text !== "")
          .slice(-HISTORY_LINES)
          .map((message) => ({ role: message.role, content: message.text })),
        { role: "user", content: text },
      ];

      let raw = "";
      try {
        const reply = engine.reply({
          system,
          messages: lines,
          signal: abort.signal,
          onProgress: (report) => {
            if (!abort.signal.aborted) setProgress(report);
          },
        });
        for await (const delta of reply) {
          if (abort.signal.aborted) break;
          raw += delta;
          setProgress(null);
          patchReply({ text: visibleReplyText(raw, tools, true) });
        }
        const visible = visibleReplyText(raw, tools);
        const invocations = abort.signal.aborted
          ? []
          : parseToolMarkers(raw, tools);
        patchReply({
          text:
            visible === "" && invocations.length === 0 && !abort.signal.aborted
              ? "..."
              : visible,
          isStreaming: false,
        });
        setProgress(null);
        if (invocations.length > 0)
          await runToolCalls(invocations, tools, (event) =>
            latest.current.onToolCall?.(event),
          );
      } catch (caught) {
        if (!abort.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : "Clippy could not answer.",
          );
        const visible = visibleReplyText(raw, tools);
        if (visible === "")
          replace(history.current.filter((message) => message.id !== replyId));
        else patchReply({ text: visible, isStreaming: false });
      } finally {
        // A new engine may have reset the chat meanwhile; only the turn that still owns it ends it.
        if (controller.current === abort) {
          setBackend(engine.backend());
          controller.current = null;
          setProgress(null);
          setStreaming(false);
        }
      }
    },
    [engine, replace],
  );

  const reset = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    replace([]);
    setError(null);
    setProgress(null);
    setStreaming(false);
  }, [replace]);

  const abort = useCallback(() => {
    controller.current?.abort();
  }, []);

  return useMemo(
    () => ({
      messages,
      send,
      isStreaming,
      progress,
      error,
      backend,
      reset,
      abort,
    }),
    [messages, send, isStreaming, progress, error, backend, reset, abort],
  );
}
