import { button, el } from "fuse-ui";
import {
  AVATARS,
  CAPACITY,
  LEVELS,
  WEEK_SECONDS,
  seatName,
  type Goals,
} from "../game/index.js";
import type { Art } from "./art.js";
import { MAX_HUMANS, validSetup, type LocalSetup } from "./local.js";
import type { Store } from "./session.js";

/**
 * The menu: who plays on this device, how many AI opponents and how good they are, how long the game runs and how
 * long each turn lasts. The choice is remembered on the device. `chooseSetup` and `parseStoredSetup` are pure, so the
 * rules of the form are tested without a page.
 */
export const SETUP_KEY = "fuse-lane-setup";
export const GOAL_PRESETS = [
  { label: "Quick", goal: 30 },
  { label: "Standard", goal: 50 },
  { label: "Long", goal: 80 },
] as const;

export interface MenuChoice {
  humans: { name: string; avatar: string }[];
  bots: number;
  level: number;
  goal: number;
  weekSeconds: number;
}

export const DEFAULT_CHOICE: MenuChoice = {
  humans: [{ name: "You", avatar: "fox" }],
  bots: 1,
  level: 1,
  goal: 50,
  weekSeconds: 60,
};

const PLAYER_NAMES = ["You", "Player 2", "Player 3", "Player 4"];

/** The most bots that fit beside `humans` people (five seats in all, three bots at most). */
export const maxBots = (humans: number) => Math.min(3, CAPACITY - humans);

/** A choice made consistent: names cleaned and distinct, counts and options in range. */
export function normalizeChoice(choice: MenuChoice): MenuChoice {
  const humans = choice.humans.slice(0, MAX_HUMANS).map((human, index) => ({
    name: seatName(human.name) ?? PLAYER_NAMES[index]!,
    avatar: (AVATARS as readonly string[]).includes(human.avatar)
      ? human.avatar
      : AVATARS[index]!,
  }));
  if (humans.length === 0) humans.push({ ...DEFAULT_CHOICE.humans[0]! });
  const seen = new Set<string>();
  humans.forEach((human, index) => {
    let name = human.name,
      n = 2;
    // Cut by code points, so a name never ends in half a surrogate pair (which `validSetup` refuses).
    const stem = Array.from(human.name).slice(0, 13).join("").trim();
    while (seen.has(name)) name = `${stem} ${n++}`;
    seen.add(name);
    humans[index] = { ...human, name };
  });
  return {
    humans,
    bots: Math.max(
      0,
      Math.min(maxBots(humans.length), Math.round(choice.bots) || 0),
    ),
    level: [0, 1, 2].includes(choice.level) ? choice.level : 1,
    goal: GOAL_PRESETS.some((preset) => preset.goal === choice.goal)
      ? choice.goal
      : 50,
    weekSeconds: (WEEK_SECONDS as readonly number[]).includes(
      choice.weekSeconds,
    )
      ? choice.weekSeconds
      : 60,
  };
}

/**
 * The setup a choice starts, with a fresh seed. It never throws (it runs in a click handler): a choice that still
 * does not make a valid setup starts the default one.
 */
export function chooseSetup(choice: MenuChoice, seed: string): LocalSetup {
  const setupOf = (from: MenuChoice): LocalSetup => {
    const clean = normalizeChoice(from);
    const goals: Goals = [clean.goal, clean.goal, clean.goal, clean.goal];
    return { ...clean, goals, seed };
  };
  const setup = setupOf(choice);
  return validSetup(setup) ? setup : setupOf(DEFAULT_CHOICE);
}

/** What the device remembered, or the defaults. */
export function parseStoredSetup(raw: string | null): MenuChoice {
  if (!raw) return DEFAULT_CHOICE;
  try {
    const value = JSON.parse(raw) as Partial<MenuChoice>;
    if (!value || typeof value !== "object" || !Array.isArray(value.humans))
      return DEFAULT_CHOICE;
    return normalizeChoice({
      ...DEFAULT_CHOICE,
      ...value,
      humans: value.humans.filter(
        (human): human is { name: string; avatar: string } =>
          Boolean(human) &&
          typeof human.name === "string" &&
          typeof human.avatar === "string",
      ),
    });
  } catch {
    return DEFAULT_CHOICE;
  }
}

