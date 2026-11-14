export type MediaErrorCause = "csp" | "unknown";

/**
 * What went wrong loading a track: a definitive CSP report naming the blocked directive, or
 * a generic media load failure. `element` (the `<audio>` element itself) is only carried on
 * the generic 'unknown' cause, from the direct `error` event listener; it lets the caller
 * retry a remote track once with a freshly resolved download URL before treating it as a real
 * failure (an expired signed URL looks identical to a broken file otherwise).
 */
export type MediaErrorInfo = {
  cause: MediaErrorCause;
  directive?: string;
  element?: HTMLMediaElement;
};

/**
 * Listens for local media (`blob:` object URL) playback failures anywhere on the page.
 *
 * Webamp plays tracks through a plain `<audio>` element (`src = <blob: url>`), so a
 * failed load is governed by the browser's `media-src` CSP directive; Webamp's own
 * `error` handling treats a blocked load exactly like a track that ended normally,
 * so its public API (`onTrackDidChange`, `getMediaStatus`) never distinguishes a CSP
 * block from a finished track. The app has to ask the browser itself:
 *
 * - `securitypolicyviolation` is dispatched on `document` (it bubbles) when the CSP
 *   blocks the load; `effectiveDirective` names the directive, which is definitive.
 * - A plain `error` event on the `<audio>` element itself covers every other load
 *   failure (a corrupt file, an unsupported format, or a CSP block the browser did not
 *   report separately); media element errors do not bubble, so this is only observable
 *   in the capture phase on `window`.
 *
 * Returns an unsubscribe.
 */
export function subscribeMediaErrors(
  onError: (info: MediaErrorInfo) => void,
): () => void {
  const handleViolation = (event: SecurityPolicyViolationEvent) => {
    const directive = event.effectiveDirective || event.violatedDirective;
    if (directive.startsWith("media-src")) onError({ cause: "csp", directive });
  };
  const handleError = (event: Event) => {
    if (event.target instanceof HTMLMediaElement)
      onError({ cause: "unknown", element: event.target });
  };
  document.addEventListener("securitypolicyviolation", handleViolation);
  window.addEventListener("error", handleError, true);
  return () => {
    document.removeEventListener("securitypolicyviolation", handleViolation);
    window.removeEventListener("error", handleError, true);
  };
}
