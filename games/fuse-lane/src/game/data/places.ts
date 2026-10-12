/**
 * The 14 places of Fusetown: the original's 13 (turn-engine notes §2.2) with Fuse Lane's names (modern-game.md §3),
 * and the docks. Where each one stands, and the streets between them, are the city's (`./cities/`).
 */
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
  | "resale"
  | "port";

export interface PlaceData {
  id: string;
  name: string;
  kind: PlaceKind;
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
  RESALE = 12,
  DOCKS = 13;

/** Employers: the nine companies in `COMPANIES` order, then City College. */
export const EMPLOYERS = [
  "Gigafactory",
  "Neobank",
  "FreshCo",
  "Mono Burger",
  "Gadget Garage",
  "Threads",
  "MegaMart",
  "KeyNest",
  "Fusetown Port",
  "City College",
] as const;
export const COLLEGE_EMPLOYER = 9;

export const PLACES: readonly PlaceData[] = [
  {
    id: "roomshare",
    name: "Roomshare",
    kind: "home",
    company: -1,
    employer: -1,
  },
  {
    id: "keynest",
    name: "KeyNest",
    kind: "rent",
    company: 7,
    employer: 7,
  },
  {
    id: "tower",
    name: "The Tower",
    kind: "home",
    company: -1,
    employer: -1,
  },
  {
    id: "freshco",
    name: "FreshCo",
    kind: "grocery",
    company: 2,
    employer: 2,
  },
  {
    id: "neobank",
    name: "Neobank",
    kind: "bank",
    company: 1,
    employer: 1,
  },
  {
    id: "gigafactory",
    name: "Gigafactory",
    kind: "factory",
    company: 0,
    employer: 0,
  },
  {
    id: "jobhub",
    name: "Job Hub",
    kind: "jobs",
    company: -1,
    employer: -1,
  },
  {
    id: "college",
    name: "City College",
    kind: "college",
    company: -1,
    employer: 9,
  },
  {
    id: "gadget",
    name: "Gadget Garage",
    kind: "gadgets",
    company: 4,
    employer: 4,
  },
  {
    id: "threads",
    name: "Threads",
    kind: "clothes",
    company: 5,
    employer: 5,
  },
  {
    id: "mono",
    name: "Mono Burger",
    kind: "food",
    company: 3,
    employer: 3,
  },
  {
    id: "megamart",
    name: "MegaMart",
    kind: "discount",
    company: 6,
    employer: 6,
  },
  {
    id: "resale",
    name: "Second Life",
    kind: "resale",
    company: -1,
    employer: -1,
  },
  {
    id: "docks",
    name: "Fusetown Docks",
    kind: "port",
    company: 8,
    employer: 8,
  },
];

/** The place an employer's staff work at. */
export const WORKPLACE: readonly number[] = EMPLOYERS.map((_, employer) =>
  PLACES.findIndex((place) => place.employer === employer),
);

/** The places where an employer also takes applications for its own jobs, at the gate (the Job Hub takes them all). */
export const hiresAtGate = (place: number): boolean =>
  PLACES[place]?.kind === "factory" || PLACES[place]?.kind === "port";

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
  [
    "The sea is calm. The paperwork is not.",
    "Mind the ropes. They have seniority.",
    "Containers in, containers out. Feelings stay on the quay.",
  ],
];
