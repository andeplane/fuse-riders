import type { ControlHint } from "fuse-ui";

/** How to play, in the words every screen uses: the landing page, the lobby, the menu and the guide before a game. */
export const GOAL =
  "Two teams of three: a Queen and two Workers each. Win a game one of three ways. Bots play every empty seat.";
export const WINS: readonly { name: string; how: string }[] = [
  { name: "MILITARY", how: "Kill the enemy Queen three times." },
  { name: "ECONOMIC", how: "Fill every hole of your hive with berries." },
  { name: "SNAIL", how: "A Worker rides the snail into your goal." },
];
export const ROLES: readonly { name: string; how: string }[] = [
  {
    name: "QUEEN",
    how: "Flies and kills on contact. Whoever is higher wins a clash; down dives. Touch a gate to claim it for your team.",
  },
  {
    name: "WORKER",
    how: "Carries one berry at a time: bank it in the hive, or stand in a gate with it to come out a Warrior (flies and kills) or faster. Only Workers ride the snail.",
  },
];
export const CONTROLS: readonly ControlHint[] = [
  { keys: "A / D or ← / →", action: "Move" },
  {
    keys: "Space, Z, W or ↑",
    action: "Jump (Worker) or flap (Queen, Warrior)",
  },
  { keys: "S or ↓", action: "Dive as the Queen; drop through a platform" },
  { keys: "Gamepad", action: "Stick or D-pad to move, A to jump or flap" },
];
export const TOUCH_CONTROLS: readonly ControlHint[] = [
  { keys: "Left thumb", action: "Slide left or right to move, down to dive" },
  { keys: "Right thumb", action: "Tap the big button to jump or flap" },
];
