export interface ShellMotion { x: number; y: number; vx: number; vy: number }
export interface ShellPoint { x: number; y: number; t: number }
export const SHELL_LIFETIME_TICKS = 100;
export const SHELL_SPEED = 450;
export const SHELL_RADIUS = 14;
/** Piecewise path preserves wall contact rather than cutting diagonally across a bounce. */
export function advanceShell(shell: ShellMotion, bounds: { left: number; right: number; top: number; bottom: number }): ShellPoint[] {
  shell.x = Math.max(bounds.left, Math.min(bounds.right, shell.x));
  shell.y = Math.max(bounds.top, Math.min(bounds.bottom, shell.y));
  const path: ShellPoint[] = [{ x: shell.x, y: shell.y, t: 0 }];
  let t = 0;
  for (let iteration = 0; t < 1 && iteration < 8; iteration++) {
    const dx = shell.vx / 20; const dy = shell.vy / 20;
    const tx = dx > 0 ? (bounds.right - shell.x) / dx : dx < 0 ? (bounds.left - shell.x) / dx : Infinity;
    const ty = dy > 0 ? (bounds.bottom - shell.y) / dy : dy < 0 ? (bounds.top - shell.y) / dy : Infinity;
    const dt = Math.max(0, Math.min(1 - t, tx, ty));
    shell.x += dx * dt; shell.y += dy * dt; t += dt;
    path.push({ x: shell.x, y: shell.y, t });
    if (tx <= dt + 1e-9) shell.vx *= -1;
    if (ty <= dt + 1e-9) shell.vy *= -1;
  }
  return path;
}
