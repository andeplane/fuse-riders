export interface MobilePlayState {
  joined: boolean;
  phase: string;
  displayOnly: boolean;
  host?: boolean;
  ended?: boolean;
  recapReady?: boolean;
}
/** Phones (touch, short side ≤ 700) and portrait windows/tablets up to 1024px wide in the lobby get the lobby screen (#134): the room code, riders and actions in either orientation, no controller.
 *  Once a joined phone leaves the lobby it is the thirds controller in either orientation for countdown, playing, roundOver and matchOver (#13).
 *  An ended room is neither, so the header status and BACK TO LOBBY are readable without ☰ MENU (#44).
 *  An unjoined phone (a host driving a TV) is back on the lobby screen once the match report is ready; a joined phone stays the controller. */
export function mobilePlayPolicy(
  state: MobilePlayState,
  touch: boolean,
  width: number,
  height: number,
) {
  const phone =
    ((touch && Math.min(width, height) <= 700) ||
      (height > width && width <= 1024)) &&
    !state.displayOnly &&
    !state.ended;
  const lobby =
    phone &&
    (state.phase === "lobby" || (state.recapReady === true && !state.joined));
  const active = phone && state.joined && !lobby;
  return { phone, lobby, active, portrait: active && height > width };
}

export interface ArenaViewState {
  shared: boolean;
  displayOnly: boolean;
  joined: boolean;
  joining: boolean;
  phase: string;
  recapReady: boolean;
}
/** Whether this device shows the Phaser arena, and whether it shows it as the blurred scene behind the lobby and results (#321).
 *  A joined rider in shared-TV mode is a controller (ADR 042's UI mode): the TV draws the arena, so the controller never shows or renders it,
 *  in any phase — lobby and results included. Every other device keeps the live scene behind the lobby and results. */
export function arenaView(state: ArenaViewState) {
  const controller = state.shared && !state.displayOnly && state.joined;
  const sceneBackground =
    !controller && (state.phase === "lobby" || state.recapReady);
  return { controller, sceneBackground, hidden: controller || state.joining };
}
