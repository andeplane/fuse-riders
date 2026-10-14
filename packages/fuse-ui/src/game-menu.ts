import { button, el } from "./dom.js";

export interface ControlHint {
  keys: string;
  action: string;
}

interface ControlsOptions {
  controls: readonly ControlHint[];
  touchControls?: readonly ControlHint[];
  goal?: string;
  document?: Document;
}

export interface GameMenuOptions extends ControlsOptions {
  title?: string;
  onLobby?: () => void;
  onLeave?: () => void;
  onOpenChange?: (open: boolean) => void;
}

export interface GameMenuState {
  canLobby: boolean;
  canLeave?: boolean;
  touch?: boolean;
  spectator?: boolean;
  /** Shared TV display: show players' phone controls, even without a local seat. */
  display?: boolean;
  controls?: readonly ControlHint[];
  touchControls?: readonly ControlHint[];
}

export interface GameMenu {
  element: HTMLElement;
  update(state: GameMenuState): void;
  close(): void;
  isOpen(): boolean;
  dispose(): void;
}

let nextMenu = 0;

function controlContent(
  options: ControlsOptions,
  doc: Document,
  touch: boolean,
  spectator: boolean,
  display = false,
): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (options.goal) nodes.push(el("p", options.goal, "fui-controls-goal", doc));
  if (display)
    nodes.push(
      el(
        "p",
        "Shared screen: watch here. Players use their own phones or devices.",
        "fui-controls-note",
        doc,
      ),
    );
  if (spectator && !display) {
    nodes.push(
      el(
        "p",
        "Watch the arena. Players control the game from their own devices.",
        "fui-controls-note",
        doc,
      ),
    );
    return nodes;
  }
  const controls = touch
    ? (options.touchControls ?? [
        { keys: "On-screen buttons", action: "Tap or hold to play" },
      ])
    : options.controls;
  const list = el("dl", "", "fui-controls-list", doc);
  for (const hint of controls) {
    const row = el("div", "", "fui-controls-row", doc);
    row.append(el("dt", hint.keys, "", doc), el("dd", hint.action, "", doc));
    list.append(row);
  }
  nodes.push(list);
  return nodes;
}

/** The same navigation in every game, with styles inherited from its host. This never pauses a room. */
export function createGameMenu(options: GameMenuOptions): GameMenu {
  const doc = options.document ?? document;
  const element = el("div", "", "fui-game-menu", doc);
  const trigger = button("MENU", "fui-game-menu-trigger", doc);
  const panel = el("section", "", "fui-game-menu-panel", doc);
  panel.id = `fui-game-menu-${++nextMenu}`;
  panel.hidden = true;
  panel.setAttribute("aria-label", options.title ?? "Game menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", panel.id);
  const heading = el(
    "h2",
    options.title ?? "GAME MENU",
    "fui-game-menu-title",
    doc,
  );
  const navigation = el("div", "", "fui-game-menu-navigation", doc);
  const resume = button("BACK TO GAME", "fui-game-menu-action", doc);
  const controls = button("CONTROLS", "fui-game-menu-action", doc);
  const lobby = button("BACK TO LOBBY", "fui-game-menu-action", doc);
  const leave = button(
    "LEAVE GAME",
    "fui-game-menu-action fui-game-menu-leave",
    doc,
  );
  navigation.append(resume, controls, lobby, leave);
  const help = el("div", "", "fui-game-menu-controls", doc);
  help.hidden = true;
  const back = button("← BACK", "fui-game-menu-action", doc);
  const helpTitle = el("h3", "CONTROLS", "fui-game-menu-title", doc);
  const helpContent = el("div", "", "", doc);
  help.append(back, helpTitle, helpContent);
  panel.append(heading, navigation, help);
  element.append(trigger, panel);

  let state: GameMenuState = { canLobby: false };
  let open = false;
  let disposed = false;
  let helpMode = "";
  const renderControls = () => {
    const current = {
      ...options,
      controls: state.controls ?? options.controls,
      touchControls: state.touchControls ?? options.touchControls,
    };
    const mode = JSON.stringify([
      !!state.touch,
      !!state.spectator,
      !!state.display,
      current.controls,
      current.touchControls,
    ]);
    if (mode === helpMode) return;
    helpMode = mode;
    helpTitle.textContent = state.display
      ? "PHONE CONTROLS"
      : state.spectator
        ? "WATCHING"
        : "CONTROLS";
    helpContent.replaceChildren(
      ...controlContent(
        current,
        doc,
        !!state.touch || !!state.display,
        !!state.spectator,
        !!state.display,
      ),
    );
  };
  const close = () => {
    if (!open) return;
    open = false;
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    trigger.focus();
    options.onOpenChange?.(false);
  };
  const showNavigation = () => {
    help.hidden = true;
    navigation.hidden = false;
    controls.focus();
  };
  trigger.onclick = () => {
    if (disposed) return;
    if (open) return close();
    open = true;
    help.hidden = true;
    navigation.hidden = false;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    resume.focus();
    options.onOpenChange?.(true);
  };
  resume.onclick = close;
  controls.onclick = () => {
    renderControls();
    navigation.hidden = true;
    help.hidden = false;
    back.focus();
  };
  back.onclick = showNavigation;
  lobby.onclick = () => {
    if (!state.canLobby || !options.onLobby) return;
    close();
    options.onLobby();
  };
  leave.onclick = () => {
    if (state.canLeave === false || !options.onLeave) return;
    close();
    options.onLeave();
  };
  const onKey = (event: KeyboardEvent) => {
    if (!open || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    close();
  };
  const onOutside = (event: Event) => {
    if (open && event.target && !element.contains(event.target as Node))
      close();
  };
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onOutside);
  const update = (next: GameMenuState) => {
    state = next;
    lobby.hidden = !next.canLobby || !options.onLobby;
    leave.hidden = next.canLeave === false || !options.onLeave;
    renderControls();
  };
  update(state);
  return {
    element,
    update,
    close,
    isOpen: () => open,
    dispose() {
      close();
      disposed = true;
      doc.removeEventListener("keydown", onKey);
      doc.removeEventListener("pointerdown", onOutside);
      trigger.onclick = null;
      resume.onclick = null;
      controls.onclick = null;
      back.onclick = null;
      lobby.onclick = null;
      leave.onclick = null;
    },
  };
}

