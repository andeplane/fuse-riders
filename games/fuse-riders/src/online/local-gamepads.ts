import {
  activeBinding,
  readGamepads,
  STANDARD_PAD,
  type PadAssignment,
  type PadBinding,
  type PadMapping,
  type PadSnapshot,
} from "../client/controller-gamepad.js";
import { MAX_PLAYERS } from "../engine/tuning.js";
import {
  LOCAL_KEYBOARD_PRESETS,
  keyboardKeyLabel,
  type KeyboardControls,
} from "../client/controller-keyboard.js";
import { MAX_RIDER_NAME, seatRiderName } from "../engine/rider-name.js";
import { node as createNode, setIfChanged } from "./dom.js";

export type LocalPlayer = { name: string } & (
  { pad: PadAssignment; keys?: never } | { keys: KeyboardControls; pad?: never }
);
interface KeyboardRow {
  name: HTMLInputElement;
  controls: Record<keyof KeyboardControls, HTMLSelectElement>;
}
interface PadRow {
  pad: PadSnapshot;
  enabled: HTMLInputElement;
  name: HTMLInputElement;
  status: HTMLElement;
  detail: HTMLElement;
  error?: string;
  mapping?: PadMapping;
  calibration?: { step: number; neutral: boolean; bindings: PadBinding[] };
}
export interface LocalSetupEnvironment {
  document: Document;
  readPads: () => ReturnType<typeof readGamepads>;
  requestFrame: (callback: () => void) => number;
  cancelFrame: (id: number) => void;
  onPageHide: (callback: () => void) => void;
  onPageRestore: (callback: () => void) => void;
  backUrl: string;
}

