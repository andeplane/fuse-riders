import type { ChatEngine } from "../../llm/llmChat";

import type { Regular } from "./regulars";
import { systemPromptFor } from "./regulars";

export type ChatTurn = { nick: string; text: string };

export type BrainRequest = {
  regular: Regular;
  channel: string;
  userNick: string;
  /** The channel's recent lines, oldest first; the one being answered last. */
  history: readonly ChatTurn[];
};

/** What decides a regular's next line: the shared language model, or their canned lines. */
export interface RegularsBrain {
  /** Who is thinking, for the Status window ("the regulars are AI" or "canned"). */
  describe(): string;
  reply(request: BrainRequest, signal: AbortSignal): Promise<string | undefined>;
  dispose(): void;
}

/** Picks one of the regular's own lines; `random` makes it deterministic in tests. */
export function cannedLine(regular: Regular, random: () => number): string | undefined {
  if (regular.lines.length === 0) return undefined;
  return regular.lines[Math.floor(random() * regular.lines.length)] ?? regular.lines[0];
}

export function cannedBrain(random: () => number): RegularsBrain {
  return {
    describe: () => "canned lines (no language model in this browser)",
    reply: (request) => Promise.resolve(cannedLine(request.regular, random)),
    dispose: () => undefined,
  };
}

/** The model's reply cut down to one IRC line: first line, no `nick:` prefix or quotes, at most 300 chars. */
export function toIrcLine(text: string, nick: string): string | undefined {
  const first = text
    .trim()
    .split(/\r?\n/)
    .find((part) => part.trim().length > 0);
  if (!first) return undefined;
  const cleaned = first
    .trim()
    .replace(new RegExp(`^<?${nick.replace(/[^A-Za-z0-9]/g, ".")}>?:?\\s*`, "i"), "")
    .replace(/^["“']|["”']$/g, "")
    .replace(/[\x00-\x1f]/g, "")
    .trim();
  return cleaned.length === 0 ? undefined : cleaned.slice(0, 300);
}

/**
 * The regulars over the shared FuseOS chat engine (Clippy's model through web-llm). AI regulars ask the model;
 * the others, and everyone when the model fails or says nothing usable, use their canned lines. One reply is
 * generated at a time; the engine itself loads lazily on the first request.
 */
export function engineBrain(engine: ChatEngine, random: () => number): RegularsBrain {
  let busy = false;
  return {
    describe: () => {
      const backend = engine.backend();
      return backend.kind === "model" ? `${backend.label}, running in this browser` : "canned lines";
    },
    async reply(request, signal) {
      if (!request.regular.ai || busy) return cannedLine(request.regular, random);
      busy = true;
      try {
        let text = "";
        for await (const piece of engine.reply({
          system: systemPromptFor(request.regular, request.channel, request.userNick),
          messages: request.history.map((turn) => ({
            role: turn.nick === request.regular.nick ? ("assistant" as const) : ("user" as const),
            content: turn.nick === request.regular.nick ? turn.text : `<${turn.nick}> ${turn.text}`,
          })),
          signal,
          onProgress: () => undefined,
        })) {
          text += piece;
          if (text.length > 600) break;
        }
        return toIrcLine(text, request.regular.nick) ?? cannedLine(request.regular, random);
      } catch {
        return cannedLine(request.regular, random);
      } finally {
        busy = false;
      }
    },
    dispose: () => engine.dispose(),
  };
}
