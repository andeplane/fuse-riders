import { button, el } from "./dom.js";
import { createDialog } from "./dialog.js";

export interface TopBarOptions {
  element: HTMLElement;
  brand?: HTMLElement;
  account?: HTMLElement;
  gameId?: string;
  /** Release held gameplay input before the modal takes keyboard focus. */
  onOpenChange?: (open: boolean) => void;
}
interface InstalledBar {
  refresh(options: TopBarOptions): void;
}
const installed = new WeakMap<HTMLElement, InstalledBar>();
const bindings = new WeakMap<HTMLElement, () => void>();

/** Shared overlay navigation. Existing game/account controls retain their handlers and game-specific data. */
export function createTopBar(options: TopBarOptions): HTMLElement {
  const root = options.element;
  const previous = installed.get(root);
  if (
    previous &&
    root.classList.contains("fui-top-bar") &&
    root.querySelector(":scope > .fui-top-bar-left")
  ) {
    previous.refresh(options);
    return root;
  }
  if (previous) installed.delete(root);
  const doc = root.ownerDocument;
  const left = el("div", "", "fui-top-bar-left", doc);
  const right = el("div", "", "fui-top-bar-right", doc);
  const context = el("div", "", "fui-top-bar-context", doc);
  const account = button("Sign in", "fui-top-bar-account", doc);
  account.hidden = true;
  const toggle = button("", "fui-top-bar-toggle", doc);
  toggle.setAttribute("aria-label", "Open game menu");
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML =
    '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
  const menu = createDialog({
    title: "Game menu",
    closeText: "Close",
    document: doc,
  });
  menu.dialog.classList.add("fui-top-bar-menu");
  menu.body.classList.add("fui-top-bar-actions");
  const owned = new Set<Node>([left, right, context, menu.dialog]);
  let source: HTMLElement | undefined;
  let onOpenChange = options.onOpenChange;
  let releaseAccount: (() => void) | undefined;
  const refresh = (next: TopBarOptions) => {
    onOpenChange = next.onOpenChange;
    const portal = root.querySelector<HTMLElement>(".fui-portal");
    const brand =
      next.brand ??
      root.querySelector<HTMLElement>(
        '[class*="brand"], .landing-logo, .wordmark',
      ) ??
      ([...root.children].find((node) => node.tagName === "A") as
        HTMLElement | undefined);
    const profile =
      next.account ??
      root.querySelector<HTMLButtonElement>(".fui-social > button");
    if (portal && portal.parentElement !== left) left.prepend(portal);
    if (brand && brand !== left && brand.parentElement !== left) {
      brand.classList.add("fui-top-bar-brand");
      left.append(brand);
    }
    if (
      profile &&
      (profile !== source || bindings.get(profile) !== releaseAccount)
    ) {
      source = profile;
      profile.classList.add("fui-top-bar-account-source");
      bindings.get(profile)?.();
      const sync = () => {
        const text = profile.textContent?.trim() || "Sign in";
        if (account.textContent !== text) account.textContent = text;
        account.title = text.replace(/\s+/g, " ");
        account.disabled = profile.hasAttribute("disabled");
        account.hidden = false;
      };
      sync();
      const Observer = doc.defaultView?.MutationObserver;
      const observer = Observer ? new Observer(sync) : undefined;
      observer?.observe(profile, {
        childList: true,
        characterData: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["disabled"],
      });
      releaseAccount = () => observer?.disconnect();
      bindings.set(profile, releaseAccount);
    }
    for (const child of [...root.childNodes]) {
      if (owned.has(child)) continue;
      if (
        child.nodeType === 1 &&
        !(child as HTMLElement).matches("button,input,select,a,details") &&
        !(child as HTMLElement).querySelector("button,input,select,a,details")
      ) {
        context.append(child);
        continue;
      }
      menu.body.append(child);
    }
    root.classList.add("fui-top-bar");
    root.dataset.fuiPreserve = "true";
    if (next.gameId) root.dataset.gameId = next.gameId;
    for (const trigger of menu.body.querySelectorAll<HTMLElement>(
      ".fui-game-menu-trigger",
    ))
      trigger.textContent = "Game controls";
  };
  right.append(account, toggle);
  refresh(options);
  root.append(left, right, context, menu.dialog);
  // Header controls keep native keyboard activation while the match continues
  // behind them. Keyup still reaches the game so previously held keys release.
  root.addEventListener("keydown", (event) => event.stopPropagation());
  toggle.onclick = () => {
    onOpenChange?.(true);
    menu.show({ title: "Game menu" });
    toggle.setAttribute("aria-expanded", "true");
  };
  menu.dialog.addEventListener("close", () => {
    onOpenChange?.(false);
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus();
  });
  account.onclick = () => {
    source?.click();
    if (menu.dialog.open) menu.dialog.close();
  };
  menu.body.addEventListener("click", () => {
    if (
      [...doc.querySelectorAll<HTMLDialogElement>("dialog[open]")].some(
        (dialog) => dialog !== menu.dialog,
      ) &&
      menu.dialog.open
    )
      menu.dialog.close();
  });
  installed.set(root, { refresh });
  return root;
}
