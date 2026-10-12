/**
 * Every raster image Fusetown (game id `fuse-lane`) draws, with the prompt to generate it. This table is the single source: the page loads
 * images by `id` from `file` (under `public/`, served from the site base) and falls back to a plain shape and label
 * when a file is missing, and `scripts/fuse-lane-art.ts` writes `art/manifest.json` and `art/prompts.md` from it.
 */

export interface ArtAsset {
  id: string;
  /** Path under `public/`. */
  file: string;
  /** Canvas size in pixels. */
  width: number;
  height: number;
  /** The point placed at the asset's position, as fractions of width and height (0,0 is top left). */
  anchor: [number, number];
  transparent: boolean;
  /** For a sprite sheet: frames laid out left to right, each `width / frames` wide. */
  frames?: number;
  /** What the placeholder shows while the file is missing: a colour and a short label. */
  color: string;
  label: string;
  prompt: string;
}

export const STYLE =
  "Bright modern flat vector illustration with soft cel shading and gentle gradients, one consistent dark navy " +
  "outline (about 3% of the canvas width), rounded friendly shapes, cheerful saturated palette (teal #2ec4b6, " +
  "coral #ff6b6b, sunflower #ffd23f, sky #4cc9f0, mint #3ddc84, plum #7b2cbf, warm cream #fff4e0), light from the " +
  "top left, no text, no letters, no logos, no watermark, crisp edges, readable at 64 px on a phone. Same art " +
  "direction for every asset of the set, like one mobile game's sticker sheet.";

const BASE = "fuse-lane";

const building = (
  id: string,
  color: string,
  label: string,
  subject: string,
): ArtAsset => ({
  id: `building-${id}`,
  file: `${BASE}/buildings/${id}.png`,
  width: 512,
  height: 512,
  anchor: [0.5, 0.92],
  transparent: true,
  color,
  label,
  prompt: `${subject} Three-quarter top-down view (about 35 degrees), the building alone on a small rounded patch of pavement, centred, its front door facing the viewer and the road, filling about 85% of the canvas. Transparent background.`,
});

const AVATAR_CHARACTERS: Record<string, string> = {
  robot: "a friendly boxy robot with an antenna and a tote bag",
  cat: "an orange tabby cat in a hoodie and sneakers",
  fox: "a red fox in a denim jacket with a backpack",
  alien: "a small green alien with big eyes, wearing a bomber jacket",
  astronaut: "a kid-sized astronaut in a white suit with the visor up",
  skull: "a cheerful skeleton in a beanie and a striped shirt",
  octopus: "a purple octopus walking on two tentacles, holding a coffee cup",
  dragon: "a small teal dragon in a cardigan with tiny wings",
  owl: "a round brown owl with glasses and a messenger bag",
  slime: "a cute lime-green slime blob wearing a baseball cap",
};
const AVATAR_COLORS = ["#4cc9f0", "#ff6b6b", "#3ddc84", "#ffd23f", "#b388ff"];

const avatarAssets = (id: string, index: number): ArtAsset[] => {
  const who = AVATAR_CHARACTERS[id]!;
  const color = AVATAR_COLORS[index % AVATAR_COLORS.length]!;
  return [
    {
      id: `avatar-${id}-idle`,
      file: `${BASE}/avatars/${id}-idle.png`,
      width: 256,
      height: 256,
      anchor: [0.5, 0.94],
      transparent: true,
      color,
      label: id[0]!.toUpperCase(),
      prompt: `Full-body game character: ${who}, standing in a relaxed idle pose, facing the viewer at three-quarter angle, feet at the bottom centre, small soft oval shadow under the feet. Chibi proportions (head about 40% of height). Transparent background.`,
    },
    {
      id: `avatar-${id}-walk`,
      file: `${BASE}/avatars/${id}-walk.png`,
      width: 512,
      height: 256,
      frames: 2,
      anchor: [0.5, 0.94],
      transparent: true,
      color,
      label: id[0]!.toUpperCase(),
      prompt: `Two-frame walk cycle sprite sheet, side by side, each frame 256x256: ${who}, walking to the right, frame 1 left foot forward, frame 2 right foot forward, identical scale and baseline in both frames, small soft oval shadow under the feet. Chibi proportions. Transparent background.`,
    },
    {
      id: `avatar-${id}-portrait`,
      file: `${BASE}/avatars/${id}-portrait.png`,
      width: 256,
      height: 256,
      anchor: [0.5, 0.5],
      transparent: true,
      color,
      label: id[0]!.toUpperCase(),
      prompt: `Head-and-shoulders portrait of ${who}, smiling, centred inside a circle-friendly composition (nothing important outside the inscribed circle). Transparent background.`,
    },
  ];
};

