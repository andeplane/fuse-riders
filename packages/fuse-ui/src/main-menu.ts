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
  /** When supplied, Play creates a room directly. Other modes remain available below the menu. */
  onPlay?: () => Promise<void> | void;
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
  const other = button(
    "Join a room · Solo & local play",
    "fui-main-menu-other",
    doc,
  );
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
  parking.append(options.play, help, settings);
  const park = () => {
    for (const node of Array.from(dialog.body.childNodes)) {
      if (node === options.play || node === help || node === settings)
        parking.append(node);
      else node.remove();
    }
  };
  dialog.dialog.addEventListener("close", park);
  const open = (name: string, nodes: readonly Node[]) => {
    park();
    dialog.show({ title: name, content: nodes });
  };
  play.onclick = async () => {
    if (!options.onPlay) return open("Play", [options.play]);
    play.disabled = true;
    play.textContent = "Creating room…";
    error.textContent = "";
    try {
      await options.onPlay();
    } catch (failure) {
      error.textContent =
        failure instanceof Error ? failure.message : String(failure);
    } finally {
      play.disabled = false;
      play.textContent = "Play";
    }
  };
  other.onclick = () => open("More ways to play", [options.play]);
  how.onclick = () =>
    options.onHowToPlay ? options.onHowToPlay() : open("How to play", [help]);
  about.onclick = () => {
    const credits = el("div", "", "fui-menu-credits", doc);
    credits.append(el("p", "Made by the vibe coding gang", "", doc));
    const names = el("ul", "", "", doc);
    for (const name of VIBE_CODING_GANG) names.append(el("li", name, "", doc));
    credits.append(names);
    open("About", [credits]);
  };
  settingsButton.onclick = () =>
    options.onSettings ? options.onSettings() : open("Settings", [settings]);
  settingsButton.hidden = !options.onSettings;
  const addSettings = (...nodes: Node[]) => {
    settings.append(...nodes);
    settingsButton.hidden = !settings.childNodes.length;
  };
  if (options.settings?.length) addSettings(...options.settings);
  navigation.append(play, how, about, settingsButton);
  home.append(title, description, navigation, other, error);
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
    play,
    dialog: dialog.dialog,
    dispose,
    startBackground,
  };
}
