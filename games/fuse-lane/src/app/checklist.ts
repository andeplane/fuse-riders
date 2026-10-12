import {
  COLLEGE,
  FRESHCO,
  GADGET,
  JOBHUB,
  JOBS,
  MONO,
  NEOBANK,
  RELAXED,
  WORKPLACE,
  fed,
  homePlace,
  owns,
  type PlayerState,
} from "../game/index.js";
import type { Store } from "./session.js";

/**
 * The "Getting started" checklist: a new player's first steps, each ticked off the first time the player's state
 * shows it done (and kept ticked after: food gets eaten, savings get spent). It lives on this device, per match and
 * player, beside the save; the screen shows it all game unless the player hides it (and they can bring it back).
 */
export const CHECKLIST_KEY = "fuse-lane-checklist";

export interface ChecklistStep {
  id: string;
  label: string;
}
export const STEPS: readonly ChecklistStep[] = [
  { id: "job", label: "Find a job" },
  { id: "shift", label: "Work a shift" },
  { id: "food", label: "Buy food for the week" },
  { id: "enroll", label: "Enroll in a course" },
  { id: "class", label: "Go to a class" },
  { id: "rest", label: "Rest at home" },
  { id: "save", label: "Save money at Neobank" },
  { id: "treat", label: "Buy something nice" },
];

/** The steps a player's state shows done right now. */
export function reached(me: PlayerState): string[] {
  const now: Record<string, boolean> = {
    job: me.job >= 0 || me.shifts > 0,
    shift: me.shifts > 0,
    food: fed(me),
    enroll: me.courses.some((lessons) => lessons >= 0),
    class: me.courses.some((lessons) => lessons > 0),
    rest: (me.flags & RELAXED) !== 0,
    save: me.bank > 0,
    treat: Object.keys(me.durables).length > 0,
  };
  return STEPS.filter((step) => now[step.id]).map((step) => step.id);
}

/** Where a step is done, for this player now. */
export function stepPlace(id: string, me: PlayerState): number {
  switch (id) {
    case "job":
      return JOBHUB;
    case "shift":
      return me.job >= 0 ? WORKPLACE[JOBS[me.job]!.employer]! : JOBHUB;
    case "food":
      return owns(me, "fridge") ? FRESHCO : MONO;
    case "enroll":
    case "class":
      return COLLEGE;
    case "rest":
      return homePlace(me.home);
    case "save":
      return NEOBANK;
    default:
      return GADGET;
  }
}

export interface ChecklistSave {
  match: string;
  /** The list is open (not folded to its title); unset until the player folds or unfolds it. */
  open?: boolean;
  /** Steps done, per player id. */
  done: Record<string, string[]>;
  /** Players who hid their list. */
  closed: string[];
}

export interface ChecklistModel {
  /** Whose list this is. */
  owner: string;
  items: { id: string; label: string; done: boolean; place: number }[];
  done: number;
  total: number;
  open?: boolean;
  complete: boolean;
  /** The player hid it. */
  hidden: boolean;
}

/** This match's checklist from the device, or a fresh one (another match's, or nothing readable). */
export function loadChecklist(store: Store, match: string): ChecklistSave {
  const fresh: ChecklistSave = { match, done: {}, closed: [] };
  try {
    const saved = JSON.parse(
      store.getItem(CHECKLIST_KEY) ?? "null",
    ) as ChecklistSave | null;
    if (
      saved?.match === match &&
      (saved.open === undefined || typeof saved.open === "boolean") &&
      saved.done &&
      typeof saved.done === "object" &&
      Array.isArray(saved.closed)
    )
      return saved;
  } catch {
    // Unreadable: start over.
  }
  return fresh;
}
export const saveChecklist = (store: Store, save: ChecklistSave): void =>
  store.setItem(CHECKLIST_KEY, JSON.stringify(save));

/** Ticks off what `me` shows done now; whether anything new was ticked. */
export function advance(
  save: ChecklistSave,
  id: string,
  me: PlayerState,
): boolean {
  const done = new Set(save.done[id] ?? []),
    before = done.size;
  for (const step of reached(me)) done.add(step);
  if (done.size === before) return false;
  save.done[id] = STEPS.map((step) => step.id).filter((step) => done.has(step));
  return true;
}

/** Hides `id`'s list, or brings it back. */
export function hideChecklist(
  save: ChecklistSave,
  id: string,
  hidden: boolean,
): void {
  save.closed = save.closed.filter((owner) => owner !== id);
  if (hidden) save.closed.push(id);
}

/** The checklist as the screen shows it. */
export function checklistModel(
  save: ChecklistSave,
  id: string,
  me: PlayerState,
): ChecklistModel {
  const done = new Set(save.done[id] ?? []);
  const items = STEPS.map((step) => ({
    id: step.id,
    label: step.label,
    done: done.has(step.id),
    place: stepPlace(step.id, me),
  }));
  const count = items.filter((item) => item.done).length;
  return {
    owner: id,
    items,
    done: count,
    total: items.length,
    ...(save.open === undefined ? {} : { open: save.open }),
    complete: count === items.length,
    hidden: save.closed.includes(id),
  };
}
