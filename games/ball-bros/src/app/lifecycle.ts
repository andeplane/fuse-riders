/** The app keeps its JS document when restoring from BFCache. Each restoration
 * needs a fresh runtime; a reload-once guard would strand the second return. */
export function installLifecycle(
  events: {
    addEventListener(
      type: "pagehide" | "pageshow",
      listener: (event: { persisted: boolean }) => void,
    ): void;
  },
  actions: { dispose(): void; restore(): void },
) {
  events.addEventListener("pagehide", () => actions.dispose());
  events.addEventListener("pageshow", (event) => {
    if (event.persisted) actions.restore();
  });
}
