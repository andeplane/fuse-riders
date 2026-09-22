import { createLandingCard, elementsFor } from "fuse-ui";
import { validRoomCode } from "fuse-network-fe";
import {
  chosenMap,
  rememberMap,
  rememberRoom,
  roomFailure,
  type Store,
} from "./session.js";
import { avatarChoice } from "./avatars.js";
import { ARENA_MAPS, MAP_IDS, type MapId } from "../engine/maps.js";

export function landing(
  root: HTMLElement,
  options: {
    store: Store;
    create(): Promise<{ code: string; token: string }>;
    navigate(query: string): void;
    active?(): boolean;
  },
) {
  const el = elementsFor(root.ownerDocument);
  const shared = el("input");
  shared.type = "checkbox";
  const choice = el("label", "", "shared-choice");
  choice.append(shared, el("span", "Shared TV + phone controllers"));
  const map = el("select", "", "map-select");
  for (const mapId of MAP_IDS) {
    const option = el("option", ARENA_MAPS[mapId].label);
    option.value = mapId;
    map.append(option);
  }
  map.querySelector<HTMLOptionElement>(
    `option[value="${chosenMap(options.store)}"]`,
  )!.selected = true;
  map.onchange = () => rememberMap(options.store, map.value as MapId);
  const mapChoice = el("label", "", "map-choice");
  mapChoice.append(el("span", "ARENA"), map);
  const card = createLandingCard({
    document: root.ownerDocument,
    title: "BALL BROS",
    tagline: "Five cores. One survivor. Orbit, reach, ricochet.",
    soloText: "PLAY SOLO",
    valid: validRoomCode,
    async onCreate() {
      try {
        const room = await options.create();
        if (options.active && !options.active()) return;
        rememberRoom(options.store, room.code, room.token, shared.checked);
        options.navigate(`?room=${room.code}`);
      } catch (error) {
        throw new Error(
          roomFailure(error instanceof Error ? error.message : String(error)),
        );
      }
    },
    onSolo: () => options.navigate("?solo=1"),
    onJoin: (code) => options.navigate(`?room=${code}`),
  });
  card.create.before(choice);
  choice.before(avatarChoice(root.ownerDocument, options.store), mapChoice);
  const help = el(
    "p",
    "A / D orbit · W / S out / in · Space launch",
    "landing-help",
  );
  const back = el("a", "← FUSE ARCADE", "back");
  back.href = "../";
  root.replaceChildren(back, card.element, help);
  return card;
}
