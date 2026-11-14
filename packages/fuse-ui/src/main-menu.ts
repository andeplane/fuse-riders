import { button, el } from "./dom.js";
import { createDialog } from "./dialog.js";
import { mountAttract, type AttractFactory } from "./attract.js";

export const VIBE_CODING_GANG = [
  "Anders Hafreager",
  "Anders Ullnæss",
  "Andreas Hennie",
  "Andreas Solbrå",
  "Åsmund Eldhuset",
  "Richard Rørmark",
  "Sindre Aarsaether",
] as const;

export interface MainMenuOptions {
  background?: AttractFactory;
  title: string;
  description?: string;
  /** Existing create/join/solo/local controls, with their original handlers. */
  play: HTMLElement;
  howToPlay?: readonly Node[];
  settings?: readonly Node[];
  /** Host room invokes the game's existing room-creation command. */
  onPlay?: () => Promise<void> | void;
  onSinglePlayer?: () => Promise<void> | void;
  singlePlayerContent?: readonly Node[] | (() => readonly Node[]);
  /**
   * What starts the single-player game, and anything that goes with it: shown in the dialog's bar beside CLOSE
   * while the single-player details are open, so it stays in reach however far the details scroll.
   */
  singlePlayerActions?: readonly Node[];
  onJoinRoom?: () => void;
  joinContent?: readonly Node[];
  /** Existing shared-screen or local hosting preferences, without another default action. */
  hostingOptions?: HTMLElement;
  onHowToPlay?: () => void;
  onSettings?: () => void;
  document?: Document;
}