const keeper = (
  id: string,
  color: string,
  label: string,
  who: string,
): ArtAsset => ({
  id: `keeper-${id}`,
  file: `${BASE}/keepers/${id}.png`,
  width: 384,
  height: 384,
  anchor: [0.5, 1],
  transparent: true,
  color,
  label,
  prompt: `Shopkeeper portrait, waist up, behind a counter edge at the bottom of the frame: ${who} Deadpan, slightly sardonic expression, looking at the viewer. Transparent background.`,
});

const icon = (
  id: string,
  color: string,
  label: string,
  subject: string,
): ArtAsset => ({
  id: `icon-${id}`,
  file: `${BASE}/icons/${id}.png`,
  width: 256,
  height: 256,
  anchor: [0.5, 0.5],
  transparent: true,
  color,
  label,
  prompt: `Item icon: ${subject}, centred, filling about 80% of the canvas, slight three-quarter angle, soft shadow below. Transparent background.`,
});

const ui = (
  id: string,
  color: string,
  label: string,
  subject: string,
): ArtAsset => ({
  id: `ui-${id}`,
  file: `${BASE}/ui/${id}.png`,
  width: 128,
  height: 128,
  anchor: [0.5, 0.5],
  transparent: true,
  color,
  label,
  prompt: `Simple UI glyph: ${subject}, centred, bold and readable at 24 px, flat with one highlight, no shadow. Transparent background.`,
});

