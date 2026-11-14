import type { ChatBackend, ChatEngine, ReplyRequest } from "./llmChat";

/**
 * The rule-based assistant for browsers without WebGPU (and for a model that failed to load): a handful of
 * commands recognised by keywords, answered in Clippy's voice with the same tool markers a model would use, so the
 * desktop executes them through the one tool pipeline.
 */
export type IntentTarget = {
  /** What `[open:<id>]` takes. */
  id: string;
  name: string;
  /** Other words the user may call it, e.g. "settings" for the Control Panel. */
  aliases?: readonly string[];
};

export type IntentCatalog = {
  /** Everything that can be opened, Fuse games first so the games list reads naturally. */
  targets: readonly IntentTarget[];
  /** The Fuse games among the targets, for "which games are there". */
  gameNames: readonly string[];
};

export type MusicAction = "play" | "pause" | "stop" | "next" | "previous";

export type Intent =
  | { kind: "open"; target: IntentTarget }
  | { kind: "music"; action: MusicAction }
  | { kind: "games" }
  | { kind: "help" }
  | { kind: "hello" }
  | { kind: "unknown" };

export const NO_WEBGPU_REASON =
  "This browser has no WebGPU, so Clippy follows simple commands instead of running a model. Chrome or Edge on a computer gives you the full Clippy.";

const HELP_TEXT =
  'I follow simple commands here: "open Fuseball", "play music", "next track", "open settings" or "which games are there".';

function words(text: string): string {
  return ` ${text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

function has(normalized: string, phrase: string): boolean {
  return normalized.includes(` ${words(phrase).trim()} `);
}

function hasAny(normalized: string, phrases: readonly string[]): boolean {
  return phrases.some((phrase) => has(normalized, phrase));
}

/** The target named in the text; the longest name wins so "Fuse Riders" beats "Fuse". */
export function findTarget(
  text: string,
  targets: readonly IntentTarget[],
): IntentTarget | undefined {
  const normalized = words(text);
  let best: { target: IntentTarget; length: number } | undefined;
  for (const target of targets) {
    for (const candidate of [
      target.name,
      target.id,
      ...(target.aliases ?? []),
    ]) {
      const phrase = words(candidate).trim();
      if (phrase === "" || !has(normalized, phrase)) continue;
      if (!best || phrase.length > best.length)
        best = { target, length: phrase.length };
    }
  }
  return best?.target;
}

const MUSIC_WORDS = ["music", "song", "songs", "track", "tunes", "soundtrack"];

export function parseIntent(text: string, catalog: IntentCatalog): Intent {
  const normalized = words(text);
  if (normalized.trim() === "") return { kind: "unknown" };
  if (hasAny(normalized, ["next track", "next song", "skip"]))
    return { kind: "music", action: "next" };
  if (hasAny(normalized, ["previous track", "previous song", "last track"]))
    return { kind: "music", action: "previous" };
  if (hasAny(normalized, ["pause"])) return { kind: "music", action: "pause" };
  if (has(normalized, "stop") && hasAny(normalized, MUSIC_WORDS))
    return { kind: "music", action: "stop" };
  if (has(normalized, "play") && hasAny(normalized, MUSIC_WORDS))
    return { kind: "music", action: "play" };
  const target = findTarget(text, catalog.targets);
  if (target) return { kind: "open", target };
  if (
    hasAny(normalized, [
      "which games",
      "what games",
      "list games",
      "list the games",
      "what can i play",
      "games are there",
    ])
  )
    return { kind: "games" };
  if (
    hasAny(normalized, ["help", "what can you do", "tip", "tips", "commands"])
  )
    return { kind: "help" };
  if (
    hasAny(normalized, ["hello", "hi", "hey", "good morning", "good evening"])
  )
    return { kind: "hello" };
  return { kind: "unknown" };
}

/** Clippy's answer to an intent, markers included. */
export function intentReply(intent: Intent, catalog: IntentCatalog): string {
  switch (intent.kind) {
    case "open":
      return `Opening ${intent.target.name}! [open:${intent.target.id}]`;
    case "music":
      return `${
        {
          play: "Winamp coming right up!",
          pause: "Pausing the music.",
          stop: "Stopping the music.",
          next: "Skipping to the next track.",
          previous: "Back to the previous track.",
        }[intent.action]
      } [music:${intent.action}]`;
    case "games":
      return catalog.gameNames.length === 0
        ? "No Fuse games are installed on this desktop yet."
        : `You can play ${catalog.gameNames.join(", ")}. Say "open" and a name and off we go!`;
    case "help":
      return HELP_TEXT;
    case "hello":
      return "Hi there! Ready to play? Tell me which game to open.";
    case "unknown":
      return `I'm not sure what you mean. ${HELP_TEXT}`;
  }
}

/** A chat engine that answers instantly from the rules; `reason` tells the balloon why there is no model. */
export function createIntentEngine(
  catalog: IntentCatalog,
  reason: string,
): ChatEngine {
  const backend: ChatBackend = { kind: "rules", reason };
  return {
    backend: () => backend,
    async *reply(request: ReplyRequest) {
      const last = [...request.messages]
        .reverse()
        .find((message) => message.role === "user");
      yield intentReply(parseIntent(last?.content ?? "", catalog), catalog);
    },
    dispose: () => undefined,
  };
}
