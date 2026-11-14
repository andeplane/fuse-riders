/**
 * Everything the Killer Fuse art pipeline (`scripts/killer-fuse-art.ts`) generates with an image model: the shared
 * palette, the prompts, and how each generated sheet is cut into frames. Hand-pixelled art (tiles, berries, hive
 * holes, effects, lettering) lives in `procedural.ts`. The game itself reads only
 * `public/killer-fuse/art/manifest.json`.
 */
import { hex, type Rgb } from "./pixel.ts";

// ---------------------------------------------------------------------------------------------------------------
// Palette: the Fuse tokens (`packages/fuse-ui/src/tokens.css`) and a few ramps around them. Every shipped pixel is
// one of these colours.

/** Four shades per ramp, darkest first: deep, shade, base (the token), light. */
export type Ramp = readonly [Rgb, Rgb, Rgb, Rgb];

const ramp = (...colours: [string, string, string, string]): Ramp => [
  hex(colours[0]),
  hex(colours[1]),
  hex(colours[2]),
  hex(colours[3]),
];

export const TEAMS = {
  cyan: ramp("#0a4a70", "#0c96bd", "#16e7ff", "#b4f8ff"),
  pink: ramp("#6e0d4a", "#c2187a", "#ff2e9d", "#ffb0dc"),
  /** Unowned gates and anything else that belongs to nobody. */
  neutral: ramp("#2a2f55", "#525a8c", "#8f98c8", "#d5dbf5"),
} as const;

export type Team = keyof typeof TEAMS;

export const NAVY = {
  void: hex("#020715"),
  deep: hex("#050c22"),
  night: hex("#0a1433"),
  dusk: hex("#111f4a"),
  slate: hex("#1c2e66"),
  steel: hex("#2c4488"),
} as const;

export const GOLD = ramp("#7a4a12", "#c9861c", "#ffc93c", "#ffe46b");
export const LIME = ramp("#2c6b1c", "#6fbf2a", "#b6ff4d", "#e8ffb8");
export const VIOLET = ramp("#22164f", "#3f2a8a", "#6544c2", "#a58cf5");

export const INK = hex("#0a0f2a");
export const WHITE = hex("#ffffff");
export const ICE = hex("#d8f1ff");
export const FROST = hex("#9db9e0");
export const CREAM = hex("#fff0c8");
export const TAN = hex("#dcb486");

/** What a unit's non-team pixels may be. */
export const UNIT_NEUTRALS: readonly Rgb[] = [
  INK,
  WHITE,
  ICE,
  FROST,
  CREAM,
  TAN,
  ...GOLD,
];

/** What scenery (snail, gates, hive shell, logo, cover) may be, besides a team ramp. */
export const SCENERY: readonly Rgb[] = [
  ...Object.values(NAVY),
  ...VIOLET,
  ...GOLD,
  ...LIME,
  INK,
  WHITE,
  ICE,
  FROST,
  CREAM,
  TAN,
];

// ---------------------------------------------------------------------------------------------------------------
// Prompts

const SHEET =
  "Authentic retro arcade pixel art sprite sheet for a 1990s arcade cabinet game, very low resolution like NES or " +
  "Neo Geo Pocket sprites, shown hugely enlarged so each art pixel is a big crisp perfectly square block on one " +
  "strict grid. Bold simple chunky shapes; every feature (limbs, antennae, eyes) is at least 2 blocks thick; no " +
  "1-block-thin lines and no dark outline around the shapes. Flat saturated colours, at most 7 colours, hard " +
  "edges, no anti-aliasing, no gradients, no glow, no drop shadows, no text, no labels, no grid lines. " +
  "Background: one flat solid magenta #ff00ff everywhere, with wide empty magenta gaps between the sprites.";

const TEAM_GREEN =
  "Colours: the whole body, helmet, arms and legs are pure bright green #00ff00, with darker green #009a00 " +
  "shading on the lower and back side and a few light green #a0ffa0 highlight blocks on top (green is the team " +
  "colour and is used for nothing else); the face is pale cream #fff0c8; the eye is white with a big black pupil.";

const WORKER =
  "Subject: one original character, a chunky cute worker bug (a little beetle-ant drone), side view facing right: " +
  "a huge round helmeted head that is half its height, one big eye, two short thick antennae, a stubby body, " +
  "short thick arms, two short thick legs with big boots.";

const FAMILY =
  "The attached image is the game's worker bug sprite sheet. Draw a NEW sheet, in exactly the same pixel art " +
  "style, block size, palette and flat shading as that worker (smooth plain rounded shapes, big flat colour " +
  "areas, one darker green band along the bottom and back, a few light green highlight blocks on top, no armour " +
  "plates, no segment lines, no dithering, no outline), of a different unit of the same species:";

