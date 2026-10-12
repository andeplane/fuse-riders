/**
 * The city: 13 places on a loop road of `RING` steps. Ring positions are the original's (turn-engine notes §2.2),
 * the names are Fuse Lane's (modern-game.md §3).
 */
export const RING = 170;

export type PlaceKind =
  | "home"
  | "rent"
  | "grocery"
  | "bank"
  | "factory"
  | "jobs"
  | "college"
  | "gadgets"
  | "clothes"
  | "food"
  | "discount"
  | "resale";

export interface PlaceData {
  id: string;
  name: string;
  kind: PlaceKind;
  /** Index on the ring road. */
  ring: number;
  /** The listed company that runs it (`COMPANIES` index), or -1. */
  company: number;
  /** The employer whose staff work here (`EMPLOYERS` index), or -1. */
  employer: number;
}

export const ROOMSHARE = 0,
  KEYNEST = 1,
  TOWER = 2,
  FRESHCO = 3,
  NEOBANK = 4,
  GIGAFACTORY = 5,
  JOBHUB = 6,
  COLLEGE = 7,
  GADGET = 8,
  THREADS = 9,
  MONO = 10,
  MEGAMART = 11,
  RESALE = 12;

/** Employers: the eight companies in `COMPANIES` order, then City College. */
export const EMPLOYERS = [
  "Gigafactory",
  "Neobank",
  "FreshCo",
  "Mono Burger",
  "Gadget Garage",
  "Threads",
  "MegaMart",
  "KeyNest",
  "City College",
] as const;
export const COLLEGE_EMPLOYER = 8;

export const PLACES: readonly PlaceData[] = [
  {
    id: "roomshare",
    name: "Roomshare",
    kind: "home",
    ring: 1,
    company: -1,
    employer: -1,
  },
  {
    id: "keynest",
    name: "KeyNest",
    kind: "rent",
    ring: 164,
    company: 7,
    employer: 7,
  },
  {
    id: "tower",
    name: "The Tower",
    kind: "home",
    ring: 151,
    company: -1,
    employer: -1,
  },
  {
    id: "freshco",
    name: "FreshCo",
    kind: "grocery",
    ring: 134,
    company: 2,
    employer: 2,
  },
  {
    id: "neobank",
    name: "Neobank",
    kind: "bank",
    ring: 120,
    company: 1,
    employer: 1,
  },
  {
    id: "gigafactory",
    name: "Gigafactory",
    kind: "factory",
    ring: 107,
    company: 0,
    employer: 0,
  },
  {
    id: "jobhub",
    name: "Job Hub",
    kind: "jobs",
    ring: 99,
    company: -1,
    employer: -1,
  },
  {
    id: "college",
    name: "City College",
    kind: "college",
    ring: 75,
    company: -1,
    employer: 8,
  },
  {
    id: "gadget",
    name: "Gadget Garage",
    kind: "gadgets",
    ring: 66,
    company: 4,
    employer: 4,
  },
  {
    id: "threads",
    name: "Threads",
    kind: "clothes",
    ring: 47,
    company: 5,
    employer: 5,
  },
  {
    id: "mono",
    name: "Mono Burger",
    kind: "food",
    ring: 35,
    company: 3,
    employer: 3,
  },
  {
    id: "megamart",
    name: "MegaMart",
    kind: "discount",
    ring: 24,
    company: 6,
    employer: 6,
  },
  {
    id: "resale",
    name: "Second Life",
    kind: "resale",
    ring: 14,
    company: -1,
    employer: -1,
  },
];

/** The place an employer's staff work at. */
export const WORKPLACE: readonly number[] = EMPLOYERS.map((_, employer) =>
  PLACES.findIndex((place) => place.employer === employer),
);

/** Steps between two ring positions the short way round. */
export function ringDistance(a: number, b: number): number {
  const gap = Math.abs(a - b) % RING;
  return Math.min(gap, RING - gap);
}
/** The direction (+1 or −1) of the shorter way from `from` to `to`; +1 on a tie. */
export function ringDirection(from: number, to: number): 1 | -1 {
  const forward = (to - from + RING) % RING;
  return forward <= RING - forward ? 1 : -1;
}

/** One line per place, picked by the week: the shopkeepers' deadpan greetings. */
export const GREETINGS: readonly (readonly string[])[] = [
  ["Your flatmate labelled the oat milk again.", "Home, sweet shared home."],
  [
    "Rent is a state of mind. Ours is due.",
    "We take keys and checks. Mostly checks.",
  ],
  [
    "The doorman nods. It costs extra.",
    "Penthouse vibes, studio square footage.",
  ],
  ["Fresh today, compost tomorrow.", "Aisle 4 has feelings about kale."],
  ["Zero fees*. *Some fees.", "Your money, but make it an app."],
  [
    "Robots build cars. You build robots. Circle of life.",
    "Hard hats are the new beanies.",
  ],
  ["Every career starts with a login.", "Today's vibe: gainfully employed."],
  ["Knowledge is power. Tuition is extra.", "Lectures at 8. Coffee at 7:59."],
  [
    "It has Bluetooth. Of course it has Bluetooth.",
    "Now with 40% more blinking lights.",
  ],
  [
    "Dress for the job you want. Rent for the job you have.",
    "This season: business casual chaos.",
  ],
  ["Would you like regret with that?", "Drive-thru open, standards closed."],
  [
    "Prices so low, so is the build quality.",
    "Today's deal: aisle-cleanup surprise.",
  ],
  ["Someone's treasure, slightly used.", "Back next season. Probably."],
];
