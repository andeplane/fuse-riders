import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "./style.css";
import QRCode from "qrcode";
import {
  createEndpoints,
  createRoom,
  memberToken,
  PeerTransport,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES } from "fuse-netcode";
import { BallRuntime } from "../online/runtime.js";
import { createRenderer } from "../render/arena.js";
import { Audio } from "./audio.js";
import { mountGame } from "./game-screen.js";
import { landing } from "./landing.js";
import { chosenMap, safeStore, session } from "./session.js";
import { installLifecycle } from "./lifecycle.js";
import { chosenAvatar } from "./avatars.js";
import { createRadio } from "./radio.js";

const root = document.querySelector<HTMLElement>("#app")!;
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}ball-bros/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
const store = safeStore(() => localStorage);
const muted = new URLSearchParams(location.search).has("mute");
const link = (query = "") =>
  endpoints.appUrl(`${query}${muted ? (query ? "&mute" : "?mute") : ""}`);
const navigate = (query = "") => {
  history.pushState(null, "", link(query));
  render();
};
let destroy = () => {};
let generation = 0;
function render() {
  const mounted = ++generation;
  destroy();
  destroy = () => {};
  root.replaceChildren();
  root.className = "";
  delete root.dataset.phase;
  const mode = session(location.search, store, memberToken);
  if (mode.kind === "landing" || mode.kind === "invalid") {
    const screen = landing(root, {
      store,
      create: () => createRoom(endpoints.apiUrl, fetch, "ball-bros"),
      navigate,
      active: () => generation === mounted,
    });
    if (mode.kind === "invalid")
      screen.error.textContent =
        "Invalid room code. Check your invite or create a new room.";
  } else {
    const online = mode.kind === "room" ? mode : undefined;
    const settings = {
      display: online?.shared ?? false,
      mapId: chosenMap(store),
    };
    destroy = mountGame(root, {
      online: online && {
        ...online,
        link: link(`?room=${online.code}`),
        displayLink: link(`?room=${online.code}&display=1`),
      },
      store,
      settings,
      qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 240 }),
      audio: new Audio(muted),
      radio: createRadio(
        document,
        import.meta.env.BASE_URL,
        new window.Audio(),
      ),
      renderer: (parent) => createRenderer(parent, import.meta.env.BASE_URL),
      runtime: (callbacks) =>
        new BallRuntime(
          callbacks,
          online
            ? {
                displayOnly: online.display,
                transport: (events) =>
                  new PeerTransport(online.code, online.token, events, {
                    apiUrl: endpoints.apiUrl,
                    gameId: "ball-bros",
                    maxFastBytes: MAX_PACKET_BYTES,
                  }),
              }
            : {},
          online?.code,
          settings,
          chosenAvatar(store),
        ),
      now: () => performance.now(),
      frame: (callback) => requestAnimationFrame(callback),
      cancelFrame: (id) => cancelAnimationFrame(id),
      events: window,
      home: () => navigate(),
      retry: render,
    });
  }
}
window.addEventListener("popstate", render);
installLifecycle(window, {
  dispose: () => {
    generation++;
    destroy();
  },
  restore: render,
});
render();