/** Setup is page-local: no controller identity or binding is persisted. */
export function setupLocalPlayers(
  app: HTMLElement,
  environment?: LocalSetupEnvironment,
): Promise<LocalPlayer[]> {
  const env = environment ?? {
    document: app.ownerDocument,
    readPads: () => readGamepads(navigator),
    requestFrame: (callback: () => void) => requestAnimationFrame(callback),
    cancelFrame: (id: number) => cancelAnimationFrame(id),
    onPageHide: (callback: () => void) =>
      window.addEventListener("pagehide", callback),
    onPageRestore: (callback: () => void) =>
      window.addEventListener("pageshow", (event) => {
        if (event.persisted) callback();
      }),
    backUrl: "./",
  };
  const node: typeof createNode = (tag, text, className) =>
    createNode(tag, text, className, env.document);
  return new Promise((resolve) => {
    const panel = node("main", "", "local-setup");
    panel.append(
      node("h1", "PLAY LOCAL"),
      node(
        "p",
        "Connect your controllers, then press a button on each one to detect it. Up to five players share this screen; AI fills the spare seats.",
      ),
    );
    const help = node(
      "p",
      "Standard controls: D-pad or left stick to steer. Hold the bottom face button to aim, release to fire. Start rematches after closing the results. Controllers with a different layout can be configured below.",
    );
    const status = node("p");
    status.setAttribute("role", "status");
    const retry = node("button", "RETRY DETECTION");
    retry.hidden = true;
    const list = node("section", "", "local-setup-list");
    const keyboardList = node("section", "", "local-setup-list");
    const addKeyboard = node("button", "ADD KEYBOARD PLAYER");
    const start = node("button", "START LOCAL GAME");
    start.disabled = true;
    const back = node("a", "BACK");
    back.href = env.backUrl;
    const actions = node("div", "", "local-setup-actions");
    actions.append(start, back);
    panel.append(
      help,
      status,
      retry,
      list,
      node(
        "p",
        "Add one keyboard player per keyboard-mode controller. Left / right / fire defaults: A / D / Space, then E / F / M, then I / G / K. You can change every key below.",
      ),
      keyboardList,
      addKeyboard,
      actions,
    );
    app.replaceChildren(panel);
    const rows = new Map<number, PadRow>();
    const keyboards = new Map<number, KeyboardRow>();
    let failed = false,
      done = false,
      finished = false,
      frame = 0,
      failure = "";
    retry.onclick = () => {
      failed = false;
    };
    const selected = () =>
      [...rows.values()].filter((r) => r.enabled.checked && r.pad.connected);
    addKeyboard.onclick = () => {
      if (selected().length + keyboards.size >= MAX_PLAYERS) return;
      let slot = 0;
      while (keyboards.has(slot)) slot++;
      const preset = LOCAL_KEYBOARD_PRESETS[slot]!;
      const row = node("div", "", "local-pad local-keyboard"),
        name = node("input");
      name.type = "text";
      name.value = `Keyboard ${slot + 1}`;
      name.maxLength = MAX_RIDER_NAME;
      name.setAttribute("aria-label", `Keyboard ${slot + 1} player name`);
      row.append(name);
      const fields = node("div", "", "local-keys");
      const controls = {} as Record<keyof KeyboardControls, HTMLSelectElement>;
      for (const control of ["left", "right", "bomb"] as const) {
        const label = node(
            "label",
            control === "bomb" ? "FIRE" : control.toUpperCase(),
          ),
          select = node("select");
        select.setAttribute("aria-label", `Keyboard ${slot + 1} ${control}`);
        const choices = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
          .map((letter) => `Key${letter}`)
          .concat(
            ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"],
            [..."0123456789"].map((n) => `Digit${n}`),
          );
        for (const code of choices) {
          const option = node("option", keyboardKeyLabel(code));
          option.value = code;
          option.selected = code === preset[control];
          select.append(option);
        }
        controls[control] = select;
        label.append(select);
        fields.append(label);
      }
      const remove = node("button", "REMOVE");
      remove.setAttribute("aria-label", `Remove keyboard ${slot + 1}`);
      remove.onclick = () => {
        keyboards.delete(slot);
        row.remove();
      };
      row.append(fields, remove);
      keyboardList.append(row);
      keyboards.set(slot, { name, controls });
    };
    const add = (pad: PadSnapshot) => {
      const row = node("div", "", "local-pad"),
        label = node("label"),
        enabled = node("input"),
        name = node("input");
      enabled.type = "checkbox";
      enabled.checked = selected().length + keyboards.size < MAX_PLAYERS;
      enabled.setAttribute("aria-label", `Use controller ${pad.index + 1}`);
      name.type = "text";
      name.value = `Player ${pad.index + 1}`;
      name.maxLength = MAX_RIDER_NAME;
      name.setAttribute(
        "aria-label",
        `Controller ${pad.index + 1} player name`,
      );
      label.append(enabled, node("span", `PAD ${pad.index + 1}`), name);
      const detail = node("small", pad.id),
        connection = node("small");
      const configure = node("button", "CONFIGURE CONTROLS");
      const entry: PadRow = {
        pad,
        enabled,
        name,
        status: connection,
        detail,
        ...(pad.mapping === "standard" ? { mapping: STANDARD_PAD } : {}),
      };
      configure.onclick = () => {
        entry.error = undefined;
        entry.mapping = undefined;
        entry.calibration = { step: 0, neutral: false, bindings: [] };
      };
      row.append(label, detail, connection, configure);
      list.append(row);
      rows.set(pad.index, entry);
    };
    const poll = () => {
      if (done) return;
      if (!failed) {
        const result = env.readPads();
        failed = Boolean(result.error);
        failure = result.error ?? "";
        setIfChanged(retry, "hidden", !failed);
        for (const row of rows.values())
          row.pad = { ...row.pad, connected: false };
        for (const pad of result.pads) {
          const row = rows.get(pad.index);
          if (!row) add(pad);
          else {
            if (row.pad.id !== pad.id) {
              row.mapping =
                pad.mapping === "standard" ? STANDARD_PAD : undefined;
              row.calibration = undefined;
              row.error = undefined;
              setIfChanged(row.detail, "textContent", pad.id);
            }
            row.pad = pad;
          }
        }
        for (const row of rows.values()) {
          let message = row.pad.connected
            ? row.mapping
              ? "Connected · ready"
              : (row.error ?? "Connected · configure controls to play")
            : "Disconnected · reconnect this controller";
          const calibration = row.calibration;
          if (calibration && row.pad.connected) {
            const binding = activeBinding(row.pad, calibration.step === 2);
            if (!activeBinding(row.pad)) calibration.neutral = true;
            if (calibration.neutral && binding) {
              calibration.bindings.push(binding);
              calibration.step++;
              calibration.neutral = false;
              if (calibration.step === 3) {
                const [left, right, bomb] = calibration.bindings;
                if (
                  new Set(calibration.bindings.map((b) => JSON.stringify(b)))
                    .size === 3
                ) {
                  row.mapping = {
                    left: [left!],
                    right: [right!],
                    bomb: [bomb!],
                  };
                  message = "Connected · configured";
                } else
                  message = row.error =
                    "Controls must differ. Configure again.";
                row.calibration = undefined;
              }
            }
            if (row.calibration)
              message = calibration.neutral
                ? [
                    "Move your stick / D-pad LEFT",
                    "Move your stick / D-pad RIGHT",
                    "Press your FIRE button",
                  ][calibration.step]!
                : "Release all buttons and center the sticks";
          }
          setIfChanged(row.status, "textContent", message);
        }
      }
      const players = selected(),
        count = players.length + keyboards.size;
      const keyCodes = [...keyboards.values()].flatMap((row) =>
        Object.values(row.controls).map((select) => select.value),
      );
      const conflictingKeys = new Set(keyCodes).size !== keyCodes.length;
      const ready =
        count > 0 &&
        count <= MAX_PLAYERS &&
        !conflictingKeys &&
        [...keyboards.values()].every((r) => seatRiderName(r.name.value)) &&
        players.every((r) => r.mapping && seatRiderName(r.name.value));
      setIfChanged(start, "disabled", !ready);
      setIfChanged(addKeyboard, "disabled", count >= MAX_PLAYERS);
      setIfChanged(
        status,
        "textContent",
        (conflictingKeys
          ? "Each keyboard player needs separate keys. Choose a different key for repeated bindings."
          : "") ||
          failure ||
          (count > MAX_PLAYERS
            ? "Choose at most five players."
            : count
              ? `${count} player${count === 1 ? "" : "s"} · ${MAX_PLAYERS - count} AI rivals`
              : "No controllers detected yet. Press a button, or add a keyboard player."),
      );
      frame = env.requestFrame(poll);
    };
    start.onclick = () => {
      if (start.disabled) return;
      const players: LocalPlayer[] = [...keyboards.values()].map((row) => ({
        name: seatRiderName(row.name.value)!,
        keys: {
          left: row.controls.left.value,
          right: row.controls.right.value,
          bomb: row.controls.bomb.value,
        },
      }));
      for (const row of selected())
        players.push({
          name: seatRiderName(row.name.value)!,
          pad: {
            index: row.pad.index,
            id: row.pad.id,
            mapping: row.mapping!,
            standard: row.pad.mapping === "standard",
          },
        });
      done = true;
      finished = true;
      env.cancelFrame(frame);
      resolve(players);
    };
    env.onPageHide(() => {
      done = true;
      env.cancelFrame(frame);
    });
    env.onPageRestore(() => {
      if (finished || !done) return;
      done = false;
      poll();
    });
    poll();
  });
}