const QUEEN_LOOK =
  "Subject: the queen, a fierce wasp-bee monarch, side view facing right, drawn one and a half times as large as " +
  "the worker and more regal: the same big round helmeted head wearing a tall three-point golden crown, one big " +
  "angry white eye with a black pupil under a slanted brow, two large pale ice-blue wings on her back, a plump " +
  "round abdomen behind her with two thick dark green stripes, short thick legs, and a long sharp golden " +
  "lance-like stinger held pointing forward and slightly down. Crown and stinger are gold #ffc93c with pale " +
  "yellow #ffe46b highlights; wings are pale ice blue #d8f1ff with white highlights.";

const SCENE =
  "Authentic retro arcade pixel art background for a 1990s arcade cabinet game, 480 by 270 pixel resolution shown " +
  "enlarged, crisp square pixels, flat colours, hard edges, no anti-aliasing, no gradients, no glow, no blur.";

const SAME =
  "The sheet shows the SAME character, same size and proportions, in";

export interface Generation {
  id: string;
  size: "1024x1024" | "1536x1024" | "1024x1536";
  prompt: string;
  /** Generate by editing this other generation's raw image (keeps the character and the layout). */
  editOf?: string;
}

/**
 * The units and gates are pixelled by hand in `arcade.ts`; `worker` and `queen` are still generated because the
 * snail and the cover are drawn as edits of them, to stay in one style.
 */
