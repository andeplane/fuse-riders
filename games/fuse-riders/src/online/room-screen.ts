/**
 * What a room page is showing, derived in one place from what the room UI already knows each frame (#255 P3).
 *
 * `ui.ts` used to decide this piecemeal: a class toggled here, a `hidden` set there, and later code reading those
 * classes back (`app.classList.contains("mobile-play")`, `sharedLobby.hidden`) to decide the next thing. Now
 * `roomScreen` works the whole screen out from its inputs, `screenClasses` names the classes that follow from it,
 * and the page sets them in one place and never reads them back.
 *
 * The screens a room page has:
 *
 * | Kind         | The device shows                                                                                     |
 * | ------------ | ---------------------------------------------------------------------------------------------------- |
 * | `boot`       | The PREPARING ROOM card: a creator, a solo run or a TV before the room's first frame                 |
 * | `join`       | The join card: an invited device that has no seat (before and after the first frame)                 |
 * | `lobby`      | The lobby card (QR, riders, host actions), over the blurred arena, or the phone lobby (#134)         |
 * | `arena`      | The live arena: desktop, TV, solo, or a phone as the thirds controller over its own arena (#13)      |
 * | `controller` | A shared-TV rider's controller (ADR 042): no arena, the TV draws it                                  |
 * | `recap`      | The match report is ready; results open over the arena/lobby; shared-TV controllers show a rematch ready screen |
 * | `ended`      | ROOM CLOSED: the room ended for good (4004); everything else is frozen as it was                     |
 *
 * The kind is the name; the flags are what the page does with it. They are kept separately because the same kind
 * is drawn differently by different devices (a `recap` is a lobby card on the creator's laptop and a controller
 * on a shared-TV rider's phone, where results stay on the TV), and because each flag is exactly one class or one `hidden` on the page.
 */
import type { WorldView } from "../engine/view.js";
import {
  arenaView,
  mobilePlayPolicy,
  type MobilePlayState,
} from "./mobile-play-policy.js";

export type RoomRole = "solo" | "display" | "host" | "joiner";

/** What the device is, read fresh for every derivation: a rotation or a resize changes the screen. */
export interface RoomDevice {
  /** A touch screen or a coarse pointer. */
  touch: boolean;
  width: number;
  height: number;
  /** `(min-width: 1000px) and (hover: hover) and (pointer: fine)`: the compact desktop game bar may apply. */
  desktopPointer: boolean;
}

export interface RoomScreenInput {
  role: RoomRole;
  /** The room has delivered its first frame. Before it, the page shows the boot or join card and nothing else is decided. */
  booted: boolean;
  /** This device's rider is in the room's roster. */
  joined: boolean;
  /** This device has a place in the room's watching list: it is in the room, so it is not at its door. */
  watching: boolean;
  /** The last frame's phase; `"lobby"` before the first frame. */
  phase: WorldView["phase"];
  /** `matchOver` whose closing pause has run out: the match report is ready. */
  recapReady: boolean;
  /** The room plays on a shared TV (`settings.mode === "shared"`). */
  shared: boolean;
  device: RoomDevice;
}

/** The phone layout (`mobile-play-layout.css`). */
export interface MobileScreen {
  /** `.mobile-play`: a joined phone is the thirds controller. */
  active: boolean;
  /** `.mobile-portrait`: that controller is held upright. */
  portrait: boolean;
  /** `.phone-lobby`: a phone (or a narrow portrait window) gets the lobby screen. */
  lobby: boolean;
  /** `.mobile-lobby`: the room's phase is the lobby, whatever the device. */
  phaseLobby: boolean;
}

export interface ScreenFlags {
  /** `.booting`: the boot card is up. */
  booting: boolean;
  /** `.joining`: an invited device without a seat; its whole page is the join card. */
  joining: boolean;
  /** `.room-over`: the ROOM CLOSED card. */
  ended: boolean;
  /** The lobby card (`.shared-lobby`) is shown, and the page takes its shape (`.room-waiting`). The standings strip hides. */
  lobbyCard: boolean;
  /** `.controller-only`: a shared-TV rider's controller, with no arena. */
  controllerOnly: boolean;
  /** `.scene-background`: the arena is the blurred scene behind the lobby and results (#321). */
  sceneBackground: boolean;
  /** The arena canvas is hidden (and not drawn). */
  arenaHidden: boolean;
  /** This device is a shared-TV controller in any phase, lobby included: it never draws the arena, so VISUAL STYLE hides. */
  arenaController: boolean;
  /** `.desktop-game`: the compact desktop game bar. */
  desktop: boolean;
  /** `.side-standings`: desktop play keeps the standings in a column right of the arena. */
  sideStandings: boolean;
  mobile: MobileScreen;
}

export type RoomScreenKind =
  "boot" | "join" | "lobby" | "arena" | "controller" | "recap" | "ended";

export type RoomScreen =
  | (ScreenFlags & { kind: "boot" })
  | (ScreenFlags & { kind: "join" })
  | (ScreenFlags & { kind: "lobby" })
  | (ScreenFlags & { kind: "arena" })
  | (ScreenFlags & { kind: "controller" })
  | (ScreenFlags & { kind: "recap" })
  | (ScreenFlags & {
      kind: "ended";
      /** What the room was showing when it closed. */
      closedOn: Exclude<RoomScreenKind, "ended">;
    });

