import { demoCanvas } from "fuse-ui";
import {
  BATTLE_MODE,
  TICK_MS,
  createWorld,
  stepWorld,
  toView,
  type Steps,
  type World,
  type WorldView,
} from "../engine/index.js";
import { createScene } from "../render/scene.js";
import { LIBRARY } from "../songs.js";

/** How long the demo stays on one song, in song milliseconds. */
const STAY_MS = 24000;
/** The AI players of the demo, by the chart each plays. */
const CHARTS = [1, 2, 3];
const NAMES = ["METRONOME", "ARPEGGIO", "SIDECHAIN"];

export const browserCanvas = (width: number, height: number) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * The menu's background: three AI players in a silent battle on the songs in turn, with the real engine and the real
 * renderer. Nothing here touches a room, an account, storage or the sounds.
 */
export function createAttract(host: HTMLElement) {
  const scene = createScene(demoCanvas(host), {
    createCanvas: browserCanvas,
  });
  let index = 0,
    ticks = 0,
    world: World | undefined,
    view: WorldView | undefined,
    steps: Steps[] = [],
    until = 0,
    at = 0;
  const begin = (next: number) => {
    const songs = LIBRARY.songs;
    if (!songs.length) return;
    index = next % songs.length;
    const song = songs[index]!;
    world = createWorld(
      LIBRARY,
      song.id,
      BATTLE_MODE,
      0x5eed + index,
      CHARTS.map((chart, slot) => ({ id: `demo-${slot}`, bot: true, chart })),
      1500,
    );
    if (!world) return;
    // Straight into the song's busy part: the demo is a picture, not a performance.
    const from = Math.max(0, song.sampleStart * 1000 - 2000);
    while (world.ms < from && world.phase !== "over")
      stepWorld(LIBRARY, world, []);
    until = world.ms + STAY_MS;
    view = toView(LIBRARY, world);
    steps = view.players.flatMap(
      (player) => LIBRARY.steps(song.id, player.chart) ?? [],
    );
  };
  begin(0);
  return {
    advance() {
      ticks++;
      if (!world) return;
      stepWorld(LIBRARY, world, []);
      if (world.phase === "over" || world.ms >= until) begin(index + 1);
      else view = toView(LIBRARY, world);
      at = 0;
    },
    tick: () => ticks,
    render(now: number) {
      if (!view) return;
      if (!at) at = now;
      // Between two demo ticks the notes keep scrolling, so they move on every frame.
      const songMs = view.ms + Math.min(TICK_MS, now - at);
      const timing = LIBRARY.timing(view.song);
      const beat = timing?.beatAt(songMs / 1000) ?? 0;
      scene.draw(view, {
        songMs,
        beat,
        bpm: timing?.bpmAt(beat) ?? 120,
        steps,
        names: NAMES,
        local: -1,
        speed: 1.5,
        down: false,
        title: "",
        chartNames: [],
        itemKey: "",
      });
    },
    dispose: () => scene.destroy(),
  };
}
