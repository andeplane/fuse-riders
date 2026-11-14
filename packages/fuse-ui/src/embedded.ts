/** The two window references the embedding test reads; a real `Window`, or a fake in a test. */
export type EmbeddingView = { readonly self: unknown; readonly top: unknown };

/**
 * Whether the page runs inside another page's frame — a Fuse game in a FuseOS desktop window — rather than as
 * the browser tab itself. Reading `top` never throws, even across origins (its properties would); a view that
 * has no `top` at all (a bare DOM in a test) is not embedded.
 */
export function isEmbeddedPage(
  view: EmbeddingView | null | undefined,
): boolean {
  if (!view) return false;
  try {
    return (
      view.top !== undefined && view.top !== null && view.top !== view.self
    );
  } catch {
    return false;
  }
}
