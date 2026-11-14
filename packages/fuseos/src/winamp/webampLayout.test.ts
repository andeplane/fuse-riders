import { WEBAMP_EMBED_OPTIONS, WEBAMP_EMBED_SIZE } from './webampLayout';

describe('embedded Winamp layout', () => {
  it('fits all three classic panels inside the mount without clipping the main transport', () => {
    const panels = Object.values(WEBAMP_EMBED_OPTIONS.windowLayout);
    const left = Math.min(...panels.map((panel) => panel.position.left));
    const top = Math.min(...panels.map((panel) => panel.position.top));
    const right = Math.max(...panels.map((panel) => panel.position.left + 275));
    const bottom = Math.max(...panels.map((panel) => panel.position.top + 116));
    // Webamp centres the bounding box before rendering any of its children.
    expect((WEBAMP_EMBED_SIZE.width - (right - left)) / 2).toBe(0);
    expect((WEBAMP_EMBED_SIZE.height - (bottom - top)) / 2).toBe(0);
    expect(WEBAMP_EMBED_OPTIONS.windowLayout.main.position.top).toBe(top);
    expect(WEBAMP_EMBED_OPTIONS.enableDoubleSizeMode).toBe(false);
  });
});
