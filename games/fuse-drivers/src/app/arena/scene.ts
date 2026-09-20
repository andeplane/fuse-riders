import Phaser from "phaser";
import type { FuseDriversView } from "../../game/game.js";
import { config } from "../../game/sim/config.js";
import type { RaceState } from "../../game/sim/race.js";
import { parseTrack, type Track } from "../../game/sim/track.js";
import { TRACK_DATA } from "../../game/tracks-data.js";
import { defaultAssetBase } from "./assets.js";
import { focusTruck, truckNames, type ArenaFrame } from "./frame.js";
import { HudScene } from "./hud-scene.js";
import { renderSnapshot } from "./interpolate.js";
import { RaceScene } from "./race-scene.js";

/** Tracks parse once per page: the maps are committed data, identical on every peer. */
const parsed = new Map<string, Track>();
function trackByName(name: string): Track | undefined {
  const cached = parsed.get(name);
  if (cached) return cached;
  const raw = TRACK_DATA[name];
  if (raw === undefined) return undefined;
  try {
    const track = parseTrack(raw, name);
    parsed.set(name, track);
    return track;
  } catch {
    // A map the bundle no longer carries is a missing picture, not a broken page.
    return undefined;
  }
}

export interface ArenaEngineOptions {
  /** Where the art is served from; ends with a slash. Defaults to `assets/` under the page's base. */
  assetBase?: string;
  /** Force the Canvas backend, for a device whose WebGL is unusable. */
  renderer?: "auto" | "canvas";
}

export interface ArenaEngine {
  /** Resolves once both scenes exist and the automatic loop has been stopped. */
  ready: Promise<void>;
  render(view: FuseDriversView, alpha: number, selfId?: string): void;
  destroy(): void;
}

/**
 * One Phaser game with two scenes and no loop of its own: the caller calls `render` once per animation
 * frame, and `game.step` draws exactly that frame. Phaser's input, audio and physics are all off, so the
 * page keeps every event and the arena only ever paints what the view it is handed says.
 */
export function createArena(
  canvas: HTMLCanvasElement,
  options: ArenaEngineOptions = {},
): ArenaEngine {
  let resolveReady!: () => void;
  const ready = new Promise<void>((resolve) => {
    resolveReady = resolve;
  });
  let booted = false;
  let destroyed = false;
  let pending = 2;
  const sceneReady = (): void => {
    pending--;
    if (pending > 0 || destroyed) return;
    // Phaser must not own the loop: from here the page's own frame loop drives every draw.
    game.loop.stop();
    booted = true;
    resolveReady();
  };
  const race = new RaceScene(
    options.assetBase ?? defaultAssetBase(),
    sceneReady,
  );
  const hud = new HudScene(sceneReady);
  const context =
    options.renderer === "canvas"
      ? null
      : canvas.getContext("webgl", { alpha: false, antialias: true });
  const game = new Phaser.Game({
    type: context ? Phaser.WEBGL : Phaser.CANVAS,
    canvas,
    backgroundColor: "#12100e",
    banner: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false, gamepad: false },
    render: { antialias: true, pixelArt: false, roundPixels: false },
    fps: { target: 60, smoothStep: false },
    // The HUD is laid out for this arcade screen; FIT letterboxes it into whatever box the page gives us.
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      expandParent: false,
      width: config.screen.width,
      height: config.screen.height,
      ...(canvas.parentElement ? { parent: canvas.parentElement } : {}),
    },
    scene: [race, hud],
  });

  /** The two newest races the page has handed over, newest last. */
  let previous: RaceState | undefined;
  let current: RaceState | undefined;
  let lastNow = 0;

  return {
    ready,
    render(view, alpha, selfId) {
      if (!booted || destroyed) return;
      const next = view.race;
      if (!next) return;
      const track = trackByName(next.trackName);
      if (!track) return;
      let newTick = true;
      if (!current || next.tick < current.tick) {
        // A first view, or a clock that moved back: there is nothing to interpolate from.
        previous = undefined;
      } else if (next.tick > current.tick) previous = current;
      else newTick = false;
      current = next;
      const between = previous ? Math.max(0, Math.min(1, alpha)) : 1;
      const frame: ArenaFrame = {
        view,
        race: next,
        previous,
        alpha: between,
        poses: renderSnapshot(previous, next, between),
        track,
        focus: focusTruck(view, next, selfId),
        newTick,
        names: truckNames(view, next.trucks.length),
      };
      race.paint(frame);
      hud.paint(frame);
      const now = performance.now();
      game.step(
        now,
        lastNow ? Math.min(50, Math.max(0, now - lastNow)) : 16.667,
      );
      lastNow = now;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      race.reset();
      game.destroy(false); // the caller owns the canvas element
      // The SceneManager needs its system scene to flush destruction; otherwise the next frame would.
      if (game.scene.isBooted) game.step(0, 0);
    },
  };
}
