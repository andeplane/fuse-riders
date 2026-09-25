import { mountNeuralDefence } from "./app.js";
import { createBrowserMapRepository } from "./map-repository.js";
import { createPreferencesStore } from "./preferences.js";
import { createSession } from "../online/session.js";
import { spriteUrls } from "../render/sprites.js";
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
  sprites: spriteUrls,
  debug: new URLSearchParams(location.search).has("debug"),
  animationClock: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});
