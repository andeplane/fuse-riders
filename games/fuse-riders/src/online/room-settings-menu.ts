import { el as element } from "fuse-ui";
import {
  defaultRoomSettings,
  type RoomSettings,
} from "../engine/room-settings.js";
import {
  POWERUP_PRESETS,
  RARITIES,
  rarityOf,
  weightFor,
} from "./powerup-rarity.js";
import { TICK_HZ, type PickupType } from "../engine/game.js";
import { ARENA_MAP_LABELS } from "../render/arena-maps.js";
import type { ArenaMapChoice } from "../engine/arena-map.js";
import {
  BOMB_MIN_CHARGE_TICKS,
  BOMB_CHARGE_TICKS_LIMIT,
} from "../engine/bomb-launch.js";
import "./room-settings-menu.css";
/** One draft survives submenu navigation; every valid change publishes it, so there is no Save button to find. */
export function showRoomSettings(
  body: HTMLElement,
  settings: RoomSettings,
  solo: boolean,
  labels: Record<PickupType, string>,
  save: (draft: RoomSettings) => boolean,
  start: "main" | "powerups" = "main",
): void {
  const draft = structuredClone(settings);
  // Typed aim text outlives submenu rebuilds so an off-grid value is still rejected on the next change instead of being silently rounded.
  let aimText = String(draft.bombChargeTicks / TICK_HZ);
  // Match length lands in the draft on every keystroke, so a change on either page checks the draft rather than the inputs of one page (#168).
  const validate = (): string | undefined => {
    if (
      !Number.isInteger(draft.length) ||
      draft.length < 1 ||
      draft.length > 20
    )
      return "Choose a match length from 1 to 20.";
    const seconds = Number(aimText),
      ticks = seconds * TICK_HZ;
    if (
      !aimText.trim() ||
      !Number.isFinite(seconds) ||
      ticks < BOMB_MIN_CHARGE_TICKS - 1e-6 ||
      ticks > BOMB_CHARGE_TICKS_LIMIT + 1e-6 ||
      Math.abs(ticks - Math.round(ticks)) > 1e-6
    )
      return "Choose a bomb aim time from 0.1 to 2 seconds in steps of 0.05.";
    return undefined;
  };
  // Every change publishes the whole draft. An invalid draft is kept, not published, and the page's alert says why; a
  // failed publish keeps the draft too, so the next change retries it. The room gets its own copy: the draft keeps changing.
  let commit = (): void => {};
  const publish = (alert: HTMLElement, prefix = "") => {
    const invalid = validate();
    if (invalid) {
      alert.textContent = `${invalid}${prefix}`;
      return;
    }
    alert.textContent = save(structuredClone(draft))
      ? ""
      : "Could not save settings. Check the room connection and try again.";
  };
  const choices = <T extends string>(
    title: string,
    value: T,
    options: readonly (readonly [T, string])[],
    change: (value: T) => void,
    disabled = false,
  ) => {
    const group = element("fieldset");
    group.className = "room-choice";
    group.disabled = disabled;
    group.append(element("legend", title));
    for (const [key, text] of options) {
      const label = element("label"),
        input = element("input");
      input.type = "radio";
      input.name = title;
      input.value = key;
      input.checked = value === key;
      input.onchange = () => {
        change(key);
        commit();
      };
      label.append(input, element("span", text));
      group.append(label);
    }
    return group;
  };
  const main = () => {
    body.replaceChildren(element("h2", "Room settings"));
    const error = element("p");
    error.setAttribute("role", "alert");
    commit = () => publish(error);
    body.append(
      choices(
        "Screen layout",
        draft.mode,
        [
          ["devices", "Full game on each device"],
          ["shared", "Shared TV + phone controls"],
        ],
        (value) => {
          draft.mode = value;
        },
        solo,
      ),
      choices(
        "Chain reaction",
        draft.chainReaction ? "on" : "off",
        [
          ["on", "Bombs set off bombs caught in the blast"],
          ["off", "Every bomb waits for its own fuse"],
        ],
        (value) => {
          draft.chainReaction = value === "on";
        },
      ),
      choices(
        "Aim bounce",
        draft.aimBounce ? "on" : "off",
        [
          ["on", "Holding past full reach aims back in and out again"],
          ["off", "Holding past full reach stays at maximum"],
        ],
        (value) => {
          draft.aimBounce = value === "on";
        },
      ),
      choices<ArenaMapChoice>(
        "Arena map",
        draft.map,
        [
          [
            "rotate",
            "A different map every round · with and without obstacles",
          ],
          ["desert", ARENA_MAP_LABELS.desert],
          ["forest", ARENA_MAP_LABELS.forest],
          ["city", ARENA_MAP_LABELS.city],
          ["classic", `${ARENA_MAP_LABELS.classic} · no obstacles`],
          ["wrap", `${ARENA_MAP_LABELS.wrap} · no walls until overtime`],
          [
            "cross",
            `${ARENA_MAP_LABELS.cross} · the classic arena, split four ways`,
          ],
          [
            "drift",
            `${ARENA_MAP_LABELS.drift} · open edges, and the walls wander`,
          ],
          ["trains", `${ARENA_MAP_LABELS.trains} · mind the level crossings`],
        ],
        (value) => {
          draft.map = value;
        },
      ),
    );
    body.append(
      element(
        "p",
        "Desert, Forest and City put rocks, buildings, crates and pyramids on the board. Crashing into one is fatal; a bomb blast clears it away.",
      ),
      element(
        "p",
        "Wrap-around has open edges: riders, shells, bullets, thrown bombs and blasts leave one side and arrive on the other. Crossed plays exactly like the classic arena, drawn shifted by half a board: the walls meet in a cross in the middle and the screen edges are open.",
      ),
      element(
        "p",
        "Drifting cross is Wrap-around with a cross of walls on it that slides around like a screensaver logo, bouncing off the edges. Trains keeps the classic walls and runs three trains round two loops of track: the rails are safe to cross, the trains are not, and neither bombs nor the closing walls stop them.",
      ),
    );
    const lengthLabel = element("label", "Match length"),
      length = element("input");
    length.type = "number";
    length.min = "1";
    length.max = "20";
    length.value = String(draft.length);
    length.setAttribute("aria-label", "Match length");
    length.oninput = () => {
      draft.length = Number(length.value);
      commit();
    };
    lengthLabel.append(length);
    body.append(lengthLabel);
    const presets = element("div");
    for (const rounds of [3, 5]) {
      const button = element(
        "button",
        rounds === 3 ? "3 ROUNDS · QUICK" : "5 ROUNDS · STANDARD",
      );
      button.type = "button";
      button.onclick = () => {
        draft.length = rounds;
        length.value = String(rounds);
        commit();
      };
      presets.append(button);
    }
    body.append(
      presets,
      element(
        "p",
        "Most points wins. +1 per opponent outlasted, +1 for the sole survivor. Ties break on round wins, then share victory.",
      ),
    );
    const aimLabel = element("label", "Bomb aim time (seconds)"),
      aim = element("input");
    aim.type = "number";
    aim.min = String(BOMB_MIN_CHARGE_TICKS / TICK_HZ);
    aim.max = String(BOMB_CHARGE_TICKS_LIMIT / TICK_HZ);
    aim.step = String(1 / TICK_HZ);
    aim.required = true;
    aim.value = aimText;
    aim.setAttribute("aria-label", "Bomb aim time (seconds)");
    aim.oninput = () => {
      aimText = aim.value;
      if (aim.checkValidity())
        draft.bombChargeTicks = Math.round(Number(aim.value) * TICK_HZ);
      commit();
    };
    aimLabel.append(aim);
    body.append(
      aimLabel,
      element(
        "p",
        "Time to reach maximum bomb distance. Lower values aim farther, faster, and with aim bounce on the range walks back in just as quickly.",
      ),
    );
    const configure = element("button", "CONFIGURE POWERUPS");
    configure.onclick = powerups;
    body.append(
      configure,
      element(
        "p",
        "Changes save as you make them. Gameplay changes apply next round. Match length applies next match.",
      ),
      error,
    );
    body.scrollTop = 0;
  };
  const powerups = () => {
    body.replaceChildren(element("h2", "Configure powerups"));
    const powerupError = element("p");
    powerupError.setAttribute("role", "alert");
    // Ctrl+P opens this page directly (#168), so it publishes here too, through the same validate() as the main page.
    commit = () =>
      publish(powerupError, " Go back to room settings to fix it.");
    const back = element("button", "← BACK TO ROOM SETTINGS");
    back.onclick = main;
    body.append(
      back,
      element(
        "p",
        "Tap a rarity per power-up, or pick a preset. The number is the spawn weight; 0 turns a power-up off.",
      ),
    );
    // Presets rewrite every weight; rarity chips scale each power-up's default so "common" always means the same thing across rooms.
    const defaults = defaultRoomSettings().weights;
    const presetRow = element("div");
    presetRow.className = "powerup-presets";
    const inputs = new Map<string, HTMLInputElement>();
    const chips = new Map<string, HTMLButtonElement[]>();
    const percentages = new Map<string, HTMLElement>();
    const recalc = () => {
      const total = Object.values(draft.weights).reduce(
        (sum, weight) => sum + (weight ?? 0),
        0,
      );
      for (const [type, output] of percentages)
        output.textContent = `${total ? (((draft.weights[type as PickupType] ?? 0) / total) * 100).toFixed(1) : "0"}%`;
      for (const [type, buttons] of chips) {
        const current = rarityOf(
          type as PickupType,
          draft.weights[type as PickupType] ?? 0,
          defaults,
        );
        for (const button of buttons)
          button.setAttribute(
            "aria-pressed",
            String(button.dataset.rarity === current),
          );
      }
    };
    const setWeight = (type: PickupType, weight: number) => {
      draft.weights[type] = weight;
      const input = inputs.get(type);
      if (input) input.value = String(weight);
      recalc();
    };
    // A preset writes every weight before one publish; a chip or a typed weight publishes on its own.
    for (const [name, weights] of Object.entries(POWERUP_PRESETS)) {
      const button = element("button", name);
      button.type = "button";
      button.onclick = () => {
        for (const type of Object.keys(labels) as PickupType[])
          setWeight(type, weights(type, defaults));
        commit();
      };
      presetRow.append(button);
    }
    body.append(presetRow);
    for (const [type, title] of Object.entries(labels)) {
      const row = element("div");
      row.className = "powerup-row";
      const rarityRow = element("div");
      rarityRow.className = "powerup-rarity";
      rarityRow.setAttribute("role", "group");
      rarityRow.setAttribute("aria-label", `${title} rarity`);
      const buttons: HTMLButtonElement[] = [];
      for (const rarity of RARITIES) {
        const chip = element("button", rarity.toUpperCase());
        chip.type = "button";
        chip.dataset.rarity = rarity;
        chip.onclick = () => {
          setWeight(
            type as PickupType,
            weightFor(type as PickupType, rarity, defaults),
          );
          commit();
        };
        buttons.push(chip);
        rarityRow.append(chip);
      }
      chips.set(type, buttons);
      const label = element("label", title),
        input = element("input"),
        percent = element("span");
      input.type = "number";
      input.min = "0";
      input.max = "10000";
      input.value = String(draft.weights[type as PickupType] ?? 0);
      input.oninput = () => {
        draft.weights[type as PickupType] = Math.max(
          0,
          Math.min(10000, Math.round(Number(input.value) || 0)),
        );
        recalc();
        commit();
      };
      label.append(input, percent);
      percentages.set(type, percent);
      inputs.set(type, input);
      row.append(label, rarityRow);
      body.append(row);
    }
    body.append(
      element("p", "Changes save as you make them and apply next round."),
      powerupError,
    );
    recalc();
    body.scrollTop = 0;
  };
  if (start === "powerups") powerups();
  else main(); // Ctrl+P opens the power-up page directly (#168).
}
