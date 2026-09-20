import { assetUrl } from "../render/asset-url.js";
import { isAvatarId, type AvatarId } from "../engine/avatar-id.js";
import {
  AVATARS,
  AVATAR_ATLAS_URL,
  HUMAN_DEFAULT_AVATAR,
  avatarCell,
} from "../shared/avatars.js";
import { createPicker, el, type Picker } from "fuse-ui";
import "./avatar-heads.css";

const AVATAR_KEY = "fuse-riders-avatar";

export function createAvatarPortrait(id: AvatarId): HTMLSpanElement {
  const portrait = el("span", "", "avatar-portrait");
  portrait.style.backgroundImage = `url("${assetUrl(AVATAR_ATLAS_URL)}")`;
  portrait.dataset.avatarId = id;
  portrait.setAttribute("role", "img");
  portrait.setAttribute(
    "aria-label",
    `${AVATARS.find((avatar) => avatar.id === id)?.label ?? "Robot"} avatar`,
  );
  const { column, row } = avatarCell(id);
  portrait.style.backgroundPosition = `${column * 25}% ${row * 100}%`;
  return portrait;
}

/** The portrait inside a picker option: decoration only, the option's label names it. */
function optionPortrait(id: AvatarId): HTMLSpanElement {
  const portrait = el("span", "", "avatar-portrait");
  portrait.style.backgroundImage = `url("${assetUrl(AVATAR_ATLAS_URL)}")`;
  portrait.setAttribute("aria-hidden", "true");
  const { column, row } = avatarCell(id);
  portrait.style.backgroundPosition = `${column * 25}% ${row * 100}%`;
  return portrait;
}

const avatarLabel = (id: AvatarId) =>
  AVATARS.find((avatar) => avatar.id === id)?.label ?? "Robot";

/**
 * The avatar grid on fuse-ui's picker. The choice is remembered on this browser. `fold` puts the grid behind one
 * button showing the current avatar and CHANGE (the join form, #142); its `id` is the grid's element id.
 */
export function createAvatarPicker(
  storage: Pick<Storage, "getItem" | "setItem">,
  onChange?: (id: AvatarId) => void,
  fold?: { id: string },
): Picker<AvatarId> {
  const stored = storage.getItem(AVATAR_KEY);
  const selected: AvatarId = isAvatarId(stored) ? stored : HUMAN_DEFAULT_AVATAR;
  const picker = createPicker<AvatarId>({
    legend: "Choose your avatar",
    choices: AVATARS,
    selected,
    art: optionPortrait,
    dataKey: "avatarId",
    onPick: (id) => {
      storage.setItem(AVATAR_KEY, id);
      onChange?.(id);
    },
    ...(fold
      ? {
          fold: {
            id: fold.id,
            summary: (id: AvatarId) => [
              createAvatarPortrait(id),
              el("span", `Avatar · ${avatarLabel(id)}`),
            ],
            label: (id: AvatarId) => `Avatar · ${avatarLabel(id)}, change`,
          },
        }
      : {}),
    classes: {
      root: "avatar-picker",
      options: "avatar-options",
      option: "avatar-option",
      summary: "avatar-current",
      change: "avatar-change",
    },
  });
  return {
    ...picker,
    sync(id) {
      if (picker.selected() === id) return;
      storage.setItem(AVATAR_KEY, id);
      picker.sync(id);
    },
  };
}
