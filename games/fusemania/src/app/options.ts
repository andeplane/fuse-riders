import { button, elementsFor } from "fuse-ui";
import { SPEEDS } from "./prefs.js";

/**
 * What a player sets beside the song select: their own scroll speed, a random song, and in a room how many songs
 * one session plays and whether the host picks them or the room draws them.
 *
 * Like the song picker it holds no state: a click reports what was asked for, and the element shows the last state
 * it was given until the page answers with `update`. The speed is this device's own and only spreads the arrows
 * apart; the session is the room's, so only the host's clicks are heard.
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
  element: HTMLElement;
  /** Shows `state`. Cheap on every room frame: nothing is written unless it changed. */
  update(state: OptionsState): void;
}

export const speedLabel = (speed: number): string => `${speed}x`;
export const lengthLabel = (songs: number): string =>
  songs === 1 ? "1 SONG" : `${songs} SONGS`;
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

  root.append(random, speed.node);
  if (lengths.length) root.append(songs.node, order.node);

  return {
    element: root,
    update(state) {
      for (const each of speeds) press(each.node, each.value === state.speed);
      // A random session draws its own songs: there is nothing to draw by hand.
      random.hidden = !state.host || (state.songs > 1 && state.random);
      for (const each of lengthChips) {
        press(each.node, each.value === state.songs);
        each.node.disabled = !state.host;
      }
      order.node.hidden = state.songs <= 1;
      for (const each of orderChips) {
        press(each.node, each.random === state.random);
        each.node.disabled = !state.host;
      }
    },
  };
}