/** A row of choices, one of them on. */
function segmented<T>(
  options: readonly { label: string; value: T }[],
  current: () => T,
  pick: (value: T) => void,
) {
  const element = el("div", "", "fl-segmented");
  const buttons = options.map((option) => {
    const choice = button(option.label, "fl-segment");
    choice.onclick = () => pick(option.value);
    element.append(choice);
    return { choice, value: option.value };
  });
  return {
    element,
    render() {
      for (const { choice, value } of buttons) {
        const on = value === current();
        choice.classList.toggle("on", on);
        choice.setAttribute("aria-pressed", String(on));
      }
    },
  };
}

export interface MenuOptions {
  art: Art;
  store: Store;
  /** The saved match's one-line summary, when there is one. */
  saved?: string;
  onStart(choice: MenuChoice): void;
  onResume(): void;
  onDiscard(): void;
}

export function createMenu(options: MenuOptions): HTMLElement {
  const { art, store } = options;
  let choice = parseStoredSetup(safeGet(store, SETUP_KEY));
  const remember = () => {
    try {
      store.setItem(SETUP_KEY, JSON.stringify(choice));
    } catch {
      /* not remembered: the menu still works */
    }
  };
  const root = el("main", "", "fl-menu");
  const hero = el("section", "", "fl-hero");
  hero.append(
    el("h1", "FUSE LANE", "fl-hero-title"),
    el(
      "p",
      "Live a week against the clock: work, study, shop and invest in a city whose economy answers back. First to reach all four goals wins.",
      "fl-hero-tagline",
    ),
  );
  root.append(hero);

  if (options.saved) {
    const resume = el("section", "", "fl-sheet fl-resume");
    const go = button("CONTINUE", "fui-button-primary fl-resume-go"),
      discard = button("DISCARD", "fl-resume-discard");
    go.onclick = () => options.onResume();
    discard.onclick = () => {
      options.onDiscard();
      resume.remove();
    };
    const actions = el("div", "", "fl-actions");
    actions.append(discard, go);
    resume.append(
      el("h2", "GAME IN PROGRESS", "fl-menu-title"),
      el("p", options.saved, "fl-resume-line"),
      actions,
    );
    root.append(resume);
  }

  const form = el("section", "", "fl-sheet fl-setup");
  // Players on this device.
  const people = el("div", "", "fl-people"),
    addPerson = button("+ ADD A PLAYER (PASS AND PLAY)", "fl-add-person");
  addPerson.onclick = () => {
    choice = normalizeChoice({
      ...choice,
      humans: [
        ...choice.humans,
        {
          name: PLAYER_NAMES[choice.humans.length] ?? "Player",
          avatar:
            AVATARS.find(
              (avatar) => !choice.humans.some((h) => h.avatar === avatar),
            ) ?? AVATARS[0],
        },
      ],
    });
    update(true);
  };
  function personRow(index: number): HTMLElement {
    const human = choice.humans[index]!;
    const row = el("div", "", "fl-person");
    const face = button("", "fl-person-face");
    face.setAttribute("aria-label", `Change ${human.name}'s character`);
    face.append(art.element(`avatar-${human.avatar}-portrait`, 44));
    face.onclick = () => {
      const at = AVATARS.indexOf(human.avatar as (typeof AVATARS)[number]);
      choice.humans[index] = {
        ...human,
        avatar: AVATARS[(at + 1) % AVATARS.length]!,
      };
      choice = normalizeChoice(choice);
      update(true);
    };
    const name = el("input", "", "fl-person-name");
    name.value = human.name;
    name.maxLength = 16;
    name.autocomplete = "off";
    name.setAttribute("aria-label", `Player ${index + 1} name`);
    name.onchange = () => {
      choice.humans[index] = { ...choice.humans[index]!, name: name.value };
      choice = normalizeChoice(choice);
      // Only this field changes: rebuilding the rows here would pull an input out from under another's blur.
      name.value = choice.humans[index]!.name;
      update(false);
    };
    row.append(face, name);
    if (choice.humans.length > 1) {
      const remove = button("×", "fl-person-remove");
      remove.setAttribute("aria-label", `Remove ${human.name}`);
      remove.onclick = () => {
        choice = normalizeChoice({
          ...choice,
          humans: choice.humans.filter((_, at) => at !== index),
        });
        update(true);
      };
      row.append(remove);
    }
    return row;
  }
  // AI opponents.
  const botCount = el("b", "", "fl-stepper-value"),
    fewer = button("−", "fl-stepper-button"),
    more = button("+", "fl-stepper-button");
  fewer.setAttribute("aria-label", "Fewer AI opponents");
  more.setAttribute("aria-label", "More AI opponents");
  const stepper = el("div", "", "fl-stepper");
  stepper.append(fewer, botCount, more);
  fewer.onclick = () => {
    choice = normalizeChoice({ ...choice, bots: choice.bots - 1 });
    update(false);
  };
  more.onclick = () => {
    choice = normalizeChoice({ ...choice, bots: choice.bots + 1 });
    update(false);
  };
  const level = segmented(
    LEVELS.map((label, value) => ({ label, value })),
    () => choice.level,
    (value) => {
      choice = { ...choice, level: value };
      update(false);
    },
  );
  const goal = segmented(
    GOAL_PRESETS.map((preset) => ({
      label: `${preset.label} · ${preset.goal}`,
      value: preset.goal,
    })),
    () => choice.goal,
    (value) => {
      choice = { ...choice, goal: value };
      update(false);
    },
  );
  const week = segmented(
    WEEK_SECONDS.map((seconds) => ({ label: `${seconds}s`, value: seconds })),
    () => choice.weekSeconds,
    (value) => {
      choice = { ...choice, weekSeconds: value };
      update(false);
    },
  );
  const levelRow = el("div", "", "fl-field");
  const summary = el("p", "", "fl-setup-summary");
  const start = button("START", "fui-button-primary fl-start-game");
  start.onclick = () => {
    remember();
    options.onStart(choice);
  };
  const field = (title: string, hint: string, ...body: HTMLElement[]) => {
    const block = el("div", "", "fl-field");
    block.append(el("h2", title, "fl-menu-title"));
    if (hint) block.append(el("p", hint, "fl-hint"));
    block.append(...body);
    return block;
  };
  levelRow.append(el("h2", "AI LEVEL", "fl-menu-title"), level.element);
  form.append(
    field(
      "PLAYERS ON THIS DEVICE",
      "Tap a face to change character. More than one player? You'll pass the device between turns.",
      people,
      addPerson,
    ),
    field("AI OPPONENTS", "", stepper),
    levelRow,
    field(
      "GOALS",
      "Wealth, happiness, education and career: reach every one in the same week to win.",
      goal.element,
    ),
    field("TURN LENGTH", "Real seconds per week, per player.", week.element),
    summary,
    start,
  );
  root.append(form);

  function update(rebuildPeople: boolean): void {
    remember();
    if (rebuildPeople)
      people.replaceChildren(
        ...choice.humans.map((_, index) => personRow(index)),
      );
    addPerson.hidden = choice.humans.length >= MAX_HUMANS;
    botCount.textContent = String(choice.bots);
    fewer.disabled = choice.bots <= 0;
    more.disabled = choice.bots >= maxBots(choice.humans.length);
    levelRow.hidden = choice.bots === 0;
    level.render();
    goal.render();
    week.render();
    const people_ = choice.humans.length;
    summary.textContent =
      people_ + choice.bots === 1
        ? "Just you against the clock: a practice run."
        : `${people_ === 1 ? "You" : `${people_} players`}${choice.bots ? ` vs ${choice.bots} ${LEVELS[choice.level]!.toLowerCase()} AI` : ""} · about ${choice.goal <= 30 ? "20" : choice.goal <= 50 ? "25–30" : "35–40"} weeks`;
  }
  update(true);
  return root;
}

function safeGet(store: Store, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}
