/**
 * The room bar's nine global actions cost two wrapped rows, and on a phone held sideways those rows are a third of
 * the height the lobby has to work with. Where the viewport is that short the bar collapses behind one ☰ MENU button
 * and the actions open as a sheet over the page instead of above it: whatever the sheet is, it takes no layout room
 * from the lobby. Which viewports collapse is CSS's decision alone (`top-menu.css`), so nothing here measures the
 * window; this only carries the open/closed state and the ARIA that goes with it.
 *
 * Full-screen phone play is not this: there the header is hidden outright and its buttons move into the ☰ MENU tools
 * overlay (`mobile-play-layout.ts`). This is the lobby and the desktop-game bar.
 */
export interface TopMenuToggle {
  /** The ☰ button itself, for the header to place. CSS shows it only where the menu collapses. */
  readonly button: HTMLButtonElement;
  /** Shut the sheet, whatever opened it. Safe to call when it is already shut. */
  close(): void;
  /** Drop the document listeners; the page is going away. */
  dispose(): void;
}

let sheets = 0;

export function createTopMenuToggle(
  header: HTMLElement,
  menu: HTMLElement,
  doc: Document = document,
): TopMenuToggle {
  const button = doc.createElement("button");
  button.type = "button";
  button.className = "top-menu-toggle";
  button.textContent = "☰ MENU";
  button.title = "Player menu";
  if (!menu.id) menu.id = `top-menu-${++sheets}`;
  button.setAttribute("aria-controls", menu.id);
  button.setAttribute("aria-haspopup", "true");

  const set = (open: boolean) => {
    if (open) header.dataset.menuOpen = "true";
    else delete header.dataset.menuOpen;
    button.setAttribute("aria-expanded", String(open));
  };
  set(false);
  const close = () => set(false);

  button.onclick = () => set(header.dataset.menuOpen !== "true");
  // Choosing an action is the end of the menu: the button's own handler still runs, this only puts the sheet away.
  menu.addEventListener("click", (event) => {
    if ((event.target as Element | null)?.closest("button")) close();
  });
  // A sheet that covers the page has to be dismissable without choosing anything.
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape" && header.dataset.menuOpen === "true") close();
  };
  const onPointer = (event: Event) => {
    const target = event.target as Node | null;
    if (target && !header.contains(target)) close();
  };
  // A rotation or a resize can take the collapsed layout away while the sheet is open, which would leave the bar
  // expanded with no way back to the button that opened it.
  const onResize = () => close();
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onPointer);
  doc.defaultView?.addEventListener("resize", onResize);

  return {
    button,
    close,
    dispose() {
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onPointer);
      doc.defaultView?.removeEventListener("resize", onResize);
    },
  };
}
