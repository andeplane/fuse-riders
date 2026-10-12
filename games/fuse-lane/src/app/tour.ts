import {
  CITY,
  COLLEGE,
  EMPLOYERS,
  FRESHCO,
  GADGET,
  GIGAFACTORY,
  GOAL_NAMES,
  JOBHUB,
  JOBS,
  KEYNEST,
  NEOBANK,
  ROOMSHARE,
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
export type TourHud = "clock" | "goals" | "tip" | "list";

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
  const sure = JOBS.find((job) => job.sure);
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
      body: `Every week has ${WEEK_HOURS} hours and ${view.weekSeconds} real seconds. Walking and everything you do costs hours. When either runs out, or you tap Call it a week, your week is over and the hours left become sleep.`,
      hud: "clock",
    },
    {
      title: "Your goals",
      body: "These rings fill up as you go. Wealth is your money, happiness comes from fun and nice things, education from degrees, and career from steady work.",
      hud: "goals",
    },
    {
      title: "Find a job",
      body: `Start at the Job Hub. Every employer posts its jobs there, with your odds of getting hired.${sure ? ` ${sure.title} at ${EMPLOYERS[sure.employer]} is a sure thing to begin with.` : ""}`,
      places: [JOBHUB],
    },
    {
      title: "Go to work",
      body: "A shift is 6 hours where your employer is: the Gigafactory, the docks, the shops. Steady work builds your career. Jobs need the right clothes, and Threads sells them.",
      places: [GIGAFACTORY],
    },
    {
      title: "Study",
      body: "Courses at City College earn degrees. Better jobs need them, and every degree lifts your education.",
      places: [COLLEGE],
    },
    {
      title: "Eat every week",
      body: "Buy groceries at FreshCo (they go off without a fridge) or a meal at Mono Burger. Go a week without food and you lose 20 hours.",
      places: [FRESHCO],
    },
    {
      title: "Home, rent and sleep",
      body: "You live at Roomshare and pay rent at KeyNest every 4 weeks. Relax at home, or leave hours unused and you sleep them off. Rest keeps the doctor and burglars away, and your first rest each week makes you happier.",
      places: [ROOMSHARE, KEYNEST],
    },
    {
      title: "Money and nice things",
      body: "Neobank keeps your savings, lends and trades shares. Gadget Garage and the other shops sell things that make you happier.",
      places: [NEOBANK, GADGET],
    },
    {
      title: "Getting started",
      body: "Your first steps: find a job, eat, study and more. They tick themselves off as you do them, and a tap on one walks you there.",
      hud: "list",
    },
    {
      title: "Tips",
      body: "Not sure what to do? This tip always shows your next step: tap it to walk there. Tap the clock for more tips and how your week is going.",
      hud: "tip",
    },
    {
      title: "Your move",
      body: "Tap a building to walk there, and drag the map to look around. Good luck!",
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