/** One front door for every game. Game rules, room creation and attract scenes stay game-owned. */
export function createMainMenu(options: MainMenuOptions) {
  const doc = options.document ?? options.play.ownerDocument;
  const element = el("section", "", "fui-main-menu", doc);
  const home = el("div", "", "fui-main-menu-home", doc);
  const title = el("h1", options.title, "fui-main-menu-title", doc);
  const description = el(
    "p",
    options.description ?? "",
    "fui-main-menu-description",
    doc,
  );
  const navigation = el("nav", "", "fui-main-menu-nav", doc);
  navigation.setAttribute("aria-label", `${options.title} main menu`);
  const play = button("Play", "fui-menu-primary", doc);
  const how = button("How to play", "", doc);
  const about = button("About", "", doc);
  const settingsButton = button("Settings", "", doc);
  const choices = el("nav", "", "fui-main-menu-nav fui-play-menu", doc);
  choices.setAttribute("aria-label", "Choose how to play");
  choices.hidden = true;
  const singlePlayer = button("Single player", "", doc);
  const hostRoom = button("Host room", "", doc);
  const joinRoom = button("Join room", "", doc);
  const back = button("Back", "fui-play-menu-back", doc);
  choices.append(singlePlayer, hostRoom, joinRoom, back);
  const hosting = el("details", "", "fui-play-hosting", doc);
  hosting.append(el("summary", "Hosting options", "", doc));
  if (options.hostingOptions) hosting.append(options.hostingOptions);
  hosting.hidden = true;
  const HostingObserver = doc.defaultView?.MutationObserver;
  if (HostingObserver && options.hostingOptions)
    new HostingObserver(() => {
      hosting.hidden = choices.hidden || options.hostingOptions!.hidden;
    }).observe(options.hostingOptions, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  const error = el("p", "", "fui-menu-error", doc);
  error.setAttribute("role", "alert");
  const help = el("div", "", "fui-menu-help", doc);
  help.append(
    ...(options.howToPlay ?? [
      el(
        "p",
        options.description ??
          "Choose Play, join a slot, then start the game with your friends.",
        "",
        doc,
      ),
    ]),
  );
  const settings = el("div", "", "fui-menu-settings", doc);
  const dialog = createDialog({ title: options.title, document: doc });
  dialog.dialog.classList.add("fui-menu-dialog");
  const parking = el("div", "", "fui-menu-parking", doc);
  parking.hidden = true;
  const owned = new Set<Node>([
    options.play,
    help,
    settings,
    ...(typeof options.singlePlayerContent === "function"
      ? []
      : (options.singlePlayerContent ?? [])),
    ...(options.joinContent ?? []),
  ]);
  const singlePlayerContent = () =>
    typeof options.singlePlayerContent === "function"
      ? options.singlePlayerContent()
      : (options.singlePlayerContent ?? []);
  parking.append(...owned);
  const barActions = options.singlePlayerActions ?? [];
  const park = () => {
    for (const node of barActions) parking.append(node);
    for (const node of Array.from(dialog.body.childNodes)) {
      if (owned.has(node)) parking.append(node);
      else node.remove();
    }
  };
  let returnFocus: HTMLElement = play;
  dialog.dialog.addEventListener("close", () => {
    park();
    returnFocus.focus();
  });
  const open = (name: string, nodes: readonly Node[]) => {
    park();
    dialog.show({ title: name, content: nodes });
  };
  let pending = false;
  const showPlayMenu = () => {
    navigation.hidden = true;
    choices.hidden = false;
    hosting.hidden = !options.hostingOptions || options.hostingOptions.hidden;
    (singlePlayer.disabled ? hostRoom : singlePlayer).focus();
  };
  const showMainMenu = () => {
    navigation.hidden = false;
    choices.hidden = true;
    hosting.hidden = true;
    error.textContent = "";
    play.focus();
  };
  play.onclick = showPlayMenu;
  back.onclick = showMainMenu;
  element.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !choices.hidden &&
      !dialog.dialog.open &&
      !pending
    ) {
      event.preventDefault();
      showMainMenu();
    }
  });
  const run = async (
    action: () => Promise<void> | void,
    trigger: HTMLButtonElement,
    pendingLabel: string,
    label: string,
  ) => {
    if (trigger.disabled) return;
    pending = true;
    for (const choice of [singlePlayer, hostRoom, joinRoom, back])
      choice.disabled = true;
    trigger.textContent = pendingLabel;
    error.textContent = "";
    try {
      await action();
    } catch (failure) {
      error.textContent =
        failure instanceof Error ? failure.message : String(failure);
    } finally {
      pending = false;
      for (const choice of [singlePlayer, hostRoom, joinRoom, back])
        choice.disabled = false;
      singlePlayer.disabled =
        !options.onSinglePlayer && !singlePlayerContent().length;
      trigger.textContent = label;
    }
  };
  hostRoom.onclick = () => {
    returnFocus = hostRoom;
    if (options.onPlay)
      void run(options.onPlay, hostRoom, "Creating room…", "Host room");
    else open("Host room", [options.play]);
  };
  singlePlayer.disabled =
    !options.onSinglePlayer && !singlePlayerContent().length;
  if (singlePlayer.disabled)
    singlePlayer.title = "This game has no single-player mode.";
  singlePlayer.onclick = () => {
    returnFocus = singlePlayer;
    const content = singlePlayerContent();
    if (content.length) {
      content.forEach((node) => owned.add(node));
      open("Single player", content);
      dialog.close.before(...barActions);
      // Enter right after opening plays: the action that starts the game is the last in the bar.
      const start = barActions[barActions.length - 1];
      if (start instanceof (doc.defaultView?.HTMLElement ?? HTMLElement))
        start.focus();
    } else if (options.onSinglePlayer)
      void run(
        options.onSinglePlayer,
        singlePlayer,
        "Starting…",
        "Single player",
      );
  };
  joinRoom.onclick = () => {
    returnFocus = joinRoom;
    if (options.onJoinRoom) options.onJoinRoom();
    else open("Join room", options.joinContent ?? [options.play]);
  };
  how.onclick = () => {
    returnFocus = how;
    options.onHowToPlay ? options.onHowToPlay() : open("How to play", [help]);
  };
  about.onclick = () => {
    returnFocus = about;
    const credits = el("div", "", "fui-menu-credits", doc);
    credits.append(el("p", "Made by the vibe coding gang", "", doc));
    const names = el("ul", "", "", doc);
    for (const name of VIBE_CODING_GANG) names.append(el("li", name, "", doc));
    credits.append(names);
    open("About", [credits]);
  };
  settingsButton.onclick = () => {
    returnFocus = settingsButton;
    options.onSettings ? options.onSettings() : open("Settings", [settings]);
  };
  settingsButton.hidden = !options.onSettings;
  const addSettings = (...nodes: Node[]) => {
    settings.append(...nodes);
    settingsButton.hidden = !settings.childNodes.length;
  };
  if (options.settings?.length) addSettings(...options.settings);
  navigation.append(play, how, about, settingsButton);
  /** A screen of the game's own on the front door, after Play: `label` is its button, `open` goes there. */
  const addEntry = (label: string, open: () => void) => {
    const entry = button(label, "", doc);
    entry.onclick = () => open();
    how.before(entry);
    return entry;
  };
  home.append(title, description, navigation, choices, hosting, error);
  element.append(home, dialog.dialog, parking);
  let backgroundActive = false,
    stopBackground = () => {};
  const startBackground = () => {
    if (backgroundActive || !options.background) return;
    element.querySelector(".fui-attract")?.remove();
    element.querySelector(".fui-attract-toggle")?.remove();
    backgroundActive = true;
    stopBackground = mountAttract(element, options.background);
  };
  const dispose = () => {
    backgroundActive = false;
    stopBackground();
  };
  startBackground();
  return {
    element,
    help,
    settings,
    addSettings,
    addEntry,
    play,
    singlePlayer,
    hostRoom,
    joinRoom,
    showPlayMenu,
    dialog: dialog.dialog,
    dispose,
    startBackground,
  };
}
