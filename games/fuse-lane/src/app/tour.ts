import {
  CITY,
  COLLEGE,
  FRESHCO,
  GIGAFACTORY,
  GOAL_NAMES,
  JOBHUB,
  KEYNEST,
  NEOBANK,
  GADGET,
  WEEK_HOURS,
  type FuseLaneView,
} from "../game/index.js";
import type { MapPoint } from "../game/data/cities/city.js";
import type { Store } from "./session.js";
import { bounds, type Rect } from "./layout.js";

/**
 * The first-play tour: a few cards that point at the HUD and walk the camera round the map, so a new player learns
 * what is where and how a week works before their first clock starts. It shows once per device and replays from the
 * PAUSED card. This file holds the words and where each card points; the screen draws them.
 */
export const TOUR_KEY = "fuse-lane-toured";

/** A HUD piece a card points at. */
export type TourHud = "clock" | "goals" | "money" | "end";

export interface TourStep {
  title: string;
  body: string;
  /** What the card points at: HUD pieces, places on the map (the camera frames them all), or nothing (a card in the middle). */
  hud?: TourHud;
  places?: readonly number[];
}

const list = (words: readonly string[]): string =>
  `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;

/**
 * The tour for `you` in this match (by default whoever plays on this device now): their goals, rivals and week length.
 */
export function tourSteps(
  view: FuseLaneView,
  you = view.current || view.players.find((player) => !player.bot)?.id || "",
): TourStep[] {
  const me = view.players.find((player) => player.id === you);
  const goals = me?.state.goals ?? [];
  const rivals = view.players.filter((player) => player.id !== you).length;
  const targets = list(
    GOAL_NAMES.map((name, index) => `${name} ${goals[index] ?? 0}`),
  );
  return [
    {
      title: "Welcome to Fusetown",
      body: rivals
        ? `You and ${rivals} ${rivals === 1 ? "rival" : "rivals"} live the same weeks here. Reach all four of your goals first to win: ${targets}.`
        : `Build a life here, one week at a time. Reach all four of your goals to win: ${targets}.`,
    },
    {
      title: "Your week",
      body: `Every week has ${WEEK_HOURS} hours and ${view.weekSeconds} real seconds. Walking and everything you do costs hours. The hours you don't use, you sleep.`,
      hud: "clock",
    },
    {
      title: "Your goals",
      body: "These rings fill up as you go. Wealth is your money, happiness comes from fun and nice things, education from degrees, and career from steady work.",
      hud: "goals",
    },
    {
      title: "Find a job",
      body: "Start at the Job Hub. Every employer posts its jobs there, with your odds of getting hired.",
      places: [JOBHUB],
    },
    {
      title: "Go to work",
      body: "A shift is 6 hours where your employer is: the Gigafactory, the docks, the shops. The more you work, the better your career.",
      places: [GIGAFACTORY],
    },
    {
      title: "Study",
      body: "Courses at City College earn degrees. Better jobs need them, and every degree lifts your education.",
      places: [COLLEGE],
    },
    {
      title: "Eat and pay rent",
      body: "Buy food every week at FreshCo or Mono Burger, or lose 20 hours to hunger. Rent is due at KeyNest every 4 weeks.",
      places: [FRESHCO, KEYNEST],
    },
    {
      title: "Money and nice things",
      body: "Neobank keeps your savings, lends and trades shares. Gadget Garage and the other shops sell things that make you happier.",
      places: [NEOBANK, GADGET],
    },
    {
      title: "Your money",
      body: "Cash in your pocket, with your bank balance underneath.",
      hud: "money",
    },
    {
      title: "Call it a week",
      body: "Done early? Call it a week. Your week also ends when the hours or the clock run out.",
      hud: "end",
    },
    {
      title: "Your move",
      body: "Tap a building to walk there. Drag the map to look around. Good luck!",
    },
  ];
}

/** What a card frames on the map, in map px: the places' buildings and their name labels. */
export function tourArea(places: readonly number[]): Rect | undefined {
  if (places.length === 0) return undefined;
  const points = places.flatMap((place) => {
    const data = CITY.places[place]!,
      box = bounds(data.tap);
    return [
      [box.x, box.y],
      [box.x + box.w, box.y + box.h],
      // The label is a point at its middle; it reaches a little either side of it.
      [data.label[0] - LABEL_REACH, data.label[1] - LABEL_REACH / 2],
      [data.label[0] + LABEL_REACH, data.label[1] + LABEL_REACH / 2],
    ] as const;
  });
  const left = Math.min(...points.map((at) => at[0])),
    top = Math.min(...points.map((at) => at[1]));
  return {
    x: left,
    y: top,
    w: Math.max(...points.map((at) => at[0])) - left,
    h: Math.max(...points.map((at) => at[1])) - top,
  };
}
const LABEL_REACH = 24;

/** The middle of what a card frames, in map px: what the camera centres on. */
export function tourFocus(places: readonly number[]): MapPoint | undefined {
  const area = tourArea(places);
  return area && [area.x + area.w / 2, area.y + area.h / 2];
}

/** Whether this device still owes its player the tour. */
export const owesTour = (store: Store): boolean => !store.getItem(TOUR_KEY);
export const markToured = (store: Store): void => store.setItem(TOUR_KEY, "1");
