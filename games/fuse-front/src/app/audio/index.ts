import { el } from "fuse-ui";
import {
  FrontAudio,
  type AudioKeys,
  type AudioStore,
  type Channel,
  type Repeat,
} from "./director.js";
import { WebAudioBackend } from "./web-backend.js";

const GESTURES = ["pointerdown", "keydown", "touchend"] as const;

/**
 * The page's sound, made once: Web Audio unlocked by every user gesture (browsers hold it silent until one, and a
 * phone can suspend it again), silent while the tab is hidden. `?mute` (`muted`) silences it without reading or
 * writing the stored choices. The counters a smoke test reads go on `debug`'s dataset twice a second.
 */
export function createAudio(
  store: AudioStore,
  keys: AudioKeys,
  muted: boolean,
  debug: HTMLElement,
): { audio: FrontAudio; toggles: () => HTMLElement[] } {
  const backend = new WebAudioBackend();
  const every: Repeat = (tick, ms) => void setInterval(tick, ms);
  const audio = new FrontAudio(backend, store, keys, muted, every);
  // Every button's press clicks (unless the press sounded already); a hover over one ticks softly.
  const button = (target: EventTarget | null) =>
    target instanceof Element ? target.closest("button") : null;
  document.addEventListener("click", (event) => {
    if (button(event.target)) audio.ui("click");
  });
  document.addEventListener("pointerover", (event) => {
    const over = button(event.target);
    if (
      over &&
      over !== button(event.relatedTarget) &&
      event.pointerType === "mouse"
    )
      audio.ui("hover");
  });
  every(() => {
    const { contexts, voices } = backend.stats;
    const values = {
      audio: audio.state,
      cuesHeard: audio.heard,
      cuesPlayed: audio.played,
      audioVoices: voices,
      audioContexts: contexts,
      music: audio.moodNow ?? "",
      musicMs: Math.round(audio.musicMs),
    };
    // Written only on change: the attributes are a smoke test's, not worth a DOM mutation each time.
    for (const [key, value] of Object.entries(values))
      if (debug.dataset[key] !== String(value))
        debug.dataset[key] = String(value);
  }, 500);
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
  };
}
