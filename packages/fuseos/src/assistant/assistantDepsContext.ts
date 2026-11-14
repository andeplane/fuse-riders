import { createContext } from "react";

import type { ChatHandle, ChatOptions } from "../llm/llmChat";
import { useNoChat } from "../llm/llmChat";
import { publicUrl } from "../retro/publicUrl";

import type { SpriteAgent } from "./spritePlayer";
import { isSpriteAgent } from "./spritePlayer";

export type { ChatHandle, ChatOptions } from "../llm/llmChat";

/** Browser, asset, clock and chat dependencies of the Office Assistant, injected so tests stay deterministic and offline. */
export type AssistantDeps = {
  /** Loads the Clippy frame table (public/fuseos/clippy/agent.json). */
  loadAgent: () => Promise<SpriteAgent>;
  /** Loads the sounds as data URIs by id (public/fuseos/clippy/sounds.json). */
  loadSounds: () => Promise<Record<string, string>>;
  /** URL of the sprite sheet. */
  spriteUrl: string;
  playSound: (dataUrl: string) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (handle: number) => void;
  /** Uniform random number in [0, 1). */
  random: () => number;
  /** The chat hook; `useNoChat` until a model is wired in. */
  useChat: (options: ChatOptions) => ChatHandle;
  /** Whether a model can answer at all; false shows `unavailableReason` instead of the input. */
  chatAvailable: boolean;
};

export const CLIPPY_ASSETS = "fuseos/clippy";

function assetUrl(path: string): string {
  return publicUrl(path, import.meta.env.BASE_URL, document.baseURI);
}

async function fetchJson(url: string): Promise<unknown> {
  const response = await fetch(url);
  if (!response.ok)
    throw new Error(`Could not load ${url}: ${response.status}`);
  return response.json();
}

function isSoundMap(value: unknown): value is Record<string, string> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((sound) => typeof sound === "string")
  );
}

export const defaultAssistantDeps: AssistantDeps = {
  loadAgent: async () => {
    const data = await fetchJson(assetUrl(`${CLIPPY_ASSETS}/agent.json`));
    if (!isSpriteAgent(data))
      throw new Error(
        `${CLIPPY_ASSETS}/agent.json is not a Clippy frame table`,
      );
    return data;
  },
  loadSounds: async () => {
    const data = await fetchJson(assetUrl(`${CLIPPY_ASSETS}/sounds.json`));
    return isSoundMap(data) ? data : {};
  },
  spriteUrl: assetUrl(`${CLIPPY_ASSETS}/map.png`),
  playSound: (dataUrl) => {
    void new Audio(dataUrl).play().catch(() => undefined);
  },
  setTimeout: (callback, ms) => window.setTimeout(callback, ms),
  clearTimeout: (handle) => window.clearTimeout(handle),
  random: () => Math.random(),
  useChat: useNoChat,
  chatAvailable: false,
};

export const AssistantDepsContext =
  createContext<AssistantDeps>(defaultAssistantDeps);
