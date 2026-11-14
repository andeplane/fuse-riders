import { createContext } from 'react';

/** The Office Assistant's Options: per browser, never shared through links. */
export type AssistantOptions = {
  /** Offer tips in the balloon. */
  showTips: boolean;
  /** Tell in the balloon what the assistant does while it works. */
  narrate: boolean;
  /** Play the character animations; off keeps the clip still. */
  animate: boolean;
  /** Play the classic sounds with the animations. */
  sounds: boolean;
  /** The first-visit greeting has been answered. */
  greeted: boolean;
};

export const DEFAULT_ASSISTANT_OPTIONS: AssistantOptions = { showTips: true, narrate: true, animate: true, sounds: false, greeted: false };

export interface AssistantOptionsStore {
  get(): AssistantOptions;
  set(options: AssistantOptions): void;
}

export const ASSISTANT_OPTIONS_KEY = 'fuseos.assistant';

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

export function parseAssistantOptions(raw: string | null | undefined): AssistantOptions {
  if (!raw) return DEFAULT_ASSISTANT_OPTIONS;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_ASSISTANT_OPTIONS;
    const record: Record<string, unknown> = { ...parsed };
    return {
      showTips: flag(record.showTips, DEFAULT_ASSISTANT_OPTIONS.showTips),
      narrate: flag(record.narrate, DEFAULT_ASSISTANT_OPTIONS.narrate),
      animate: flag(record.animate, DEFAULT_ASSISTANT_OPTIONS.animate),
      sounds: flag(record.sounds, DEFAULT_ASSISTANT_OPTIONS.sounds),
      greeted: flag(record.greeted, DEFAULT_ASSISTANT_OPTIONS.greeted),
    };
  } catch {
    return DEFAULT_ASSISTANT_OPTIONS;
  }
}

/** localStorage backed store; every access is guarded because storage can be unavailable. */
export class LocalStorageAssistantOptionsStore implements AssistantOptionsStore {
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeLocalStorage()) {}

  get(): AssistantOptions {
    try {
      return parseAssistantOptions(this.storage?.getItem(ASSISTANT_OPTIONS_KEY));
    } catch {
      return DEFAULT_ASSISTANT_OPTIONS;
    }
  }

  set(options: AssistantOptions): void {
    try {
      this.storage?.setItem(ASSISTANT_OPTIONS_KEY, JSON.stringify(options));
    } catch {
      // Storage blocked or full: the options simply are not remembered.
    }
  }
}

function safeLocalStorage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export class MemoryAssistantOptionsStore implements AssistantOptionsStore {
  constructor(private options: AssistantOptions = DEFAULT_ASSISTANT_OPTIONS) {}
  get(): AssistantOptions {
    return this.options;
  }
  set(options: AssistantOptions): void {
    this.options = options;
  }
}

export const AssistantOptionsStoreContext = createContext<AssistantOptionsStore>(new LocalStorageAssistantOptionsStore());
