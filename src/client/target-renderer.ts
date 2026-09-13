import type { GameSnapshot } from '../shared/protocol.js';

/** Authoritative targets stay visible over arena effects, never over the HUD. */
export function drawBombTargets(ctx: CanvasRenderingContext2D, snapshot: GameSnapshot): void {
  for (const player of snapshot.players) {
    const target = player.bombTarget;
    if (!player.alive || player.shellArmed || !player.targetBombArmed || player.bombChargeStartedTick === undefined || !target) continue;
    ctx.save();
    ctx.strokeStyle = player.color; ctx.lineWidth = 3;
    ctx.setLineDash([6, 8]); ctx.globalAlpha = .65;
    ctx.beginPath(); ctx.moveTo(player.x, player.y); ctx.lineTo(target.x, target.y); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
    ctx.fillStyle = '#071022cc'; ctx.beginPath(); ctx.arc(target.x, target.y, 23, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      ctx.beginPath(); ctx.moveTo(target.x + dx * 11, target.y + dy * 11); ctx.lineTo(target.x + dx * 32, target.y + dy * 32); ctx.stroke();
    }
    ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center'; ctx.lineWidth = 4; ctx.strokeStyle = '#030817';
    const caption = `TARGET · ${player.name}`;
    ctx.strokeText(caption, target.x, target.y + 47); ctx.fillStyle = player.color; ctx.fillText(caption, target.x, target.y + 47);
    ctx.restore();
  }
}
