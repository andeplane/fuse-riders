import { createAttractGame } from "fuse-netcode";
import { demoCanvas } from "fuse-ui";
import { diceGame, DEFAULT_SETTINGS } from "../game/index.js";
export function createAttract(host: HTMLElement) {
  const demo = createAttractGame(diceGame, DEFAULT_SETTINGS, { bots: 4 });
  const canvas = demoCanvas(host),
    ctx = canvas.getContext("2d")!;
  const dots: Record<number, readonly [number, number][]> = {
    1: [[0, 0]],
    2: [
      [-1, -1],
      [1, 1],
    ],
    3: [
      [-1, -1],
      [0, 0],
      [1, 1],
    ],
    4: [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ],
    5: [
      [-1, -1],
      [1, -1],
      [0, 0],
      [-1, 1],
      [1, 1],
    ],
    6: [
      [-1, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [1, 1],
    ],
  };
  return {
    advance: demo.advance,
    tick: demo.tick,
    render(now: number) {
      const view = demo.view();
      ctx.fillStyle = "#081728";
      ctx.fillRect(0, 0, 960, 600);
      const n = view.lastRoll?.value ?? 1,
        angle = Math.sin(now / 700) * 0.08;
      ctx.save();
      ctx.translate(480, 300);
      ctx.rotate(angle);
      ctx.fillStyle = "#18dbeb";
      ctx.beginPath();
      ctx.roundRect(-95, -95, 190, 190, 24);
      ctx.fill();
      ctx.fillStyle = "#061323";
      for (const [x, y] of dots[n]!) {
        ctx.beginPath();
        ctx.arc(x * 53, y * 53, 13, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      ctx.font = "22px monospace";
      ctx.textAlign = "center";
      view.players.forEach((player, index) => {
        const x = 160 + index * 210;
        ctx.fillStyle = player.id === view.currentId ? "#f6d962" : "#88aac5";
        ctx.fillText(player.name, x, 110);
        ctx.font = "bold 40px monospace";
        ctx.fillText(String(player.score), x, 165);
        ctx.font = "22px monospace";
      });
      ctx.fillStyle = "#e8f5ff";
      ctx.fillText(`THIS TURN  ${view.turnTotal}`, 480, 470);
    },
    dispose() {
      canvas.remove();
    },
  };
}