export const GENERATIONS: readonly Generation[] = [
  {
    id: "worker",
    size: "1024x1024",
    prompt: `${SHEET} ${WORKER} ${TEAM_GREEN} ${SAME} 8 poses in 2 rows of 4. Row 1: standing idle; run cycle frame 1 (front leg stretched forward, back leg stretched back); run frame 2 (legs together under the body); run frame 3 (other leg forward, legs apart). Row 2: run frame 4 (legs together under the body); jumping up with both arms raised and legs stretched down; falling with arms up and knees tucked; standing idle with the eye closed (blink).`,
  },
  {
    id: "queen",
    size: "1536x1024",
    editOf: "worker",
    prompt: `${FAMILY} ${SHEET} ${QUEEN_LOOK} ${TEAM_GREEN} ${SAME} 6 poses in 2 rows of 3. Row 1: hovering with wings level behind her; flying with both wings raised straight up; flying with both wings pushed down. Row 2: diving steeply downward stinger first with wings swept back; walking on the ground frame 1 (legs apart), wings folded; walking frame 2 (legs together), wings folded.`,
  },
  {
    id: "snail",
    size: "1536x1024",
    editOf: "worker",
    prompt: `${FAMILY} ${SHEET} Subject: the giant racing snail the workers ride, side view facing right, about three times as long as the worker is wide: a long plump pale cream #fff0c8 body with tan #dcb486 shading underneath, a round head at the right with one big white eye with a black pupil and two thick eye stalks, and on its back a big round spiral shell in violet #6544c2 with a light violet #a58cf5 spiral band and a dark violet #3f2a8a underside. On top of the shell sits a small flat gold #ffc93c saddle. No green anywhere. ${SAME} 5 poses in 2 rows (3 then 2). Row 1: resting; crawling frame 1 (body stretched long); crawling frame 2 (body bunched up short, head raised slightly). Row 2: crawling frame 3 (in between); eating, with its mouth wide open like a big dark navy #0a0f2a bite at the front of the head.`,
  },
  {
    id: "bg-far",
    size: "1536x1024",
    prompt: `${SCENE} The farthest background layer of a night arcade arena inside a gigantic insect hive city: an almost black deep navy #020715 sky with a few tiny dim stars, and far away huge soft honeycomb megastructures and hexagonal towers as flat silhouettes in very dark navy blues (#050c22, #0a1433, #111f4a), a faint violet #22164f haze low on the horizon, and a big dim hexagonal moon in dusk blue. Very dark, very low contrast, calm, lots of empty sky in the upper middle. No bright colours at all, no characters, no text.`,
  },
  {
    id: "bg-mid",
    size: "1536x1024",
    prompt: `${SCENE} A middle parallax layer drawn on a flat solid magenta #ff00ff sky (everything that is not building is pure magenta): the skyline of a night insect hive city rising from the bottom edge to at most half the image height, with taller clusters at the left and right edges and a low gap in the middle: hexagonal honeycomb towers, domed hive pods, pipes and antenna masts as flat silhouettes in dark navy #0a1433 and #111f4a with slightly lighter #1c2e66 edges on their left sides, and a sparse scatter of tiny dim neon windows and sign strips in muted violet #3f2a8a, dim teal #0a4a70 and dim magenta-rose #6e0d4a. Dark and low contrast. No characters, no text.`,
  },
  {
    id: "bg-near",
    size: "1536x1024",
    prompt: `${SCENE} A near parallax layer drawn on a flat solid magenta #ff00ff background (everything that is not structure is pure magenta, and most of the image is magenta): only a framing of dark foreground structure along the left edge, the right edge and the top corners: hanging honeycomb scaffolding, thick cables and circuit conduits with hexagonal junction boxes, as flat silhouettes in dark navy #111f4a and slate #1c2e66 with a thin muted violet #3f2a8a neon edge line and a few tiny dim gold #7a4a12 lamps. The whole centre and bottom of the image is empty magenta. No characters, no text.`,
  },
  {
    id: "logo",
    size: "1536x1024",
    prompt: `Authentic 1990s arcade cabinet title logo in chunky pixel art, shown enlarged so each art pixel is a big crisp perfectly square block on one strict grid, about 140 blocks wide. The words "KILLER FUSE" in two lines, "KILLER" above "FUSE", in heavy blocky slab capital letters: letter faces in yellow #ffe46b with a gold #ffc93c lower half and a white top highlight row, a thick dark navy #0a0f2a outline, and a solid extruded drop shadow down-right, cyan #16e7ff under "KILLER" and hot pink #ff2e9d under "FUSE". The letter I in KILLER is a sword-like stinger pointing down, and a small burning fuse spark in white and yellow sits at the end of the E of FUSE. Flat colours, hard edges, no anti-aliasing, no gradients, no glow, no extra text. Background: one flat solid green #00ff00 everywhere.`,
  },
  {
    id: "cover",
    size: "1024x1024",
    editOf: "queen",
    prompt: `The attached image is the queen sprite sheet of an arcade game (its green stands for the team colour). Paint the game's square cover art as chunky retro arcade pixel art with big crisp square pixels, flat colours and hard edges: on a deep navy #020715 night sky with dark honeycomb hive towers, two rival bug queens of this exact design clash in mid-air in the centre, lances crossed, the left one coloured cyan #16e7ff and facing right, the right one coloured hot pink #ff2e9d and facing left, both with golden crowns and pale wings, a white-yellow spark where the lances meet. Below them a giant cream snail with a violet spiral shell crawls along a neon violet platform, and a few glowing lime-green #b6ff4d berries float around. Bold, readable, dramatic, lots of dark navy. No text, no letters, no logo, no border.`,
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Cutting

export interface UnitSheet {
  /** The generation this sheet is cut from. */
  from: string;
  /** Frame names, in the reading order of the generated sheet. */
  frames: readonly string[];
  /** Frames whose feet stand on the ground: they are aligned by their soles, the rest by their body. */
  grounded: readonly string[];
  /** Art pixels per generated block: the model draws at about twice the game's resolution. */
  reduce: number;
  /** Enlarge by this before reducing, for a size that is not a whole fraction (3 then 4 is three quarters). */
  grow?: number;
  /** Cell size of the shipped sheet. */
  cell: readonly [number, number];
  /** Looping animations by name: frame names and frames per second. */
  animations: Record<
    string,
    { frames: readonly string[]; fps: number; loop: boolean }
  >;
}

/** The snail: one generated sheet, aligned by its shell so the shell stays put while the body stretches. */
export const SNAIL: UnitSheet = {
  from: "snail",
  frames: ["idle", "crawl1", "crawl2", "crawl3", "eat"],
  grounded: ["idle", "crawl1", "crawl2", "crawl3", "eat"],
  grow: 3,
  reduce: 4,
  cell: [40, 20],
  animations: {
    idle: { frames: ["idle"], fps: 1, loop: false },
    crawl: {
      frames: ["crawl1", "crawl3", "crawl2", "crawl3"],
      fps: 6,
      loop: true,
    },
    eat: { frames: ["eat", "idle"], fps: 4, loop: true },
  },
};

/** Sheets that `cut` samples as single drawings on a grid: id, how many drawings, and the key colour behind them. */
export const CUTS: readonly {
  id: string;
  count: number;
  key: "magenta" | "green";
  units: boolean;
}[] = [
  { id: "snail", count: 5, key: "magenta", units: false },
  { id: "logo", count: 1, key: "green", units: false },
];
