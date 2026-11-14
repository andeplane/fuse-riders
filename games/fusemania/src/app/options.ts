import { button, elementsFor } from "fuse-ui";
import { SPEEDS } from "./prefs.js";

/**
 * What a player sets beside the song select: their own scroll speed, a random song, and in a room how many songs
 * one session plays and whether the host picks them or the room draws them.
 *
 * Like the song picker it holds no state: a click reports what was asked for, and the element shows the last state
 * it was given until the page answers with `update`. The speed is this device's own and only spreads the arrows
 * apart; the session is the room's and its chips are the host's. Every other player reads what the host set as one
 * line (`sessionLine`) and has only their own speed to choose.
 */
export interface OptionsState {
  /** This device's scroll speed. */
  speed: number;
  /** May this player change the room's options (the host, or a solo player)? */
  host: boolean;
  /** Songs a session plays: one is a single song. */
  songs: number;
  /** A session's songs are drawn at random. */
  random: boolean;
}
export interface PlayOptionsOptions {
  document: Document;
  /** The session lengths on offer; leave out for a select with no sessions (solo). */
  lengths?: readonly number[];
  onSpeed(speed: number): void;
  /** The player asked for a random song. */
  onRandomSong(): void;
  onSongs?(songs: number): void;
  onOrder?(random: boolean): void;
}
export interface PlayOptions {
  /** This player's speed and, in a room, the session. */
  element: HTMLElement;
  /**
   * RANDOM SONG. It picks a song, so it belongs with the song carousel (the picker's `tools`), not under the
   * levels: the page places it.
   */
  random: HTMLButtonElement;
  /** Shows `state`. Cheap on every room frame: nothing is written unless it changed. */
  update(state: OptionsState): void;
}

export const speedLabel = (speed: number): string => `${speed}x`;
export const lengthLabel = (songs: number): string =>
  songs === 1 ? "1 SONG" : `${songs} SONGS`;
/** What a player who cannot change the session reads of it: "5 SONGS · RANDOM", or "1 SONG". */
export const sessionLine = (songs: number, random: boolean): string =>
  songs <= 1
    ? lengthLabel(1)
    : `${lengthLabel(songs)} · ${random ? "RANDOM" : "HOST PICKS"}`;
export const ORDERS = [
  { random: false, name: "HOST PICKS", line: "The host picks every song" },
  { random: true, name: "RANDOM", line: "Every song is a surprise" },
] as const;

export function createPlayOptions(options: PlayOptionsOptions): PlayOptions {
  const el = elementsFor(options.document);
  const root = el("div", "", "fm-options");
  const chip = (text: string, className: string) =>
    button(text, `fm-option ${className}`, options.document);
  const row = (label: string, className: string) => {
    const node = el("div", "", `fm-options-row ${className}`),
      chips = el("div", "", "fm-options-chips");
    chips.setAttribute("role", "group");
    chips.setAttribute("aria-label", label);
    node.append(el("span", label, "fm-options-label"), chips);
    return { node, chips };
  };
  const press = (node: HTMLElement, on: boolean) => {
    const value = String(on);
    if (node.getAttribute("aria-pressed") !== value)
      node.setAttribute("aria-pressed", value);
  };

  const hide = (node: HTMLElement, hidden: boolean) => {
    if (node.hidden !== hidden) node.hidden = hidden;
  };

  const random = chip("RANDOM SONG", "fm-option-random");
  random.onclick = () => options.onRandomSong();

  const speed = row("YOUR SPEED", "fm-options-speed");
  const speeds = SPEEDS.map((value) => {
    const node = chip(speedLabel(value), "fm-option-speed");
    node.onclick = () => options.onSpeed(value);
    speed.chips.append(node);
    return { value, node };
  });
  speed.node.append(
    el(
      "small",
      "Spreads your own arrows apart. The beat and the judging stay the same.",
      "fm-options-hint",
    ),
  );

  const lengths = options.lengths ?? [];
  const songs = row("SONGS", "fm-options-songs"),
    order = row("NEXT SONG", "fm-options-order");
  const lengthChips = lengths.map((value) => {
    const node = chip(lengthLabel(value), "fm-option-songs");
    node.onclick = () => options.onSongs?.(value);
    songs.chips.append(node);
    return { value, node };
  });
  const orderChips = ORDERS.map((choice) => {
    const node = chip(choice.name, "fm-option-order");
    node.title = choice.line;
    node.onclick = () => options.onOrder?.(choice.random);
    order.chips.append(node);
    return { random: choice.random, node };
  });

  const summary = el("p", "", "fm-options-summary"),
    summaryText = el("b");
  summary.append(el("span", "SESSION", "fm-options-label"), summaryText);
  summary.hidden = true;

  root.append(speed.node);
  if (lengths.length) root.append(songs.node, order.node, summary);

  return {
    element: root,
    random,
    update(state) {
      for (const each of speeds) press(each.node, each.value === state.speed);
      // A random session draws its own songs: there is nothing to draw by hand.
      hide(random, !state.host || (state.songs > 1 && state.random));
      for (const each of lengthChips) {
        press(each.node, each.value === state.songs);
        each.node.disabled = !state.host;
      }
      // The chips are the host's to press: everyone else gets the line.
      hide(songs.node, !state.host);
      hide(summary, state.host);
      const line = sessionLine(state.songs, state.random);
      if (summaryText.textContent !== line) summaryText.textContent = line;
      hide(order.node, !state.host || state.songs <= 1);
      for (const each of orderChips) {
        press(each.node, each.random === state.random);
        each.node.disabled = !state.host;
      }
    },
  };
}

export interface OptionsMenu {
  /** The OPTIONS button with its panel: one node for a bar. */
  element: HTMLElement;
  button: HTMLButtonElement;
  panel: HTMLElement;
  close(): void;
}

/**
 * OPTIONS: a button that opens a panel under itself, for a bar that has no room for the options themselves (the
 * solo song select keeps it beside PLAY). A press outside the panel, or Escape, closes it.
 */
export function createOptionsMenu(options: {
  document: Document;
  content: readonly Node[];
}): OptionsMenu {
  const doc = options.document,
    el = elementsFor(doc);
  const root = el("span", "", "fm-options-menu"),
    toggle = button("OPTIONS", "fm-options-toggle", doc),
    panel = el("div", "", "fm-options-panel");
  panel.id = "fm-options-panel";
  panel.hidden = true;
  panel.append(...options.content);
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", panel.id);
  const set = (open: boolean) => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.onclick = () => set(panel.hidden);
  doc.addEventListener("pointerdown", (event) => {
    if (!panel.hidden && !root.contains(event.target as Node | null))
      set(false);
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || panel.hidden) return;
    // Escape closes the panel, not the dialog under it.
    event.preventDefault();
    event.stopPropagation();
    set(false);
    toggle.focus();
  });
  root.append(toggle, panel);
  return { element: root, button: toggle, panel, close: () => set(false) };
}
