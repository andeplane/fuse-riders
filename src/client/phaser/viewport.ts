/** Bound fill rate and texture dimensions while preserving the supplied world aspect. */
export function arenaBacking(worldWidth: number, worldHeight: number, cssWidth: number, cssHeight: number, dpr: number, cover = false): { width: number; height: number } {
  const displayScale = cssWidth > 0 && cssHeight > 0 ? (cover ? Math.max : Math.min)(cssWidth / worldWidth, cssHeight / worldHeight) : 1;
  const scale = Math.min(displayScale * (Number.isFinite(dpr) && dpr > 0 ? dpr : 1),
    Math.sqrt((3840 * 2160) / (worldWidth * worldHeight)), 4096 / Math.max(worldWidth, worldHeight));
  return { width: Math.max(1, Math.round(worldWidth * scale)), height: Math.max(1, Math.round(worldHeight * scale)) };
}

/** Cache CSS layout measurements; density is read each frame to handle moving between screens. */
export function observeArenaDisplay(canvas: HTMLCanvasElement): { backing(width: number, height: number): { width: number; height: number }; destroy(): void } {
  const bounds = canvas.getBoundingClientRect();
  let cssWidth = bounds.width; let cssHeight = bounds.height;
  const cover = getComputedStyle(canvas).objectFit === 'cover';
  const observer = new ResizeObserver(entries => {
    const entry = entries[0];
    if (entry && entry.contentRect.width > 0 && entry.contentRect.height > 0) {
      cssWidth = entry.contentRect.width; cssHeight = entry.contentRect.height;
    }
  });
  observer.observe(canvas);
  return {
    backing: (width, height) => arenaBacking(width, height, cssWidth, cssHeight, window.devicePixelRatio, cover),
    destroy: () => observer.disconnect(),
  };
}