export interface RoundControlsState {
  /** The round identity, used to refresh the announcement once for each countdown. */
  round: string | number;
  visible: boolean;
  touch?: boolean;
  spectator?: boolean;
  display?: boolean;
  controls?: readonly ControlHint[];
  touchControls?: readonly ControlHint[];
}

export interface RoundControls {
  element: HTMLElement;
  update(state: RoundControlsState): void;
}

/** Dismissible countdown guidance. The caller owns round timing; this has no clock or game state. */
export function createRoundControls(options: ControlsOptions): RoundControls {
  const doc = options.document ?? document;
  const element = el("aside", "", "fui-round-controls", doc);
  element.hidden = true;
  element.setAttribute("role", "status");
  element.setAttribute("aria-live", "polite");
  element.setAttribute("aria-atomic", "true");
  let identity = "";
  let visible = false;
  let round: string | number | undefined;
  let dismissed = false;
  const dismiss = button("×", "fui-round-controls-dismiss", doc);
  dismiss.setAttribute("aria-label", "Dismiss controls");
  dismiss.onclick = () => {
    dismissed = true;
    element.hidden = true;
    dismiss.blur?.();
  };
  // A close click must not become an arena input in the surrounding game.
  element.addEventListener("pointerdown", (event) => event.stopPropagation());
  element.addEventListener("click", (event) => event.stopPropagation());
  return {
    element,
    update(state) {
      if (round !== state.round || (!visible && state.visible))
        dismissed = false;
      round = state.round;
      const current = {
        ...options,
        controls: state.controls ?? options.controls,
        touchControls: state.touchControls ?? options.touchControls,
      };
      const nextIdentity = JSON.stringify([
        state.round,
        !!state.touch,
        !!state.spectator,
        !!state.display,
        current.controls,
        current.touchControls,
      ]);
      if (state.visible && (!visible || identity !== nextIdentity)) {
        element.replaceChildren(
          dismiss,
          el(
            "strong",
            state.display
              ? "GET READY · PHONE CONTROLS"
              : state.spectator
                ? "WATCHING THIS ROUND"
                : "GET READY · YOUR CONTROLS",
            "fui-round-controls-title",
            doc,
          ),
          ...controlContent(
            current,
            doc,
            !!state.touch || !!state.display,
            !!state.spectator,
            !!state.display,
          ),
        );
        element.dataset.round = String(state.round);
        identity = nextIdentity;
      }
      visible = state.visible;
      element.hidden = !state.visible || dismissed;
    },
  };
}
