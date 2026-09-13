export interface ShellMotion { x: number; y: number; vx: number; vy: number }
export interface ShellPoint { x: number; y: number; t: number }
export interface ShellTrail { x1: number; y1: number; x2: number; y2: number }
export const SHELL_LIFETIME_TICKS = 100;
export const SHELL_SPEED = 450;
export const SHELL_RADIUS = 14;
/** Piecewise path preserves wall contact rather than cutting diagonally across a bounce. */
export function advanceShell(shell: ShellMotion, bounds: { left: number; right: number; top: number; bottom: number }, trails: readonly ShellTrail[] = [], trailWidth = 6): ShellPoint[] {
  shell.x = Math.max(bounds.left, Math.min(bounds.right, shell.x));
  shell.y = Math.max(bounds.top, Math.min(bounds.bottom, shell.y));
  const path: ShellPoint[] = [{ x: shell.x, y: shell.y, t: 0 }];
  let t = 0;
  for (let iteration = 0; t < 1 && iteration < 8; iteration++) {
    const dx = shell.vx / 20; const dy = shell.vy / 20;
    const tx = dx > 0 ? (bounds.right - shell.x) / dx : dx < 0 ? (bounds.left - shell.x) / dx : Infinity;
    const ty = dy > 0 ? (bounds.bottom - shell.y) / dy : dy < 0 ? (bounds.top - shell.y) / dy : Infinity;
    let hit: { time: number; nx: number; ny: number } | undefined;
    for (const trail of trails) {
      const candidate = trailContact(shell.x, shell.y, dx, dy, Math.min(1 - t, tx, ty), trail, SHELL_RADIUS + trailWidth / 2);
      if (candidate && (!hit || candidate.time < hit.time)) hit = candidate;
    }
    const dt = Math.max(0, Math.min(1 - t, tx, ty, hit?.time ?? Infinity));
    shell.x += dx * dt; shell.y += dy * dt; t += dt;
    path.push({ x: shell.x, y: shell.y, t });
    if (hit && hit.time <= dt + 1e-9) {
      const dot = shell.vx * hit.nx + shell.vy * hit.ny;
      shell.vx -= 2 * dot * hit.nx; shell.vy -= 2 * dot * hit.ny;
      shell.x += hit.nx * 1e-6; shell.y += hit.ny * 1e-6;
    }
    if (tx <= dt + 1e-9) shell.vx *= -1;
    if (ty <= dt + 1e-9) shell.vy *= -1;
  }
  return path;
}

/** Earliest swept circle contact against a trail capsule, including its endpoints. */
function trailContact(x: number, y: number, dx: number, dy: number, limit: number, trail: ShellTrail, radius: number): { time: number; nx: number; ny: number } | undefined {
  if (Math.max(x, x + dx * limit) < Math.min(trail.x1, trail.x2) - radius ||
      Math.min(x, x + dx * limit) > Math.max(trail.x1, trail.x2) + radius ||
      Math.max(y, y + dy * limit) < Math.min(trail.y1, trail.y2) - radius ||
      Math.min(y, y + dy * limit) > Math.max(trail.y1, trail.y2) + radius) return;
  let hit: { time: number; nx: number; ny: number } | undefined;
  const accept = (time: number, nx: number, ny: number) => {
    if (time >= -1e-9 && time <= limit + 1e-9 && dx * nx + dy * ny < -1e-9 && (!hit || time < hit.time)) hit = { time: Math.max(0, time), nx, ny };
  };
  const sx = trail.x2 - trail.x1; const sy = trail.y2 - trail.y1; const length = Math.hypot(sx, sy);
  const alongStart = length > 0 ? Math.max(0, Math.min(1, ((x - trail.x1) * sx + (y - trail.y1) * sy) / (length * length))) : 0;
  const ox = x - trail.x1 - alongStart * sx; const oy = y - trail.y1 - alongStart * sy;
  const separation = Math.hypot(ox, oy);
  if (separation > 0 && separation <= radius) accept(0, ox / separation, oy / separation);
  if (length > 0) {
    const ux = sx / length; const uy = sy / length; const nx = -uy; const ny = ux;
    const distance = (x - trail.x1) * nx + (y - trail.y1) * ny;
    const speed = dx * nx + dy * ny;
    for (const sign of [-1, 1]) {
      const time = (sign * radius - distance) / speed;
      const along = (x + dx * time - trail.x1) * ux + (y + dy * time - trail.y1) * uy;
      if (along >= 0 && along <= length) accept(time, sign * nx, sign * ny);
    }
  }
  const a = dx * dx + dy * dy;
  if (a > 0) for (const [cx, cy] of [[trail.x1, trail.y1], [trail.x2, trail.y2]]) {
    const px = x - cx!; const py = y - cy!;
    const b = 2 * (px * dx + py * dy); const c = px * px + py * py - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc < 0) continue;
    const time = (-b - Math.sqrt(disc)) / (2 * a);
    const nx = px + dx * time; const ny = py + dy * time; const norm = Math.hypot(nx, ny);
    if (norm > 0) accept(time, nx / norm, ny / norm);
  }
  return hit;
}
