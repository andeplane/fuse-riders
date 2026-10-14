import Phaser from "phaser";
import { config, TICK_RATE } from "../../game/sim/config.js";
import {
  FONT as BASE_FONT,
  FRAMES,
  HUD_CELL,
  SPONSORS,
  TRUCK_COLORS,
} from "./assets.js";
import type { ArenaFrame } from "./frame.js";
import { raceViewport } from "./race-scene.js";

const FONT: Phaser.Types.GameObjects.Text.TextStyle = {
  ...BASE_FONT,
  fontSize: "30px",
  fontStyle: "bold",
  strokeThickness: 5,
};
const LABEL: Phaser.Types.GameObjects.Text.TextStyle = {
  ...FONT,
  fontSize: "18px",
  color: "#c8c8d0",
  strokeThickness: 0,
};
/** Big centre messages styled like the countdown cells: yellow, red outline, black drop shadow. */
const BIG: Phaser.Types.GameObjects.Text.TextStyle = {
  ...FONT,
  fontSize: "96px",
  color: "#ffe600",
  stroke: "#e01010",
  strokeThickness: 12,
  shadow: {
    offsetX: 8,
    offsetY: 8,
    color: "#000000",
    fill: true,
    stroke: true,
  },
};
/** Corner insets of the 9-slice panels at their half-size cut. */
const INSET = 24;
const TOP = 6,
  TOP_H = 64;

/** A centre message: a countdown cell (frame index) or a line of text, and how opaque to draw it. */
interface Flash {
  what: number | string;
  alpha: number;
}

/** A message holds, then fades. Ages are in simulated ticks. */
function flash(
  what: number | string,
  age: number,
  hold = 15,
  out = 12,
): Flash | undefined {
  if (age < 0 || age >= hold + out) return undefined;
  return { what, alpha: age < hold ? 1 : 1 - (age - hold) / out };
}

/**
 * The stadium and the panels, drawn in screen pixels over the race view. Every number comes from the view;
 * the lap banner is the only thing that remembers anything, and it forgets whenever the clock moves back.
 */
export class HudScene extends Phaser.Scene {
  static readonly KEY = "fd-hud";

  private readonly onReady: () => void;

  private built = "";
  private lap?: Phaser.GameObjects.Text;
  private pos?: Phaser.GameObjects.Text;
  private kills?: Phaser.GameObjects.Text;
  private clock?: Phaser.GameObjects.Text;
  private speed?: Phaser.GameObjects.Text;
  private where?: Phaser.GameObjects.Text;
  private slot?: Phaser.GameObjects.Image;
  private bigImage?: Phaser.GameObjects.Image;
  private bigText?: Phaser.GameObjects.Text;
  private badge?: Phaser.GameObjects.Image;
  private chipNames: Phaser.GameObjects.Text[] = [];
  /** Armor pips per truck in the driver chips. */
  private chipArmor: Phaser.GameObjects.Image[][] = [];
  private armor: Phaser.GameObjects.Image[] = [];
  private nitros: Phaser.GameObjects.Image[] = [];
  /** The lap each truck was last seen on, and the tick it changed, for the LAP banner. */
  private laps: number[] = [];
  private lapTick: number[] = [];
  private lastTick = -1;

  constructor(onReady: () => void) {
    super(HudScene.KEY);
    this.onReady = onReady;
  }

  create(): void {
    this.onReady();
  }

  private panel(
    color: string,
    x: number,
    y: number,
    w: number,
    h: number,
  ): Phaser.GameObjects.NineSlice {
    return this.add
      .nineslice(
        x,
        y,
        `panel-${color}`,
        undefined,
        w,
        h,
        INSET,
        INSET,
        INSET,
        INSET,
      )
      .setOrigin(0)
      .setAlpha(0.9);
  }

  private pips(
    x: number,
    y: number,
    count: number,
    size: number,
    gap: number,
    frame: number,
  ): Phaser.GameObjects.Image[] {
    return Array.from({ length: count }, (_, i) =>
      this.add
        .image(x + i * (size + gap) + size / 2, y, "bars", frame)
        .setScale(size / HUD_CELL.bars),
    );
  }

