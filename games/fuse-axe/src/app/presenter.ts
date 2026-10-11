import { TICK_MS } from "fuse-netcode";
import { CAPACITY, VIEW_H, VIEW_W } from "../engine/view-kit.js";
import type { HeroKind } from "../engine/index.js";
import { picksApply, type View } from "../online/game.js";
import type { HudSeats } from "../render/hud.js";
import { SEAT_COLORS } from "../render/seat-colors.js";

/**
 * What the page shows, decided from one frame: the lobby (roster, hero picker, start), the running game, or a phone's
 * controller for a shared screen, and the line of help under it. Pure, so the decisions are unit-tested; `main.ts`
 * only puts them on the page. A seat's hero always comes from the room (`SeatView.hero`): a pick is logged, not
 * promised, and the room can drop it.
 */
export interface Viewer {
  me: string;
  host: boolean;
  solo: boolean;
  /** This page only watches the room (`?display=1`): it never takes a seat. It is the shared screen, the TV. */
  display: boolean;
  /** A touch screen (a coarse pointer): its hero is steered with the on-screen pads. */
  touch: boolean;
}

/** How the page introduces each hero. */
export const HEROES: Readonly<
  Record<HeroKind, { name: string; blurb: string; color: string }>
> = {
  brakka: {
    name: "BRAKKA",
    blurb: "Barbarian · broadsword · Storm",
    color: "#4da6ff",
  },
  rhea: { name: "RHEA", blurb: "Amazon · longsword · Fire", color: "#ff6a3d" },
  gorm: { name: "GORM", blurb: "Dwarf · battle axe · Earth", color: "#ffc23d" },
};
export const tag = (slot: number): string => `P${slot + 1}`;
/** The stages by number, as the cards name them. */
export const STAGE_NAMES: readonly string[] = [
  "",
  "ASHEN VILLAGE",
  "WYRMBONE PASS",
  "DROWNED CRYPT",
];
/** Log ticks a second: the clocks count in log ticks and show whole seconds. */
const TICKS_PER_SECOND = 1000 / TICK_MS;

/** Every line the stage-flow cards show. */
export const TEXT = {
  clear: (round: number) => `STAGE ${round} CLEAR`,
  onward: "The road goes on in",
  camp: "CAMP",
  campLine: "Kick the thieves: meat heals",
  won: "The run is won in",
  continueTitle: "CONTINUE?",
  fallen: "Every hero has fallen",
  pressAttack: "Press ATTACK (J / Z) to fight on",
  tapAttack: "Tap ATTACK to fight on",
  waitHeroes: "A hero may continue the run",
  victory: "VICTORY",
  defeat: "GAME OVER",
  reached: (round: number, last: number) =>
    `STAGE ${round} OF ${last} · ${STAGE_NAMES[round] ?? ""}`,
  waitHost: "The host sets out again",
  hostChoice: "Set out again, or back to the lobby",
  continueButton: "CONTINUE",
  rematchButton: "REMATCH",
  lobbyButton: "LOBBY",
  tallyHead: ["", "HERO", "DAMAGE", "KO"],
} as const;

export interface Member {
  id: string;
  name: string;
  tag: string;
  color: string;
  hero: HeroKind | null;
  status: string;
}
/** A hero's line in a tally: its seat, its player (or its tag once the seat has gone) and the numbers. */
export interface TallyRow {
  tag: string;
  name: string;
  color: string;
  hero: HeroKind;
  damage: number;
  knockdowns: number;
}
/**
 * The card over the game while the stage flow holds it: a cleared stage's tally, camp's caption, the continue
 * countdown, or the run's end with its summary. `seconds` counts down whole seconds (rounded up) where a clock runs.
 */
