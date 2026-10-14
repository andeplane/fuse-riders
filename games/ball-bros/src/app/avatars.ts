import { AVATAR_ATLAS } from "fuse-ui/assets";
import { isAvatar } from "../engine/avatars.js";
import type { Store } from "./session.js";
export const AVATAR_KEY = "ball-bros-avatar";
export function chosenAvatar(store: Store): string {
  const value = store.getItem(AVATAR_KEY);
  return isAvatar(value) ? value : "fox";
}
export function avatarChoice(document: Document, store: Store): HTMLElement {
  const label = document.createElement("label");
  label.className = "avatar-choice";
  label.textContent = "YOUR CORE ";
  const select = document.createElement("select");
  const portrait = document.createElement("span");
  portrait.className = "avatar-preview";
  portrait.setAttribute("aria-hidden", "true");
  portrait.style.backgroundImage = `url(..${AVATAR_ATLAS.url})`;
  select.setAttribute("aria-label", "Core avatar");
  for (const id of AVATAR_ATLAS.frames) {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id.toUpperCase();
    option.selected = id === chosenAvatar(store);
    select.append(option);
  }
  const preview = () => {
    const index = AVATAR_ATLAS.frames.findIndex((id) => id === select.value);
    portrait.style.backgroundPosition = `${(index % 5) * 25}% ${Math.floor(index / 5) * 50}%`;
  };
  select.onchange = () => {
    store.setItem(AVATAR_KEY, select.value);
    preview();
  };
  preview();
  label.append(portrait, select);
  return label;
}
