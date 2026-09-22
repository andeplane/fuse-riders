export interface Camera {
  x: number;
  y: number;
  zoom: number;
}
export interface Viewport {
  width: number;
  height: number;
}
export interface MapSize {
  width: number;
  height: number;
}

export function fitScale(map: MapSize, viewport: Viewport): number {
  return Math.min(viewport.width / map.width, viewport.height / map.height);
}
export function constrainCamera(
  camera: Camera,
  map: MapSize,
  viewport: Viewport,
  shared = false,
): Camera {
  const zoom = shared ? 1 : Math.max(1, Math.min(5, camera.zoom));
  const scale = fitScale(map, viewport) * zoom;
  const halfX = Math.min(map.width / 2, viewport.width / (2 * scale));
  const halfY = Math.min(map.height / 2, viewport.height / (2 * scale));
  return {
    zoom,
    x: shared
      ? map.width / 2
      : Math.max(halfX, Math.min(map.width - halfX, camera.x)),
    y: shared
      ? map.height / 2
      : Math.max(halfY, Math.min(map.height - halfY, camera.y)),
  };
}
export function screenToWorld(
  point: { x: number; y: number },
  camera: Camera,
  map: MapSize,
  viewport: Viewport,
): { x: number; y: number } {
  const scale = fitScale(map, viewport) * camera.zoom;
  return {
    x: camera.x + (point.x - viewport.width / 2) / scale,
    y: camera.y + (point.y - viewport.height / 2) / scale,
  };
}

/** Keep directions to off-screen birds/supplies readable in local zoom views. */
export function edgeMarker(
  point: { x: number; y: number },
  camera: Camera,
  map: MapSize,
  viewport: Viewport,
): { x: number; y: number; arrow: string } | undefined {
  const scale = fitScale(map, viewport) * camera.zoom;
  const dx = point.x - camera.x,
    dy = point.y - camera.y;
  const halfX = viewport.width / (2 * scale),
    halfY = viewport.height / (2 * scale);
  if (Math.abs(dx) <= halfX && Math.abs(dy) <= halfY) return;
  const insetX = Math.min(70, viewport.width / 4) / scale,
    insetY = Math.min(28, viewport.height / 4) / scale;
  const reach = Math.min(
    (halfX - insetX) / Math.max(1, Math.abs(dx)),
    (halfY - insetY) / Math.max(1, Math.abs(dy)),
  );
  return {
    x: camera.x + dx * reach,
    y: camera.y + dy * reach,
    arrow:
      Math.abs(dx) / halfX > Math.abs(dy) / halfY
        ? dx < 0
          ? "←"
          : "→"
        : dy < 0
          ? "↑"
          : "↓",
  };
}
/** Preserve the world point under a pinch midpoint or mouse cursor. */
export function zoomAt(
  camera: Camera,
  zoom: number,
  point: { x: number; y: number },
  map: MapSize,
  viewport: Viewport,
): Camera {
  const before = screenToWorld(point, camera, map, viewport);
  const next = { ...camera, zoom: Math.max(1, Math.min(5, zoom)) };
  const after = screenToWorld(point, next, map, viewport);
  return constrainCamera(
    { ...next, x: next.x + before.x - after.x, y: next.y + before.y - after.y },
    map,
    viewport,
  );
}

/** Fit a live shot's complete group; never zoom in beyond the viewer's chosen scale. */
export function followShot(
  camera: Camera,
  points: readonly { x: number; y: number }[],
  map: MapSize,
  viewport: Viewport,
  elapsedMs: number,
): Camera {
  if (points.length === 0) return camera;
  const xs = points.map((point) => point.x),
    ys = points.map((point) => point.y);
  const left = Math.min(...xs),
    right = Math.max(...xs),
    top = Math.min(...ys),
    bottom = Math.max(...ys);
  const fit = fitScale(map, viewport);
  const zoom = Math.max(
    1,
    Math.min(
      camera.zoom,
      viewport.width / ((right - left + 160) * fit),
      viewport.height / ((bottom - top + 160) * fit),
    ),
  );
  const target = constrainCamera(
    { x: (left + right) / 2, y: (top + bottom) / 2, zoom },
    map,
    viewport,
  );
  const weight = 1 - Math.exp(-Math.max(0, Math.min(100, elapsedMs)) / 100);
  return constrainCamera(
    {
      x: camera.x + (target.x - camera.x) * weight,
      y: camera.y + (target.y - camera.y) * weight,
      // Zoom out immediately so spread fragments remain visible; position eases toward their center.
      zoom,
    },
    map,
    viewport,
  );
}