  /**
   * The stadium around the race view: a grandstand band between the HUD strip and the track with the fence
   * and its sponsor boards along the bottom, and crowd strips down both sides.
   */
  private drawStands(frame: ArenaFrame, width: number, height: number): void {
    const cam = raceViewport(frame.track);
    const top = TOP + TOP_H + 2,
      bottom = cam.y;
    if (this.textures.exists("grandstand")) {
      const crowd = (x: number, y: number, w: number, h: number): void => {
        if (w > 0 && h > 0)
          this.add
            .tileSprite(x, y, w, h, "grandstand")
            .setOrigin(0)
            .setTileScale(0.55)
            .setDepth(-10);
      };
      crowd(0, top, width, bottom - top);
      crowd(0, bottom, cam.x, height - bottom);
      crowd(
        cam.x + cam.width,
        bottom,
        width - cam.x - cam.width,
        height - bottom,
      );
    }
    if (!this.textures.exists("fence")) return;
    const img = this.textures.get("fence").getSourceImage();
    const scale = 0.62,
      fh = img.height * scale,
      fw = img.width * scale;
    this.add
      .tileSprite(0, bottom - fh, width, fh, "fence")
      .setOrigin(0)
      .setTileScale(scale)
      .setDepth(-9);
    // Board centres and width as fractions of one fence tile; names shrink to fit their board.
    const boards = [0.086, 0.238, 0.396, 0.557, 0.721, 0.902],
      boardW = 0.11 * fw;
    let k = 0;
    for (let x = 0; x < width; x += fw) {
      for (const f of boards) {
        const sponsor = SPONSORS[k++ % SPONSORS.length]!;
        const label = this.add
          .text(x + f * fw, bottom - fh * 0.52, sponsor[0], {
            ...LABEL,
            fontSize: "16px",
            fontStyle: "italic bold",
            color: "#ffffff",
            stroke: "#000000",
            strokeThickness: 4,
          })
          .setOrigin(0.5)
          .setDepth(-8);
        label.setScale(Math.min(1, boardW / label.width));
      }
    }
  }

  /** Everything whose shape depends on the grid rather than on the tick. */
  private build(frame: ArenaFrame): void {
    for (const child of [...this.children.list]) child.destroy();
    this.chipArmor = [];
    this.chipNames = [];
    const { width, height } = config.screen;
    const trucks = frame.race.trucks;
    this.drawStands(frame, width, height);

    // Top strip: logo, one chip per driver, then lap / position / kills / time.
    this.add
      .image(12, TOP + TOP_H / 2, "logo", 0)
      .setOrigin(0, 0.5)
      .setScale(TOP_H / 380);
    const chipW = 172;
    this.chipArmor = trucks.map((t, i) => {
      const x = 170 + i * (chipW + 6);
      this.panel(TRUCK_COLORS[i % TRUCK_COLORS.length]!, x, TOP, chipW, TOP_H);
      this.add
        .image(x + 32, TOP + TOP_H / 2, "portraits", i)
        .setScale(46 / HUD_CELL.portraits);
      this.chipNames.push(
        this.add.text(x + 60, TOP + 12, frame.names[i] ?? "", {
          ...LABEL,
          color: "#ffffff",
        }),
      );
      return this.pips(x + 60, TOP + 44, t.stats.maxArmor, 14, 1, 2 * i);
    });
    const px = 170 + trucks.length * (chipW + 6);
    this.panel("grey", px, TOP, width - 8 - px, TOP_H);
    const col = (width - 8 - px) / 4;
    const readouts = ["LAP", "POS", "KILLS", "TIME"].map((label, i) => {
      const cx = px + col * (i + 0.5);
      this.add.text(cx, TOP + 16, label, LABEL).setOrigin(0.5);
      return this.add
        .text(cx, TOP + 42, "", {
          ...FONT,
          color: i === 1 ? "#ffe600" : "#ffffff",
        })
        .setOrigin(0.5);
    });
    [this.lap, this.pos, this.kills, this.clock] = readouts;

    // Bottom-left: framed item slot, nitro bottles, the followed truck's armor bar and its speed.
    const by = height - 8 - 100;
    this.panel("grey", 8, by, 330, 100);
    this.panel("gold", 18, by + 10, 80, 80);
    this.slot = this.add
      .image(58, by + 50, "icons", FRAMES.icons.empty)
      .setScale(54 / 128);
    this.nitros = this.pips(
      108,
      by + 32,
      config.truck.nitroMax,
      30,
      4,
      FRAMES.bars.nitro,
    );
    // Enough pips for the best-armoured truck; paint() shows the followed truck's own count in its colour.
    this.armor = this.pips(
      108,
      by + 72,
      Math.max(...trucks.map((t) => t.stats.maxArmor)),
      22,
      2,
      0,
    );
    this.speed = this.add
      .text(326, by + 72, "", { ...LABEL, color: "#ffffff" })
      .setOrigin(1, 0.5);
    this.where = this.add
      .text(width - 12, height - 10, "", { ...FONT, fontSize: "20px" })
      .setOrigin(1, 1);

    this.bigImage = this.add
      .image(width / 2, height * 0.42, "countdown", 0)
      .setVisible(false);
    this.bigText = this.add
      .text(width / 2, height * 0.42, "", BIG)
      .setOrigin(0.5)
      .setVisible(false);
    this.badge = this.add
      .image(width / 2, height * 0.64, "placements", 0)
      .setScale(1.1)
      .setVisible(false);
  }

