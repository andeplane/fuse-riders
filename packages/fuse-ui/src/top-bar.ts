import { button, el } from "./dom.js";
import { createDialog } from "./dialog.js";
import { ALL_SONGS, type Song, type MusicMedia } from "fuse-music";
import { createRadio } from "./radio.js";

export interface TopBarOptions {
  element: HTMLElement;
  brand?: HTMLElement;
  account?: HTMLElement;
  gameId?: string;
  /** This game's master switch: music and effects change together. */
  sound?: TopBarSound;
  /** Omit for the full shared catalogue, pass a game's selection, or false for a custom radio UI. */
  music?: readonly Song[] | false;
  /** The browser media boundary; tests and embedded hosts can supply their own player surface. */
  createMusicMedia?: () => MusicMedia;
  /** Release held gameplay input before the modal takes keyboard focus. */
  onOpenChange?: (open: boolean) => void;
}
export interface TopBarSound {
  enabled(): boolean;
  setEnabled(enabled: boolean): void;
  readonly forcedMute?: boolean;
  onChange?(changed: () => void): () => void;
}
interface InstalledBar {
  refresh(options: TopBarOptions): void;
}
const installed = new WeakMap<HTMLElement, InstalledBar>();
const bindings = new WeakMap<HTMLElement, () => void>();
const radios = new WeakMap<Document, ReturnType<typeof createRadio>>();

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
  const customRadio = options.music === false;
  let radio = radios.get(doc);
  if (
    !radio &&
    !customRadio &&
    options.gameId &&
    doc.defaultView &&
    (options.createMusicMedia || typeof doc.defaultView.Audio === "function")
  ) {
    const win = doc.defaultView;
    const preview = new URLSearchParams(win.location?.search ?? "").has("mute");
    radio = createRadio(
      doc,
      import.meta.env?.BASE_URL ?? "/",
      options.createMusicMedia ?? (() => new win.Audio()),
      preview,
      options.music || ALL_SONGS,
    );
    radios.set(doc, radio);
    win.addEventListener("pagehide", (event) => {
      if (!event.persisted) radio?.destroy();
    });
    for (const type of [
      "pointerdown",
      "pointerup",
      "touchend",
      "keydown",
      "click",
    ])
      doc.addEventListener(type, () => radio?.player.unlock(), {
        passive: true,
      });
  }
  const left = el("div", "", "fui-top-bar-left", doc);
  const right = el("div", "", "fui-top-bar-right", doc);
  const context = el("div", "", "fui-top-bar-context", doc);
  const account = button("Sign in", "fui-top-bar-account", doc);
  account.hidden = true;
  const sound = button("Sound on", "fui-top-bar-sound", doc);
  sound.hidden = true;
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
  let soundControl: TopBarSound | undefined;
  let releaseSound: (() => void) | undefined;
  const renderSound = () => {
    radio?.setMuted(Boolean(soundControl && !soundControl.enabled()));
    sound.hidden = !soundControl;
    const on = Boolean(
      soundControl && !soundControl.forcedMute && soundControl.enabled(),
    );
    const label = on ? "🔊 Sound on" : "🔇 Sound off";
    if (sound.textContent !== label) sound.textContent = label;
    sound.setAttribute("aria-label", on ? "Sound on" : "Sound off");
    sound.setAttribute("aria-pressed", String(on));
    sound.disabled = Boolean(soundControl?.forcedMute);
    sound.title = soundControl?.forcedMute
      ? "Sound off for this preview"
      : "Toggle music and sound effects";
  };
  let onOpenChange = options.onOpenChange;
  let releaseAccount: (() => void) | undefined;
  const refresh = (next: TopBarOptions) => {
    onOpenChange = next.onOpenChange;
    if (next.sound && next.sound !== soundControl) {
      releaseSound?.();
      soundControl = next.sound;
      releaseSound = soundControl.onChange?.(renderSound);
    }
    renderSound();
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
  right.append(sound, account, toggle);
  refresh(options);
  if (radio && !customRadio) menu.body.prepend(radio.element);
  root.append(left, right, context, menu.dialog);
  // Header controls keep native keyboard activation while the match continues
  // behind them. Keyup still reaches the game so previously held keys release.
  // The context is the game's own content, lent to the bar (a roster, the host's actions): a key pressed with
  // focus left there after a click is still the game's, or Space would press that button again instead of the bomb.
  root.addEventListener("keydown", (event) => {
    if (!context.contains(event.target as Node | null)) event.stopPropagation();
  });
  toggle.onclick = () => {
    renderSound();
    onOpenChange?.(true);
    menu.show({ title: "Game menu" });
    toggle.setAttribute("aria-expanded", "true");
  };
  // A game's own menu lives in this dialog as "Game controls". Its closing actions close the dialog before they run,
  // and a dialog closed any other way (Escape, Close) collapses that menu: otherwise the game stays paused for input
  // behind a menu nobody can see, and focus cannot return to the arena while the modal holds the page inert.
  menu.body.addEventListener(
    "click",
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest?.("[data-fui-menu-dismiss]") && menu.dialog.open)
        menu.dialog.close();
    },
    true,
  );
  menu.dialog.addEventListener("close", () => {
    renderSound();
    onOpenChange?.(false);
    toggle.setAttribute("aria-expanded", "false");
    for (const trigger of menu.body.querySelectorAll<HTMLElement>(
      '.fui-game-menu-trigger[aria-expanded="true"]',
    ))
      trigger.click();
    // Keep focus where the game put it when it resumed; otherwise return it to the control that opened the dialog.
    const active = doc.activeElement;
    if (!active || active === doc.body || root.contains(active)) toggle.focus();
  });
  account.onclick = () => {
    source?.click();
    if (menu.dialog.open) menu.dialog.close();
  };
  sound.onclick = () => {
    if (soundControl && !soundControl.forcedMute) {
      soundControl.setEnabled(!soundControl.enabled());
      renderSound();
    }
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
