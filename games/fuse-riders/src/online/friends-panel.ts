import {
  createFriendsPanel as sharedFriends,
  type FriendsPanelDependencies,
} from "fuse-ui/social-friends";
import { createAvatarPortrait } from "../client/avatar-heads.js";
import type { AvatarId } from "../engine/avatar-id.js";
import { PORTAL_GAMES } from "fuse-ui/portal";
import "./friends-panel.css";
export type {
  FriendsPanelAuth,
  FriendsPanelHandle,
} from "fuse-ui/social-friends";
export type { FriendsPanelDependencies };
export const createFriendsPanel = (dependencies: FriendsPanelDependencies) => {
  const panel = sharedFriends({
    ...dependencies,
    gameName: (id) =>
      PORTAL_GAMES.find((game) => game.id === id)?.name ??
      (id === "fuse-riders" ? "Fuse Riders" : "a game"),
    avatar: (id) => createAvatarPortrait(id as AvatarId),
  });
  panel.button.classList.add("landing-account");
  panel.dialog.classList.add("game-dialog");
  return panel;
};