function mobileScreen(
  input: RoomScreenInput,
  state: MobilePlayState,
): MobileScreen {
  const { touch, width, height } = input.device;
  const policy = mobilePlayPolicy(state, touch, width, height);
  return {
    active: policy.active,
    portrait: policy.portrait,
    lobby: policy.lobby,
    phaseLobby: state.phase === "lobby",
  };
}

/** The screen of a live room (not ended). A pure function of its input. */
export function roomScreen(input: RoomScreenInput): RoomScreen {
  const displayOnly = input.role === "display";
  if (!input.booted) {
    // Before the first frame only the boot card is decided: the arena and the lobby card keep their initial state,
    // and a phone booting a room already takes the lobby shape (#134). An invited device waits here too rather than
    // on the join card, because it takes its own seat the moment the room arrives
    // (`docs/design/room-is-the-join-screen.md`). The card is the exception screen now — for a device the room will
    // not seat — so opening on it would be a gate that lifts a second later for everybody who can be seated.
    return {
      kind: "boot",
      booting: true,
      joining: false,
      ended: false,
      lobbyCard: false,
      controllerOnly: false,
      sceneBackground: false,
      arenaHidden: false,
      arenaController: false,
      desktop: false,
      sideStandings: false,
      mobile: mobileScreen(input, {
        joined: false,
        phase: "lobby",
        displayOnly,
      }),
    };
  }
  const joining = input.role === "joiner" && !input.joined && !input.watching;
  const mobile = mobileScreen(input, {
    joined: input.joined,
    phase: input.phase,
    displayOnly,
    recapReady: input.recapReady,
  });
  // The same arena stays behind the lobby and results; only its presentation changes. A shared-TV controller never shows it.
  const arena = arenaView({
    shared: input.shared,
    displayOnly,
    joined: input.joined,
    joining,
    phase: input.phase,
    recapReady: input.recapReady,
  });
  // A phone in the lobby always gets the lobby card (#134); elsewhere solo, a shared-TV controller and a phone playing
  // as the thirds controller have none. Once the recap is ready the room is back in the lobby it started from.
  const lobbyCard =
    (input.phase === "lobby" || input.recapReady) &&
    !joining &&
    (mobile.lobby ||
      !(input.role === "solo" || arena.controller || mobile.active));
  const controllerOnly = arena.controller && !mobile.lobby;
  const desktop =
    input.device.desktopPointer &&
    !mobile.active &&
    !controllerOnly &&
    !joining &&
    !lobbyCard;
  const flags: ScreenFlags = {
    booting: false,
    joining,
    ended: false,
    lobbyCard,
    controllerOnly,
    sceneBackground: arena.sceneBackground,
    arenaHidden: arena.hidden,
    arenaController: arena.controller,
    desktop,
    sideStandings: desktop && !arena.hidden && !arena.sceneBackground,
    mobile,
  };
  if (joining) return { ...flags, kind: "join" };
  if (input.recapReady) return { ...flags, kind: "recap" };
  if (lobbyCard) return { ...flags, kind: "lobby" };
  if (controllerOnly) return { ...flags, kind: "controller" };
  return { ...flags, kind: "arena" };
}

/**
 * The room closed for good. Nothing arrives after it, so the screen is frozen as it was, except that the boot card
 * goes, a shared-TV controller gives way to the ordinary header so the status reads without ☰ MENU (#44), and the
 * phone layout lets go. Pass `device` when the viewport changes afterwards: the desktop bar follows it again, and
 * the standings column stays down under the ROOM CLOSED card.
 */
export function endedScreen(
  behind: RoomScreen,
  device?: RoomDevice,
): RoomScreen {
  const closedOn = behind.kind === "ended" ? behind.closedOn : behind.kind;
  const flags: ScreenFlags = {
    ...behind,
    booting: false,
    ended: true,
    controllerOnly: false,
    mobile: {
      active: false,
      portrait: false,
      lobby: false,
      phaseLobby: behind.mobile.phaseLobby,
    },
  };
  if (device) {
    flags.desktop = device.desktopPointer && !flags.joining && !flags.lobbyCard;
    flags.sideStandings = false;
  }
  return { ...flags, kind: "ended", closedOn };
}

/** Every class a room screen sets on the app element. The page toggles exactly these, from here, and reads none back. */
export function screenClasses(screen: RoomScreen): Record<string, boolean> {
  return {
    booting: screen.booting,
    joining: screen.joining,
    "room-over": screen.ended,
    "room-waiting": screen.lobbyCard,
    "controller-only": screen.controllerOnly,
    "scene-background": screen.sceneBackground,
    "desktop-game": screen.desktop,
    "side-standings": screen.sideStandings,
    "mobile-play": screen.mobile.active,
    "mobile-portrait": screen.mobile.portrait,
    "mobile-lobby": screen.mobile.phaseLobby,
    "phone-lobby": screen.mobile.lobby,
  };
}
