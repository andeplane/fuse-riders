import { createBackLink, createPageHeader } from "./back.js";
import { button, el } from "./dom.js";
import { createDialog } from "./dialog.js";
import type { Roster } from "./lobby.js";
import { mountAttract, type AttractFactory } from "./attract.js";

/** The requested seat is carried by the existing game-owned admission action. */
export function requestedRoomSlot(element: HTMLElement): number | undefined {
  const value = element.dataset.slot;
  return value === undefined ? undefined : Number(value);
}

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
  /** Main match action stays beside the invitation, before Game settings. */
  primaryAction?: HTMLElement;
  mainMenuAction?: HTMLElement;
  mainMenuHref?: string;
  title?: string;
  modes?: readonly Node[];
  background?: AttractFactory;
  slotColor?: (slot: number) => string;
  /** What a seat is, when that is more than its number (a role, a team). The seat's number is on its chip. */
  slotLabel?: (slot: number) => string;
  /**
   * The label says what an open seat is (a team, a role) and the row of whoever sits there already says it too: a
   * taken seat then shows the player alone, as a seat with no label does.
   */
  slotLabelOpenOnly?: boolean;
  playerName?: () => string | undefined;
  /**
   * Settings and the main action across the room's top, beside Back, where a dialog's bar has them: they stay on
   * screen however long the room's own choices run. Without it they close the invitation's column.
   */
  actionsInHeader?: boolean;
  /** A game's own actions in the header, before Settings (a song select's OPTIONS). Implies `actionsInHeader`. */
  headerActions?: readonly Node[];
  /**
   * A room on one device (a solo game): one column with no invitation, the seats a strip of who is here and the
   * next open one. Implies `actionsInHeader`.
   */
  compact?: boolean;
  /** Beside Back, in the header. */
  heading?: string;
  /** The host's own choices for the room (a shared TV), under the invitation. */
  extras?: readonly Node[];
  /** The connection's state: one quiet line at the foot of the room. */
  status?: HTMLElement;
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
  const modes = el("div", "", "fui-room-modes", doc);
  modes.setAttribute("role", "group");
  modes.setAttribute("aria-label", "Match size");
  modes.append(...(options.modes ?? []));
  modes.hidden = !options.modes?.length;
  const actions = el("div", "", "fui-room-actions", doc);
  const joinActions = el("div", "", "fui-room-join", doc);
  const slots = el("div", "", "fui-room-open-slots", doc);
  const heading = el("h2", options.title ?? "Players", "", doc);
  const count = el("span", "", "fui-room-count", doc);
  heading.append(count);
  const compact = options.compact === true,
    inHeader =
      compact ||
      options.actionsInHeader === true ||
      Boolean(options.headerActions?.length);
  if (invite) left.append(invite);
  else if (!compact)
    left.append(
      el("h2", "Your room", "", doc),
      el("p", "Play together on this device.", "", doc),
    );
  left.append(...(options.extras ?? []));
  const settings = createDialog({ title: "Game settings", document: doc });
  settings.dialog.classList.add("fui-menu-dialog");
  const configure =
    options.settingsTrigger ??
    button("Game settings", "fui-room-settings", doc);
  configure.textContent = inHeader ? "Settings" : "Game settings";
  configure.setAttribute("aria-label", "Game settings");
  configure.classList.add("fui-room-configure");
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
  const primary = options.primaryAction
    ? el("div", "", "fui-room-primary-action", doc)
    : undefined;
  primary?.append(options.primaryAction!);
  if (!inHeader) {
    if (primary) left.append(primary);
    left.append(configure);
  }
  // The way out is Back, top left, as on every other page: not a button among the room's own.
  const location = doc.defaultView?.location;
  const mainMenu =
    options.mainMenuAction ??
    createBackLink({
      href:
        options.mainMenuHref ??
        `${location?.pathname ?? "./"}${new URLSearchParams(location?.search).has("mute") ? "?mute" : ""}`,
      document: doc,
    });
  mainMenu.classList.add("fui-back", "fui-room-main-menu");
  // In the header the order is a dialog bar's: a game's own actions, Settings, and the main action last.
  const head = createPageHeader({
    back: mainMenu,
    ...(options.heading || compact
      ? { title: options.heading ?? "Your room" }
      : {}),
    ...(inHeader
      ? {
          actions: [
            ...(options.headerActions ?? []),
            configure,
            ...(primary ? [primary] : []),
          ],
        }
      : {}),
    document: doc,
  });
  head.element.classList.add("fui-room-head");
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
  const admissionDialog = createDialog({
    title: "Join the game",
    document: doc,
  });
  admissionDialog.dialog.classList.add("fui-menu-dialog", "fui-slot-admission");
  const parking = el("div", "", "fui-slot-parking", doc);
  parking.hidden = true;
  let occupiedCount = 0;
  let occupiedSlots: Set<number> | undefined;
  const joinSlot = (index: number) => {
    if (!admission) return;
    admission.dataset.slot = String(index);
    const input = admission.querySelector<HTMLInputElement>(
      'input:not([type="checkbox"]):not([type="radio"])',
    );
    const accountName = options.playerName?.();
    if (input && accountName) input.value = accountName;
    if (input?.value.trim()) {
      admission.requestSubmit();
      if (input.getAttribute("aria-invalid") === "true")
        admissionDialog.show({ title: `Join seat ${index + 1}` });
    } else {
      admissionDialog.show({ title: `Join seat ${index + 1}` });
      input?.focus();
    }
  };
  const createSlot = (index: number) => {
    const slot = el("div", "", "fui-room-open-slot", doc);
    // The number is the seat's own: a label says more only when a game has more to say.
    const chip = el("span", String(index + 1), "fui-slot-chip", doc);
    chip.setAttribute("aria-hidden", "true");
    if (!options.slotLabel) slot.classList.add("fui-slot-plain");
    const label = el("span", "", "fui-slot-label", doc);
    const controls = el("div", "", "fui-slot-controls", doc);
    const occupant = el("ul", "", "fui-slot-occupant", doc);
    const join = button("Join", "fui-slot-join", doc),
      ai = button("Add AI", "fui-slot-ai", doc);
    join.onclick = () => joinSlot(index);
    ai.onclick = () => {
      if (options.addAI) {
        options.addAI.dataset.slot = String(index);
        options.addAI.click();
      }
    };
    controls.append(join, ai);
    slot.append(chip, label, controls, occupant);
    if (options.slotColor)
      slot.style.setProperty("--slot-color", options.slotColor(index));
    slot.dataset.slot = String(index);
    return slot;
  };
  for (let i = 0; i < options.capacity; i++) {
    const slot = createSlot(i);
    emptySlots.push(slot);
    slots.append(slot);
  }
  actions.append(
    ...(options.actions ?? []).filter((node) => node !== options.primaryAction),
  );
  // Who is here and where to join come first, in every game: a game's own choices (modes, maps, songs) follow.
  right.append(heading, roster, slots, joinActions, modes, actions);
  root.classList.add("fui-room-layout");
  root.classList.toggle("fui-room-compact", compact);
  root.classList.toggle("fui-room-actions-top", inHeader);
  const foot = el("div", "", "fui-room-status", doc);
  if (options.status) foot.append(options.status);
  root.replaceChildren(
    head.element,
    ...(compact ? [] : [left]),
    right,
    ...(options.status ? [foot] : []),
    settings.dialog,
    admissionDialog.dialog,
    parking,
  );
  joinActions.hidden = true;
  const placeAdmission = () => {
    if (!admission) return;
    if (!root.hidden && admission.parentElement !== admissionDialog.body)
      admissionDialog.body.append(admission);
    else if (root.hidden && admission.parentElement === admissionDialog.body) {
      if (joinHome?.isConnected) joinHome.after(admission);
      else root.after(admission);
    }
    if ((root.hidden || admission.hidden) && admissionDialog.dialog.open)
      admissionDialog.dialog.close();
  };
  let stopBackground: (() => void) | undefined;
  let active = true;
  const syncBackground = () => {
    if (!options.background) return;
    if (root.hidden || !active) {
      stopBackground?.();
      stopBackground = undefined;
    } else if (!stopBackground && root.isConnected) {
      root
        .querySelectorAll(":scope > .fui-attract, :scope > .fui-attract-toggle")
        .forEach((node) => node.remove());
      stopBackground = mountAttract(root, options.background);
    }
  };
  let capacity = options.capacity;
  const update = (
    occupied: number,
    nextCapacity = capacity,
    seats?: readonly number[],
  ) => {
    if (seats) occupiedSlots = new Set(seats);
    occupiedCount = occupied;
    capacity = nextCapacity;
    // Game settings closes the invitation's column, under START and whatever a game put there since.
    if (
      !root.hidden &&
      configure.parentElement === left &&
      left.lastElementChild !== configure
    )
      left.append(configure);
    const renderedCapacity = Math.max(
      capacity,
      occupied,
      ...[...(occupiedSlots ?? [])].map((slot) => slot + 1),
    );
    while (emptySlots.length < renderedCapacity) {
      const slot = createSlot(emptySlots.length);
      emptySlots.push(slot);
      slots.append(slot);
    }
    // Keep references before clearing old slots: a team switch moves a persistent roster row.
    const rows = new Map<number, HTMLElement>();
    const registered =
      "entries" in options.roster
        ? [...options.roster.entries()].map(([, row]) => row)
        : [];
    for (const row of [
      ...slots.querySelectorAll<HTMLElement>(
        ".fui-slot-occupant > [data-slot]",
      ),
      ...roster.querySelectorAll<HTMLElement>("[data-slot]"),
      ...registered,
    ]) {
      if (row.dataset.slot !== undefined)
        rows.set(Number(row.dataset.slot), row);
    }
    const text = `${occupied} / ${capacity}`;
    if (count.textContent !== text) count.textContent = text;
    emptySlots.forEach((slot, index) => {
      const taken = occupiedSlots ? occupiedSlots.has(index) : index < occupied;
      slot.hidden = index >= capacity && !taken;
      const custom = options.slotLabel?.(index);
      const label = taken
        ? (custom ?? `Seat ${index + 1}`)
        : custom
          ? `${custom} · Open`
          : "Open seat";
      const text = slot.querySelector(".fui-slot-label")!;
      if (text.textContent !== label) text.textContent = label;
      slot.classList.toggle("fui-slot-occupied", taken);
      slot.classList.toggle(
        "fui-slot-plain",
        !options.slotLabel || (taken && !!options.slotLabelOpenOnly),
      );
      (slot.querySelector(".fui-slot-controls") as HTMLElement).hidden = taken;
      if (!taken) slot.querySelector(".fui-slot-occupant")!.replaceChildren();
      const join = slot.querySelector<HTMLButtonElement>(".fui-slot-join")!,
        ai = slot.querySelector<HTMLButtonElement>(".fui-slot-ai")!;
      join.hidden = !admission || admission.hidden;
      join.disabled =
        admission?.querySelector<HTMLButtonElement>('button[type="submit"]')
          ?.disabled ?? false;
      ai.hidden = !options.addAI || options.addAI.hidden;
      ai.disabled = options.addAI?.disabled ?? true;
      // Open, with nothing this viewer can do about it: the seat says so quietly and takes less room.
      slot.classList.toggle(
        "fui-slot-idle",
        !taken && join.hidden && ai.hidden,
      );
    });
    for (const [index, row] of rows) {
      if (occupiedSlots ? !occupiedSlots.has(index) : index >= occupied)
        continue;
      const target = emptySlots[index]?.querySelector(".fui-slot-occupant");
      if (
        target &&
        (target.firstElementChild !== row || target.children.length !== 1)
      )
        target.replaceChildren(row);
    }
    if (admission) {
      const join = admission;
      placeAdmission();
      const submit = join.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      if (submit && submit.textContent !== "Join") submit.textContent = "Join";
    }
    if (root.hidden && settings.dialog.open) settings.dialog.close();
    syncBackground();
  };
  if ("observe" in options.roster) {
    const list = options.roster;
    list.observe((members) => {
      occupiedSlots = members.every((member) => member.slot !== undefined)
        ? new Set(members.map((member) => member.slot!))
        : undefined;
      for (const [id, row] of list.entries()) {
        row.classList.add("fui-roster-row");
        const member = members.find((member) => member.id === id);
        if (member)
          row.dataset.slot = String(member.slot ?? members.indexOf(member));
      }
      update(members.length);
    });
  }
  update(0);
  const Observer = doc.defaultView?.MutationObserver;
  const observer = Observer
    ? new Observer(() => {
        placeAdmission();
        update(occupiedCount);
      })
    : undefined;
  observer?.observe(root, { attributes: true, attributeFilter: ["hidden"] });
  observer?.observe(roster, { childList: true });
  if (admission)
    observer?.observe(admission, {
      attributes: true,
      attributeFilter: ["hidden"],
    });
  if (options.addAI)
    observer?.observe(options.addAI, {
      attributes: true,
      attributeFilter: ["hidden", "disabled"],
    });
  return {
    element: root,
    update,
    settings: settings.dialog,
    setActive(active: boolean) {
      if (!active && settings.dialog.open) settings.dialog.close();
      if (!active && admissionDialog.dialog.open)
        admissionDialog.dialog.close();
      setBackgroundActive(active);
    },
    dispose() {
      observer?.disconnect();
      stopBackground?.();
    },
    attachJoin(form: HTMLFormElement) {
      admission = form;
      joinHome = doc.createComment("Late join form");
      form.before(joinHome);
      observer?.observe(form, {
        attributes: true,
        attributeFilter: ["hidden"],
      });
      placeAdmission();
      update(occupiedCount);
    },
  };
  function setBackgroundActive(value: boolean) {
    active = value;
    syncBackground();
  }
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
  primaryAction?: string;
  mainMenu?: string;
  occupied: number;
  capacity: number;
  occupiedSlots?: readonly number[];
  canJoin?: boolean;
  canAddAI?: boolean;
  slotColors?: readonly string[];
  slotPlayers?: readonly { slot: number; html: string }[];
}): string {
  const open = Array.from(
    {
      length: Math.max(
        options.capacity,
        ...(options.occupiedSlots ?? []).map((slot) => slot + 1),
      ),
    },
    (_, index) =>
      (
        options.occupiedSlots
          ? options.occupiedSlots.includes(index)
          : index < options.occupied
      )
        ? `<div class="fui-room-open-slot fui-slot-plain fui-slot-occupied" data-slot="${index}" style="--slot-color:${options.slotColors?.[index] ?? "#b9d0e1"}"><span class="fui-slot-chip" aria-hidden="true">${index + 1}</span><span class="fui-slot-label">Seat ${index + 1}</span><ul class="fui-slot-occupant">${options.slotPlayers?.find((player) => player.slot === index)?.html ?? ""}</ul></div>`
        : index >= options.capacity
          ? ""
          : `<div class="fui-room-open-slot fui-slot-plain${options.canJoin || options.canAddAI ? "" : " fui-slot-idle"}" data-slot="${index}" style="--slot-color:${options.slotColors?.[index] ?? "#b9d0e1"}"><span class="fui-slot-chip" aria-hidden="true">${index + 1}</span><span class="fui-slot-label">Open seat</span><div class="fui-slot-controls">${options.canJoin ? `<button data-action="take-slot" data-slot="${index}">Join</button>` : ""}${options.canAddAI ? `<button data-action="add-bot" data-slot="${index}">Add AI</button>` : ""}</div></div>`,
  ).join("");
  return `<main class="fui-room-layout"><header class="fui-page-head fui-room-head">${options.mainMenu ?? '<a class="fui-back fui-room-main-menu" href="./" aria-label="Back">Back</a>'}</header><aside class="fui-room-invitation">${options.invite}${options.primaryAction ? `<div class="fui-room-primary-action">${options.primaryAction}</div>` : ""}<button class="fui-room-configure" data-action="open-room-settings">Game settings</button></aside><section class="fui-room-players"><h2>Players <span class="fui-room-count">${options.occupied} / ${options.capacity}</span></h2>${options.players}<div class="fui-room-open-slots">${open}</div><div class="fui-room-actions">${options.actions}</div></section><dialog class="fui-dialog fui-menu-dialog fui-slot-admission" data-room-name aria-label="Join the game"><header class="fui-dialog-bar"><button class="fui-back" data-action="close-room-name" aria-label="Back">Back</button><strong class="fui-dialog-title">Join the game</strong></header><div class="fui-dialog-body">${options.join}</div></dialog><dialog class="fui-dialog fui-menu-dialog" data-room-settings aria-label="Game settings"><header class="fui-dialog-bar"><button class="fui-back" data-action="close-room-settings" aria-label="Back">Back</button><strong class="fui-dialog-title">Game settings</strong></header><div class="fui-dialog-body">${options.settings}</div></dialog></main>`;
}
