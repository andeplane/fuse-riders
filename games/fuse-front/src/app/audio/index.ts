import { el } from "fuse-ui";
import {
  FrontAudio,
  type AudioKeys,
  type AudioStore,
  type Channel,
} from "./director.js";
import { WebAudioBackend } from "./web-backend.js";

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/**
 * The page's sound, made once: Web Audio unlocked by every user gesture (browsers hold it silent until one, and a
 * phone can suspend it again), silent while the tab is hidden. `?mute` (`muted`) silences it without reading or
 * writing the stored choices. `debug` writes the counters a smoke test reads onto `target`'s dataset.
 */
export function createAudio(
  store: AudioStore,
  keys: AudioKeys,
  muted: boolean,
): {
  audio: FrontAudio;
  toggles: () => HTMLElement[];
  debug: (target: HTMLElement) => void;
} {
  const backend = new WebAudioBackend();
  const audio = new FrontAudio(backend, store, keys, muted);
  if (!muted) {
    for (const type of GESTURES)
      window.addEventListener(type, () => audio.unlock(), {
        capture: true,
        passive: true,
      });
    document.addEventListener("visibilitychange", () =>
      audio.hide(document.hidden),
    );
  }
  const toggle = (label: string, channel: Channel) => {
    const button = el("button", "", "ff-sound");
    button.type = "button";
    const show = () => {
      const on = audio.enabled(channel);
      button.textContent = `${label} ${on ? "ON" : "OFF"}`;
      button.setAttribute("aria-pressed", String(on));
    };
    button.disabled = muted;
    if (muted) button.title = "Silenced by ?mute";
    button.onclick = () => {
      audio.set(channel, !audio.enabled(channel));
      show();
      button.blur(); // Space follows the hero; it never toggles this again.
    };
    show();
    return button;
  };
  return {
    audio,
    toggles: () => [toggle("♫ MUSIC", "music"), toggle("SFX", "effects")],
    debug(target) {
      const { contexts, voices } = backend.stats;
      const values = {
        audio: audio.state,
        cuesHeard: audio.heard,
        cuesPlayed: audio.played,
        audioVoices: voices,
        audioContexts: contexts,
      };
      // Written only on change: the attributes are a smoke test's, not worth a DOM mutation every frame.
      for (const [key, value] of Object.entries(values))
        if (target.dataset[key] !== String(value))
          target.dataset[key] = String(value);
    },
  };
}
