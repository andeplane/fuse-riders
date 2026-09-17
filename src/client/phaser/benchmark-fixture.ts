import {
  createGame,
  addPlayer,
  toSnapshot,
  SLOT_COLORS,
} from "../../engine/game.js";
import { AVATARS } from "../../shared/avatars.js";
import type { WorldView } from "../../engine/view.js";
/** Synthetic reproducible visual stress, not a physics or network benchmark. */
export function visualFixture(tick: number): WorldView {
  const game = createGame("renderer-fixture", 42);
  for (let p = 0; p < 5; p++)
    addPlayer(game, {
      id: `p${p}`,
      name: `RIDER ${p + 1}`,
      slot: p,
      color: SLOT_COLORS[p],
      avatarId: AVATARS[p].id,
    });
  const state = toSnapshot(game);
  const phase = tick / 20;
  return {
    ...state,
    tick,
    round: 1,
    phase: "playing",
    boundaryInset: 35,
    players: state.players.map((player, p) => {
      const cx = 260 + (p % 3) * 480,
        cy = 250 + Math.floor(p / 3) * 390,
        r = 155;
      const angle = phase * 0.6 + p;
      return {
        ...player,
        alive: true,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        angle: angle + Math.PI / 2,
        shielded: p === 0,
        drunkUntilTick: p === 1 ? tick + 60 : 0,
        inkUntilTick: 0,
        trail: Array.from({ length: 160 }, (_, i) => {
          const a = angle - (160 - i) * 0.012;
          return {
            x1: cx + Math.cos(a) * r,
            y1: cy + Math.sin(a) * r,
            x2: cx + Math.cos(a + 0.012) * r,
            y2: cy + Math.sin(a + 0.012) * r,
            createdTick: tick - 160 + i,
            expiresAtTick: tick + i,
          };
        }),
      };
    }),
    bombs: Array.from({ length: 24 }, (_, i) => ({
      id: i,
      ownerId: `p${i % 5}`,
      x: 100 + ((i * 163 + phase * 50) % 1400),
      y: 80 + ((i * 127) % 740),
      launchX: 100,
      launchY: 100,
      launchedTick: tick - 15,
      landsAtTick: tick - 5,
      explodeAtTick: tick + 20,
      blastRange: 90,
      flightPath: [],
      ...(i % 3 === 0 ? { shell: { vx: 200, vy: 50, gun: i % 2 === 0 } } : {}),
    })),
    blasts: Array.from({ length: 5 }, (_, i) => ({
      bombId: 1000 + Math.floor(tick / 12) * 5 + i,
      circle: { x: 220 + i * 270, y: 450, radius: 70 + i * 12 },
      expiresAtTick: tick + 8 - (tick % 12),
    })).filter((b) => b.expiresAtTick > tick),
    pickups: ["power", "triple", "five", "beer", "target", "shell"].map(
      (type, i) => ({
        id: i,
        type: type as WorldView["pickups"][number]["type"],
        x: 180 + i * 240,
        y: 780,
        expiresAtTick: tick + 100,
      }),
    ),
  };
}