export interface Card {
  kind: "clear" | "camp" | "continue" | "victory" | "defeat";
  title: string;
  /** The stage, or what happened. */
  line: string;
  seconds: number | null;
  /** What the clock runs to, or what to do now. */
  hint: string;
  rows: TallyRow[];
  /** This device plays a hero in the run and may vote to continue it. */
  canContinue: boolean;
  /** The host may set out again (REMATCH) or go back to the lobby from here. */
  canRematch: boolean;
}
/** A shared screen's phone: its seat, in the seat's colour (its marker over the hero on the TV), and its hero. */
export interface Controller {
  title: string;
  color: string;
  hero: HeroKind | null;
}
export interface Model {
  /** The lobby, the game, or (a seat's page while a shared screen shows the game) the phone's controller. */
  screen: "lobby" | "play" | "controller";
  card: Card | null;
  askName: boolean;
  seated: boolean;
  /** This device steers a hero in the running world, so the game's keys are its own. */
  playing: boolean;
  /** The hero this device's seat plays (or plays next), from the room. */
  hero: HeroKind | null;
  /** The hero picker takes a pick: a present seat, in the lobby or once a run is over. */
  canPick: boolean;
  members: Member[];
  watchers: number;
  showStart: boolean;
  canStart: boolean;
  /** The host may seat a bot companion in the lobby (+ BOT) while a seat is free, and remove the bots seated. */
  canAddBot: boolean;
  removable: string[];
  /** The host may take the room back to the lobby (and the hero picker) from a run, from its controller too. */
  canReturn: boolean;
  note: string;
  /** What the game's HUD names: each seat's player by slot, and this device's seat. */
  hud: HudSeats;
  /** The on-screen d-pad and buttons show: on a controller, and over the game on a touch screen whose hero fights. */
  pads: boolean;
  /** The pads fill a phone: its header folds behind a MENU button and the control hints show. */
  phone: boolean;
  controller: Controller | null;
  /** The room is one shared screen with phones as controllers (`Settings.display`). */
  shared: boolean;
  /** The host may turn the shared screen on or off: in the lobby of a room. */
  canShare: boolean;
  /** The host is offered the shared screen's page to open on the TV. */
  showTv: boolean;
  /** The shared screen shows the room's code and QR code beside its game, so a latecomer can join from a phone. */
  invite: boolean;
}

export function present(view: View, viewer: Viewer): Model {
  const seats = view.seats.filter((seat) => !seat.watcher);
  const mine = view.seats.find((seat) => seat.id === viewer.me);
  const seated = !!mine && !mine.watcher && !viewer.display;
  const inWorld =
    seated && !!view.world?.heroes.some((hero) => hero.seat === mine.slot);
  const shared = view.settings.display,
    room = !viewer.solo && !viewer.display;
  const screen =
    view.stage === "lobby" ? "lobby" : shared && seated ? "controller" : "play";
  const playing = inWorld && (view.stage === "running" || !!view.world?.camp);
  const pads = screen === "controller" || (viewer.touch && playing);
  let note = "";
  if (screen === "lobby")
    note = !seats.length
      ? viewer.display && shared
        ? "Scan the code to join on your phone"
        : "Pick a name to take a seat"
      : viewer.display
        ? shared
          ? "Join on your phone; the host starts the run"
          : "This screen watches; everyone plays on their own device"
        : viewer.host
          ? shared
            ? "Open the TV screen, pick your hero, then START"
            : "Pick your hero, then START"
          : "Pick your hero; the host starts the run";
  else if (!viewer.display)
    note = !seated
      ? mine
        ? "Watching"
        : "Pick a name to play from the next run"
      : !inWorld
        ? "You join the next run"
        : view.stage === "over"
          ? "The run is over"
          : "";
  return {
    screen,
    card: card(view, viewer, inWorld && mine.connected && !mine.away),
    askName: !mine && !viewer.display && !viewer.solo,
    seated,
    playing,
    hero: seated ? mine.hero : null,
    canPick: seated && mine.connected && !mine.away && picksApply(view.stage),
    members: seats.map((seat) => ({
      id: seat.id,
      name: seat.id === viewer.me ? `${seat.name} (you)` : seat.name,
      tag: tag(seat.slot),
      color: SEAT_COLORS[seat.slot % SEAT_COLORS.length]!,
      hero: seat.hero,
      status: seat.away
        ? "AWAY"
        : !seat.connected && !seat.bot
          ? "OFFLINE"
          : `${tag(seat.slot)} · ${seat.bot ? "BOT · " : ""}${seat.hero ? HEROES[seat.hero].name : ""}`,
    })),
    watchers: view.seats.length - seats.length,
    showStart: viewer.host && !viewer.display && screen === "lobby",
    canStart: seats.length > 0,
    canAddBot:
      viewer.host &&
      !viewer.display &&
      screen === "lobby" &&
      seats.length < CAPACITY,
    removable:
      viewer.host && !viewer.display && screen === "lobby"
        ? seats.filter((seat) => seat.bot).map((seat) => seat.id)
        : [],
    canReturn: viewer.host && !viewer.display && screen !== "lobby",
    note,
    hud: {
      names: Array.from(
        { length: CAPACITY },
        (_, slot) => seats.find((seat) => seat.slot === slot)?.name ?? null,
      ),
      you: seated ? mine.slot : null,
      open: !viewer.solo,
    },
    pads,
    phone: pads && viewer.touch,
    controller:
      screen === "controller" && mine
        ? {
            title: `${tag(mine.slot)} · ${mine.name}`,
            color: SEAT_COLORS[mine.slot % SEAT_COLORS.length]!,
            hero: mine.hero,
          }
        : null,
    shared,
    canShare: room && viewer.host && screen === "lobby",
    showTv: room && viewer.host && shared && screen === "lobby",
    invite: viewer.display && screen === "play",
  };
}

