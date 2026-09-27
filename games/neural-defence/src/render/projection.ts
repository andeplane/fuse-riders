/** Oblique ground plane. Upright artwork keeps its height; rules stay on hex cells. */
export const GROUND = Object.freeze({ radius: 35, depth: 0.72 });
const dx = Math.sqrt(3) * GROUND.radius;
const dy = 1.5 * GROUND.radius * GROUND.depth;
export function hexCenter(width: number, cell: number) {
  const row = Math.floor(cell / width),
    column = cell % width;
  return {
    x: GROUND.radius + dx * (column + (row & 1) / 2),
    y: GROUND.radius + dy * row,
  };
}
export function hexPoints(width: number, cell: number, inset = 0): string {
  const { x, y } = hexCenter(width, cell);
  return Array.from({ length: 6 }, (_, i) => {
    const angle = (Math.PI / 180) * (60 * i - 30);
    return `${(x + Math.cos(angle) * (GROUND.radius - inset)).toFixed(2)},${(y + Math.sin(angle) * (GROUND.radius - inset) * GROUND.depth).toFixed(2)}`;
  }).join(" ");
}
export function boardSize(width: number, height: number) {
  return {
    width: Math.ceil(dx * (width - 0.5) + GROUND.radius * 2),
    height: dy * (height - 1) + GROUND.radius * 2,
  };
}
export function groundCell(
  width: number,
  height: number,
  x: number,
  y: number,
) {
  const row = Math.max(
    0,
    Math.min(height - 1, Math.round((y - GROUND.radius) / dy)),
  );
  const column = Math.max(
    0,
    Math.min(width - 1, Math.round((x - GROUND.radius) / dx - (row & 1) / 2)),
  );
  return row * width + column;
}
