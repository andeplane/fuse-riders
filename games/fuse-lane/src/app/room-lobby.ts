import { button, createInviteCard, el } from "fuse-ui";
import { LEVELS, WEEK_SECONDS } from "../game/index.js";
import type { Art } from "./art.js";
import { GOAL_PRESETS } from "./menu.js";
import type { LobbyModel } from "./presenter.js";
import { text } from "./screen.js";

/**
 * An online room's lobby in Fusetown's paper look: the invitation (QR, code, link), who is in (face, name, how they
 * are), the goals you play for, and for the host the AI and the week's length and START. Every choice goes back as a
 * command through `actions`; what shows is always the last frame's model.
 */
export interface LobbyActions {
  addBot(): void;
  removeBot(id: string): void;
  start(): void;
  /** One goal for all four, as the menu's presets do. */
  goal(goal: number): void;
  level(level: number): void;
  weekSeconds(seconds: number): void;
}

export interface RoomLobbyOptions {
  art: Art;
  code: string;
  link: string;
  qr(value: string): Promise<string>;
  /** A shared-screen room: this screen is the TV, and phones join. */
  tv: boolean;
  actions: LobbyActions;
  /** Extra buttons beside START (e.g. OPEN TV SCREEN). */
  extra?: HTMLElement[];
}

/** The preset all four of these goals match, or 0 when they were set one by one. */
export function presetOf(goals: readonly number[]): number {
  const first = goals[0] ?? 0;
  return goals.every((goal) => goal === first) &&
    GOAL_PRESETS.some((preset) => preset.goal === first)
    ? first
    : 0;
}

export function createRoomLobby(options: RoomLobbyOptions) {
  const { art, actions } = options;
  const element = el("section", "", "fl-lobby fl-sheet");
  element.classList.toggle("tv", options.tv);
  const invite = createInviteCard({
    code: options.code,
    link: options.link,
    qr: options.qr,
    caption: options.tv ? "SCAN WITH YOUR PHONE TO PLAY" : "SCAN TO JOIN",
    classes: {
      root: "fl-invite",
      qr: "fl-invite-qr",
      caption: "fl-invite-caption",
      code: "fl-invite-code",
      link: "fl-invite-link",
      url: "fl-invite-url",
      copy: "fl-invite-copy",
    },
  });
  const title = (words: string) => el("h2", words, "fl-menu-title");

  const roster = el("div", "", "fl-roster");
  roster.setAttribute("aria-label", "Players");
  const rows = new Map<
    string,
    {
      root: HTMLElement;
      face: HTMLElement;
      name: HTMLElement;
      status: HTMLElement;
      remove: HTMLButtonElement;
    }
  >();
  const empty = el("p", "Nobody has joined yet", "fl-roster-empty");

  const segmented = <T>(
    choices: readonly { label: string; value: T }[],
    pick: (value: T) => void,
  ) => {
    const row = el("div", "", "fl-segmented");
    const all = choices.map((choice) => {
      const go = button(choice.label, "fl-segment");
      go.onclick = () => pick(choice.value);
      row.append(go);
      return { go, value: choice.value };
    });
    return {
      row,
      render(current: T, enabled: boolean) {
        for (const { go, value } of all) {
          go.classList.toggle("on", value === current);
          go.setAttribute("aria-pressed", String(value === current));
          go.disabled = !enabled;
        }
      },
    };
  };
  const goals = segmented(
    GOAL_PRESETS.map((preset) => ({
      label: `${preset.label} · ${preset.goal}`,
      value: preset.goal as number,
    })),
    (goal) => actions.goal(goal),
  );
  const level = segmented(
    LEVELS.map((label, value) => ({ label, value })),
    (value) => actions.level(value),
  );
  const week = segmented(
    WEEK_SECONDS.map((seconds) => ({
      label: `${seconds}s`,
      value: seconds as number,
    })),
    (seconds) => actions.weekSeconds(seconds),
  );
  const goalsBlock = el("div", "", "fl-field"),
    levelBlock = el("div", "", "fl-field"),
    weekBlock = el("div", "", "fl-field");
  goalsBlock.append(
    title("YOUR GOALS"),
    el(
      "p",
      "Each player picks their own: reach all four in the same week to win.",
      "fl-hint",
    ),
    goals.row,
  );
  levelBlock.append(title("AI LEVEL"), level.row);
  weekBlock.append(
    title("WEEK LENGTH"),
    el(
      "p",
      "Real seconds. Everyone plays the week at the same time.",
      "fl-hint",
    ),
    week.row,
  );

  const note = el("p", "", "fl-lobby-note");
  note.setAttribute("role", "status");
  const addBot = button("+ ADD AI", "fl-add-bot"),
    start = button("START MATCH", "fui-button-primary fl-start");
  addBot.onclick = () => actions.addBot();
  start.onclick = () => actions.start();
  const buttons = el("div", "", "fl-actions");
  buttons.append(...(options.extra ?? []), addBot, start);

  const who = el("div", "", "fl-field fl-who");
  who.append(title("PLAYERS"), roster, empty);
  const side = el("div", "", "fl-lobby-side");
  side.append(invite.element);
  const body = el("div", "", "fl-lobby-body");
  body.append(who, goalsBlock, levelBlock, weekBlock, note, buttons);
  element.append(side, body);

  return {
    element,
    render(model: LobbyModel, tvHost: boolean): void {
      for (const [id, row] of rows)
        if (!model.members.some((member) => member.id === id)) {
          row.root.remove();
          rows.delete(id);
        }
      model.members.forEach((member, index) => {
        let row = rows.get(member.id);
        if (!row) {
          const root = el("div", "", "fl-roster-row"),
            face = el("span", "", "fl-roster-face"),
            words = el("span", "", "fl-roster-words"),
            name = el("strong", "", "fl-roster-name"),
            status = el("small", "", "fl-roster-status"),
            remove = button("×", "fl-remove");
          remove.onclick = () => actions.removeBot(member.id);
          words.append(name, status);
          root.append(face, words, remove);
          row = { root, face, name, status, remove };
          rows.set(member.id, row);
        }
        if (roster.children[index] !== row.root)
          roster.insertBefore(row.root, roster.children[index] ?? null);
        row.root.style.setProperty("--player", member.color ?? "#8d99ae");
        const avatar = member.avatar ?? "robot";
        if (row.face.dataset.avatar !== avatar) {
          row.face.dataset.avatar = avatar;
          row.face.replaceChildren(
            art.element(`avatar-${avatar}-portrait`, 40),
          );
        }
        text(row.name, member.name);
        text(
          row.status,
          member.status === "BOT"
            ? `AI · ${LEVELS[model.level] ?? ""}`
            : member.status === "AWAY"
              ? "Away"
              : "Ready",
        );
        row.root.classList.toggle("away", member.status === "AWAY");
        const removable = model.removable.includes(member.id);
        row.remove.hidden = !removable;
        row.remove.setAttribute("aria-label", `Remove ${member.name}`);
      });
      empty.hidden = model.members.length > 0;
      goalsBlock.hidden = !model.canPickGoals;
      goals.render(presetOf(model.goals), model.canPickGoals);
      const bots = model.members.some((member) => member.status === "BOT");
      levelBlock.hidden = !bots || !model.canSetLevel;
      level.render(model.level, model.canSetLevel);
      week.render(model.weekSeconds, model.canSetWeek);
      weekBlock.hidden = !model.canSetWeek && tvHost;
      addBot.hidden = !model.canAddBot;
      start.hidden = !model.showStart;
      start.disabled = !model.canStart;
      text(note, model.note);
      note.hidden = !model.note;
    },
  };
}