/** Each hero of the run's tally line, from this stage's numbers or the whole run's. */
function rows(view: View, of: "stage" | "run"): TallyRow[] {
  return view.tally.map((row) => {
    const seat = view.seats.find(
      (each) => !each.watcher && each.slot === row.seat,
    );
    return {
      tag: tag(row.seat),
      name: seat?.name ?? tag(row.seat),
      color: SEAT_COLORS[row.seat % SEAT_COLORS.length]!,
      hero: row.kind,
      ...row[of],
    };
  });
}

/**
 * The stage flow's card: the tally between stages, then camp's caption (small, over the top of the camp the heroes
 * play in), the countdown while every hero is out (a vote for a present hero of the run, a wait for everyone else),
 * and the outcome with the run's summary once it is over (the host's REMATCH and lobby). None while the party fights,
 * or in the lobby.
 */
function card(view: View, viewer: Viewer, hero: boolean): Card | null {
  const seconds = Math.ceil(view.countdown / TICKS_PER_SECOND),
    host = viewer.host && !viewer.display;
  if (view.stage === "between" && view.world?.camp)
    return {
      kind: "camp",
      title: TEXT.camp,
      line: TEXT.campLine,
      seconds,
      hint: TEXT.onward,
      rows: [],
      canContinue: false,
      canRematch: false,
    };
  if (view.stage === "between")
    return {
      kind: "clear",
      title: TEXT.clear(view.round),
      line: STAGE_NAMES[view.round] ?? "",
      seconds,
      hint: view.round < view.lastStage ? TEXT.onward : TEXT.won,
      rows: rows(view, "stage"),
      canContinue: false,
      canRematch: false,
    };
  if (view.stage === "running" && view.countdown > 0)
    return {
      kind: "continue",
      title: TEXT.continueTitle,
      line: TEXT.fallen,
      seconds,
      hint: !hero
        ? TEXT.waitHeroes
        : viewer.touch
          ? TEXT.tapAttack
          : TEXT.pressAttack,
      rows: [],
      canContinue: hero,
      canRematch: false,
    };
  if (view.stage === "over") {
    const won = view.outcome === "victory";
    return {
      kind: won ? "victory" : "defeat",
      title: won ? TEXT.victory : TEXT.defeat,
      line: TEXT.reached(view.round, view.lastStage),
      seconds: null,
      hint: host ? TEXT.hostChoice : TEXT.waitHost,
      rows: rows(view, "run"),
      canContinue: false,
      canRematch: host,
    };
  }
  return null;
}

/**
 * What the game's canvas is to a screen reader: its HUD draws the party in pixels (capitals, names cut to fit), so
 * this says every seat's tag, player in full and hero in words.
 */
export function partyLabel(members: readonly Member[]): string {
  if (!members.length) return "Fuse Axe: nobody is seated";
  const seats = members.map(({ tag, name, hero }) =>
    [`${tag} ${name}`, hero ? HEROES[hero].name : ""]
      .filter(Boolean)
      .join(", "),
  );
  return `Fuse Axe: ${seats.join("; ")}`;
}

/** The largest whole-number scale at which the native screen fits `width` × `height` device pixels; at least 1. */
export function pixelScale(width: number, height: number): number {
  return Math.max(1, Math.floor(Math.min(width / VIEW_W, height / VIEW_H)));
}
