export interface MenuKeysOptions {
  /** The controls the arrows walk, in order. Default: the menu's buttons and links that are shown and enabled. */
  items?: () => readonly HTMLElement[];
  /** False while the arrows mean something else (a song is playing, a key is being bound). Default: always. */
  enabled?: () => boolean;
  /** Where the keys are heard. Default: the page, so a menu takes them wherever the focus is. */
  scope?: HTMLElement;
  document?: Document;
}

const NEXT = new Set(["ArrowDown", "ArrowRight"]),
  PREVIOUS = new Set(["ArrowUp", "ArrowLeft"]);

function reachable(item: HTMLElement): boolean {
  return (
    item.isConnected &&
    !item.closest("[hidden]") &&
    !item.hasAttribute("disabled") &&
    item.getAttribute("aria-disabled") !== "true"
  );
}

/**
 * Arrow keys walk a menu's controls, Home and End jump to its ends, and Enter presses the focused one as the
 * browser does. The page hears the keys, so a menu that has just appeared takes them without a click or a Tab
 * first: the first arrow lands on the first control (or the last, going up). Not while the menu is hidden, not
 * under a dialog the menu is not in, not from a field that uses the arrows itself, and not for a key something
 * else already used. Returns what removes the listener.
 */
export function menuKeys(
  menu: HTMLElement,
  options: MenuKeysOptions = {},
): () => void {
  const doc = options.document ?? menu.ownerDocument;
  const items = () =>
    (
      options.items?.() ?? [
        ...menu.querySelectorAll<HTMLElement>("button, a[href]"),
      ]
    ).filter(reachable);
  const onKey = (event: KeyboardEvent) => {
    const forward = NEXT.has(event.key) || event.key === "Home",
      backward = PREVIOUS.has(event.key) || event.key === "End";
    if (!forward && !backward) return;
    if (
      event.defaultPrevented ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey
    )
      return;
    if (!menu.isConnected || menu.closest("[hidden]")) return;
    // Hidden by a style, not the attribute (a menu a game covers while it plays): the arrows are the game's.
    if (menu.checkVisibility?.() === false) return;
    const dialog = doc.querySelector("dialog[open]");
    if (dialog && !dialog.contains(menu)) return;
    const target = event.target as Element | null;
    if (target?.closest?.("input, select, textarea, [contenteditable]")) return;
    if (options.enabled && !options.enabled()) return;
    const list = items();
    if (!list.length) return;
    const active = doc.activeElement,
      at = list.findIndex((item) => item === active);
    // Focus on something else that is not the page itself (another menu's button) is that thing's to keep.
    if (
      at === -1 &&
      active &&
      active !== doc.body &&
      !menu.contains(active) &&
      active.matches?.("button, a[href], [tabindex]")
    )
      return;
    const jump = event.key === "Home" || event.key === "End";
    const next = jump
      ? forward
        ? 0
        : list.length - 1
      : at === -1
        ? forward
          ? 0
          : list.length - 1
        : (at + (forward ? 1 : -1) + list.length) % list.length;
    event.preventDefault();
    list[next]!.focus();
  };
  const scope: Pick<Document, "addEventListener" | "removeEventListener"> =
    options.scope ?? doc;
  scope.addEventListener("keydown", onKey as EventListener);
  return () => scope.removeEventListener("keydown", onKey as EventListener);
}
