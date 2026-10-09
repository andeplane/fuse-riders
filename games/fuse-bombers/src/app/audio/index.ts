import "./audio.css";
import type { RoundView, TickEvent } from "../../engine/index.js";
import { ROUND_EVENTS, ROUND_START } from "../../render/round-scene.js";
import {
  AudioDirector,
  mutedByQuery,
  type MusicKind,
  type StorageLike,
} from "./director.js";
import { WebAudioBackend } from "./web-backend.js";

export type { MusicKind } from "./director.js";

/** The part of a Phaser scene that `attachRound` uses. */
export interface RoundSceneLike {
  readonly events: {
    on(event: string, fn: (...args: never[]) => void): unknown;
    off(event: string, fn: (...args: never[]) => void): unknown;
    once(event: string, fn: () => void): unknown;
  };
}

export interface GameAudio {
  /** True with `?mute`: nothing plays, and the toggle and stored choice are left alone. */
  readonly disabled: boolean;
  readonly muted: boolean;
  /** Crossfades to a track (null fades out). Starts on the first key or tap if the browser still blocks audio. */
  music(kind: MusicKind | null): void;
  /** Mutes or unmutes everything and remembers the choice in localStorage. */
  setMuted(muted: boolean): void;
  /** Runs `listener` after every mute change; returns the unsubscribe. */
  onChange(listener: () => void): () => void;
  /**
   * Plays effects for a round scene's `ROUND_EVENTS`, the round track on `ROUND_START` and the sudden-death track
   * when the fuse burns out. Detaches itself when the scene shuts down (attach again after a restart); also
   * returns the detach.
   */
  attachRound(scene: RoundSceneLike): () => void;
  /** Adds the SOUND ON / SOUND OFF corner button (none with `?mute`). */
  mountToggle(parent?: HTMLElement): HTMLButtonElement | null;
}

const GESTURES = ["pointerdown", "pointerup", "keydown", "touchend"] as const;

function localStorageOrNone(): StorageLike | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined; // Blocked site data: mute is per page load then.
  }
}

export function createAudio(
  search: string = window.location.search,
): GameAudio {
  const disabled = mutedByQuery(search);
  const director = new AudioDirector(
    new WebAudioBackend(import.meta.env.BASE_URL),
    disabled ? undefined : localStorageOrNone(),
    disabled,
  );
  if (!disabled) {
    // Browsers keep audio blocked until a gesture; every gesture retries (iOS can suspend audio again later).
    const unlock = (): void => director.unlock();
    for (const type of GESTURES)
      window.addEventListener(type, unlock, { capture: true, passive: true });
    const onVisibility = (): void => director.setHidden(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    onVisibility();
  }

  return {
    disabled,
    get muted() {
      return director.muted;
    },
    music: (kind) => director.music(kind),
    setMuted: (muted) => director.setMuted(muted),
    onChange: (listener) => director.onChange(listener),
    attachRound(scene) {
      const onStart = (): void => director.roundStarted();
      const onEvents = (events: readonly TickEvent[], view: RoundView): void =>
        director.roundEvents(events, view);
      scene.events.on(ROUND_START, onStart);
      scene.events.on(ROUND_EVENTS, onEvents);
      let attached = true;
      const detach = (): void => {
        if (!attached) return;
        attached = false;
        scene.events.off(ROUND_START, onStart);
        scene.events.off(ROUND_EVENTS, onEvents);
        director.roundDetached();
      };
      scene.events.once("shutdown", detach);
      scene.events.once("destroy", detach);
      return detach;
    },
    mountToggle(parent = document.body) {
      if (disabled) return null;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "audio-toggle";
      const render = (): void => {
        button.textContent = director.muted ? "SOUND OFF" : "SOUND ON";
        button.setAttribute("aria-pressed", String(!director.muted));
      };
      // Not a touch-zone press for whoever plays in this corner.
      button.addEventListener("pointerdown", (event) =>
        event.stopPropagation(),
      );
      button.addEventListener("click", () => {
        director.setMuted(!director.muted);
        button.blur(); // Space or Enter must not toggle it again mid-game.
      });
      director.onChange(render);
      render();
      parent.append(button);
      return button;
    },
  };
}
