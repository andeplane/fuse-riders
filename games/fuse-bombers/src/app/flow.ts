import type { RoundView, TickEvent } from "../engine/index.js";
import type { MusicKind } from "./audio/index.js";
import { css } from "../render/palette.js";
import type { PlayerLook, RoundSource } from "../render/round-scene.js";
import { createBotPlayer } from "./bot.js";
import type { BrowserInput, Command, DeviceId } from "./input/index.js";
import { Lobby, PLAYER_NAMES, type Seat } from "./lobby.js";
import { RoundRunner } from "./round-runner.js";
import * as screens from "./screens.js";

type Screen =
  | { kind: "lobby" }
  | { kind: "countdown"; left: number }
  | { kind: "playing"; overFor: number }
  | { kind: "results"; left: number }
  | { kind: "winner" };

/** What the menus answer to: the screen, or `paused` over it. */
export type MenuState = Screen["kind"] | "paused";

export interface FlowOptions {
  input: BrowserInput;
  /** The overlay element the screens are drawn into. */
  root: HTMLElement;
  /** (Re)start the round scene drawing `source` with these player looks; `attract` for the bots behind the lobby. */
  show(
    source: RoundSource,
    players: readonly PlayerLook[],
    attract: boolean,
  ): void;
  /** Switch the music track (the round tracks follow the round scene). */
  music?(kind: MusicKind): void;
  seed: number;
  /** `?speed=N`: run the game and its timers N times as fast (for tests). */
  speed?: number;
  /** Where menu keys come from; `window` by default, a fake in tests. */
  keys?: {
    addEventListener(
      type: "keydown",
      listener: (event: KeyboardEvent) => void,
    ): void;
  };
}

const COUNTDOWN = 3;
/** Seconds of "GO!" while the round already runs. */
const GO = 0.7;
/** Seconds of explosions and the winner banner before the results screen. */
const AFTERMATH = 2.5;
const RESULTS = 7;

/**
 * The action a menu key (a `KeyboardEvent.code`) or a pad's `start`/`back` command takes in `state`, if any. Enter,
 * Space and Start confirm, Esc and Back go back; mid-round Start also pauses. None of these is a player's button,
 * so a shot never pauses and pausing never costs a shot.
 */
export function menuAction(state: MenuState, key: string): string | undefined {
  const primary = key === "Enter" || key === "Space" || key === "start";
  const back = key === "Escape" || key === "back";
  if (state === "lobby") {
    if (primary) return "start";
    if (/^Digit[2-6]$/.test(key)) return `players:${key.slice(5)}`;
    if (key === "KeyR") return "wins";
    if (key === "KeyB") return "bots";
  } else if (state === "paused") {
    if (primary || back) return "resume";
    if (key === "Backspace") return "quit";
  } else if (state === "winner") {
    if (primary) return "again";
    if (back || key === "Backspace") return "lobby";
  } else if (state === "results" && primary) return "next";
  else if (back || key === "start") return "pause";
  return undefined;
}

/**
 * The match flow: lobby (a bots-only round plays behind it) → countdown → round → results → … → match winner →
 * play again or back to the lobby, plus pause. It is the round scene's `RoundSource`, so the scene's frame drives
 * its timers, and it draws the DOM overlay screens.
 */
export class Flow implements RoundSource {
  readonly lobby = new Lobby();
  screen: Screen = { kind: "lobby" };
  paused = false;
  private runner!: RoundRunner;
  private seats: Seat[] = [];
  private seed: number;
  private readonly speed: number;
  private html = "";

  constructor(private readonly options: FlowOptions) {
    this.seed = options.seed;
    this.speed = Math.max(1, Math.floor(options.speed ?? 1));
    if (options.input.touchEnabled) options.root.dataset.touch = "";
    options.input.hub.onPress((device) => this.onPress(device));
    options.input.hub.onCommand((device, command) =>
      this.onCommand(device, command),
    );
    const keys: NonNullable<FlowOptions["keys"]> = options.keys ?? window;
    keys.addEventListener("keydown", (event) => this.onKey(event));
    options.root.addEventListener("mousedown", (event) => {
      if ((event.target as Element).closest("button")) event.preventDefault(); // Keep focus off buttons.
    });
    options.root.addEventListener("click", (event) => {
      const target = (event.target as Element).closest("[data-action]");
      const action = target?.getAttribute("data-action");
      if (action) this.act(action);
    });
    this.toLobby();
  }

  get view(): RoundView {
    return this.runner.view;
  }

  advance(deltaMs: number): readonly TickEvent[] {
    const { hub } = this.options.input;
    hub.poll();
    const events: TickEvent[] = [];
    if (!this.paused) {
      const dt = ((Number.isFinite(deltaMs) ? deltaMs : 0) / 1000) * this.speed;
      const screen = this.screen;
      let run = true;
      if (screen.kind === "countdown") {
        screen.left -= dt;
        run = screen.left <= 0;
        if (screen.left + dt > 0 && run) hub.clearPresses(); // GO: countdown taps do not fire.
        if (screen.left <= -GO) this.screen = { kind: "playing", overFor: 0 };
      } else if (screen.kind === "playing" && this.view.result) {
        screen.overFor += dt;
        if (screen.overFor >= AFTERMATH)
          this.screen =
            this.runner.match.winner === null
              ? { kind: "results", left: RESULTS }
              : { kind: "winner" };
        if (this.screen.kind === "winner") this.options.music?.("victory");
      } else if (screen.kind === "results") {
        screen.left -= dt;
        if (screen.left <= 0) this.nextRound();
      }
      if (run)
        for (let i = 0; i < this.speed; i++)
          events.push(...this.runner.advance(deltaMs));
    }
    this.render();
    return events;
  }