export const ART: readonly ArtAsset[] = [
  {
    // The city every match is played in: the whole board, label-free (the game draws the name labels). The street
    // graph in `src/game/data/cities/fusetown.ts` is traced over it in 1536 × 1024 map px, so any size of this
    // picture with the same composition fits.
    id: "board-fusetown",
    file: `${BASE}/cities/fusetown.jpg`,
    width: 3072,
    height: 2048,
    anchor: [0, 0],
    transparent: false,
    color: "#8cc363",
    label: "",
    prompt:
      "A whole little harbour town seen from above at a three-quarter angle (about 35 degrees), as one cheerful mobile game board in landscape 3:2: a town square with a clock tower in the middle; curvy, imperfect asphalt streets with white dashes and crossings winding between the buildings, with several bends and a crossroads, no ring road; a bay with a quay, a pier, a wharf with cranes and containers, boats, a canal crossed by a footbridge, and a lighthouse in the bottom right. Fourteen buildings face the streets: a shared house, a letting agency, a glass residential tower, a grocery store, a fintech bank, a modern factory, a job centre, a red-brick college, an electronics store, a clothing boutique, a drive-thru burger joint, a big-box discount store, a second-hand shop and the port with its harbour office. Buildings, streets and water fill the frame edge to edge, only small patches of lawn and trees between them. Opaque, no text, no labels, no signs with letters.",
  },
  building(
    "roomshare",
    "#ffb4a2",
    "ROOM",
    "A tired but charming three-storey shared house with mismatched curtains, bikes chained outside and a recycling bin overflowing with takeaway boxes.",
  ),
  building(
    "keynest",
    "#ffd23f",
    "KEY",
    "A small modern letting-agency office with a huge key-shaped sign shape above the door (no letters) and a glass front with house listings as coloured cards.",
  ),
  building(
    "tower",
    "#4cc9f0",
    "TWR",
    "A sleek glass residential tower with a doorman canopy, potted plants and warm lights in the windows.",
  ),
  building(
    "freshco",
    "#3ddc84",
    "FRSH",
    "A bright neighbourhood grocery store with a striped awning, crates of fruit and vegetables outside and a shopping cart.",
  ),
  building(
    "neobank",
    "#7b2cbf",
    "BANK",
    "A minimalist fintech bank branch with a curved glass facade, a big app-icon-like sign shape and an ATM by the door.",
  ),
  building(
    "gigafactory",
    "#8d99ae",
    "GIGA",
    "A huge clean modern factory with saw-tooth roofs, solar panels, a chimney with a puff of white steam and a robot arm visible through a window.",
  ),
  building(
    "jobhub",
    "#2ec4b6",
    "JOBS",
    "A friendly job centre with a speech-bubble sign shape, a notice board of job cards outside and a queue line rope.",
  ),
  building(
    "college",
    "#ff9f1c",
    "COLL",
    "A small red-brick city college with columns, a clock above the entrance, steps and a tree with a bench.",
  ),
  building(
    "gadget",
    "#00b4d8",
    "GADG",
    "An electronics store with a giant plug-shaped sign shape, glowing screens in the window and a delivery van.",
  ),
  building(
    "threads",
    "#ff6b9e",
    "THRD",
    "A stylish clothing boutique with mannequins in the window, a hanger-shaped sign shape and a pink awning.",
  ),
  building(
    "mono",
    "#ff6b6b",
    "MONO",
    "A retro drive-thru burger joint with a giant burger on the roof, a drive-thru lane and a neon-style menu board.",
  ),
  building(
    "megamart",
    "#f9c74f",
    "MEGA",
    "A big-box discount warehouse store with a huge flat roof, stacked pallets, a cart corral and bargain banners without text.",
  ),
  building(
    "resale",
    "#b5838d",
    "2ND",
    "A quirky second-hand shop with a cluttered window of lamps, guitars and teapots, and a hand-painted sign shape.",
  ),
  building(
    "docks",
    "#3a86c8",
    "PORT",
    "A small harbour office on a wooden quay with a stack of colourful shipping containers, a little yellow crane, coiled ropes, a bollard and the edge of the water with a moored tugboat.",
  ),
  ...Object.keys(AVATAR_CHARACTERS).flatMap(avatarAssets),
  keeper(
    "roomshare",
    "#ffb4a2",
    "ROOM",
    "a sleepy flatmate in pyjamas holding a mug labelled with a sticky note.",
  ),
  keeper(
    "keynest",
    "#ffd23f",
    "KEY",
    "a landlord in a sharp blazer holding a clipboard and a ring of keys.",
  ),
  keeper(
    "tower",
    "#4cc9f0",
    "TWR",
    "a dignified doorman in a uniform with a cap and white gloves.",
  ),
  keeper(
    "freshco",
    "#3ddc84",
    "FRSH",
    "a grocer in a green apron holding a perfect tomato.",
  ),
  keeper(
    "neobank",
    "#7b2cbf",
    "BANK",
    "a young banker in a turtleneck holding a phone with a chart on it.",
  ),
  keeper(
    "gigafactory",
    "#8d99ae",
    "GIGA",
    "a shift supervisor in a hard hat and hi-vis vest with a tablet.",
  ),
  keeper(
    "jobhub",
    "#2ec4b6",
    "JOBS",
    "a cheerful recruiter with a headset and a stack of job cards.",
  ),
  keeper(
    "college",
    "#ff9f1c",
    "COLL",
    "a professor with tweed jacket, elbow patches and a coffee mug.",
  ),
  keeper(
    "gadget",
    "#00b4d8",
    "GADG",
    "a tech salesperson with a lanyard and a tablet, very enthusiastic.",
  ),
  keeper(
    "threads",
    "#ff6b9e",
    "THRD",
    "a fashion stylist with a measuring tape around the neck and big glasses.",
  ),
  keeper(
    "mono",
    "#ff6b6b",
    "MONO",
    "a teenage burger cashier in a paper hat, visibly bored.",
  ),
  keeper(
    "megamart",
    "#f9c74f",
    "MEGA",
    "a discount-store clerk in a vest with a price-tag gun.",
  ),
  keeper(
    "resale",
    "#b5838d",
    "2ND",
    "an eccentric collector with a monocle and a vintage scarf.",
  ),
  keeper(
    "docks",
    "#3a86c8",
    "PORT",
    "a weathered harbour master in a navy cap and a yellow rain jacket holding a clipboard, a coil of rope over one shoulder.",
  ),
  icon(
    "groceries",
    "#3ddc84",
    "FOOD",
    "a paper grocery bag with bread, carrots and apples",
  ),
  icon("burger", "#ff6b6b", "BRGR", "a classic cheeseburger"),
  icon("double-burger", "#ff6b6b", "2X", "a tall double cheeseburger"),
  icon("shake", "#ff6b9e", "SHK", "a strawberry milkshake with a straw"),
  icon("clothes-casual", "#4cc9f0", "CSL", "a folded hoodie and jeans"),
  icon(
    "clothes-smart",
    "#2ec4b6",
    "SMT",
    "a blazer over a polo shirt on a hanger",
  ),
  icon(
    "clothes-business",
    "#7b2cbf",
    "BIZ",
    "a dark business suit with a tie on a hanger",
  ),
  icon(
    "fridge",
    "#00b4d8",
    "FRDG",
    "a modern smart fridge with a small screen on the door",
  ),
  icon("freezer", "#4cc9f0", "FRZR", "a white chest freezer with frost"),
  icon("stove", "#ff9f1c", "STOV", "an induction stove top with a pan"),
  icon("tv", "#7b2cbf", "TV", "a flat smart TV on a stand"),
  icon("console", "#3ddc84", "GAME", "a game console with a controller"),
  icon("speakers", "#ffd23f", "SPKR", "a pair of bookshelf speakers"),
  icon("airfryer", "#ff6b6b", "FRYR", "an air fryer with a basket"),
  icon("hottub", "#2ec4b6", "TUB", "a round hot tub with bubbles"),
  icon("laptop", "#8d99ae", "LAP", "an open laptop with a sticker on the lid"),
  icon(
    "books",
    "#ff9f1c",
    "BOOK",
    "a stack of three textbooks with a bookmark",
  ),
  icon("joke-phonecase", "#ff6b9e", "LOL", "a phone case covered in glitter"),
  icon(
    "joke-nft",
    "#b388ff",
    "NFT",
    "a framed pixelated picture of a sandwich",
  ),
  icon(
    "joke-audiobook",
    "#ffd23f",
    "HSTL",
    "a box set of audio CDs with a rocket on the cover",
  ),
  ui("clock", "#4cc9f0", "H", "a round alarm clock"),
  ui("cash", "#3ddc84", "$", "a green banknote"),
  ui("bank", "#7b2cbf", "BK", "a classical bank building"),
  ui("wealth", "#ffd23f", "W", "a gold coin stack"),
  ui("happiness", "#ff6b9e", "J", "a smiling face"),
  ui("education", "#4cc9f0", "E", "a graduation cap"),
  ui("career", "#ff9f1c", "C", "a briefcase"),
  ui("rent", "#ffd23f", "R", "a house key"),
  ui("food", "#3ddc84", "F", "a fork and knife"),
  ui("work", "#8d99ae", "WK", "a hard hat"),
  ui("study", "#ff9f1c", "ST", "an open book"),
  ui("relax", "#2ec4b6", "Z", "a sofa with a pillow"),
  ui("stocks", "#7b2cbf", "↗", "a rising line chart"),
  ui("week", "#ff6b6b", "WK", "a calendar page"),
  ui("ready", "#3ddc84", "✓", "a check mark in a circle"),
];

export const ART_BY_ID: ReadonlyMap<string, ArtAsset> = new Map(
  ART.map((asset) => [asset.id, asset]),
);
