import QRCode from "qrcode";
import {
  PeerTransport,
  createEndpoints,
  createRoom,
  validRoomCode,
} from "fuse-network-fe";
import { MAX_PACKET_BYTES, uuid } from "fuse-netcode";
import { createAppPortal } from "fuse-ui";
import { mountFuseCraft } from "./app.js";
import { createBrowserMapRepository } from "./map-repository.js";
import { createPreferencesStore } from "./preferences.js";
import { createOnlineSession, createSession } from "../online/session.js";
import { spriteUrls } from "../render/sprites.js";
import {
  createBuildingSprites,
  createBrowserSpriteRasterizer,
} from "../render/sprite-raster.js";
import { createCameraFactory } from "../render/camera.js";
import { createWebGlLightRenderer } from "../render/light-canvas.js";
import { createBrowserAudio } from "./audio.js";
import "@fontsource/press-start-2p/latin.css";
import "fuse-ui/tokens.css";
import "fuse-ui/components.css";
import "fuse-ui/portal.css";
import "./fuse-craft.css";

const GAME = "fuse-craft";
const endpoints = createEndpoints(
  {
    basePath: `${import.meta.env.BASE_URL}${GAME}/`,
    apiOrigin: import.meta.env.VITE_API_ORIGIN,
  },
  location.origin,
);
/** Storage that never throws; a browser that refuses it keeps values for this page's life. */
const memory = new Map<string, string>();
const store = {
  get(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
};
const secret = () => uuid().replaceAll("-", "") + uuid().replaceAll("-", "");
/** The page address with a room (or none), keeping the preview flags. */
const address = (code: string | null) => {
  const query = new URLSearchParams(location.search);
  if (code) query.set("room", code);
  else query.delete("room");
  const text = query.toString();
  return `${location.pathname}${text ? `?${text}` : ""}`;
};
const initialRoom = new URLSearchParams(location.search)
  .get("room")
  ?.trim()
  .toUpperCase();

const root = document.getElementById("app");
if (!root) throw new Error("Fuse Craft mount point is missing");
const buildingSprites = createBuildingSprites(
  spriteUrls,
  createBrowserSpriteRasterizer(
    document,
    () => new Image(),
    (blob) => URL.createObjectURL(blob),
  ),
);

mountFuseCraft(root, {
  // The shared portal of every Fuse game, first in each header.
  portal: () =>
    createAppPortal({
      document,
      current: "fuse-craft",
      base: import.meta.env.BASE_URL,
      search: location.search,
    }).element,
  maps: createBrowserMapRepository(fetch.bind(globalThis)),
  preferences: createPreferencesStore(localStorage),
  createSession: (map, slot, mode, settings, options) =>
    createSession(map, slot, mode, settings, undefined, options),
  online: {
    async createRoom() {
      const room = await createRoom(endpoints.apiUrl, fetch, GAME).catch(
        (error: unknown) => {
          const message =
            error instanceof Error ? error.message : String(error);
          throw new Error(
            /unknown game/i.test(message)
              ? "Online rooms are not open for Fuse Craft on this server yet."
              : message,
          );
        },
      );
      // Only the creator's browser holds this token, which makes it the host.
      store.set(`${GAME}-room-${room.code}`, room.token);
      return { code: room.code };
    },
    openRoom(code) {
      let token =
        store.get(`${GAME}-room-${code}`) ?? store.get(`${GAME}-peer-${code}`);
      if (!token) {
        // A joiner keeps one token per room, so a refresh is the same member.
        token = secret();
        store.set(`${GAME}-peer-${code}`, token);
      }
      const member = token;
      return createOnlineSession(
        code,
        (events) =>
          new PeerTransport(code, member, events, {
            apiUrl: endpoints.apiUrl,
            gameId: GAME,
            maxFastBytes: MAX_PACKET_BYTES,
          }),
      );
    },
    validCode: validRoomCode,
    roomLink: (code) => endpoints.appUrl(`?room=${code}`),
    enterRoom: (code) => history.replaceState(null, "", address(code)),
    leaveRoom: () => history.replaceState(null, "", address(null)),
    qr: (text) => QRCode.toDataURL(text, { margin: 1, width: 280 }),
    savedName: () => store.get(`${GAME}-player-name`) ?? "",
    saveName: (name) => store.set(`${GAME}-player-name`, name),
  },
  ...(initialRoom ? { initialRoom } : {}),
  audio: createBrowserAudio(new URLSearchParams(location.search).has("mute")),
  forcedMute: new URLSearchParams(location.search).has("mute"),
  sprites: spriteUrls,
  buildingSprites: {
    resolve: (scale, slots) =>
      buildingSprites.resolve(scale * window.devicePixelRatio, slots),
  },
  createCamera: createCameraFactory({
    observeResize(element, callback) {
      const observer = new ResizeObserver(callback);
      observer.observe(element);
      return () => observer.disconnect();
    },
    requestFrame: (callback) => requestAnimationFrame(callback),
    cancelFrame: (handle) => cancelAnimationFrame(handle),
  }),
  ...(document.fullscreenEnabled
    ? {
        fullscreen: {
          active: () => document.fullscreenElement !== null,
          toggle() {
            if (document.fullscreenElement)
              void document.exitFullscreen().catch(() => {});
            else
              void document.documentElement.requestFullscreen().catch(() => {});
          },
          onChange(callback: () => void) {
            document.addEventListener("fullscreenchange", callback);
            return () =>
              document.removeEventListener("fullscreenchange", callback);
          },
        },
      }
    : {}),
  // Light is soft, so one canvas pixel per CSS pixel is enough; on dense
  // screens this quarters the GPU fill cost and the browser upscales smoothly.
  createLightRenderer: (canvas) =>
    createWebGlLightRenderer(canvas, () =>
      Math.min(1, window.devicePixelRatio),
    ),
  debug: new URLSearchParams(location.search).has("debug"),
  animationClock: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
});
