import { mountNeuralDefence } from "./app.js";
import { createBrowserMapRepository } from "./map-repository.js";
import { createPreferencesStore } from "./preferences.js";
import { createSession } from "../online/session.js";
import { spriteUrls } from "../render/sprites.js";
import { createCameraFactory } from "../render/camera.js";
import { createBrowserAudio } from "./audio.js";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "./neural-defence.css";

const root = document.getElementById("app");
if (!root) throw new Error("Neural Defence mount point is missing");

mountNeuralDefence(root, {
  maps: createBrowserMapRepository(fetch.bind(globalThis)),
  preferences: createPreferencesStore(localStorage),
  createSession,
  audio: createBrowserAudio(new URLSearchParams(location.search).has("mute")),
  forcedMute: new URLSearchParams(location.search).has("mute"),
  sprites: spriteUrls,
  createCamera: createCameraFactory({
    observeResize(element, callback) {
      const observer = new ResizeObserver(callback);
      observer.observe(element);
      return () => observer.disconnect();
    },
  }),
  debug: new URLSearchParams(location.search).has("debug"),
  animationClock: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});
