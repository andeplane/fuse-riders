import { button, el } from "./dom.js";
import { createDialog } from "./dialog.js";
import type { Roster } from "./lobby.js";

export interface RoomLayoutOptions {
  element: HTMLElement;
  invite?: HTMLElement;
  roster: Roster | HTMLElement;
  capacity: number;
  join?: HTMLFormElement;
  appearance?: readonly Node[];
  addAI?: HTMLButtonElement;
  settings?: readonly Node[];
  settingsTrigger?: HTMLButtonElement;
  onSettings?: () => void;
  actions?: readonly Node[];
  title?: string;
}

/** A shared waiting room; adapters keep their existing commands, permissions and state updates. */
export function createRoomLayout(options: RoomLayoutOptions) {
  const root = options.element,
    doc = root.ownerDocument;
  const invite =
    options.invite ??
    root.querySelector<HTMLElement>(".fui-invite") ??
    undefined;
  if (invite) {
    invite.classList.add("fui-invite");
    invite.querySelector("img")?.classList.add("fui-invite-qr");
    invite.querySelector("strong")?.classList.add("fui-room-code");
    invite.querySelector("p")?.classList.add("fui-invite-caption");
  }
  const roster =
    "element" in options.roster ? options.roster.element : options.roster;
  roster.classList.add("fui-roster");
  if ("empty" in options.roster)
    options.roster.empty?.classList.add("fui-roster-empty");
  const left = el("aside", "", "fui-room-invitation", doc);
  const right = el("section", "", "fui-room-players", doc);
  const actions = el("div", "", "fui-room-actions", doc);
  const joinActions = el("div", "", "fui-room-join", doc);
  const slots = el("div", "", "fui-room-open-slots", doc);
  const heading = el("h2", options.title ?? "Players", "", doc);
  const count = el("span", "", "fui-room-count", doc);
  heading.append(count);
  if (invite) left.append(invite);
  else
    left.append(
      el("h2", "Your room", "", doc),
      el("p", "Play together on this device.", "", doc),
    );
  const settings = createDialog({ title: "Game settings", document: doc });
  settings.dialog.classList.add("fui-menu-dialog");
  const configure =
    options.settingsTrigger ??
    button("Game settings", "fui-room-settings", doc);
  configure.textContent = "Game settings";
  configure.onclick =
    options.onSettings ?? (() => settings.show({ title: "Game settings" }));
  if (options.settings?.length) {
    settings.body.append(...options.settings);
  } else
    settings.body.append(
      el(
        "p",
        "This game uses fixed match rules. Invite your friends, take a slot and start when everyone is ready.",
        "",
        doc,
      ),
    );
  left.append(configure);
  let joinHome: Comment | undefined;
  let admission = options.join;
  if (admission && options.appearance?.length)
    admission.append(createRoomAppearance(options.appearance, doc));
  if (admission?.parentNode) {
    joinHome = doc.createComment("Late join form returns here during play");
    admission.before(joinHome);
  }
  if (options.addAI) {
    options.addAI.textContent = "Add AI";
    joinActions.append(options.addAI);
  }
  const emptySlots: HTMLElement[] = [];
  for (let i = 0; i < options.capacity; i++) {
    const slot = el("div", "", "fui-room-open-slot", doc);
    emptySlots.push(slot);
    slots.append(slot);
  }
  actions.append(...(options.actions ?? []));
  right.append(heading, roster, slots, joinActions, actions);
  root.classList.add("fui-room-layout");
  root.replaceChildren(left, right, settings.dialog);
  const update = (occupied: number) => {
    const text = `${occupied} / ${options.capacity}`;
    if (count.textContent !== text) count.textContent = text;
    emptySlots.forEach((slot, index) => {
      slot.hidden = index < occupied;
      const label = `Slot ${index + 1} · Open`;
      if (slot.textContent !== label) slot.textContent = label;
    });
    if (admission) {
      const join = admission;
      if (!root.hidden && join.parentElement !== joinActions)
        joinActions.prepend(join);
      else if (root.hidden && join.parentElement === joinActions) {
        if (joinHome?.isConnected) joinHome.after(join);
        else if (root.isConnected) root.after(join);
      }
      const submit = join.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (submit && submit.textContent !== "Join") submit.textContent = "Join";
    }
    if (root.hidden && settings.dialog.open) settings.dialog.close();
  };
  if ("observe" in options.roster) {
    const list = options.roster;
    list.observe((members) => {
      for (const [, row] of list.entries()) row.classList.add("fui-roster-row");
      update(members.length);
    });
  }
  update(0);
  return {
    element: root,
    update,
    settings: settings.dialog,
    setActive(active: boolean) {
      if (!active && settings.dialog.open) settings.dialog.close();
    },
    attachJoin(form: HTMLFormElement) {
      admission = form;
      joinHome = doc.createComment("Late join form");
      form.before(joinHome);
      joinActions.prepend(form);
    },
  };
}

export function createRoomAppearance(content: readonly Node[], doc: Document) {
  const details = el("details", "", "join-appearance", doc);
  details.append(el("summary", "Appearance", "", doc), ...content);
  return details;
}

/** The same layout for apps that reconcile escaped HTML instead of retaining DOM nodes.
 * All HTML slots are authored and escaped by the calling game's existing markup renderer.
 */
export function roomLayoutMarkup(options: {
  invite: string;
  players: string;
  join: string;
  settings: string;
  actions: string;
  occupied: number;
  capacity: number;
}): string {
  const open = Array.from(
    { length: Math.max(0, options.capacity - options.occupied) },
    (_, index) =>
      `<div class="fui-room-open-slot">Slot ${options.occupied + index + 1} · Open</div>`,
  ).join("");
  return `<main class="fui-room-layout"><aside class="fui-room-invitation">${options.invite}<button data-action="open-room-settings">Game settings</button></aside><section class="fui-room-players"><h2>Players <span class="fui-room-count">${options.occupied} / ${options.capacity}</span></h2>${options.players}<div class="fui-room-open-slots">${open}</div><div class="fui-room-join">${options.join}</div><div class="fui-room-actions">${options.actions}</div></section><dialog class="fui-dialog fui-menu-dialog" data-room-settings aria-label="Game settings"><header class="fui-dialog-bar"><strong>Game settings</strong><button data-action="close-room-settings">Close</button></header><div class="fui-dialog-body">${options.settings}</div></dialog></main>`;
}
