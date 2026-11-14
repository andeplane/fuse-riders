/**
 * Absolute URL of a file under public/. The app is built with `base: './'`
 * and mounted under a hosting origin, so assets are resolved against the
 * document like Vite does for the built index.html, never as `/games/...`.
 */
export function publicUrl(path: string, baseUrl: string, documentUrl: string): string {
  return new URL(path, new URL(baseUrl, documentUrl)).href;
}
