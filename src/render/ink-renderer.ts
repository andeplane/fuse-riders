import type { WorldView } from "../engine/view.js";

let layer: HTMLCanvasElement | undefined;

/** Fog is a display effect only; unaffected riders retain a clear nearby area. */
export function drawInkClouds(
  ctx: CanvasRenderingContext2D,
  snapshot: WorldView,
  tick: number,
): void {
  const affected = snapshot.players.filter(
    (player) => player.alive && player.inkUntilTick > tick,
  );
  if (!affected.length) return;
  layer ??= document.createElement("canvas");
  if (layer.width !== snapshot.width || layer.height !== snapshot.height) {
    layer.width = snapshot.width;
    layer.height = snapshot.height;
  }
  const fog = layer.getContext("2d")!;
  fog.clearRect(0, 0, layer.width, layer.height);
  fog.globalCompositeOperation = "source-over";
  for (const player of affected) {
    fog.fillStyle = "#100c1c";
    fog.beginPath();
    fog.arc(player.x, player.y, 100, 0, Math.PI * 2);
    fog.fill();
    for (let index = 0; index < 8; index += 1) {
      const angle = (index * Math.PI) / 4 + tick * 0.035 + player.slot;
      const radius = 86 + Math.sin(tick * 0.22 + index * 3 + player.slot) * 8;
      fog.fillStyle = index % 2 ? "#171124" : "#100c1c";
      fog.beginPath();
      fog.arc(
        player.x + Math.cos(angle) * radius,
        player.y + Math.sin(angle) * radius,
        40,
        0,
        Math.PI * 2,
      );
      fog.fill();
    }
  }
  fog.globalCompositeOperation = "destination-out";
  for (const player of snapshot.players) {
    if (!player.alive || player.inkUntilTick > tick) continue;
    fog.beginPath();
    fog.arc(player.x, player.y, 80, 0, Math.PI * 2);
    fog.fill();
  }
  fog.globalCompositeOperation = "source-over";
  ctx.save();
  ctx.beginPath();
  ctx.rect(
    snapshot.boundaryInset,
    snapshot.boundaryInset,
    snapshot.width - 2 * snapshot.boundaryInset,
    snapshot.height - 2 * snapshot.boundaryInset,
  );
  ctx.clip();
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}