  private render(): void {
    const { runner, seats, screen } = this;
    const info = { seats, match: runner.match, view: runner.view };
    let html = "";
    if (screen.kind === "lobby")
      html = screens.lobbyHtml(this.lobby, this.options.input.touchEnabled);
    else {
      const pause = // Touch players have no Esc or Start button.
        this.options.input.touchEnabled &&
        !this.paused &&
        (screen.kind === "countdown" || screen.kind === "playing");
      html = screens.hudHtml(info, pause, runner.speed);
      if (this.paused) html += screens.pauseHtml();
      else if (screen.kind === "countdown")
        html += screens.countdownHtml(
          screen.left > 0 ? String(Math.ceil(screen.left)) : "GO!",
        );
      else if (screen.kind !== "playing")
        html += screens.resultsHtml(info, "left" in screen ? screen.left : 0);
    }
    if (html === this.html) return;
    this.html = html;
    this.options.root.innerHTML = html;
    this.options.root.dataset.screen = this.paused ? "paused" : screen.kind;
  }

  private onPress(device: DeviceId): void {
    if (this.screen.kind !== "lobby") return;
    const { hub } = this.options.input;
    const seat = this.lobby.press(device);
    if (!seat) return;
    if (seat.joined) hub.bind(seat.slot, device);
    else hub.unbind(seat.slot);
    this.updateTouchZones();
  }

  private get menuState(): MenuState {
    return this.paused ? "paused" : this.screen.kind;
  }

  private onKey(event: KeyboardEvent): void {
    if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
    const action = menuAction(this.menuState, event.code);
    if (!action) return;
    event.preventDefault();
    this.act(action);
  }

  /** A pad's Start or Back button; holding a seated player's button in the lobby starts too. */
  private onCommand(device: DeviceId, command: Command): void {
    if (command !== "hold") {
      const action = menuAction(this.menuState, command);
      if (action) this.act(action);
    } else if (
      this.menuState === "lobby" &&
      this.lobby.devices.includes(device)
    )
      this.act("start");
  }

  private act(action: string): void {
    const lobby = this.lobby;
    const [name, arg = ""] = action.split(":");
    /** `+`/`-` steps `value`, a number sets it. */
    const set = (value: number) =>
      arg === "+" ? value + 1 : arg === "-" ? value - 1 : Number(arg);
    switch (name) {
      case "start":
      case "again":
        return this.startMatch();
      case "players":
        lobby.setPlayerCount(set(lobby.playerCount));
        break;
      case "wins":
        lobby.setWinsToWin(
          arg ? set(lobby.winsToWin) : (lobby.winsToWin % 5) + 1,
        );
        break;
      case "bots":
        lobby.cycleDifficulty();
        break;
      case "bot":
        lobby.cycleDifficulty(Number(arg));
        break;
      case "next":
        return this.nextRound();
      case "pause":
        this.paused = true;
        break;
      case "resume":
        this.paused = false;
        this.options.input.hub.clearPresses();
        break;
      case "quit":
      case "lobby":
        return this.toLobby();
    }
    this.updateTouchZones();
  }

  private toLobby(): void {
    this.screen = { kind: "lobby" };
    this.paused = false;
    // Attract mode: four bots play behind the lobby.
    const seats = new Lobby().seats();
    this.runner = new RoundRunner({
      seed: this.seed++,
      controllers: seats.map((s) => createBotPlayer("normal", s.slot, s.slot)),
      aftermath: 3,
    });
    this.options.show(
      this,
      seats.map((s) => ({ ...s, tag: "" })),
      true,
    );
    this.options.music?.("lobby");
    this.updateTouchZones();
  }

  private startMatch(): void {
    const { hub } = this.options.input;
    this.lobby.compactTouchZones();
    this.seats = this.lobby.seats();
    for (const s of this.seats) if (s.device) hub.bind(s.slot, s.device); // Touch zones may have been renumbered.
    const seed = this.seed++;
    this.runner = new RoundRunner({
      seed,
      controllers: this.seats.map((s) =>
        s.device ? null : createBotPlayer(s.difficulty, s.slot, seed + s.slot),
      ),
      input: { takePresses: (slots) => hub.takePresses(slots) },
      winsToWin: this.lobby.winsToWin,
      aftermath: Infinity,
    });
    this.screen = { kind: "countdown", left: COUNTDOWN };
    this.paused = false;
    const prompt = (s: Seat) =>
      s.device?.startsWith("touch:") ? "TAP!" : `PRESS ${s.tag}`;
    this.options.show(
      this,
      this.seats.map((s) => (s.device ? { ...s, prompt: prompt(s) } : s)),
      false,
    );
    this.updateTouchZones();
  }

  private nextRound(): void {
    this.runner.nextRound();
    this.screen = { kind: "countdown", left: COUNTDOWN };
  }

  /** Touch players get a zone in their colour; in the lobby the free zones read JOIN. */
  private updateTouchZones(): void {
    const inLobby = this.screen.kind === "lobby";
    const seats = inLobby ? this.lobby.seats() : this.seats;
    const zones = new Map<number, Seat>();
    for (const s of seats)
      if (s.device?.startsWith("touch:"))
        zones.set(Number(s.device.slice(6)), s);
    const count = Math.min(
      PLAYER_NAMES.length,
      Math.max(-1, ...zones.keys()) + (inLobby ? 2 : 1),
    );
    this.options.input.setTouchZones(
      Array.from({ length: count }, (_, zone) => {
        const s = zones.get(zone);
        if (s) return { label: s.name, color: css(s.color) };
        return { label: inLobby ? "JOIN" : "", color: "var(--fui-yellow)" };
      }),
    );
  }
}
