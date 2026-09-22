import {
  createInviteCard,
  createNameEntry,
  createRoster,
  elementsFor,
} from "fuse-ui";
import type { RoomCommand } from "fuse-netcode";
import { ballGame, type Settings } from "../online/game.js";
import { colorCss } from "../render/present.js";
import { roomModel } from "./room-model.js";
import { NAME_KEY, type Store } from "./session.js";
import { avatarChoice, chosenAvatar } from "./avatars.js";
import { ARENA_MAPS, MAP_IDS, type MapId } from "../engine/maps.js";

export function roomPanel(
  root: HTMLElement,
  options: {
    code: string;
    link: string;
    displayLink: string;
    display: boolean;
    store: Store;
    qr(link: string): Promise<string>;
    command(command: RoomCommand<Settings>): void;
  },
) {
  const document = root.ownerDocument,
    el = elementsFor(document);
  const element = el("section", "", "room-panel");
  const invite = createInviteCard({
    document,
    code: options.code,
    link: options.link,
    qr: options.qr,
  });
  const roster = createRoster({ document, emptyText: "Nobody has joined yet" });
  const name = createNameEntry({
    document,
    initial: options.store.getItem(NAME_KEY) ?? "",
    normalize: (s) => ballGame.seating.seatName(s) ?? "",
    onSubmit(value) {
      options.store.setItem(NAME_KEY, value);
      options.command({
        type: "join",
        name: value,
        avatarId: chosenAvatar(options.store),
      });
    },
  });
  name.form.prepend(avatarChoice(document, options.store));
  const add = el("button", "+ ADD BOT", "quiet-button");
  add.onclick = () => options.command({ type: "bot", action: "add" });
  const start = el("button", "START MATCH", "primary");
  start.onclick = () => options.command({ type: "action", action: "start" });
  const tv = el("a", "OPEN TV SCREEN", "quiet-button");
  tv.href = options.displayLink;
  tv.target = "_blank";
  tv.rel = "noopener";
  const note = el("p", "Connecting to the room…", "room-note");
  const map = el("select", "", "map-select");
  for (const mapId of MAP_IDS) {
    const option = el("option", ARENA_MAPS[mapId].label);
    option.value = mapId;
    map.append(option);
  }
  const mapChoice = el("label", "", "map-choice");
  mapChoice.append(el("span", "ARENA"), map);
  map.onchange = () =>
    options.command({
      type: "settings",
      settings: { display: lastDisplay, mapId: map.value as MapId },
    });
  const actions = el("div", "", "room-actions");
  actions.append(add, start, tv);
  element.append(
    invite.element,
    el("h2", "PLAYERS"),
    name.form,
    roster.element,
    mapChoice,
    note,
    actions,
  );
  root.append(element);
  let key = "";
  let lastDisplay = false;
  name.form.hidden = true;
  actions.hidden = true;
  return {
    element,
    render(model: ReturnType<typeof roomModel>) {
      const next = JSON.stringify(model);
      if (next === key) return;
      key = next;
      element.hidden = !model.lobby;
      lastDisplay = model.display;
      map.querySelectorAll<HTMLOptionElement>("option").forEach((option) => {
        option.selected = option.value === model.mapId;
      });
      map.disabled = !model.manage;
      name.form.hidden = !model.askName;
      actions.hidden = false;
      add.hidden = !model.canAdd;
      start.hidden = !model.manage;
      start.disabled = !model.canStart;
      tv.hidden = options.display;
      note.textContent = model.note;
      roster.update(
        model.players.map((p) => ({ ...p, color: colorCss(p.color) })),
      );
      for (const [id, row] of roster.entries()) {
        let remove = row.querySelector<HTMLButtonElement>(".remove-bot");
        if (!remove) {
          remove = el("button", "REMOVE", "quiet-button remove-bot");
          remove.setAttribute("aria-label", "Remove bot");
          remove.onclick = () =>
            options.command({ type: "bot", action: "remove", id });
          row.append(remove);
        }
        remove.hidden = !model.players.find((p) => p.id === id)?.removable;
      }
    },
  };
}