  /** The one message on show, worked out from the view alone except for the lap the banner remembers. */
  private message(frame: ArenaFrame): Flash | undefined {
    const { race, focus } = frame;
    const me = race.trucks[focus];
    if (!me) return undefined;
    if (race.phase === "countdown") {
      const left = Math.ceil((race.countdownEndTick - race.tick) / TICK_RATE);
      return { what: Math.max(0, Math.min(2, 3 - left)), alpha: 1 };
    }
    if (me.finishedTick)
      return flash(
        FRAMES.countdown.finish,
        race.tick - me.finishedTick,
        45,
        20,
      );
    if (me.respawnAtTick)
      return flash(
        "WRECKED",
        config.truck.respawnTicks - (me.respawnAtTick - race.tick),
      );
    const lapTick = this.lapTick[focus];
    if (lapTick !== undefined && me.laps > 0)
      return (
        flash(
          `LAP ${Math.min(me.laps + 1, config.laps)}`,
          race.tick - lapTick,
        ) ?? this.startOrWarning(frame, me.wrongWayTicks)
      );
    return this.startOrWarning(frame, me.wrongWayTicks);
  }

  private startOrWarning(
    frame: ArenaFrame,
    wrongWayTicks: number,
  ): Flash | undefined {
    const { race } = frame;
    if (wrongWayTicks >= config.truck.wrongWayTicks)
      return { what: "WRONG WAY", alpha: 1 };
    return flash(FRAMES.countdown.go, race.tick - race.countdownEndTick);
  }

  /** Show a countdown cell (a frame index) or a line of text, or hide both. */
  private show(flashed: Flash | undefined): void {
    const image = this.bigImage,
      text = this.bigText;
    if (!image || !text) return;
    if (!flashed) {
      image.setVisible(false);
      text.setVisible(false);
      return;
    }
    const { what, alpha } = flashed;
    image.setVisible(typeof what === "number");
    text.setVisible(typeof what === "string");
    if (typeof what === "string") {
      text.setText(what).setAlpha(alpha);
      return;
    }
    // Digits are tall cells, GO! and FINISH are wide; scale each to a couch-readable size.
    const scale =
      what < FRAMES.countdown.go ? 0.4 : what === FRAMES.countdown.go ? 0.6 : 1;
    image.setFrame(what).setScale(scale).setAlpha(alpha);
  }

  /** Remember each truck's lap and when it changed; a clock that moved back forgets rather than banners. */
  private trackLaps(frame: ArenaFrame): void {
    const { race } = frame;
    if (race.tick < this.lastTick || this.laps.length !== race.trucks.length) {
      this.laps = race.trucks.map((t) => t.laps);
      this.lapTick = race.trucks.map(() => Number.NEGATIVE_INFINITY);
    } else
      race.trucks.forEach((t, slot) => {
        if (t.laps !== this.laps[slot]) {
          this.laps[slot] = t.laps;
          this.lapTick[slot] = race.tick;
        }
      });
    this.lastTick = race.tick;
  }

  paint(frame: ArenaFrame): void {
    const shape = `${frame.track.name}:${frame.race.trucks.length}`;
    if (this.built !== shape) {
      this.build(frame);
      this.built = shape;
    }
    this.trackLaps(frame);
    const { race, focus } = frame;
    const me = race.trucks[focus];
    if (!me) return;
    this.lap?.setText(`${Math.min(me.laps + 1, config.laps)}/${config.laps}`);
    this.pos?.setText(
      `${race.placements.indexOf(focus) + 1}/${race.trucks.length}`,
    );
    this.kills?.setText(String(me.kills));
    const secs = Math.max(0, (race.tick - race.countdownEndTick) / TICK_RATE);
    this.clock?.setText(
      `${Math.floor(secs / 60)}:${(secs % 60).toFixed(1).padStart(4, "0")}`,
    );
    race.trucks.forEach((t, i) => {
      this.chipNames[i]?.setText(frame.names[i] ?? "");
      for (const [j, pip] of (this.chipArmor[i] ?? []).entries())
        pip.setFrame(2 * i + (j < t.armor ? 0 : 1));
    });
    this.armor.forEach((pip, j) =>
      pip
        .setVisible(j < me.stats.maxArmor)
        .setFrame(2 * focus + (j < me.armor ? 0 : 1)),
    );
    this.nitros.forEach((pip, j) =>
      pip.setFrame(j < me.nitros ? FRAMES.bars.nitro : FRAMES.bars.nitroEmpty),
    );
    this.speed?.setText(`${Math.round(me.speed / 10) * 10} u/s`);
    this.slot?.setFrame(me.item ? FRAMES.icons[me.item] : FRAMES.icons.empty);
    this.where?.setText(
      `RACE ${frame.view.round + 1}  ${frame.track.name.toUpperCase()}`,
    );
    this.show(this.message(frame));
    this.badge
      ?.setFrame(Math.max(0, race.placements.indexOf(focus)))
      .setVisible(me.laps >= config.laps);
  }
}
